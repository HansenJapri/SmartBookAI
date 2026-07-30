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
 * Bandingkan jumlah item terhadap total struk.
 * Mengembalikan true bila cocok dalam toleransi, atau bila total tidak terbaca
 * (statedTotal <= 0) — kasus itu tidak bisa divalidasi, bukan berarti salah.
 */
export function isChecksumValid(
  itemsSum: number,
  statedTotal: number,
  tolerance = CHECKSUM_TOLERANCE,
): boolean {
  if (!Number.isFinite(itemsSum) || !Number.isFinite(statedTotal)) return false
  if (statedTotal <= 0) return true          // total tidak terbaca — lewati validasi
  if (itemsSum <= 0) return false            // ada total tapi tidak ada item -> gagal
  return Math.abs(itemsSum - statedTotal) / statedTotal <= tolerance
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

  if (!isChecksumValid(itemsSum, statedTotal)) {
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
  }
}
