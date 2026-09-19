// ============================================================
// deno test — validasi checksum struk.
//
// Berkas ini lahir dari kegagalan yang dilaporkan 9 September 2026: SETIAP
// struk restoran ditolak dengan "rincian item tidak cocok dengan total di
// struk", termasuk struk yang sempurna terbaca.
//
// Sebabnya bukan OCR-nya. Validator lama membandingkan jumlah item langsung ke
// GRAND TOTAL, padahal pada struk mana pun yang memungut pajak, item berjumlah
// ke SUB TOTAL:
//
//     Sub Total   : 169.555   <- item berjumlah ke sini
//     PPN         :  16.956
//     Rounding    :     -11
//     Grand Total : 186.500   <- yang dibandingkan validator
//
// Selisihnya 10%, toleransinya 2%. Artinya setiap struk ber-PPN atau
// ber-service-charge DIJAMIN gagal — bukan kadang-kadang, tapi selalu. Fitur
// OCR-nya tidak pernah bisa dipakai untuk struk restoran, dan pesan errornya
// menyalahkan kualitas foto pengguna.
//
// Angka pada test pertama diambil apa adanya dari struk sungguhan yang gagal.
// ============================================================
import { assert, assertEquals, assertFalse } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  isChecksumValid, sumItems, totalSetelahRincian, tanggalStrukMasukAkal,
  parseAndValidateReceipt, type ReceiptItem,
} from './ocr-parser.ts'

const item = (name: string, total: number): ReceiptItem =>
  ({ name, qty: 1, unit: 'pcs', unit_price: total, total })

Deno.test('struk restoran ber-PPN: item cocok ke SUB TOTAL, bukan grand total', () => {
  // KEDAI BERINGIN, 9 Juli 2016 — struk yang benar-benar ditolak sistem lama.
  const items = [
    item('Ayam Saus Mentega', 25_456), item('Bebek Panggang 1 Prs', 25_910),
    item('Bubur Ayam', 12_728), item('Kuo Tiek', 13_637),
    item('Liang Teh', 10_910), item('Lumpia Goreng Kulit Tahu', 12_728),
    item('Nasi Hainam Ayam Pgg', 21_365), item('Nasi Hainam Bebek Pgg', 29_092),
    item('Nasi Putih Polos', 3_637), item('Teh Manis', 3_637),
    item('Truly-J Wortel', 10_455),
  ]
  const jumlah = sumItems(items)          // 169.555
  assertEquals(jumlah, 169_555)

  // Yang lama: dibandingkan ke grand total -> gagal.
  assertFalse(isChecksumValid(jumlah, 186_500))

  // Yang benar: subtotal dikenal, jadi itulah pembandingnya.
  assert(isChecksumValid(jumlah, 186_500, { subtotal: 169_555 }))

  // Atau lewat identitas akuntansi lengkap, tanpa subtotal.
  assert(isChecksumValid(jumlah, 186_500, { tax: 16_956, rounding: -11 }))
})

Deno.test('struk warung tanpa pajak: item langsung sama dengan total', () => {
  const items = [item('Kopi', 15_000), item('Gorengan', 5_000)]
  assert(isChecksumValid(sumItems(items), 20_000))
})

Deno.test('service charge + pajak restoran (10% + 11%)', () => {
  const jumlah = 100_000
  assert(isChecksumValid(jumlah, 121_000, { service: 10_000, tax: 11_000 }))
})

Deno.test('diskon mengurangi total, bukan menaikkan', () => {
  assert(isChecksumValid(100_000, 90_000, { discount: 10_000 }))
})

Deno.test('pembulatan kecil tetap dimaafkan toleransi', () => {
  // 169.555 vs 169.550 — beda 5 rupiah, jelas pembulatan.
  assert(isChecksumValid(169_555, 169_550))
})

Deno.test('struk yang BENAR-BENAR salah baca tetap ditolak', () => {
  // Item terbaca sebagian: 50rb vs total 500rb. Ini bukan pajak, ini kegagalan
  // OCR — dan menyimpannya diam-diam berarti pembukuan yang salah 10x lipat.
  assertFalse(isChecksumValid(50_000, 500_000))
  // Bahkan bila pajak diklaim, selisihnya tidak terjelaskan.
  assertFalse(isChecksumValid(50_000, 500_000, { tax: 20_000 }))
})

Deno.test('total tidak terbaca: tidak bisa divalidasi, bukan berarti salah', () => {
  assert(isChecksumValid(120_000, 0))
})

