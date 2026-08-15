// ============================================================
// deno test — rate limiter kuota AI, DI SUMBERNYA.
//
// Yang dikunci di sini adalah tiga aturan yang kalau rusak langsung terasa di
// tagihan atau di kepercayaan pengguna:
//   1. checkQuota() TIDAK menambah penghitung (hanya membaca).
//   2. RPC error != kuota habis — ditandai unavailable:true (§1.3 metrik "RPC
//      ai_quota_check error"), karena pesannya harus berbeda.
//   3. commitQuota() tidak boleh menggagalkan respons yang sudah jadi.
//
// Jalankan: deno test supabase/functions/_shared/ai/
// ============================================================
import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  checkQuota, commitQuota, dailyLimitPayload, telemetriDari,
  type QuotaFeature,
} from './rate-limiter.ts'

/** Klien Supabase palsu (fake) — mencatat panggilan RPC dan membalas skenario. */
function fakeSupabase(balasan: { data?: unknown; error?: { message: string } | null } = {}) {
  const panggilan: Array<{ fn: string; args: Record<string, unknown> }> = []
  return {
    panggilan,
    klien: {
      // deno-lint-ignore no-explicit-any
      rpc: (fn: string, args: Record<string, unknown>): any => {
        panggilan.push({ fn, args })
        if (balasan.error) return Promise.resolve({ data: null, error: balasan.error })
        return Promise.resolve({ data: balasan.data ?? null, error: null })
      },
      // deno-lint-ignore no-explicit-any
    } as any,
  }
}

const FITUR: QuotaFeature[] = [
  'insight_dashboard', 'insight_stok', 'chat', 'crud', 'ocr',
  'catat', 'hpp_draft', 'voice',
]

// ---------- checkQuota ----------

Deno.test('checkQuota memanggil RPC ai_quota_check dengan fitur & batas yang benar', async () => {
  const { klien, panggilan } = fakeSupabase({ data: [{ allowed: true, used: 3, cap: 10, reset_at: '2026-08-05T07:00:00Z' }] })
  const status = await checkQuota(klien, 'chat', 10)

  assertEquals(panggilan.length, 1)
  assertEquals(panggilan[0].fn, 'ai_quota_check')
  assertEquals(panggilan[0].args, { p_feature: 'chat', p_limit: 10 })
  assertEquals(status, { allowed: true, used: 3, cap: 10, resetAt: '2026-08-05T07:00:00Z' })
})

Deno.test('checkQuota TIDAK menambah penghitung (tidak memanggil ai_quota_commit)', async () => {
  const { klien, panggilan } = fakeSupabase({ data: [{ allowed: true, used: 0, cap: 10, reset_at: null }] })
  await checkQuota(klien, 'crud', 10)
  assertEquals(panggilan.filter((p) => p.fn === 'ai_quota_commit').length, 0)
})

Deno.test('checkQuota menolak saat kuota habis', async () => {
  const { klien } = fakeSupabase({ data: [{ allowed: false, used: 10, cap: 10, reset_at: '2026-08-05T07:00:00Z' }] })
  const status = await checkQuota(klien, 'chat', 10)
  assertEquals(status.allowed, false)
  assertEquals(status.used, 10)
  // Kuota yang benar-benar habis TIDAK boleh ditandai unavailable.
  assertEquals(status.unavailable, undefined)
})

Deno.test('checkQuota menerima bentuk baris tunggal maupun array', async () => {
  const { klien } = fakeSupabase({ data: { allowed: true, used: 1, cap: 10, reset_at: null } })
  const status = await checkQuota(klien, 'ocr', 10)
  assertEquals(status.allowed, true)
  assertEquals(status.used, 1)
})

Deno.test('RPC error = fail-closed TAPI ditandai unavailable (bukan "kuota habis")', async () => {
  const { klien } = fakeSupabase({ error: { message: 'function ai_quota_check does not exist' } })
  const status = await checkQuota(klien, 'chat', 10)

  assertEquals(status.allowed, false)      // fail-closed demi biaya
  assertEquals(status.unavailable, true)   // ...tapi penyebabnya dibedakan
  assertEquals(status.resetAt, null)
})

