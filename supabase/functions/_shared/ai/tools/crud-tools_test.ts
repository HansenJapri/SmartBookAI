// ============================================================
// deno test — resolusi referensi & slot-filling CRUD lewat prompt.
//
// Berkas ini lahir dari satu bug yang membuat fitur AI CRUD tidak pernah
// benar-benar bekerja, dan yang lolos justru karena tidak ada test di sini:
//
//   Model TIDAK PERNAH diberi satu pun ID. Prompt sistem hanya memuat nama
//   ("Produk: [\"Nasi Goreng\"]") dan daftar pilihan di kartu slot-filling juga
//   berisi nama. Jadi `product_id` selalu sampai ke server berisi teks, bukan
//   UUID — lalu dijalankan sebagai `.eq('id', 'Nasi Goreng')` pada kolom uuid.
//   Postgres menolaknya (22P02), nilainya dibuang, dan:
//     - untuk ref opsional  -> penjualan tercatat tanpa memotong stok;
//     - untuk ref WAJIB     -> field kosong SETELAH daftar pertanyaan disusun,
//       sehingga tidak pernah ditanyakan lagi, draft dinyatakan siap, dan
//       penyimpanan gagal dengan galat NOT NULL yang tidak berarti apa pun.
//
// Karena itu yang diuji di sini bukan "fungsinya jalan", melainkan tiga janji
// yang kalau dilanggar mengembalikan bug itu: nama diterjemahkan ke ID, nilai
// yang gagal diresolusi DITANYAKAN ULANG, dan jawaban yang ditolak tidak
// pernah dianggap sudah terjawab.
//
// Jalankan: deno test --allow-import _shared/ai/
// ============================================================
import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  applyAnswer,
  computeClarifications,
  resolveReferences,
  validateDraft,
  type ValidatedDraft,
} from './crud-tools.ts'

const OWNER = '11111111-1111-4111-8111-111111111111'
const ID_NASI = '22222222-2222-4222-8222-222222222222'
const ID_NASI2 = '33333333-3333-4333-8333-333333333333'
const ID_BUDI = '44444444-4444-4444-8444-444444444444'

/**
 * Supabase palsu seukuran kebutuhan: hanya rantai yang benar-benar dipakai
 * resolveReferences (select -> eq/ilike -> limit/maybeSingle).
 *
 * `eq('id', ...)` sengaja MELEMPAR untuk nilai non-UUID, meniru persis
 * perilaku Postgres yang menjadi sumber bug. Test-nya jadi tidak bisa lulus
 * dengan implementasi lama, apa pun bentuknya.
 */
function fakeDb(tabel: Record<string, Array<Record<string, unknown>>>) {
  const panggilan: string[] = []
  const from = (t: string) => {
    let baris = [...(tabel[t] ?? [])]
    const api: any = {
      select: () => api,
      eq(kolom: string, nilai: unknown) {
        if (kolom === 'id' && !/^[0-9a-f-]{36}$/i.test(String(nilai))) {
          throw new Error(`invalid input syntax for type uuid: "${nilai}"`)
        }
        panggilan.push(`${t}.eq(${kolom})`)
        baris = baris.filter((r) => r[kolom] === nilai)
        return api
      },
      ilike(kolom: string, pola: string) {
        panggilan.push(`${t}.ilike(${kolom})`)
        const bersih = pola.replace(/\\(.)/g, '$1')
        const bebas = bersih.startsWith('%') && bersih.endsWith('%')
        const inti = bersih.replace(/^%|%$/g, '').toLowerCase()
        baris = baris.filter((r) => {
          const v = String(r[kolom] ?? '').toLowerCase()
          return bebas ? v.includes(inti) : v === inti
        })
        return api
      },
      limit: () => api,
      maybeSingle: () => Promise.resolve({ data: baris[0] ?? null, error: null }),
      then: (res: any) => res({ data: baris, error: null }),
    }
    return api
  }
  return { db: { from }, panggilan }
}

