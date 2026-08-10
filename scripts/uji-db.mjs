#!/usr/bin/env node
// Gerbang pengujian sisi DATABASE — pasangan `npx vitest run` untuk sisi klien.
//
// Menjalankan public.test_semua(), yang menggabungkan:
//   test_bom()            mesin pemotongan stok berbasis kemasan
//   test_pembatalan()     pembalikan stok saat transaksi dihapus
//   test_stock_applied()  penanda "baris ini benar-benar menggerakkan stok"
//   rls_lint()            privasi baris (setiap baris = pelanggaran)
//   tenancy_lint()        isolasi workspace (setiap baris = pelanggaran)
//
// KENAPA BERKAS INI ADA
// Sebelum ini semua penjaga database hanya bisa dijalankan dengan cara mengingat
// untuk menjalankannya. Penjaga yang bergantung pada ingatan bukan penjaga —
// ia hanya dokumentasi yang kebetulan bisa dieksekusi.
//
// CARA PAKAI
//   SUPABASE_DB_URL='postgresql://...' node scripts/uji-db.mjs
//   npm run test:db
//
// URL koneksinya ada di Supabase Dashboard > Project Settings > Database >
// Connection string (mode "Session", bukan pooler transaksi — fungsi uji
// memakai transaksi eksplisit).
//
// TANPA SUPABASE_DB_URL skrip ini KELUAR SUKSES dengan pesan "dilewati".
// Itu disengaja: pull request dari fork tidak punya akses rahasia, dan
// menggagalkan CI di sana hanya akan mengajari orang mengabaikan warna merah.
// Untuk repo utama, rahasianya ada sehingga gerbangnya benar-benar berjalan.

import { execFileSync } from 'node:child_process'

const URL_DB = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL

if (!URL_DB) {
  console.log('[uji-db] SUPABASE_DB_URL tidak diset — pengujian database DILEWATI.')
  console.log('[uji-db] Ini bukan kelulusan. Gerbang DB hanya berjalan bila rahasianya tersedia.')
  process.exit(0)
}

// Satu baris JSON per kasus supaya mudah dibaca manusia maupun mesin.
const SQL = `
  select coalesce(json_agg(row_to_json(t)), '[]'::json)::text
  from (select suite, kasus, hasil, lulus from public.test_semua()) t;
`

let keluaran
try {
  keluaran = execFileSync('psql', [URL_DB, '-t', '-A', '-c', SQL], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
} catch (e) {
  console.error('[uji-db] Gagal menjalankan psql.')
  console.error(e.stderr?.toString?.() || e.message)
  process.exit(1)
}

let baris
try {
  baris = JSON.parse(keluaran.trim())
} catch {
  console.error('[uji-db] Keluaran psql tidak bisa dibaca sebagai JSON:')
  console.error(keluaran)
  process.exit(1)
}

// Nol kasus berarti fungsinya hilang atau tidak mengembalikan apa pun —
// itu kegagalan, bukan kelulusan. Sama seperti "no tests" di vitest.
if (!Array.isArray(baris) || baris.length === 0) {
  console.error('[uji-db] NOL kasus dijalankan — gerbang ini tidak menguji apa pun.')
  console.error('[uji-db] Periksa apakah public.test_semua() masih ada di database.')
  process.exit(1)
}

const gagal = baris.filter((b) => !b.lulus)
for (const b of baris) {
  console.log(`${b.lulus ? '  ok  ' : '  GAGAL'} [${b.suite}] ${b.kasus} -> ${b.hasil}`)
}
console.log(`\n[uji-db] ${baris.length - gagal.length}/${baris.length} lulus.`)

if (gagal.length) {
  console.error(`[uji-db] ${gagal.length} kasus GAGAL.`)
  process.exit(1)
}
