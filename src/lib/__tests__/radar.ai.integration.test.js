import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============================================================
// Integration test lapisan ai.js untuk fitur Radar Harga.
// Facade tipis (src/lib/ai.js) dites via mock supabase.functions.invoke —
// nol jaringan, deterministik, cepat untuk gate CI.
// ============================================================

const invoke = vi.fn()

vi.mock('../supabase', () => ({
  supabase: {
    functions: { invoke: (...a) => invoke(...a) },
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: 'u-1' } } })),
      onAuthStateChange: vi.fn(),
    },
  },
}))

// Import setelah mock terpasang (vi.mock di-hoist).
const ai = await import('../ai')

beforeEach(() => { invoke.mockReset() })

describe('hargaDaerah (facade -> harga-daerah edge fn)', () => {
  it('meneruskan province_id dengan nama fungsi tepat', async () => {
    invoke.mockResolvedValueOnce({
      data: { runDate: '2026-07-26', prices: [{ province_id: 11, commodity_key: 'beras', price: 14500 }] },
      error: null,
    })
    const res = await ai.hargaDaerah(11)
    // `signal` selalu ikut sejak setiap panggilan Edge Function diberi batas
    // waktu — tanpa itu, fungsi yang menggantung meninggalkan pengguna pada
    // spinner tanpa akhir yang bahkan tidak bisa dibatalkan.
    expect(invoke).toHaveBeenCalledWith('harga-daerah', {
      body: { province_id: 11 }, signal: expect.any(AbortSignal),
    })
    expect(res.prices[0].province_id).toBe(11)
  })

  it('melempar error dengan pesan detail bila edge merespons error', async () => {
    invoke.mockResolvedValueOnce({
      data: null,
      error: { context: { json: async () => ({ error: 'Provinsi tidak dikenal.' }) } },
    })
    await expect(ai.hargaDaerah(99)).rejects.toThrow('Provinsi tidak dikenal.')
  })

  it('fallback pesan bila error tanpa detail', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: { context: { json: async () => { throw new Error('x') } } } })
    await expect(ai.hargaDaerah(1)).rejects.toThrow(/Harga bahan pokok sedang tidak dapat dimuat/)
  })
})

describe('makroRefresh (pemicu cadangan makro-harian)', () => {
  it('memanggil edge fn makro-harian tanpa body payload berarti', async () => {
    invoke.mockResolvedValueOnce({ data: { ok: true, signals: 25 }, error: null })
    const res = await ai.makroRefresh()
    expect(invoke).toHaveBeenCalledWith('makro-harian', { body: {}, signal: expect.any(AbortSignal) })
    expect(res.ok).toBe(true)
  })
})

describe('askAI (facade -> BukuPencatatan)', () => {
  it('membersihkan markdown dari respons AI (cleanReply integrasi)', async () => {
    invoke.mockResolvedValueOnce({
      data: { reply: '**Laba** bulan ini `Rp 1.000.000`\n\n\n*catatan* penting' },
      error: null,
    })
    const out = await ai.askAI('berapa laba?')
    expect(out).not.toMatch(/\*\*|`/)
    expect(out).toContain('Laba bulan ini')
    expect(out).toContain('catatan penting')
  })

  it('meneruskan history dengan device kind di body invoke', async () => {
    invoke.mockResolvedValueOnce({ data: { reply: 'ok' }, error: null })
    await ai.askAI('pesan', [{ role: 'user', text: 'sebelumnya' }])
    const [name, opts] = invoke.mock.calls[0]
    expect(name).toBe('BukuPencatatan')
    expect(opts.body.message).toContain('pesan')
    expect(opts.body.history).toEqual([{ role: 'user', text: 'sebelumnya' }])
    expect(['mobile', 'desktop']).toContain(opts.body.device)
  })

  // Bahasa jawaban mengikuti tombol ID/EN di header aplikasi.
  //
  // Arahannya diselipkan ke PESAN, bukan hanya dikirim sebagai field `lang`,
  // karena Edge Function yang ter-deploy sekarang belum membaca field itu —
  // `const { message, history, device } = await req.json()`. Arahan di dalam
  // pesan bekerja pada versi lama maupun versi baru.
  it('menyisipkan arahan bahasa ke pesan sesuai pilihan pengguna', async () => {
    invoke.mockResolvedValueOnce({ data: { reply: 'ok' }, error: null })
    await ai.askAI('berapa laba?', [], 'en')
    const [, opts] = invoke.mock.calls[0]
    expect(opts.body.message).toMatch(/^Reply in English\./)
    expect(opts.body.message).toContain('berapa laba?')
    expect(opts.body.lang).toBe('en')
  })

  it('default ke Bahasa Indonesia bila bahasa tidak disebut', async () => {
    invoke.mockResolvedValueOnce({ data: { reply: 'ok' }, error: null })
    await ai.askAI('berapa laba?')
    const [, opts] = invoke.mock.calls[0]
    expect(opts.body.message).toMatch(/^Jawab dalam Bahasa Indonesia\./)
    expect(opts.body.lang).toBe('id')
  })

  it('catatAI meminta note berbahasa Inggris saat lang = en', async () => {
    invoke.mockResolvedValueOnce({ data: { transactions: [] }, error: null })
    await ai.catatAI('laku 3 donat 15rb', 'en')
    const [name, opts] = invoke.mock.calls[0]
    expect(name).toBe('ai-catat')
    expect(opts.body.message).toContain('in English')
    expect(opts.body.message).toContain('laku 3 donat 15rb')
  })
})