const DB_DASAR = {
  products: [
    { id: ID_NASI, user_id: OWNER, name: 'Nasi Goreng' },
    { id: ID_NASI2, user_id: OWNER, name: 'Nasi Goreng Seafood' },
    { id: '55555555-5555-4555-8555-555555555555', user_id: OWNER, name: 'Es Teh' },
  ],
  employees: [{ id: ID_BUDI, user_id: OWNER, name: 'Budi' }],
}

// ---------- 1. Nama diterjemahkan menjadi ID ----------

Deno.test('nama produk yang disebut model diterjemahkan menjadi UUID', async () => {
  const d = validateDraft('create_transaksi', {
    direction: 'in', amount: 25000, description: 'Jual nasi goreng',
    category: 'Penjualan', product_id: 'Nasi Goreng', qty: 1,
  }) as ValidatedDraft

  // Persis bentuk yang dihasilkan model: NAMA, bukan UUID.
  assertEquals(d.values.product_id, 'Nasi Goreng')

  const { db } = fakeDb(DB_DASAR)
  const masalah = await resolveReferences(db, d, OWNER)

  assertEquals(masalah.length, 0)
  assertEquals(d.values.product_id, ID_NASI)
  // Label dipertahankan supaya kartu konfirmasi tidak menampilkan UUID.
  assertEquals(d.refLabels?.product_id, 'Nasi Goreng')
})

Deno.test('nama tidak pernah dikirim sebagai eq(id) — inilah galat 22P02 yang lama', async () => {
  const d = validateDraft('create_transaksi', {
    direction: 'in', amount: 1000, description: 'x', category: 'Penjualan',
    product_id: 'Nasi Goreng',
  }) as ValidatedDraft

  const { db, panggilan } = fakeDb(DB_DASAR)
  // Implementasi lama melempar di sini; yang baru harus lolos.
  await resolveReferences(db, d, OWNER)

  // Pencocokan nama memakai ilike, bukan eq('id').
  assert(panggilan.some((p) => p.startsWith('products.ilike')))
})

Deno.test('UUID yang sudah benar tetap diverifikasi lewat eq(id)', async () => {
  const d = validateDraft('create_transaksi', {
    direction: 'in', amount: 1000, description: 'x', category: 'Penjualan',
    product_id: ID_NASI,
  }) as ValidatedDraft

  const { db, panggilan } = fakeDb(DB_DASAR)
  const masalah = await resolveReferences(db, d, OWNER)

  assertEquals(masalah.length, 0)
  assertEquals(d.values.product_id, ID_NASI)
  assert(panggilan.includes('products.eq(id)'))
})

// ---------- 2. Yang gagal diresolusi DITANYAKAN ULANG ----------

Deno.test('ref WAJIB yang tidak ditemukan kembali ke antrean pertanyaan, bukan hilang', async () => {
  const d = validateDraft('create_absensi', {
    employee_id: 'Siapa Entah', status: 'hadir', date: '2026-08-11',
  }) as ValidatedDraft

  // Sebelum resolusi, employee_id "terisi" sehingga tidak dianggap kurang.
  assertEquals(d.missingRequired.some((q) => q.field === 'employee_id'), false)

  const { db } = fakeDb(DB_DASAR)
  const masalah = await resolveReferences(db, d, OWNER)

  assertEquals(masalah.length, 1)
  assertEquals(d.values.employee_id, undefined)
  // Inti perbaikan: field wajib yang kosong HARUS ditanyakan lagi.
  assertEquals(d.missingRequired.some((q) => q.field === 'employee_id'), true)
  assertEquals(d.ok, false)
  assertEquals(computeClarifications(d).needsClarification, true)
})