Deno.test('checkQuota fail-closed untuk SEMUA fitur saat RPC error', async () => {
  for (const fitur of FITUR) {
    const { klien } = fakeSupabase({ error: { message: 'boom' } })
    const status = await checkQuota(klien, fitur, 10)
    assertEquals(status.allowed, false, `${fitur} harus fail-closed`)
    assertEquals(status.unavailable, true, `${fitur} harus ditandai unavailable`)
  }
})

Deno.test('baris kosong dianggap tidak diizinkan', async () => {
  const { klien } = fakeSupabase({ data: [] })
  const status = await checkQuota(klien, 'chat', 10)
  assertEquals(status.allowed, false)
  assertEquals(status.used, 0)
})

// ---------- commitQuota ----------

Deno.test('commitQuota menambah 1 unit secara baku', async () => {
  const { klien, panggilan } = fakeSupabase()
  await commitQuota(klien, 'chat')
  assertEquals(panggilan.length, 1)
  assertEquals(panggilan[0].fn, 'ai_quota_commit')
  assertEquals(panggilan[0].args.p_feature, 'chat')
  assertEquals(panggilan[0].args.p_units, 1)
})

Deno.test('commitQuota meneruskan jumlah detik untuk fitur voice', async () => {
  const { klien, panggilan } = fakeSupabase()
  await commitQuota(klien, 'voice', 125)
  assertEquals(panggilan[0].args.p_feature, 'voice')
  assertEquals(panggilan[0].args.p_units, 125)
})

// ---------- telemetri token (Fase 0) ----------

Deno.test('commitQuota tanpa telemetri mengirim token 0, bukan undefined', async () => {
  // undefined pada argumen RPC diserialkan jadi field yang HILANG, dan fungsi
  // Postgres lalu memakai default-nya. Kebetulan hasilnya sama, tapi menyandarkan
  // kebenaran pada kebetulan itu rapuh — kirim 0 secara eksplisit.
  const { klien, panggilan } = fakeSupabase()
  await commitQuota(klien, 'chat')
  const a = panggilan[0].args
  assertEquals(a.p_prompt_tokens, 0)
  assertEquals(a.p_completion_tokens, 0)
  assertEquals(a.p_thinking_tokens, 0)
  assertEquals(a.p_total_tokens, 0)
  assertEquals(a.p_wasted_tokens, 0)
  assertEquals(a.p_model, null)
})

Deno.test('commitQuota meneruskan token & model dari telemetri', async () => {
  const { klien, panggilan } = fakeSupabase()
  await commitQuota(klien, 'ocr', 1, {
    model: 'gemini-3.1-flash-lite',
    promptTokens: 1200, completionTokens: 340, thinkingTokens: 88,
    totalTokens: 1628, wastedTokens: 900, latencyMs: 2400,
  })
  const a = panggilan[0].args
  assertEquals(a.p_prompt_tokens, 1200)
  assertEquals(a.p_completion_tokens, 340)
  assertEquals(a.p_thinking_tokens, 88)
  assertEquals(a.p_total_tokens, 1628)
  assertEquals(a.p_wasted_tokens, 900)
  assertEquals(a.p_model, 'gemini-3.1-flash-lite')
})

Deno.test('commitQuota menolak angka token yang tidak masuk akal', async () => {
  const { klien, panggilan } = fakeSupabase()
  await commitQuota(klien, 'chat', 1, {
    // NaN pernah muncul nyata saat field usageMetadata tidak ada dan hasil
    // aritmetikanya diteruskan apa adanya. NaN yang lolos ke Postgres membuat
    // SELURUH kolom penjumlahan hari itu jadi NaN — satu baris rusak
    // menghapus pembukuan sehari penuh.
    promptTokens: NaN, completionTokens: -5, totalTokens: Infinity,
  })
  const a = panggilan[0].args
  assertEquals(a.p_prompt_tokens, 0)
  assertEquals(a.p_completion_tokens, 0)
  assertEquals(a.p_total_tokens, 0)
})

Deno.test('commitQuota units=0 = catat token TANPA menaikkan kuota', async () => {
  // Dipakai saat Gemini menjawab tapi jawabannya dibuang (narasi terpotong,
  // struk gagal checksum, kalimat tak terpahami). Pengguna tidak boleh
  // tertagih kuota; Google tetap menagih tokennya.
  const { klien, panggilan } = fakeSupabase()
  await commitQuota(klien, 'insight_dashboard', 0, { totalTokens: 700, wastedTokens: 700 })
  assertEquals(panggilan[0].args.p_units, 0)
  assertEquals(panggilan[0].args.p_wasted_tokens, 700)
})

