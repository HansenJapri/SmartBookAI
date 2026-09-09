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
  ) {
    super(
      `Checksum struk tidak cocok: jumlah item ${itemsSum} vs total tertera ${statedTotal} `
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
 * Dua jalur penerimaan, dicoba berurutan:
 *   1. Bila SUBTOTAL terbaca -> jumlah item dibandingkan ke subtotal. Inilah
 *      pembanding yang benar secara akuntansi.
 *   2. Selain itu -> identitas lengkap:
 *      item + pajak + layanan - diskon + pembulatan ~= total dibayar.
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

  // Jalur 1 — subtotal terbaca.
  const subtotal = n(b.subtotal)
  if (subtotal > 0 && dekat(itemsSum, subtotal)) return true

  // Jalur 2 — identitas lengkap.
  const dihitung = itemsSum + n(b.tax) + n(b.service) - n(b.discount) + n(b.rounding)
  return dekat(dihitung, statedTotal)
}

export function sumItems(items: ReceiptItem[]): number {
  return (items || []).reduce((s, it) => s + (Number(it.total) || 0), 0)
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
    throw new ChecksumMismatchError(itemsSum, statedTotal, CHECKSUM_TOLERANCE)
  }

  const legibilityRaw = String(parsed.legibility ?? 'cetak_jelas')
  const legibility: ReceiptData['legibility'] =
    legibilityRaw === 'buram' || legibilityRaw === 'tulisan_tangan'
      ? legibilityRaw
      : 'cetak_jelas'

  const dateRaw = String(parsed.date ?? '')
  return {
    merchant: String(parsed.merchant ?? '').slice(0, 160),
    date: /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : null,
    total: statedTotal,
    legibility,
    items,
    ...breakdown,
  }
}