Deno.test('nama yang ambigu menawarkan kandidat alih-alih menebak', async () => {
  const d = validateDraft('create_transaksi', {
    direction: 'in', amount: 1000, description: 'x', category: 'Penjualan',
    product_id: 'Nasi',
  }) as ValidatedDraft

  const { db } = fakeDb(DB_DASAR)
  const masalah = await resolveReferences(db, d, OWNER)

  assertEquals(masalah.length, 1)
  assertStringIncludes(masalah[0].message, 'Nasi Goreng')
  assertStringIncludes(masalah[0].message, 'Nasi Goreng Seafood')
  // Tidak menebak salah satunya.
  assertEquals(d.values.product_id, undefined)
  const q = d.optionalPrompts.find((x) => x.field === 'product_id')
  assert(q, 'pertanyaan produk harus diajukan ulang')
  assertEquals(q!.options?.length, 2)
})

Deno.test('nama persis menang atas kecocokan sebagian', async () => {
  const d = validateDraft('create_transaksi', {
    direction: 'in', amount: 1000, description: 'x', category: 'Penjualan',
    product_id: 'Nasi Goreng',
  }) as ValidatedDraft

  const { db } = fakeDb(DB_DASAR)
  await resolveReferences(db, d, OWNER)
  // "Nasi Goreng" cocok persis, jadi "Nasi Goreng Seafood" tidak ikut.
  assertEquals(d.values.product_id, ID_NASI)
})

// ---------- 3. Jawaban yang ditolak tidak menutup pertanyaannya ----------

Deno.test('jawaban nominal yang tidak terbaca TIDAK dianggap sudah terjawab', () => {
  const d = validateDraft('create_transaksi', {
    direction: 'in', description: 'Jual kue', category: 'Penjualan',
  }) as ValidatedDraft
  assertEquals(d.missingRequired.some((q) => q.field === 'amount'), true)

  // "seratus ribu" -> coerceField menghasilkan 0, ditolak karena min: 1.
  applyAnswer(d, 'amount', 'seratus ribu')

  assertEquals(d.values.amount, undefined)
  // Dulu pertanyaannya tetap dicoret di sini, draft dinyatakan siap, dan yang
  // tersimpan adalah transaksi Rp 0.
  assertEquals(d.missingRequired.some((q) => q.field === 'amount'), true)
  assertEquals(d.ok, false)
})

Deno.test('jawaban nominal yang sah menutup pertanyaannya', () => {
  const d = validateDraft('create_transaksi', {
    direction: 'in', description: 'Jual kue', category: 'Penjualan',
  }) as ValidatedDraft
  applyAnswer(d, 'amount', '125000')
  assertEquals(d.values.amount, 125000)
  assertEquals(d.missingRequired.some((q) => q.field === 'amount'), false)
})

Deno.test('field wajib tidak bisa dilewati', () => {
  const d = validateDraft('create_transaksi', {
    direction: 'in', description: 'Jual kue', category: 'Penjualan',
  }) as ValidatedDraft
  applyAnswer(d, 'amount', 'lewati')
  assertEquals(d.missingRequired.some((q) => q.field === 'amount'), true)
  assertEquals(d.ok, false)
})

Deno.test('"tidak" adalah JAWABAN untuk status pembayaran, bukan perintah melewati', () => {
  const d = validateDraft('create_transaksi', {
    direction: 'in', amount: 50000, description: 'Jual kue', category: 'Penjualan',
  }) as ValidatedDraft

  // Dulu "tidak" cocok dengan pola melewati, sehingga jatuh ke fallback 'lunas'
  // — piutang yang tercatat lunas adalah tagihan yang tidak akan pernah ditagih.
  applyAnswer(d, 'payment_status', 'belum')
  assertEquals(d.values.payment_status, 'belum')

  const d2 = validateDraft('create_transaksi', {
    direction: 'in', amount: 50000, description: 'Jual kue', category: 'Penjualan',
  }) as ValidatedDraft
  applyAnswer(d2, 'payment_status', 'tidak')
  // Bukan pilihan sah -> ditolak dan ditanyakan lagi, BUKAN dilewati diam-diam.
  assertEquals(d2.values.payment_status, undefined)
  assertEquals(d2.optionalPrompts.some((q) => q.field === 'payment_status'), true)
})

