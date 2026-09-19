// ============================================================
// OCR struk/PDF — parser + validasi checksum.
//
// Aturan spesifikasi: total hasil ekstraksi item HARUS cocok dengan total yang
// terbaca di struk. Bila tidak cocok, panggilan diulang SEKALI dengan model
// fallback (lihat gemini-client.generateWithFallback).
// ============================================================

export interface ReceiptItem {
  name: string
  qty: number
  unit: string
  unit_price: number
  total: number
}

export interface ReceiptData {
  merchant: string
  date: string | null
  /**
   * Tanggal yang TERBACA tapi ditolak karena terlalu jauh dari hari ini —
   * hampir selalu nomor referensi struk yang menyerupai tanggal.
   * Dilaporkan supaya UI bisa memberi tahu, bukan diam-diam menggantinya.
   */
  dateDiabaikan?: string | null
  total: number
  legibility: 'cetak_jelas' | 'buram' | 'tulisan_tangan'
  items: ReceiptItem[]
  /**
   * Rincian di ANTARA jumlah item dan total yang dibayar.
   *
   * Tanpa bagian ini, jumlah item tidak akan pernah sama dengan total pada
   * struk mana pun yang memungut pajak — dan itu mayoritas struk restoran,
   * kafe, dan toko modern di Indonesia.
   */
  subtotal?: number
  tax?: number
  service?: number
  discount?: number
  rounding?: number
}

/** Komponen yang menjelaskan selisih jumlah item terhadap total dibayar. */
export interface ReceiptBreakdown {
  subtotal?: number
  tax?: number
  service?: number
  discount?: number
  rounding?: number
}

export class ChecksumMismatchError extends Error {
  constructor(
    public itemsSum: number,
    public statedTotal: number,
    public tolerance: number,
    // Angka yang BENAR-BENAR dibandingkan: jumlah item setelah pajak, layanan,
    // diskon dan pembulatan diperhitungkan.
    //
    // KENAPA INI ADA. Sebelumnya error ini hanya membawa itemsSum dan
    // statedTotal, sementara perbandingan yang menggagalkannya memakai nilai
    // TURUNAN. Pada struk minimarket ber-PPN inklusif, keduanya kebetulan sama
    // persis — sehingga pengguna dihadapkan pada kalimat mustahil:
    // "Rincian item terbaca Rp 22.400, sedangkan total di struk Rp 22.400.
    //  Selisihnya belum bisa dijelaskan..."
    // Pesan yang menyuruh orang mencari selisih antara dua angka yang identik
    // lebih buruk daripada tidak ada pesan: ia membuat pengguna meragukan
    // matanya sendiri, lalu memotret ulang struk yang sudah sempurna.
    public computedTotal: number = itemsSum,
  ) {
    super(
      `Checksum struk tidak cocok: jumlah item ${itemsSum} (setelah pajak/layanan/diskon: `
      + `${computedTotal}) vs total tertera ${statedTotal} `
      + `(toleransi ${Math.round(tolerance * 100)}%).`,
    )
    this.name = 'ChecksumMismatchError'
  }
}

/** Toleransi selisih wajar (pembulatan, pajak kecil, diskon baris). */
export const CHECKSUM_TOLERANCE = 0.02 // 2%

/**
 * Bandingkan jumlah item terhadap total struk, DENGAN memperhitungkan pajak,
 * service charge, diskon, dan pembulatan.
 *
 * Versi sebelumnya membandingkan jumlah item langsung ke total yang dibayar.
 * Itu benar hanya untuk struk warung tanpa pajak. Pada struk restoran mana pun:
 *
 *     Sub Total   : 169.555   <- item berjumlah ke sini
 *     PPN         :  16.956
 *     Rounding    :     -11
 *     Grand Total : 186.500   <- yang dibandingkan validator lama
 *
 * Selisihnya 10% sementara toleransinya 2%, jadi struk ber-PPN DIJAMIN
 * ditolak — dan pesan errornya menyalahkan kualitas foto pengguna untuk
 * kegagalan yang sepenuhnya ada di sisi kita.
 *
 * TIGA jalur penerimaan, dicoba berurutan:
 *   0. PPN INKLUSIF -> jumlah item sudah sama dengan total dibayar. Default
 *      ritel Indonesia (minimarket, warung, toko): pajak ada DI DALAM harga
 *      rak, dan baris "PPN" di struk sifatnya informatif.
 *   1. Bila SUBTOTAL terbaca -> jumlah item dibandingkan ke subtotal. Inilah
 *      pembanding yang benar secara akuntansi.
 *   2. Selain itu -> identitas lengkap untuk pajak EKSKLUSIF:
 *      item + pajak + layanan - diskon + pembulatan ~= total dibayar.
 *
 * Urutannya penting. Jalur 2 menambahkan pajak ke jumlah item, jadi kalau ia
 * dijalankan lebih dulu pada struk PPN inklusif, pajaknya terhitung DUA KALI
 * dan struk yang sempurna ditolak.
 *
 * Subtotal yang keliru terbaca TIDAK boleh jadi celah: bila jalur 1 gagal,
 * jalur 2 tetap diuji, dan struk yang benar-benar salah baca tetap ditolak
 * oleh keduanya.
 */
