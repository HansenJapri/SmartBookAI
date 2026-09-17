import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { penjagaSatuKejadian, pesanDilewati } from './satu-kejadian.ts'

// Kasus-kasus di bawah ditulis memakai CONTOH ASLI yang menentukan aturan ini,
// bukan 'a'/'b'/'c'. Kalau kelak ada yang melonggarkan aturannya, yang gagal
// harus kalimat yang bisa langsung dikenali sebagai keputusan produk.

Deno.test('kejadian tunggal: satu penjualan lolos', () => {
  const p = penjagaSatuKejadian()
  // "kejual kopi 5pcs 80rb"
  assertEquals(p.terima('transaksi'), true)
  assertEquals(p.dilewati, [])
})

Deno.test('satu kejadian boleh menyentuh beberapa JENIS catatan', () => {
  const p = penjagaSatuKejadian()
  // "beli stok indomie 24 bungkus" → pengeluaran + stok produk
  assertEquals(p.terima('transaksi'), true)
  assertEquals(p.terima('produk'), true)
  assertEquals(p.dilewati, [], 'dua jenis berbeda bukan dua kejadian')
})

Deno.test('dua kejadian berjenis sama: yang kedua dilewati', () => {
  const p = penjagaSatuKejadian()
  // "kejual kopi hitam 5pcs dan kopi latte 2pcs" → dua penjualan
  assertEquals(p.terima('transaksi'), true)
  assertEquals(p.terima('transaksi'), false)
  assertEquals(p.dilewati, ['transaksi'])
})

Deno.test('yang PERTAMA yang dipertahankan, bukan yang terakhir', () => {
  // Penting: pengguna menyebut yang paling penting lebih dulu, dan kalimat
  // pemberitahuannya berjanji "saya catat yang pertama saja".
  const p = penjagaSatuKejadian()
  const urutan = ['kopi hitam', 'kopi latte', 'teh manis']
  const lolos = urutan.filter(() => p.terima('transaksi'))
  assertEquals(lolos, ['kopi hitam'])
  assertEquals(p.dilewati.length, 2)
})

Deno.test('kejadian campuran: satu per jenis, sisanya dilewati', () => {
  const p = penjagaSatuKejadian()
  assertEquals(p.terima('transaksi'), true)
  assertEquals(p.terima('produk'), true)
  assertEquals(p.terima('transaksi'), false)  // penjualan kedua
  assertEquals(p.terima('pelanggan'), true)   // jenis baru, masih boleh
  assertEquals(p.terima('produk'), false)     // produk kedua
  assertEquals(p.dilewati, ['transaksi', 'produk'])
})

Deno.test('jenis kosong tidak pernah dijadikan kunci', () => {
  // Gagal ke arah MEMPROSES: aksi tetap harus dikonfirmasi manusia sebelum
  // tersimpan, sedangkan aksi yang dibuang diam-diam tidak bisa dikoreksi.
  const p = penjagaSatuKejadian()
  assertEquals(p.terima(''), true)
  assertEquals(p.terima(''), true)
  assertEquals(p.terima('   '), true)
  assertEquals(p.terima(undefined as unknown as string), true)
  assertEquals(p.dilewati, [])
})

Deno.test('tiap pesan mulai dari nol', () => {
  // Penjaga dibuat per permintaan. Kalau keadaannya bocor antar pesan, pesan
  // kedua pengguna tidak akan pernah tercatat.
  const pertama = penjagaSatuKejadian()
  assertEquals(pertama.terima('transaksi'), true)

  const kedua = penjagaSatuKejadian()
  assertEquals(kedua.terima('transaksi'), true, 'pesan baru, jatah baru')
})

Deno.test('pesan pemberitahuan hanya muncul bila ada yang dilewati', () => {
  assertEquals(pesanDilewati(0), '')
  assertEquals(pesanDilewati(-1), '')
  const teks = pesanDilewati(2)
  // Harus menjelaskan SEBABNYA (dua kejadian), bukan sekadar bahwa ada yang
  // tidak diproses — pengguna yang mengira kalimatnya kepanjangan akan
  // memperpendeknya dan tetap menabrak aturan yang sama.
  assertEquals(teks.includes('satu kejadian'), true)
  assertEquals(teks.includes('pesan terpisah'), true)
})