Deno.test('jawaban nama pada pertanyaan ref ikut diresolusi jadi ID', async () => {
  const d = validateDraft('create_absensi', { status: 'hadir', date: '2026-08-11' }) as ValidatedDraft
  assertEquals(d.missingRequired.some((q) => q.field === 'employee_id'), true)

  // Pengguna menekan salah satu chip berisi NAMA karyawan.
  applyAnswer(d, 'employee_id', 'Budi')
  const { db } = fakeDb(DB_DASAR)
  const masalah = await resolveReferences(db, d, OWNER)

  assertEquals(masalah.length, 0)
  assertEquals(d.values.employee_id, ID_BUDI)
  assertEquals(d.ok, true)
  // Tidak ada lagi field WAJIB yang tertunda. Slot-filling boleh tetap berjalan
  // untuk field opsional (`note`) — itu kebijakan yang memang diminta, terpisah
  // dari perkara resolusi referensi yang diuji di sini.
  assertEquals(d.missingRequired.length, 0)
  const rencana = computeClarifications(d)
  assertEquals(rencana.pending.some((q) => q.field === 'employee_id'), false)
})

// ---------- 4. Pertanyaan opsional dibatasi ----------
//
// Aturan lama menanyakan SETIAP field opsional yang kosong. "Jual nasi goreng
// 25rb" berarti delapan giliran percakapan sebelum satu baris pun tersimpan —
// dan pengguna berhenti di pertanyaan ketiga, sehingga yang tersimpan NIHIL.
// Angka-angka di sini dikunci supaya penambahan field baru tidak diam-diam
// mengembalikan interogasi itu.

Deno.test('transaksi lengkap tidak menyisakan pertanyaan opsional selain status bayar', () => {
  const d = validateDraft('create_transaksi', {
    direction: 'in', amount: 25000, description: 'Jual nasi goreng', category: 'Penjualan',
  }) as ValidatedDraft

  assertEquals(d.missingRequired.length, 0)
  // Dulu: channel, tanggal, status bayar, jatuh tempo, nama pelanggan, kontak,
  // produk, jumlah = 8 pertanyaan. Sekarang hanya yang merusak angka bila salah.
  assertEquals(d.optionalPrompts.map((q) => q.field), ['payment_status'])
})

Deno.test('field opsional yang tidak ditanyakan diberi nilai bawaannya', () => {
  const d = validateDraft('create_transaksi', {
    direction: 'in', amount: 25000, description: 'Jual nasi goreng', category: 'Penjualan',
  }) as ValidatedDraft
  // Kartu ringkasan harus memperlihatkan apa yang BENAR-BENAR akan tersimpan.
  assertEquals(d.values.channel, 'manual')
  // 'today' hanyalah penanda — pengisiannya milik klien yang tahu zona waktu.
  assertEquals(d.values.occurred_at, undefined)
})

Deno.test('jatuh tempo baru ditanyakan setelah dijawab belum lunas', () => {
  const d = validateDraft('create_transaksi', {
    direction: 'in', amount: 25000, description: 'Jual kue', category: 'Penjualan',
  }) as ValidatedDraft
  assertEquals(d.optionalPrompts.some((q) => q.field === 'due_date'), false)

  applyAnswer(d, 'payment_status', 'belum')
  assertEquals(d.optionalPrompts.some((q) => q.field === 'due_date'), true)
})

Deno.test('jatuh tempo ditarik kembali bila status dikoreksi jadi lunas', () => {
  const d = validateDraft('create_transaksi', {
    direction: 'in', amount: 25000, description: 'Jual kue', category: 'Penjualan',
    payment_status: 'belum',
  }) as ValidatedDraft
  assertEquals(d.optionalPrompts.some((q) => q.field === 'due_date'), true)

  applyAnswer(d, 'payment_status', 'lunas')
  assertEquals(d.optionalPrompts.some((q) => q.field === 'due_date'), false)
})