Deno.test('ada total tapi tidak ada satu pun item: gagal', () => {
  assertFalse(isChecksumValid(0, 120_000))
})

Deno.test('subtotal yang keliru terbaca tidak boleh melemahkan validasi', () => {
  // Bila subtotal jauh dari jumlah item, jangan langsung menerima; jatuh
  // kembali ke identitas total. Subtotal salah baca tidak boleh jadi celah
  // yang meloloskan struk yang memang gagal dibaca.
  assertFalse(isChecksumValid(50_000, 500_000, { subtotal: 490_000 }))
})

// ============================================================
// PPN INKLUSIF — struk ritel Indonesia
//
// Ditambahkan 19 September 2026, dari kegagalan yang dilaporkan pengguna:
// setiap struk minimarket ditolak, dengan pesan yang mustahil dibaca —
// "Rincian item terbaca Rp 22.400, sedangkan total di struk Rp 22.400.
//  Selisihnya belum bisa dijelaskan..."
//
// Dua angka identik, disebut tidak cocok. Penyebabnya: validator memakai
// identitas `item + pajak = total`, yang hanya berlaku kalau pajaknya
// EKSKLUSIF. Di ritel Indonesia PPN sudah ada DI DALAM harga rak, jadi
// menambahkannya lagi menghitung pajak dua kali.
//
// Test di berkas ini memakai angka apa adanya dari struk yang gagal itu.
// ============================================================

Deno.test('struk minimarket PPN INKLUSIF: item sudah sama dengan total', () => {
  // Indomaret, 19 Sep 2026:
  //   INDOMI KARI AYAM 72G   4 x 2.700 = 10.800
  //   INDOMI GORENG SPC 80   4 x 2.900 = 11.600
  //   HARGA JUAL / TOTAL               = 22.400
  //   PPN: DPP = 20.180, PPn = 2.220   (20.180 + 2.220 = 22.400)
  const items = [item('INDOMI KARI AYAM 72G', 10_800), item('INDOMI GORENG SPC 80', 11_600)]
  const jumlah = sumItems(items)
  assertEquals(jumlah, 22_400)

  // PPn terbaca 2.220 — tapi ia INFORMATIF, bukan tambahan. Sebelum perbaikan,
  // jalur "item + pajak" menghitung 24.620 dan menolak struk ini.
  assert(
    isChecksumValid(jumlah, 22_400, { tax: 2_220 }),
    'struk PPN inklusif ditolak — pajak dihitung dua kali',
  )
})

Deno.test('PPN inklusif tetap lolos walau DPP ikut terbaca sebagai subtotal', () => {
  // Sebagian struk menuliskan DPP di baris terpisah dan model membacanya
  // sebagai subtotal. DPP (20.180) BUKAN jumlah item (22.400), jadi jalur
  // subtotal tidak cocok — yang menyelamatkan adalah jalur PPN inklusif.
  assert(isChecksumValid(22_400, 22_400, { subtotal: 20_180, tax: 2_220 }))
})

Deno.test('struk tanpa pajak sama sekali tetap lolos', () => {
  assert(isChecksumValid(50_000, 50_000, {}))
})

Deno.test('jalur PPN inklusif TIDAK melonggarkan penolakan struk yang memang salah', () => {
  // Ini yang membuat jalur baru aman: ia hanya menerima kalau jumlah item
  // memang SUDAH sama dengan total. Struk yang benar-benar meleset tetap
  // ditolak, tidak peduli pajaknya inklusif atau tidak.
  assertFalse(isChecksumValid(50_000, 500_000, { tax: 20_000 }))
  assertFalse(isChecksumValid(10_000, 22_400, { tax: 2_220 }))
  // Setengah item terpotong di foto: 11.600 dari 22.400 — harus MERAH.
  assertFalse(isChecksumValid(11_600, 22_400, { tax: 2_220 }))
})

Deno.test('totalSetelahRincian melaporkan angka yang BENAR-BENAR dibandingkan', () => {
  // Pesan error lama mencetak itemsSum dan statedTotal, padahal yang diadu
  // adalah nilai turunan ini. Pada struk PPN inklusif keduanya sama persis,
  // sehingga pesannya menyuruh pengguna mencari selisih antara dua angka
  // yang identik.
  assertEquals(totalSetelahRincian(22_400, { tax: 2_220 }), 24_620)
  assertEquals(totalSetelahRincian(100_000, { service: 10_000, tax: 11_000 }), 121_000)
  assertEquals(totalSetelahRincian(50_000, { discount: 5_000 }), 45_000)
  assertEquals(totalSetelahRincian(50_000, {}), 50_000)
})

