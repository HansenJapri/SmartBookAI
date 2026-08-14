// ============================================================
// deno test — redaksi PII konteks RAG.
//
// Test kedua di berkas ini ("kolom sah tidak ikut tersaring") menjaga kegagalan
// yang paling sulit dilacak: daftar larangan yang terlalu rakus memakan kolom
// yang sah, lalu gejalanya muncul sebagai "AI-nya bego" — bukan sebagai error
// yang bisa dilacak siapa pun. /hp/ polos memakan hpp_per_unit; /pin/ polos
// memakan pinjaman.
// ============================================================
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { kolomTerlarang, samarkan, saringKolomAman } from './redact.ts'

// ---------- Kolom yang HARUS tertangkap ----------

Deno.test('kolom PII tertangkap', () => {
  const pii = [
    'phone', 'telp', 'telepon', 'hp', 'wa_number', 'whatsapp', 'mobile_phone',
    'email', 'mail', 'user_email',
    'address', 'alamat', 'alamat_lengkap',
    'no_rekening', 'norek', 'bank_account', 'account_number', 'card_number',
    'password', 'kata_sandi', 'pin', 'api_key', 'access_token', 'otp_code',
    'nik', 'ktp', 'npwp', 'paspor',
    'raw', 'raw_text',
  ]
  for (const k of pii) {
    assertEquals(kolomTerlarang([k]), [k], `kolom PII "${k}" LOLOS`)
  }
})

// ---------- Kolom yang TIDAK BOLEH tertangkap ----------

Deno.test('kolom sah tidak ikut tersaring', () => {
  // Setiap nama di sini benar-benar dipakai skema aplikasi, dan beberapa
  // sengaja dipilih karena mirip pola PII:
  //   hpp_per_unit  -> mengandung "hp"
  //   pinjaman      -> mengandung "pin"
  //   simulasi      -> mengandung "sim"
  //   description   -> teks bebas, tapi bukan PII (disaring sanitize, bukan di sini)
  const sah = [
    'name', 'sku', 'category', 'unit', 'stock', 'min_stock', 'price',
    'hpp_per_unit', 'hpp', 'pinjaman', 'simulasi', 'total',
    'salary_type', 'salary_amount', 'base_amount', 'bonus', 'deduction',
    'occurred_at', 'direction', 'amount', 'channel', 'payment_status',
    'description', 'note', 'title', 'status', 'priority', 'due_date',
    'po_number', 'opname_number', 'qty', 'unit_price', 'expected_date',
    'period', 'score', 'date', 'join_date', 'role', 'modules',
    'supplier_id', 'employee_id', 'product_id', 'assignee_id',
    'remind_at', 'is_active', 'deadline', 'start_date',
  ]
  const kena = kolomTerlarang(sah)
  assertEquals(kena, [], `kolom sah ikut tersaring: ${kena.join(', ')}`)
})

// ---------- saringKolomAman ----------

Deno.test('saringKolomAman membuang PII dan mempertahankan sisanya', () => {
  const hasil = saringKolomAman(['name', 'phone', 'stock', 'email', 'price'])
  assertEquals(hasil, ['name', 'stock', 'price'])
})

Deno.test('saringKolomAman mempertahankan urutan asli', () => {
  // Urutan kolom menentukan urutan nilai di baris data. Kalau berubah,
  // nilainya masuk ke kolom yang salah — stok terbaca sebagai harga.
  assertEquals(saringKolomAman(['stock', 'name', 'price']), ['stock', 'name', 'price'])
})

Deno.test('daftar kolom tanpa PII lewat utuh', () => {
  const kolom = ['name', 'sku', 'unit', 'stock', 'min_stock', 'price']
  assertEquals(saringKolomAman(kolom), kolom)
})

// ---------- Pseudonimisasi ----------

Deno.test('samarkan menghasilkan label berformat benar', () => {
  const label = samarkan('Pelanggan', 'a3f19c00-0000-4000-8000-000000000001')
  assert(/^Pelanggan #\d{4}$/.test(label), `format tidak sesuai: ${label}`)
})

Deno.test('samarkan stabil untuk id yang sama', () => {
  // Inilah alasan hash dipakai, bukan nomor urut hasil query. Riwayat
  // percakapan yang dikirim ulang ke model masih memuat label lama; kalau
  // labelnya bergeser, model bicara tentang dua orang berbeda seolah satu.
  const id = 'a3f19c00-0000-4000-8000-000000000001'
  assertEquals(samarkan('Pelanggan', id), samarkan('Pelanggan', id))
})

Deno.test('samarkan membedakan id yang berbeda', () => {
  const a = samarkan('Pelanggan', '11111111-0000-4000-8000-000000000001')
  const b = samarkan('Pelanggan', '22222222-0000-4000-8000-000000000002')
  assert(a !== b, `dua id berbeda menghasilkan label sama: ${a}`)
})

Deno.test('samarkan tidak pernah membocorkan id aslinya', () => {
  const id = 'a3f19c00-dead-4000-8000-000000000001'
  const label = samarkan('Pelanggan', id)
  assert(!label.includes(id), 'id asli ikut di label')
  assert(!label.includes('a3f19c00'), 'potongan id asli ikut di label')
})

Deno.test('samarkan menangani id kosong tanpa melempar', () => {
  for (const kosong of [null, undefined, '', '   ']) {
    assertEquals(samarkan('Pelanggan', kosong), 'Pelanggan (tidak dikenal)')
  }
})

Deno.test('sebaran label cukup lebar untuk daftar sebesar UMKM', () => {
  // 200 pelanggan adalah ujung atas yang realistis untuk warung/UMKM. Tabrakan
  // label berarti dua orang berbeda tampak sebagai satu bagi model — piutang
  // mereka akan dijumlahkan jadi satu angka yang salah.
  const label = new Set<string>()
  for (let i = 0; i < 200; i++) {
    label.add(samarkan('Pelanggan', `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`))
  }
  assert(label.size >= 195, `terlalu banyak tabrakan: ${label.size} label unik dari 200`)
})
