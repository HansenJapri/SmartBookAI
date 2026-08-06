import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============================================================
// Penyampaian kegagalan sesi suara.
//
// Berkas test ini lahir dari kegagalan nyata: fitur suara menampilkan
// "Sesi suara belum bisa dibuka. Coba lagi sebentar lagi." padahal sebabnya
// adalah Edge Function yang belum ter-deploy — sesuatu yang tidak akan pernah
// membaik betapa pun lamanya ditunggu. Seluruh test suite waktu itu hijau,
// karena tidak satu pun menguji jalur ini.
//
// Yang dijaga di sini: pesan kegagalan HARUS menunjuk penyebab yang benar.
// ============================================================

const invoke = vi.fn()

vi.mock('../supabase', () => ({ supabase: { functions: { invoke: (...a) => invoke(...a) } } }))
vi.mock('../api', () => ({ getSelectedWorkspace: () => null }))

const { fetchLiveToken, diagnoseVoice } = await import('../useLiveVoice')

/** Bentuk error yang dikembalikan supabase-js untuk balasan non-2xx. */
const fnError = (status, body) => ({
  data: null,
  error: {
    message: 'Edge Function returned a non-2xx status code',
    context: { status, json: async () => (body ?? Promise.reject(new Error('bukan JSON'))) },
  },
})

beforeEach(() => { invoke.mockReset() })

describe('fetchLiveToken', () => {
  it('404 menyebut fungsi yang belum ter-deploy, bukan "coba lagi nanti"', async () => {
    invoke.mockResolvedValue(fnError(404, null))
    await expect(fetchLiveToken()).rejects.toThrow(/belum ter-deploy/)
    // Kalimat lama yang menyesatkan tidak boleh kembali.
    await expect(fetchLiveToken()).rejects.not.toThrow(/coba lagi sebentar lagi/i)
  })

  it('menyebut perintah deploy yang harus dijalankan', async () => {
    invoke.mockResolvedValue(fnError(404, null))
    await expect(fetchLiveToken()).rejects.toThrow(/supabase functions deploy voice-live-token/)
  })

  it('meneruskan pesan server APA ADANYA saat kuota belum terpasang', async () => {
    invoke.mockResolvedValue(fnError(503, {
      error: 'Sistem kuota AI belum terpasang di database. Jalankan supabase/migration_ai_workspace_quota.sql',
      code: 'QUOTA_SYSTEM_MISSING',
    }))
    await expect(fetchLiveToken()).rejects.toThrow(/migration_ai_workspace_quota\.sql/)
  })

  it('membedakan kuota habis dari kuota yang tidak terbaca', async () => {
    invoke.mockResolvedValue(fnError(429, {
      error: 'Kuota suara harian workspace Anda sudah habis (10 menit/hari).',
      code: 'DAILY_LIMIT_REACHED',
    }))
    await expect(fetchLiveToken()).rejects.toThrow(/sudah habis/)
  })

  it('menyebut kunci Gemini bila secret belum diatur', async () => {
    invoke.mockResolvedValue(fnError(500, {
      error: 'Kunci Gemini belum diatur. Set secret GEMINI_KEY_B di Supabase.',
      code: 'NO_API_KEY',
    }))
    await expect(fetchLiveToken()).rejects.toThrow(/GEMINI_KEY_B/)
  })

  it('menyertakan kode HTTP saat badan balasan bukan JSON', async () => {
    invoke.mockResolvedValue(fnError(500, null))
    await expect(fetchLiveToken()).rejects.toThrow(/HTTP 500/)
  })

  it('menolak balasan 200 yang tidak membawa token', async () => {
    invoke.mockResolvedValue({ data: { model: 'x' }, error: null })
    await expect(fetchLiveToken()).rejects.toThrow(/tidak mengirim token/)
  })

  it('mengembalikan token dan model saat berhasil', async () => {
    invoke.mockResolvedValue({ data: { token: 'tok', model: 'gemini-live' }, error: null })
    await expect(fetchLiveToken()).resolves.toEqual({ token: 'tok', model: 'gemini-live' })
  })

  it('mengirim fitur yang diminta ke Edge Function', async () => {
    invoke.mockResolvedValue({ data: { token: 't' }, error: null })
    await fetchLiveToken('voice_crud')
    expect(invoke).toHaveBeenCalledWith('voice-live-token', {
      body: { feature: 'voice_crud', owner: undefined },
    })
  })
})

describe('diagnoseVoice', () => {
  it('tidak melempar saat server error — mengembalikan hasil yang bisa dibaca', async () => {
    // Diagnosa harus tetap menjawab justru ketika semuanya sedang rusak.
    invoke.mockResolvedValue(fnError(500, { error: 'meledak' }))
    await expect(diagnoseVoice()).resolves.toMatchObject({ ok: false, status: 500, error: 'meledak' })
  })

  it('memakai action diagnose, bukan mencetak token', async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null })
    await diagnoseVoice()
    expect(invoke.mock.calls[0][1].body.action).toBe('diagnose')
  })
})
