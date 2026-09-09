// ============================================================
// deno test — parseTanggalManusiawi()
//
// Berkas ini lahir dari satu laporan pengguna (9 September 2026): transaksi
// piutang yang sudah diketik lengkap tidak pernah masuk ke Piutang & Utang.
// Sebabnya bukan database, bukan RLS, dan bukan AI — melainkan satu regex:
//
//   if (!/^\d{4}-\d{2}-\d{2}/.test(v)) { ...tolak... }
//
// Asisten bertanya "Kapan jatuh temponya?", pengguna menjawab "30 september
// 2026" — jawaban paling wajar dalam bahasa Indonesia — dan ditolak. Keluhan
// formatnya tidak ditampilkan, jadi pertanyaannya sekadar muncul lagi. Draft
// tidak pernah dinyatakan siap, tombol Simpan tidak pernah muncul, dan
// transaksinya hilang tanpa satu pun pesan error.
//
// Yang dikunci di sini bukan "parser bekerja", melainkan format-format yang
// BENAR-BENAR diketik orang Indonesia — termasuk yang dulu ditolak.
// ============================================================
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { parseTanggalManusiawi } from './crud-tools.ts'

Deno.test('format ISO tetap diterima apa adanya', () => {
  assertEquals(parseTanggalManusiawi('2026-09-30'), '2026-09-30')
  assertEquals(parseTanggalManusiawi('2026-9-5'), '2026-09-05')
  // Bagian waktu ikut terpotong, bukan membuat seluruhnya ditolak.
  assertEquals(parseTanggalManusiawi('2026-09-30T10:00:00Z'), '2026-09-30')
})

Deno.test('bahasa Indonesia — kasus yang dulu membuat transaksi hilang', () => {
  assertEquals(parseTanggalManusiawi('30 september 2026'), '2026-09-30')
  assertEquals(parseTanggalManusiawi('30 September 2026'), '2026-09-30')
  assertEquals(parseTanggalManusiawi('1 des 2026'), '2026-12-01')
  assertEquals(parseTanggalManusiawi('17 agustus 2026'), '2026-08-17')
  assertEquals(parseTanggalManusiawi('5 jan 2027'), '2027-01-05')
  // Singkatan bergaya lama yang masih dipakai di Indonesia.
  assertEquals(parseTanggalManusiawi('9 nop 2026'), '2026-11-09')
  assertEquals(parseTanggalManusiawi('3 pebruari 2026'), '2026-02-03')
})

Deno.test('nama bulan bahasa Inggris ikut dikenali', () => {
  assertEquals(parseTanggalManusiawi('30 September 2026'), '2026-09-30')
  assertEquals(parseTanggalManusiawi('4 July 2026'), '2026-07-04')
})

Deno.test('dd/mm/yyyy dibaca HARI dulu, bukan gaya Amerika', () => {
  // Ini alasan parser ditulis sendiri alih-alih memakai new Date(string).
  // `new Date('03/09/2026')` di JS = 9 MARET. Pengguna Indonesia menulisnya
  // sebagai 3 September. Menebak salah pada tanggal jatuh tempo berarti
  // menagih pelanggan di bulan yang keliru.
  assertEquals(parseTanggalManusiawi('03/09/2026'), '2026-09-03')
  assertEquals(parseTanggalManusiawi('30/09/2026'), '2026-09-30')
  assertEquals(parseTanggalManusiawi('30-9-2026'), '2026-09-30')
  assertEquals(parseTanggalManusiawi('30.09.2026'), '2026-09-30')
})

Deno.test('kata relatif yang biasa diucapkan', () => {
  const hariIni = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10)
  const besok = new Date(Date.now() + 7 * 3600 * 1000 + 86400000).toISOString().slice(0, 10)
  assertEquals(parseTanggalManusiawi('hari ini'), hariIni)
  assertEquals(parseTanggalManusiawi('besok'), besok)
  assertEquals(parseTanggalManusiawi('Besok'), besok)
})

Deno.test('tanggal yang tidak ada ditolak, bukan digeser diam-diam', () => {
  // 31 Februari akan digeser jadi 2/3 Maret oleh Date() kalau dibiarkan.
  // Menggeser tanggal jatuh tempo tanpa memberi tahu siapa pun lebih buruk
  // daripada menolaknya.
  assertEquals(parseTanggalManusiawi('31/02/2026'), null)
  assertEquals(parseTanggalManusiawi('31 februari 2026'), null)
  assertEquals(parseTanggalManusiawi('2026-02-30'), null)
  assertEquals(parseTanggalManusiawi('32/01/2026'), null)
  assertEquals(parseTanggalManusiawi('30/13/2026'), null)
})

Deno.test('masukan yang memang bukan tanggal ditolak', () => {
  assertEquals(parseTanggalManusiawi(''), null)
  assertEquals(parseTanggalManusiawi(null), null)
  assertEquals(parseTanggalManusiawi(undefined), null)
  assertEquals(parseTanggalManusiawi('Penjualan Marketplace'), null)
  assertEquals(parseTanggalManusiawi('besok lusa entah kapan'), null)
  assertEquals(parseTanggalManusiawi('30 bulanapa 2026'), null)
})

Deno.test('tahun di luar rentang masuk akal ditolak', () => {
  assertEquals(parseTanggalManusiawi('30/09/1800'), null)
  assertEquals(parseTanggalManusiawi('2200-01-01'), null)
})
