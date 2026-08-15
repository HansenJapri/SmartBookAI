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
  checkQuota, commitQuota, quotaBlockedPayload, telemetriDari,
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

/** Baris balasan ai_quota_resolve, dengan nilai wajar yang bisa ditimpa. */
function baris(ubah: Record<string, unknown> = {}) {
  return {
    allowed: true,
    blocked_by: null,
    daily_used: 3,
    daily_cap: 10,
    daily_reset_at: '2026-08-05T07:00:00Z',
    credits_used: 42,
    credits_cap: 300,
    cycle_start: '2026-08-01',
    cycle_end: '2026-08-31',
    plan_code: 'free',
    ...ubah,
  }
}

Deno.test('checkQuota memanggil ai_quota_resolve, dan cap kode jadi CADANGAN', async () => {
  const { klien, panggilan } = fakeSupabase({ data: [baris()] })
  const status = await checkQuota(klien, 'chat', 10)

  assertEquals(panggilan.length, 1)
  assertEquals(panggilan[0].fn, 'ai_quota_resolve')
  // p_fallback_cap, bukan p_limit: angka dari FEATURE_ROUTES tidak lagi
  // menentukan, ia hanya dipakai bila paket & override tidak menyebut fitur ini.
  assertEquals(panggilan[0].args, { p_feature: 'chat', p_fallback_cap: 10 })
  assertEquals(status.allowed, true)
  assertEquals(status.used, 3)
  assertEquals(status.cap, 10)
  assertEquals(status.resetAt, '2026-08-05T07:00:00Z')
})

Deno.test('checkQuota membawa serta keadaan kredit & siklus', async () => {
  const { klien } = fakeSupabase({ data: [baris()] })
  const status = await checkQuota(klien, 'chat', 10)
  assertEquals(status.creditsUsed, 42)
  assertEquals(status.creditsCap, 300)
  assertEquals(status.cycleEnd, '2026-08-31')
  assertEquals(status.planCode, 'free')
})

Deno.test('cap yang dinaikkan paket MENANG atas cap kode', async () => {
  // Inti Fase 2: angka yang dipakai datang dari database, bukan dari
  // FEATURE_ROUTES. Kalau ini terbalik, seluruh gunanya hilang — admin
  // menaikkan limit dan tidak terjadi apa-apa.
  const { klien } = fakeSupabase({ data: [baris({ daily_cap: 50, daily_used: 30 })] })
  const status = await checkQuota(klien, 'ocr', 10)
  assertEquals(status.cap, 50)
  assertEquals(status.allowed, true)
})

Deno.test('credits_cap null = TANPA BATAS, bukan nol', async () => {
  // Perbedaan yang paling mudah rusak oleh Number(): Number(null) = 0, dan 0
  // berarti kebalikan persis dari yang dimaksud — Enterprise tanpa batas
  // mendadak jadi Enterprise tanpa kredit sama sekali.
  const { klien } = fakeSupabase({ data: [baris({ credits_cap: null })] })
  const status = await checkQuota(klien, 'chat', 10)
  assertEquals(status.creditsCap, null)
})

Deno.test('checkQuota TIDAK menambah penghitung (tidak memanggil ai_quota_commit)', async () => {
  const { klien, panggilan } = fakeSupabase({ data: [baris({ daily_used: 0 })] })
  await checkQuota(klien, 'crud', 10)
  assertEquals(panggilan.filter((p) => p.fn === 'ai_quota_commit').length, 0)
})

Deno.test('checkQuota menolak saat kuota harian habis', async () => {
  const { klien } = fakeSupabase({ data: [baris({ allowed: false, blocked_by: 'daily', daily_used: 10 })] })
  const status = await checkQuota(klien, 'chat', 10)
  assertEquals(status.allowed, false)
  assertEquals(status.used, 10)
  assertEquals(status.blockedBy, 'daily')
  // Kuota yang benar-benar habis TIDAK boleh ditandai unavailable.
  assertEquals(status.unavailable, undefined)
})

Deno.test('checkQuota membedakan kredit habis dari kuota harian habis', async () => {
  const { klien } = fakeSupabase({
    data: [baris({ allowed: false, blocked_by: 'credits', daily_used: 2, credits_used: 300 })],
  })
  const status = await checkQuota(klien, 'chat', 10)
  assertEquals(status.blockedBy, 'credits')
  // Harian masih longgar (2 dari 10) — yang habis jatah komersialnya.
  assertEquals(status.used, 2)
})

