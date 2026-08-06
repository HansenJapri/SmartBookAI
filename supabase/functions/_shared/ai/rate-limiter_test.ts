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
import { checkQuota, commitQuota, dailyLimitPayload, type QuotaFeature } from './rate-limiter.ts'

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
  assertEquals(panggilan[0].args, { p_feature: 'chat', p_units: 1 })
})

Deno.test('commitQuota meneruskan jumlah detik untuk fitur voice', async () => {
  const { klien, panggilan } = fakeSupabase()
  await commitQuota(klien, 'voice', 125)
  assertEquals(panggilan[0].args, { p_feature: 'voice', p_units: 125 })
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
