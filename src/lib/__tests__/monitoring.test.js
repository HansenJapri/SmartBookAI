// ============================================================
// monitoring.js — kontrak pencatatan error klien.
//
// CATATAN PERUBAHAN (9 September 2026)
// ------------------------------------
// Test ini DULU mengunci perilaku lama: menulis ke tabel `app_events` bertipe
// 'client_error', berhenti setelah 20 error per sesi, dan dedupe di dalam satu
// tab browser saja.
//
// Perilaku itu diganti — bukan dihapus — karena tiga cacatnya baru terlihat
// ketika benar-benar dibutuhkan:
//
//   1. `if (!user) return` membuat error SEBELUM login tidak pernah tercatat.
//      Padahal layar Masuk & Daftar adalah tempat orang paling mungkin berhenti
//      memakai aplikasi, dan pemadaman CORS 8 September 2026 memukul persis
//      seluruh jalur itu. Kebutaan pada bagian corong paling rapuh.
//   2. Semuanya masuk satu kolom `meta` jsonb tanpa fitur/aksi/tingkat, jadi
//      "fitur mana yang paling sering rusak?" tidak bisa dijawab.
//   3. Dedupe hanya per sesi browser: bug yang menimpa 50 pengguna tampak
//      sebagai 50 kejadian tak berhubungan.
//
// Yang dikunci sekarang adalah kontrak baru — termasuk secara eksplisit
// perbaikan nomor 1, supaya tidak ada yang memasang kembali gerbang login itu
// tanpa sadar apa yang hilang bersamanya.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
const getUser = vi.fn()

vi.mock('../supabase', () => ({
  supabase: { get rpc() { return rpc }, auth: { get getUser() { return getUser } } },
}))

// State peredam ada di level modul (Map sidik -> waktu), jadi tiap test memuat
// ulang modulnya agar tidak saling mewarisi.
async function muatUlang() {
  vi.resetModules()
  return await import('../monitoring')
}

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: 1, error: null })
  getUser.mockReset().mockResolvedValue({ data: { user: null } })
})

describe('logClientError', () => {
  it('mencatat lewat RPC catat_error, bukan menulis tabel langsung', async () => {
    const { logClientError } = await muatUlang()
    await logClientError('react.render', 'Boom')

    expect(rpc).toHaveBeenCalledTimes(1)
    const [nama, arg] = rpc.mock.calls[0]
    expect(nama).toBe('catat_error')
    expect(arg.p_pesan).toBe('Boom')
    expect(arg.p_sumber).toBe('frontend')
  })

  it('menerjemahkan kind teknis jadi nama fitur yang dikenal pengguna', async () => {
    // Yang membaca tab Log Error adalah pemilik produk. "react.render" tidak
    // memberitahunya bagian mana dari aplikasinya yang sedang rusak.
    const { logClientError } = await muatUlang()
    await logClientError('react.render', 'Boom')
    expect(rpc.mock.calls[0][1].p_fitur).toBe('Render halaman')
  })

  it('TETAP mencatat walau tidak ada sesi login', async () => {
    // Inilah perbaikan paling penting dari versi lama. Error pada layar Masuk
    // & Daftar terjadi sebelum ada sesi; menolaknya berarti membutakan diri
    // pada bagian corong yang paling rapuh.
    getUser.mockResolvedValue({ data: { user: null } })
    const { logClientError } = await muatUlang()
    await logClientError('window.error', 'Gagal memuat sebelum login')
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('meneruskan data tambahan sebagai konteks', async () => {
    const { logClientError } = await muatUlang()
    await logClientError('window.error', 'Boom', { berkas: 'app.js', baris: 12 })
    expect(rpc.mock.calls[0][1].p_konteks).toMatchObject({ berkas: 'app.js', baris: 12 })
  })

  it('memotong pesan yang sangat panjang', async () => {
    const { logClientError } = await muatUlang()
    await logClientError('react.render', 'x'.repeat(5000))
    expect(rpc.mock.calls[0][1].p_pesan.length).toBeLessThanOrEqual(2000)
  })

  it('TIDAK PERNAH melempar walau RPC gagal', async () => {
    // Dipanggil dari ErrorBoundary saat aplikasi sudah bermasalah. Kalau
    // pencatatnya ikut melempar, layar putih yang seharusnya dicegah justru
    // terjadi — satu error berubah jadi dua.
    rpc.mockRejectedValue(new Error('jaringan mati'))
    const { logClientError } = await muatUlang()
    await expect(logClientError('react.render', 'Boom')).resolves.toBeUndefined()
  })
})

describe('peredam kejadian berulang', () => {
  it('error yang sama persis hanya dikirim sekali dalam jendela peredam', async () => {
    const { logClientError } = await muatUlang()
    await logClientError('react.render', 'Boom')
    await logClientError('react.render', 'Boom')
    await logClientError('react.render', 'Boom')
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('pesan berbeda tetap dikirim terpisah', async () => {
    const { logClientError } = await muatUlang()
    await logClientError('react.render', 'Boom A')
    await logClientError('react.render', 'Boom B')
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it('angka & UUID dalam pesan tidak memecah kejadian yang sama', async () => {
    // Tanpa normalisasi, satu bug melahirkan ratusan baris berbeda hanya karena
    // nominal dan id di dalam pesannya berbeda — tabelnya berubah dari alat
    // menjadi kebisingan.
    const { logClientError } = await muatUlang()
    await logClientError('react.render', 'Gagal simpan transaksi 350000')
    await logClientError('react.render', 'Gagal simpan transaksi 125000')
    expect(rpc).toHaveBeenCalledTimes(1)
  })
})

describe('initMonitoring', () => {
  it('menangkap error global window beserta lokasinya', async () => {
    const { initMonitoring } = await muatUlang()
    initMonitoring()
    window.dispatchEvent(Object.assign(new Event('error'), {
      message: 'Boom global', filename: 'app.js', lineno: 42,
    }))
    await new Promise((r) => setTimeout(r, 0))
    expect(rpc).toHaveBeenCalled()
    expect(rpc.mock.calls[0][1].p_konteks).toMatchObject({ berkas: 'app.js', baris: 42 })
  })

  it('menangkap promise yang ditolak tanpa penangan', async () => {
    const { initMonitoring } = await muatUlang()
    initMonitoring()
    window.dispatchEvent(Object.assign(new Event('unhandledrejection'), {
      reason: new Error('Promise gagal'),
    }))
    await new Promise((r) => setTimeout(r, 0))
    expect(rpc).toHaveBeenCalled()
    expect(rpc.mock.calls[0][1].p_pesan).toBe('Promise gagal')
  })

  it('tidak memasang penangan dua kali walau dipanggil berulang', async () => {
    // Pemasangan ganda membuat setiap error tercatat dua kali, dan `jumlah` di
    // tabel error_logs — yang gunanya justru mengukur seberapa sering sesuatu
    // terjadi — berubah jadi angka yang menipu.
    const { initMonitoring } = await muatUlang()
    initMonitoring()
    initMonitoring()
    window.dispatchEvent(Object.assign(new Event('error'), { message: 'Sekali saja' }))
    await new Promise((r) => setTimeout(r, 0))
    expect(rpc).toHaveBeenCalledTimes(1)
  })
})
