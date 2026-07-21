// ============================================================
// Seed data uji untuk akun pengujian: Karyawan, Pemasok, Produk, dan
// Purchase Order. Dipakai agar alur HR & Gudang bisa diuji end-to-end —
// tanpa data ini halaman Absensi/KPI/Penggajian dan modal "Terima PO"
// tidak pernah muncul sehingga tak bisa diverifikasi.
//
// Semua yang dibuat diberi penanda "[UJI]" (dan nomor PO berawalan
// PO-UJI-) sehingga:
//   - mudah dikenali di antarmuka,
//   - bisa dihapus total tanpa menyentuh data lain,
//   - tidak mengganggu penomoran PO asli (formatnya sengaja beda).
//
// Pakai:
//   E2E_EMAIL=... E2E_PASSWORD=... node scripts/seed-uji.mjs --seed
//   E2E_EMAIL=... E2E_PASSWORD=... node scripts/seed-uji.mjs --bersih
//   (--seed membersihkan sisa lama dulu, jadi aman dijalankan berulang)
// ============================================================
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const MARK = '[UJI]'
const PO_PREFIX = 'PO-UJI-'

function loadEnv() {
  const env = { ...process.env }
  try {
    for (const line of readFileSync('.env', 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && env[m[1]] === undefined) env[m[1]] = m[2].trim()
    }
  } catch { /* boleh tidak ada bila ENV sudah lengkap */ }
  return env
}

const env = loadEnv()
const { VITE_SUPABASE_URL: URL, VITE_SUPABASE_ANON_KEY: ANON, E2E_EMAIL: EMAIL, E2E_PASSWORD: PASSWORD } = env
const mode = process.argv.includes('--bersih') ? 'bersih' : process.argv.includes('--seed') ? 'seed' : null

if (!mode) { console.error('Pakai --seed atau --bersih.'); process.exit(2) }
if (!URL || !ANON) { console.error('✗ VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY tidak ditemukan.'); process.exit(2) }
if (!EMAIL || !PASSWORD) { console.error('✗ Set E2E_EMAIL & E2E_PASSWORD (akun uji).'); process.exit(2) }

const sb = createClient(URL, ANON, { auth: { persistSession: false } })

// Hapus HANYA baris berpenanda, urut aman terhadap relasi antar-tabel:
// PO lebih dulu (menunjuk produk & pemasok), lalu karyawan, produk, pemasok.
async function bersihkan() {
  const hasil = {}
  const hapus = async (label, jalan) => {
    const { data, error } = await jalan()
    if (error) { hasil[label] = `gagal: ${error.message}`; return }
    hasil[label] = (data || []).length
  }
  await hapus('purchase_orders', () => sb.from('purchase_orders').delete().like('po_number', `${PO_PREFIX}%`).select('id'))
  await hapus('employees', () => sb.from('employees').delete().like('name', `${MARK}%`).select('id'))
  await hapus('products', () => sb.from('products').delete().like('name', `${MARK}%`).select('id'))
  await hapus('suppliers', () => sb.from('suppliers').delete().like('name', `${MARK}%`).select('id'))
  return hasil
}

async function seed(userId) {
  // 1. Pemasok — dirujuk produk & PO.
  const { data: pemasok, error: e1 } = await sb.from('suppliers')
    .insert({ user_id: userId, name: `${MARK} Pemasok Sejahtera`, phone: '081200000001', note: 'Data uji otomatis' })
    .select().single()
  if (e1) throw new Error(`pemasok: ${e1.message}`)

  // 2. Produk — WAJIB ada karena PO menunjuk satu produk.
  //    min_stock diisi supaya peringatan stok menipis juga bisa diuji.
  const { data: produk, error: e2 } = await sb.from('products')
    .insert({
      user_id: userId, name: `${MARK} Bolu Coklat`, unit: 'pcs', category: 'Kue',
      stock: 8, min_stock: 10, price: 25000, cost_price: 15000, supplier_id: pemasok.id,
    })
    .select().single()
  if (e2) throw new Error(`produk: ${e2.message}`)

  // 3. Karyawan — dua tipe gaji supaya Penggajian & KPI punya dua jalur hitung.
  const { data: karyawan, error: e3 } = await sb.from('employees').insert([
    { user_id: userId, name: `${MARK} Andi`, role: 'Kasir', phone: '081200000002',
      salary_type: 'bulanan', salary_amount: 2500000, status: 'aktif', join_date: '2026-01-06', note: 'Data uji otomatis' },
    { user_id: userId, name: `${MARK} Budi`, role: 'Produksi', phone: '081200000003',
      salary_type: 'harian', salary_amount: 100000, status: 'aktif', join_date: '2026-03-02', note: 'Data uji otomatis' },
  ]).select()
  if (e3) throw new Error(`karyawan: ${e3.message}`)

  // 4. Purchase Order — satu draf dan satu disetujui. Yang disetujui penting:
  //    hanya PO berstatus "approved" yang memunculkan modal Terima PO.
  const { data: po, error: e4 } = await sb.from('purchase_orders').insert([
    { user_id: userId, po_number: `${PO_PREFIX}0001`, product_id: produk.id, supplier_id: pemasok.id,
      qty: 20, unit_price: 15000, status: 'draft', note: 'Data uji otomatis (draf)' },
    { user_id: userId, po_number: `${PO_PREFIX}0002`, product_id: produk.id, supplier_id: pemasok.id,
      qty: 12, unit_price: 15000, status: 'approved', approved_at: new Date().toISOString(),
      note: 'Data uji otomatis (siap diterima)' },
  ]).select()
  if (e4) throw new Error(`purchase order: ${e4.message}`)

  return { pemasok: 1, produk: 1, karyawan: karyawan.length, purchase_orders: po.length }
}

async function main() {
  const { data: auth, error: authErr } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  if (authErr) { console.error('✗ Gagal masuk akun uji:', authErr.message); process.exit(2) }
  const userId = auth.user.id
  console.log(`Akun uji : ${EMAIL}`)
  console.log(`Penanda  : ${MARK} (PO: ${PO_PREFIX})\n`)

  if (mode === 'bersih') {
    console.log('Menghapus data berpenanda...')
    console.log(await bersihkan())
    console.log('\nSelesai. Hanya baris berpenanda yang dihapus.')
    return
  }

  console.log('Membersihkan sisa seed lama dulu (agar tidak menumpuk)...')
  console.log(await bersihkan())
  console.log('\nMenanam data uji...')
  console.log(await seed(userId))
  console.log(`\nSelesai. Hapus kembali dengan: node scripts/seed-uji.mjs --bersih`)
}

main().catch((e) => { console.error('✗', e.message); process.exit(1) })
