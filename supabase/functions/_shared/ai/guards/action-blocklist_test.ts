// ============================================================
// deno test — guard blocklist aksi AI, DI SUMBERNYA.
//
// Sebelum berkas ini ada, action-blocklist.ts hanya diuji lewat cerminan
// logikanya di sisi klien (src/lib/aiActions.js). Artinya perubahan pada .ts
// ini bisa lolos tanpa satu pun test berteriak.
//
// Gerbang G-09 menuntut 18/18 tabel dan 13/13 pola tertahan. Karena itu setiap
// entri diuji SATU PER SATU dan jumlahnya dikunci — menambah entri tanpa
// menambah kasus uji akan membuat test gagal.
//
// Jalankan: deno test supabase/functions/_shared/ai/guards/
// ============================================================
import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  BLOCKED_PATTERNS,
  BLOCKED_TABLES,
  checkActionAllowed,
  isTableBlocked,
  logBlockedAttempt,
} from './action-blocklist.ts'

// ---------- Jumlah entri dikunci ----------

Deno.test('BLOCKED_TABLES berisi tepat 18 tabel (G-09)', () => {
  assertEquals(BLOCKED_TABLES.length, 18)
})

Deno.test('BLOCKED_PATTERNS berisi tepat 13 pola (G-09)', () => {
  assertEquals(BLOCKED_PATTERNS.length, 13)
})

// ---------- 18 tabel terlarang, satu per satu ----------

for (const tabel of BLOCKED_TABLES) {
  Deno.test(`tabel terlarang "${tabel}" ditolak oleh isTableBlocked()`, () => {
    assert(isTableBlocked(tabel), `${tabel} seharusnya diblokir`)
  })

  Deno.test(`tabel terlarang "${tabel}" ditolak lewat argumen function call`, () => {
    const hasil = checkActionAllowed('update_row', { table: tabel })
    assert(hasil.blocked, `${tabel} seharusnya diblokir lewat argumen`)
    assert(hasil.reason, 'penolakan wajib menyertakan alasan')
  })

  Deno.test(`tabel terlarang "${tabel}" tetap ditolak walau huruf besar & berspasi`, () => {
    assert(isTableBlocked(`  ${tabel.toUpperCase()}  `))
  })

  Deno.test(`tabel terlarang "${tabel}" tetap ditolak dengan awalan skema`, () => {
    assert(isTableBlocked(`public.${tabel}`))
  })
}

// ---------- 13 pola terlarang, satu per satu ----------
// Setiap baris: [indeks pola, nama aksi yang WAJIB tertahan oleh pola itu].
const CONTOH_POLA: Array<[number, string]> = [
  [0, '/settings/profile'],
  [1, 'update_settings'],
  [2, 'ubah_pengaturan'],
  [3, 'update_auth'],
  [4, 'login'],
  [5, 'reset_password'],
  // Kasus yang sudah dikomentari di kode: \b2fa\b GAGAL menangkap "update_2fa"
  // karena "_" dihitung karakter kata. Pemisah ditulis eksplisit justru untuk ini.
  [6, 'update_2fa'],
  [7, 'update_pin'],
  [8, 'billing'],
  [9, 'api_key'],
  [10, 'update_role'],
  [11, 'webhook'],
  [12, 'delete_account'],
]

Deno.test('setiap pola terlarang punya minimal satu kasus uji (13/13)', () => {
  const tercakup = new Set(CONTOH_POLA.map(([i]) => i))
  assertEquals(tercakup.size, BLOCKED_PATTERNS.length)
})