// ============================================================
// KEWAJARAN TANGGAL STRUK
//
// Dari kegagalan 19 September 2026. Struk Indomaret memuat baris referensi:
//
//     01.04.22-07/58/2.2.7/9902
//
// Model membacanya sebagai tanggal 1 April 2022. Bentuknya sah
// (^\d{4}-\d{2}-\d{2}$), jadi lolos validasi — dan EMPAT transaksi tersimpan
// dengan tanggal empat tahun lalu.
//
// Akibatnya bukan sekadar satu kolom salah: daftar Transaksi diurutkan menurut
// tanggal transaksi, jadi baris yang baru disimpan mendarat di DASAR daftar.
// Pengguna melihat bagian atas, tidak menemukan apa-apa, menyimpulkan
// simpanannya gagal, lalu mengulang. Empat kali. Dan belanja hari ini masuk ke
// laporan April 2022.
// ============================================================

const HARI_INI = new Date('2026-09-19T10:00:00Z')

Deno.test('tanggal dari nomor referensi struk DITOLAK', () => {
  // Kasus nyata yang memicu seluruh perbaikan ini.
  assertFalse(tanggalStrukMasukAkal('2022-04-01', HARI_INI))
})

Deno.test('tanggal hari ini dan beberapa hari lalu diterima', () => {
  assert(tanggalStrukMasukAkal('2026-09-19', HARI_INI))
  assert(tanggalStrukMasukAkal('2026-09-18', HARI_INI))
  assert(tanggalStrukMasukAkal('2026-09-01', HARI_INI))
})

Deno.test('pembukuan menyusul tetap diterima sampai ~13 bulan', () => {
  // UMKM sering baru memotret struk berminggu-minggu kemudian. Menolaknya
  // akan memaksa mereka mengubah tanggal manual setiap kali — dan orang yang
  // harus melawan validasi setiap hari akan berhenti mempercayainya.
  assert(tanggalStrukMasukAkal('2026-06-19', HARI_INI))
  assert(tanggalStrukMasukAkal('2025-09-01', HARI_INI))
})

Deno.test('lebih tua dari toleransi ditolak', () => {
  assertFalse(tanggalStrukMasukAkal('2025-06-01', HARI_INI))
  assertFalse(tanggalStrukMasukAkal('2019-01-01', HARI_INI))
})

Deno.test('tanggal masa depan ditolak, kecuali selisih zona waktu', () => {
  // Kasir dengan jam yang meleset sehari masih wajar; seminggu ke depan tidak.
  assert(tanggalStrukMasukAkal('2026-09-20', HARI_INI))
  assertFalse(tanggalStrukMasukAkal('2026-09-26', HARI_INI))
  assertFalse(tanggalStrukMasukAkal('2027-01-01', HARI_INI))
})

Deno.test('bentuk yang bukan tanggal ditolak tanpa melempar', () => {
  assertFalse(tanggalStrukMasukAkal('', HARI_INI))
  assertFalse(tanggalStrukMasukAkal('01.04.22', HARI_INI))
  assertFalse(tanggalStrukMasukAkal('2026-13-45', HARI_INI))
})

Deno.test('parseAndValidateReceipt membuang tanggal tak masuk akal TAPI melaporkannya', () => {
  // Menghilangkannya diam-diam akan membuat pengguna mengira tanggalnya tidak
  // terbaca, padahal yang terjadi salah baca yang perlu dia ketahui.
  const r = parseAndValidateReceipt(JSON.stringify({
    merchant: 'Indomaret',
    date: '2022-04-01',
    total: 22400,
    items: [
      { name: 'INDOMI KARI AYAM 72G', qty: 4, unit: 'pcs', unit_price: 2700, total: 10800 },
      { name: 'INDOMI GORENG SPC 80', qty: 4, unit: 'pcs', unit_price: 2900, total: 11600 },
    ],
    tax: 2220,
  }))
  assertEquals(r.date, null)
  assertEquals(r.dateDiabaikan, '2022-04-01')
  // Sekaligus membuktikan struk PPN inklusif ini lolos checksum.
  assertEquals(r.total, 22400)
  assertEquals(r.items.length, 2)
})