export function isChecksumValid(
  itemsSum: number,
  statedTotal: number,
  breakdown: ReceiptBreakdown | number = {},
  toleranceArg = CHECKSUM_TOLERANCE,
): boolean {
  // Tanda tangan lama isChecksumValid(sum, total, tolerance) tetap didukung
  // supaya pemanggil yang belum diperbarui tidak diam-diam berubah artinya.
  const tolerance = typeof breakdown === 'number' ? breakdown : toleranceArg
  const b: ReceiptBreakdown = typeof breakdown === 'number' ? {} : (breakdown || {})

  if (!Number.isFinite(itemsSum) || !Number.isFinite(statedTotal)) return false
  if (statedTotal <= 0) return true          // total tidak terbaca — lewati validasi
  if (itemsSum <= 0) return false            // ada total tapi tidak ada item -> gagal

  const dekat = (a: number, b2: number) => {
    const acuan = Math.max(Math.abs(b2), 1)
    // Toleransi absolut kecil menutup pembulatan rupiah pada nominal kecil,
    // yang secara persentase bisa terlihat besar.
    return Math.abs(a - b2) <= Math.max(acuan * tolerance, 100)
  }

  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)

  // Jalur 0 — PPN SUDAH TERMASUK di harga item. Ini default ritel Indonesia,
  // dan sebelumnya tidak pernah diperiksa sama sekali.
  //
  // Struk Indomaret 19 Sep 2026 yang menggagalkan fitur ini:
  //   INDOMI KARI AYAM  4 x 2.700 = 10.800
  //   INDOMI GORENG     4 x 2.900 = 11.600
  //   TOTAL                         22.400
  //   PPN: DPP = 20.180, PPn = 2.220     (20.180 + 2.220 = 22.400)
  //
  // Jumlah item SUDAH sama dengan total. Tapi jalur 2 di bawah menambahkan
  // PPN sekali lagi — 22.400 + 2.220 = 24.620 — lalu menyatakannya meleset
  // 2.220 dari 22.400, jauh di luar toleransi. Struk yang sempurna ditolak.
  //
  // Sebabnya: identitas `item + pajak = total` hanya berlaku bila pajaknya
  // EKSKLUSIF (ditambahkan di atas harga), seperti struk restoran yang sudah
  // ditangani jalur 1 dan 2. Di minimarket, warung, dan hampir semua ritel
  // Indonesia, PPN sudah di dalam harga rak — baris "PPN" di struk itu
  // INFORMATIF (rincian DPP/PPn untuk keperluan pajak), bukan tambahan.
  //
  // Diperiksa PALING AWAL karena ia kasus yang paling sering, dan karena
  // mencocokkannya tidak butuh satu pun angka turunan.
  if (dekat(itemsSum, statedTotal)) return true

  // Jalur 1 — subtotal terbaca.
  const subtotal = n(b.subtotal)
  if (subtotal > 0 && dekat(itemsSum, subtotal)) return true

  // Jalur 2 — identitas lengkap (pajak EKSKLUSIF, ditambahkan di atas harga).
  const dihitung = itemsSum + n(b.tax) + n(b.service) - n(b.discount) + n(b.rounding)
  return dekat(dihitung, statedTotal)
}

/**
 * Nilai yang dibandingkan jalur 2 — dipakai HANYA untuk menyusun pesan error
 * yang jujur. Tanpa ini, pengguna diberi tahu dua angka yang tidak pernah
 * benar-benar diadu satu sama lain.
 */
export function totalSetelahRincian(
  itemsSum: number,
  breakdown: ReceiptBreakdown = {},
): number {
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const b = breakdown || {}
  return itemsSum + n(b.tax) + n(b.service) - n(b.discount) + n(b.rounding)
}

export function sumItems(items: ReceiptItem[]): number {
  return (items || []).reduce((s, it) => s + (Number(it.total) || 0), 0)
}

/** Sejauh apa tanggal struk boleh menyimpang dari hari ini. */
export const HARI_TOLERANSI_DEPAN = 2     // beda zona waktu + jam kasir yang meleset
export const HARI_TOLERANSI_BELAKANG = 400 // ~13 bulan: cukup untuk pembukuan menyusul