Deno.test('jatuh tempo yang sudah dilewati tidak ditanyakan lagi', () => {
  const d = validateDraft('create_transaksi', {
    direction: 'in', amount: 25000, description: 'Jual kue', category: 'Penjualan',
  }) as ValidatedDraft
  applyAnswer(d, 'payment_status', 'belum')
  applyAnswer(d, 'due_date', 'lewati')
  assertEquals(d.optionalPrompts.some((q) => q.field === 'due_date'), false)
  // Dan tetap tidak kembali pada putaran berikutnya — syaratnya masih terpenuhi
  // dan nilainya masih kosong, jadi tanpa penjaga ini akan berputar selamanya.
  applyAnswer(d, 'customer_name', 'Bu Sari')
  assertEquals(d.optionalPrompts.some((q) => q.field === 'due_date'), false)
})

Deno.test('jumlah hanya ditanyakan bila ada produk stok yang dipilih', () => {
  const tanpa = validateDraft('create_transaksi', {
    direction: 'in', amount: 25000, description: 'Jual kue', category: 'Penjualan',
  }) as ValidatedDraft
  assertEquals(tanpa.optionalPrompts.some((q) => q.field === 'qty'), false)

  const dengan = validateDraft('create_transaksi', {
    direction: 'in', amount: 25000, description: 'Jual nasi goreng', category: 'Penjualan',
    product_id: 'Nasi Goreng',
  }) as ValidatedDraft
  assertEquals(dengan.optionalPrompts.some((q) => q.field === 'qty'), true)
})

Deno.test('pemasok, pelanggan, dan tugas tidak menyisakan pertanyaan opsional', () => {
  const pemasok = validateDraft('create_pemasok', { name: 'Toko Grosir Jaya' }) as ValidatedDraft
  assertEquals(pemasok.optionalPrompts.length, 0)
  assertEquals(pemasok.ok, true)

  const pelanggan = validateDraft('create_pelanggan', { name: 'Bu Sari' }) as ValidatedDraft
  assertEquals(pelanggan.optionalPrompts.length, 0)

  // Papan tugas dulu bertanya lima kali untuk satu baris "beli galon".
  const tugas = validateDraft('create_tugas', { title: 'Beli galon' }) as ValidatedDraft
  assertEquals(tugas.optionalPrompts.length, 0)
  assertEquals(tugas.values.status, 'antre')
  assertEquals(tugas.values.priority, 'normal')
})

Deno.test('produk hanya menanyakan HPP di antara field opsionalnya', () => {
  const d = validateDraft('create_produk', {
    name: 'Kopi Susu', unit: 'pcs', price: 15000, stock: 20,
  }) as ValidatedDraft
  assertEquals(d.optionalPrompts.map((q) => q.field), ['cost_price'])
  assertEquals(d.values.min_stock, 0)
})

Deno.test('pertanyaan wajib tetap didahulukan sebelum yang opsional', () => {
  const d = validateDraft('create_transaksi', { direction: 'in' }) as ValidatedDraft
  const urutan = computeClarifications(d).pending.map((q) => q.field)
  assertEquals(urutan[urutan.length - 1], 'payment_status')
  assert(urutan.indexOf('amount') < urutan.indexOf('payment_status'))
})

// ---------- 5. Keluhan lama tidak menumpuk ----------

Deno.test('keluhan ref dari putaran sebelumnya dibersihkan saat diresolusi ulang', async () => {
  const d = validateDraft('create_absensi', {
    employee_id: 'Salah Nama', status: 'hadir', date: '2026-08-11',
  }) as ValidatedDraft

  const { db } = fakeDb(DB_DASAR)
  await resolveReferences(db, d, OWNER)
  d.issues.push(...await Promise.resolve([]))
  assert(d.issues.length >= 0)

  // Putaran berikutnya: pengguna memperbaiki namanya.
  applyAnswer(d, 'employee_id', 'Budi')
  await resolveReferences(db, d, OWNER)

  assertEquals(d.issues.some((i) => i.field === 'employee_id'), false)
  assertEquals(d.values.employee_id, ID_BUDI)
})
