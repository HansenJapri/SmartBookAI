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
import { uraikanKeluaran, nilaiHasil, formatBaris } from './ujiDbParse.mjs'

const URL_DB = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL

if (!URL_DB) {
  console.log('[uji-db] SUPABASE_DB_URL tidak diset — pengujian database DILEWATI.')
  console.log('[uji-db] Ini bukan kelulusan. Gerbang DB hanya berjalan bila rahasianya tersedia.')
  process.exit(0)
}

// SELURUH pengujian dibungkus BEGIN ... ROLLBACK, dan itu bukan formalitas.
//
// Harness (test_bom, test_pembatalan, test_stock_applied) MENULIS baris nyata:
// produk, bahan, komposisi, transaksi. Ia memang membersihkan miliknya sendiri
// di jalur sukses maupun di blok exception — tapi pembersihan yang bergantung
// pada kode yang sedang diuji adalah jaminan yang melingkar. Satu `raise` di
// tempat tak terduga, satu perubahan nama prefiks, atau koneksi yang putus di
// tengah jalan sudah cukup untuk meninggalkan sampah di database yang dipakai
// pengguna sungguhan.
//
// ROLLBACK memindahkan jaminannya ke Postgres: apa pun yang terjadi di dalam,
// tidak ada satu byte pun yang di-commit. Keluaran SELECT tetap terkirim ke
// stdout sebelum ROLLBACK dijalankan, jadi hasil ujinya tidak ikut hilang.
//
// Yang TETAP tersisa sebagai risiko: pengujian ini masih berjalan di instance
// produksi, jadi ia memakai koneksi dan mengunci baris sesaat (SELECT ... FOR
// UPDATE). Itu ringan dan sesaat, tapi bukan nol. Memindahkannya ke database
// terpisah (Supabase branch atau Postgres lokal di CI) adalah langkah berikutnya
// yang benar; ROLLBACK ini menutup bagian yang paling berbahaya lebih dulu.
const SQL = `
begin;
select coalesce(json_agg(row_to_json(t)), '[]'::json)::text
from (select suite, kasus, hasil, lulus from public.test_semua()) t;
rollback;
`

let keluaran
try {
  // -f - (baca dari stdin), bukan -c: dengan -c seluruh string dikirim sebagai
  // SATU simple query dalam transaksi implisit, sehingga BEGIN di dalamnya
  // memicu peringatan "there is already a transaction in progress" dan kendali
  // transaksinya jadi ambigu. Lewat stdin tiap pernyataan dikirim terpisah dan
  // BEGIN/ROLLBACK benar-benar mengendalikan transaksinya.
  // -q WAJIB: tanpa itu psql mencetak tag perintah "BEGIN" dan "ROLLBACK" ke
  // stdout, bercampur dengan baris JSON dan membuat penguraiannya gagal.
  keluaran = execFileSync('psql', [URL_DB, '-t', '-A', '-q', '-v', 'ON_ERROR_STOP=1', '-f', '-'], {
    input: SQL,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
} catch (e) {
  console.error('[uji-db] Gagal menjalankan psql.')
  console.error(e.stderr?.toString?.() || e.message)
  process.exit(1)
}

// Penguraian & penilaian ada di modul terpisah yang diuji vitest
// (src/lib/__tests__/ujiDbParse.test.js). Di sini tinggal I/O dan kode keluar.
let baris
try {
  baris = uraikanKeluaran(keluaran)
} catch (e) {
  console.error(`[uji-db] ${e.message}`)
  console.error(keluaran)
  process.exit(1)
}

for (const b of baris) console.log(formatBaris(b))

const hasil = nilaiHasil(baris)
console.log(`
[uji-db] ${hasil.total - hasil.gagal}/${hasil.total} lulus.`)
if (!hasil.lulus) {
  console.error(`[uji-db] ${hasil.alasan}`)
  process.exit(1)
}
