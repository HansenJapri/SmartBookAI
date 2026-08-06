// ============================================================
// monitoring.js — sebelumnya 0% coverage.
//
// Modul ini dipanggil dari ErrorBoundary saat aplikasi sedang bermasalah, jadi
// dua sifatnya wajib dikunci:
//
//   1. TIDAK PERNAH melempar. Kalau pencatatan error ikut error, layar putih
//      yang seharusnya dicegah ErrorBoundary justru terjadi.
//   2. Throttle + dedupe bekerja. Satu error di dalam loop render bisa memicu
//      ribuan panggilan; tanpa rem, tabel app_events terisi sampah dan biaya
//      Supabase naik karena bug yang sama.
//
// State-nya (penghitung + set) ada di level modul, jadi tiap test memuat ulang
// modulnya lewat vi.resetModules() agar tidak saling mewarisi hitungan.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getUser = vi.fn()
const insert = vi.fn()
const from = vi.fn(() => ({ insert }))

vi.mock('../supabase', () => ({
  supabase: { auth: { get getUser() { return getUser } }, get from() { return from } },
}))

async function muatUlang() {
  vi.resetModules()
  return await import('../monitoring')
}

beforeEach(() => {
  getUser.mockReset().mockResolvedValue({ data: { user: { id: 'u1' } } })
  insert.mockReset().mockResolvedValue({ error: null })
  from.mockClear()
})

describe('logClientError', () => {
  it('mencatat error ke tabel app_events dengan tipe client_error', async () => {
    const { logClientError } = await muatUlang()
    await logClientError('react.render', 'Boom')

    expect(from).toHaveBeenCalledWith('app_events')
    const baris = insert.mock.calls[0][0]
    expect(baris.user_id).toBe('u1')
    expect(baris.type).toBe('client_error')
    expect(baris.meta).toMatchObject({ kind: 'react.render', message: 'Boom' })
  })

  it('menyertakan path dan user agent untuk diagnosis', async () => {
    const { logClientError } = await muatUlang()
    await logClientError('react.render', 'Boom')
    const meta = insert.mock.calls[0][0].meta
    expect(meta).toHaveProperty('path')
    expect(meta).toHaveProperty('ua')
  })

  it('meneruskan data tambahan dari pemanggil', async () => {
    const { logClientError } = await muatUlang()
    await logClientError('react.render', 'Boom', { stack: 'at foo()' })
    expect(insert.mock.calls[0][0].meta.stack).toBe('at foo()')
  })

  it('memotong pesan pada 400 karakter', async () => {
    const { logClientError } = await muatUlang()
    await logClientError('x', 'a'.repeat(600))
    expect(insert.mock.calls[0][0].meta.message).toHaveLength(400)
  })

  it('mengabaikan pesan kosong tanpa menyentuh database', async () => {
    const { logClientError } = await muatUlang()
    await logClientError('x', '')
    await logClientError('x', null)
    await logClientError('x', undefined)
    expect(insert).not.toHaveBeenCalled()
  })

  it('tidak mencatat apa pun saat belum login (RLS app_events butuh sesi)', async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    const { logClientError } = await muatUlang()
    await logClientError('x', 'Boom')
    expect(insert).not.toHaveBeenCalled()
  })
})

describe('throttle & dedupe', () => {
  it('error yang sama persis hanya dicatat sekali', async () => {
    const { logClientError } = await muatUlang()
    for (let i = 0; i < 5; i++) await logClientError('react.render', 'Boom')
    expect(insert).toHaveBeenCalledTimes(1)
  })

  it('membedakan berdasarkan jenis DAN pesan', async () => {
    const { logClientError } = await muatUlang()
    await logClientError('a', 'Boom')
    await logClientError('b', 'Boom')     // jenis beda -> dicatat
    await logClientError('a', 'Bang')     // pesan beda -> dicatat
    await logClientError('a', 'Boom')     // duplikat  -> diabaikan
    expect(insert).toHaveBeenCalledTimes(3)
  })

  it('berhenti mencatat setelah 20 error berbeda dalam satu sesi', async () => {
    const { logClientError } = await muatUlang()
    for (let i = 0; i < 30; i++) await logClientError('x', `Error ke-${i}`)
    expect(insert).toHaveBeenCalledTimes(20)
  })
})

describe('ketahanan — tidak boleh mengganggu UX', () => {
  it('tidak melempar saat penulisan ke database gagal', async () => {
    insert.mockRejectedValue(new Error('jaringan putus'))
    const { logClientError } = await muatUlang()
    await expect(logClientError('x', 'Boom')).resolves.toBeUndefined()
  })

  it('tidak melempar saat sesi tidak bisa dibaca', async () => {
    getUser.mockRejectedValue(new Error('auth mati'))
    const { logClientError } = await muatUlang()
    await expect(logClientError('x', 'Boom')).resolves.toBeUndefined()
  })
})

describe('initMonitoring', () => {
  it('menangkap error global window dan meneruskan lokasinya', async () => {
    const { initMonitoring } = await muatUlang()
    initMonitoring()

    window.dispatchEvent(Object.assign(new Event('error'), {
      message: 'Gagal total', filename: 'app.js', lineno: 42,
    }))
    await vi.waitFor(() => expect(insert).toHaveBeenCalled())

    const meta = insert.mock.calls[0][0].meta
    expect(meta).toMatchObject({ kind: 'window.error', message: 'Gagal total', src: 'app.js', line: 42 })
  })

  it('menangkap promise yang ditolak tanpa penangan', async () => {
    const { initMonitoring } = await muatUlang()
    initMonitoring()

    window.dispatchEvent(Object.assign(new Event('unhandledrejection'), {
      reason: new Error('Janji ingkar'),
    }))
    await vi.waitFor(() => expect(insert).toHaveBeenCalled())
    expect(insert.mock.calls[0][0].meta).toMatchObject({
      kind: 'unhandledrejection', message: 'Janji ingkar',
    })
  })
})
