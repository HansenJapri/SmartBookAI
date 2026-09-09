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
import { isChecksumValid, sumItems, type ReceiptItem } from './ocr-parser.ts'

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