Deno.test('telemetriDari memetakan GenerateResult apa adanya', () => {
  const t = telemetriDari({
    usage: { prompt: 10, completion: 20, thinking: 5, total: 35 },
    wastedTokens: 12, latencyMs: 999, modelUsed: 'gemini-3.5-flash',
    usedFallback: true, attempts: 2,
  }, 'C')
  assertEquals(t.promptTokens, 10)
  assertEquals(t.completionTokens, 20)
  assertEquals(t.thinkingTokens, 5)
  assertEquals(t.totalTokens, 35)
  assertEquals(t.wastedTokens, 12)
  assertEquals(t.latencyMs, 999)
  assertEquals(t.model, 'gemini-3.5-flash')
  assertEquals(t.keySlot, 'C')
  assertEquals(t.usedFallback, true)
  assertEquals(t.attempts, 2)
})

Deno.test('telemetriDari aman untuk hasil tanpa usage (jalur cache)', () => {
  const t = telemetriDari({ modelUsed: 'gemini-3.5-flash-lite' })
  assertEquals(t.totalTokens, undefined)
  assertEquals(t.model, 'gemini-3.5-flash-lite')
})

Deno.test('commitQuota menelan error — respons yang sudah jadi tidak boleh gagal', async () => {
  const klien = { rpc: () => Promise.reject(new Error('jaringan putus')) }
  // deno-lint-ignore no-explicit-any
  await commitQuota(klien as any, 'chat')  // tidak boleh melempar
})

// ---------- dailyLimitPayload ----------

Deno.test('dailyLimitPayload memakai kode DAILY_LIMIT_REACHED', () => {
  const p = dailyLimitPayload('chat', { allowed: false, used: 10, cap: 10, resetAt: '2026-08-05T07:00:00Z' })
  assertEquals(p.code, 'DAILY_LIMIT_REACHED')
  assertEquals(p.feature, 'chat')
  assertEquals(p.used, 10)
  assertEquals(p.cap, 10)
  assertEquals(p.resetAt, '2026-08-05T07:00:00Z')
})

Deno.test('pesan kuota menjelaskan berbagi antar-anggota dan mengarahkan ke form manual', () => {
  const p = dailyLimitPayload('crud', { allowed: false, used: 10, cap: 10, resetAt: null })
  assertStringIncludes(p.error, 'seluruh anggota')
  assertStringIncludes(p.error, 'manual')
  assertStringIncludes(p.error, 'besok')
})

Deno.test('kuota voice ditampilkan dalam menit, bukan detik', () => {
  const p = dailyLimitPayload('voice', { allowed: false, used: 600, cap: 600, resetAt: null })
  assertStringIncludes(p.error, '10 menit')
  assert(!p.error.includes('600 kali'))
})

// Pesan yang dibaca pengguna harus menyebut NAMA FITUR yang mereka kenal dari
// UI, bukan kunci internal. ("voice" sengaja tetap muncul di dalam kurung pada
// label "Fitur suara (voice)" — itu label, bukan kunci mentah.)
const LABEL_HARAPAN: Record<QuotaFeature, string> = {
  insight_dashboard: 'Insight AI Dashboard',
  insight_stok: 'Insight AI Stok',
  chat: 'Chat Tanya AI',
  crud: 'Pencatatan via AI',
  ocr: 'Baca struk dengan AI',
  catat: 'Catat dengan kalimat biasa',
  hpp_draft: 'Draf HPP dengan AI',
  voice: 'Fitur suara',
}

Deno.test('setiap fitur punya label yang dikenali pengguna, bukan kunci internal', () => {
  for (const fitur of FITUR) {
    const p = dailyLimitPayload(fitur, { allowed: false, used: 10, cap: 10, resetAt: null })
    assertStringIncludes(p.error, LABEL_HARAPAN[fitur])
    // Kunci mentah bergaris bawah tidak boleh bocor ke pesan pengguna.
    assert(!p.error.includes('insight_'), `kunci mentah bocor untuk "${fitur}"`)
  }
})