for (const [indeks, contoh] of CONTOH_POLA) {
  Deno.test(`pola #${indeks} ${BLOCKED_PATTERNS[indeks]} menangkap "${contoh}"`, () => {
    // Pola itu sendiri memang cocok...
    assert(BLOCKED_PATTERNS[indeks].test(contoh), `pola #${indeks} tidak cocok dengan "${contoh}"`)
    // ...dan guard benar-benar menolaknya sebagai nama tool.
    const hasil = checkActionAllowed(contoh)
    assert(hasil.blocked, `"${contoh}" seharusnya ditolak sebagai nama aksi`)
    assertStringIncludes(hasil.reason ?? '', contoh)
  })

  Deno.test(`pola #${indeks}: "${contoh}" juga ditolak bila disembunyikan di argumen`, () => {
    for (const kunci of ['table', 'tabel', 'resource', 'endpoint', 'path', 'target', 'entity']) {
      const hasil = checkActionAllowed('tool_netral', { [kunci]: contoh })
      assert(hasil.blocked, `"${contoh}" lolos lewat argumen "${kunci}"`)
    }
  })
}

// Kasus 2FA ditulis eksplisit karena inilah regresi yang pernah nyaris lolos.
Deno.test('varian penulisan 2FA/OTP semuanya tertahan', () => {
  for (const nama of ['update_2fa', 'disable-2fa', '2fa', 'two_factor', 'two-factor',
    'otp_codes', 'send_otp', 'verifikasi_kode']) {
    assert(checkActionAllowed(nama).blocked, `"${nama}" seharusnya diblokir`)
  }
})

// ---------- Kontrol positif: aksi sah TIDAK boleh ikut terblokir ----------
// Tanpa bagian ini, guard yang menolak SEMUA aksi akan lulus sempurna —
// dan fitur CRUD via AI mati total tanpa ada test yang protes.

Deno.test('aksi bisnis yang sah tidak ikut terblokir', () => {
  const sah = [
    'create_transaction',
    'update_transaction',
    'list_transactions',
    'create_product',
    'update_product',
    'list_categories',
    'create_customer',
    'list_suppliers',
    'create_purchase_order',
    'summarize_cashflow',
  ]
  for (const nama of sah) {
    const hasil = checkActionAllowed(nama)
    assertEquals(hasil.blocked, false, `"${nama}" seharusnya DIIZINKAN, ditolak karena: ${hasil.reason}`)
  }
})

Deno.test('tabel bisnis yang sah tidak ikut terblokir', () => {
  for (const t of ['transactions', 'products', 'categories', 'customers', 'suppliers', 'purchase_orders']) {
    assertEquals(isTableBlocked(t), false, `tabel "${t}" seharusnya diizinkan`)
  }
})

// ---------- Perilaku tepi ----------

Deno.test('argumen non-string diabaikan, tidak melempar', () => {
  const hasil = checkActionAllowed('create_transaction', {
    table: 123 as unknown as string,
    resource: null as unknown as string,
    entity: { nested: 'user_pins' } as unknown as string,
  })
  assertEquals(hasil.blocked, false)
})

Deno.test('nama tool kosong/undefined tidak melempar', () => {
  assertEquals(checkActionAllowed('').blocked, false)
  assertEquals(isTableBlocked(''), false)
  assertEquals(isTableBlocked(undefined as unknown as string), false)
})

Deno.test('kunci argumen di luar daftar suspect tidak diperiksa', () => {
  // "description" bukan penunjuk target, jadi isinya tidak boleh memblokir aksi
  // sah — kalau tidak, transaksi berdeskripsi "bayar langganan" ikut ditolak.
  const hasil = checkActionAllowed('create_transaction', { description: 'bayar langganan internet' })
  assertEquals(hasil.blocked, false)
})

Deno.test('logBlockedAttempt mencatat ke ai_blocked_attempts dan tidak melempar saat gagal', () => {
  const tercatat: Array<{ tabel: string; nilai: unknown }> = []
  logBlockedAttempt(
    { from: (t: string) => ({ insert: (v: unknown) => { tercatat.push({ tabel: t, nilai: v }); return Promise.resolve(null) } }) },
    { userId: 'u1', toolName: 'update_settings', reason: 'pola terlarang' },
  )
  assertEquals(tercatat.length, 1)
  assertEquals(tercatat[0].tabel, 'ai_blocked_attempts')

  // Klien yang melempar tidak boleh membatalkan penolakan.
  logBlockedAttempt(
    { from: () => { throw new Error('db mati') } },
    { userId: null, toolName: 'x', reason: 'y' },
  )
})