Deno.test('checkQuota menerima bentuk baris tunggal maupun array', async () => {
  const { klien } = fakeSupabase({ data: baris({ daily_used: 1 }) })
  const status = await checkQuota(klien, 'ocr', 10)
  assertEquals(status.allowed, true)
  assertEquals(status.used, 1)
})

Deno.test('RPC error = fail-closed TAPI ditandai unavailable (bukan "kuota habis")', async () => {
  const { klien } = fakeSupabase({ error: { message: 'function ai_quota_resolve does not exist' } })
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

// ---------- quotaBlockedPayload ----------

Deno.test('blokir harian memakai kode DAILY_LIMIT_REACHED', () => {
  const p = quotaBlockedPayload('chat', {
    allowed: false, blockedBy: 'daily', used: 10, cap: 10, resetAt: '2026-08-05T07:00:00Z',
  })
  assertEquals(p.code, 'DAILY_LIMIT_REACHED')
  assertEquals(p.feature, 'chat')
  assertEquals(p.used, 10)
  assertEquals(p.cap, 10)
  assertEquals(p.resetAt, '2026-08-05T07:00:00Z')
})

Deno.test('blokir harian MENEGASKAN kredit tidak terpotong', () => {
  // Tanpa kalimat ini, pengguna yang menabrak guardrail teknis mengira jatah
  // komersialnya ikut habis, lalu membeli sesuatu yang tidak ia butuhkan.
  const p = quotaBlockedPayload('ocr', { allowed: false, blockedBy: 'daily', used: 10, cap: 10, resetAt: null })
  assertStringIncludes(p.error, 'Kredit Anda tidak berkurang')
})

Deno.test('kredit habis memakai kode & kalimat yang BERBEDA dari kuota harian', () => {
  const p = quotaBlockedPayload('chat', {
    allowed: false, blockedBy: 'credits', used: 2, cap: 10, resetAt: null,
    creditsUsed: 300, creditsCap: 300, cycleEnd: '2026-08-31',
  })
  assertEquals(p.code, 'CREDIT_LIMIT_REACHED')
  assertStringIncludes(p.error, '300 dari 300 kredit')
  assertStringIncludes(p.error, '31 Agustus')
  assertStringIncludes(p.error, 'tingkatkan paket')
  // "Tunggu besok" adalah saran yang SALAH di sini: besok kreditnya tetap habis.
  assert(!p.error.includes('besok'), 'pesan kredit tidak boleh menyuruh menunggu besok')
})

Deno.test('AI yang ditangguhkan admin punya kode sendiri', () => {
  const p = quotaBlockedPayload('chat', {
    allowed: false, blockedBy: 'suspended', used: 0, cap: 10, resetAt: null,
  })
  assertEquals(p.code, 'AI_SUSPENDED')
  assertStringIncludes(p.error, 'admin')
  assertStringIncludes(p.error, 'manual')
})

Deno.test('ketiga sebab blokir mengarahkan ke form manual', () => {
  // Apa pun sebabnya, pengguna tidak boleh merasa pembukuannya ikut mati.
  for (const sebab of ['daily', 'credits', 'suspended'] as const) {
    const p = quotaBlockedPayload('catat', {
      allowed: false, blockedBy: sebab, used: 10, cap: 10, resetAt: null,
      creditsUsed: 300, creditsCap: 300, cycleEnd: '2026-09-01',
    })
    assertStringIncludes(p.error, 'manual')
  }
})

Deno.test('pesan kuota harian menjelaskan berbagi antar-anggota', () => {
  const p = quotaBlockedPayload('crud', { allowed: false, blockedBy: 'daily', used: 10, cap: 10, resetAt: null })
  assertStringIncludes(p.error, 'seluruh anggota')
  assertStringIncludes(p.error, 'manual')
  assertStringIncludes(p.error, 'besok')
})

Deno.test('kuota voice ditampilkan dalam menit, bukan detik', () => {
  const p = quotaBlockedPayload('voice', { allowed: false, blockedBy: 'daily', used: 600, cap: 600, resetAt: null })
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
    const p = quotaBlockedPayload(fitur, { allowed: false, blockedBy: 'daily', used: 10, cap: 10, resetAt: null })
    assertStringIncludes(p.error, LABEL_HARAPAN[fitur])
    // Kunci mentah bergaris bawah tidak boleh bocor ke pesan pengguna.
    assert(!p.error.includes('insight_'), `kunci mentah bocor untuk "${fitur}"`)
  }
})