/**
 * Apakah tanggal yang terbaca di struk MASUK AKAL sebagai tanggal belanja?
 *
 * KENAPA INI ADA — kegagalan 19 September 2026.
 * Parser hanya memeriksa BENTUK tanggal (`^\d{4}-\d{2}-\d{2}$`), tidak pernah
 * kewajarannya. Struk Indomaret memuat baris referensi toko:
 *
 *     01.04.22-07/58/2.2.7/9902
 *
 * Model membacanya sebagai tanggal 1 April 2022. Bentuknya sah, jadi lolos —
 * dan empat transaksi tersimpan dengan tanggal EMPAT TAHUN lalu.
 *
 * Akibatnya jauh lebih besar daripada satu kolom yang salah:
 *
 *   1. Halaman Transaksi mengurutkan berdasarkan tanggal transaksi, jadi baris
 *      yang baru disimpan mendarat di DASAR daftar, di bawah semua transaksi
 *      tahun berjalan. Pengguna melihat bagian atas, tidak menemukan apa-apa,
 *      menyimpulkan simpanannya gagal, lalu mengulang. Empat kali.
 *   2. Belanja hari ini masuk ke laporan April 2022. Laba bulan berjalan salah,
 *      dan tidak ada satu pun pesan yang memberi tahu.
 *
 * Nomor referensi yang menyerupai tanggal ada di hampir setiap struk ritel.
 * Menerimanya apa adanya berarti menyerahkan tanggal pembukuan kepada tebakan
 * OCR — jadi yang di luar rentang wajar DITOLAK, dan pemanggil memakai hari ini.
 */
export function tanggalStrukMasukAkal(iso: string, hariIni: Date = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false
  const t = Date.parse(iso + 'T12:00:00Z')
  if (!Number.isFinite(t)) return false
  const selisihHari = (t - hariIni.getTime()) / 86_400_000
  return selisihHari <= HARI_TOLERANSI_DEPAN && selisihHari >= -HARI_TOLERANSI_BELAKANG
}

/**
 * Ubah teks JSON mentah dari model menjadi ReceiptData tervalidasi.
 * MELEMPAR ChecksumMismatchError bila checksum gagal — pemanggil memakainya
 * sebagai sinyal untuk retry dengan model fallback.
 */
export function parseAndValidateReceipt(rawText: string): ReceiptData {
  let parsed: Record<string, unknown> = {}
  try {
    parsed = JSON.parse(rawText.match(/\{[\s\S]*\}/)?.[0] ?? '{}')
  } catch {
    throw new Error('Hasil baca struk bukan JSON yang sah.')
  }

  const rawItems = Array.isArray(parsed.items) ? parsed.items : []
  const items: ReceiptItem[] = rawItems
    .slice(0, 100)
    .map((it: Record<string, unknown>) => {
      const qty = Number(it.qty) || 1
      const unitPrice = Math.round(Number(it.unit_price) || 0)
      const total = Math.round(Number(it.total) || unitPrice * qty)
      return {
        name: String(it.name ?? '').slice(0, 120),
        qty,
        unit: String(it.unit ?? 'pcs').slice(0, 20),
        unit_price: unitPrice,
        total,
      }
    })
    .filter((it: ReceiptItem) => it.name && it.total >= 0)

  const statedTotal = Math.round(Number(parsed.total) || 0)
  const itemsSum = sumItems(items)

  // Rincian antara jumlah item dan total dibayar. Tanpa ini, struk ber-PPN
  // atau ber-service-charge tidak akan pernah lolos validasi.
  const angka = (v: unknown) => {
    const n = Math.round(Number(v) || 0)
    return Number.isFinite(n) ? n : 0
  }
  const breakdown = {
    subtotal: angka(parsed.subtotal),
    tax: angka(parsed.tax),
    service: angka(parsed.service),
    discount: angka(parsed.discount),
    rounding: angka(parsed.rounding),
  }

  if (!isChecksumValid(itemsSum, statedTotal, breakdown)) {
    throw new ChecksumMismatchError(
      itemsSum, statedTotal, CHECKSUM_TOLERANCE,
      totalSetelahRincian(itemsSum, breakdown),
    )
  }

  const legibilityRaw = String(parsed.legibility ?? 'cetak_jelas')
  const legibility: ReceiptData['legibility'] =
    legibilityRaw === 'buram' || legibilityRaw === 'tulisan_tangan'
      ? legibilityRaw
      : 'cetak_jelas'

  // Tanggal yang bentuknya sah TAPI tidak masuk akal dibuang, dan nilai yang
  // dibuang itu tetap dilaporkan lewat `dateDiabaikan`. Menghilangkannya
  // diam-diam akan membuat pengguna mengira tanggalnya memang tidak terbaca,
  // padahal yang terjadi adalah salah baca yang perlu dia ketahui — struknya
  // mungkin memang lama, dan hanya dia yang tahu.
  const dateRaw = String(parsed.date ?? '')
  const bentukSah = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw)
  const masukAkal = bentukSah && tanggalStrukMasukAkal(dateRaw)
  return {
    merchant: String(parsed.merchant ?? '').slice(0, 160),
    date: masukAkal ? dateRaw : null,
    dateDiabaikan: bentukSah && !masukAkal ? dateRaw : null,
    total: statedTotal,
    legibility,
    items,
    ...breakdown,
  }
}
