// ============================================================
// Mesin HPP (Harga Pokok Produksi) — DETERMINISTIK (tanpa AI).
// Simulasi efek kenaikan bahan (sinyal makro / manual / kurs) dihitung kode;
// AI hanya dipakai untuk DRAF komposisi awal (Edge Function ai-hpp-draft).
// ============================================================

// Keranjang komoditas — WAJIB sinkron dengan Edge Functions makro-harian
// & ai-hpp-draft (kunci yang sama).
export const COMMODITIES = [
  { key: 'beras', label: 'Beras' },
  { key: 'terigu', label: 'Terigu/Gandum' },
  { key: 'gula', label: 'Gula' },
  { key: 'telur', label: 'Telur Ayam' },
  { key: 'ayam', label: 'Daging Ayam' },
  { key: 'daging_sapi', label: 'Daging Sapi' },
  { key: 'cabai', label: 'Cabai' },
  { key: 'bawang_merah', label: 'Bawang Merah' },
  { key: 'bawang_putih', label: 'Bawang Putih' },
  { key: 'minyak_goreng', label: 'Minyak Goreng/CPO' },
  { key: 'kedelai', label: 'Kedelai' },
  { key: 'susu', label: 'Susu' },
  { key: 'kakao', label: 'Kakao/Cokelat' },
  { key: 'kopi', label: 'Kopi' },
  { key: 'lpg', label: 'LPG/Gas' },
  { key: 'bbm', label: 'BBM' },
  { key: 'tekstil', label: 'Tekstil/Kain' },
  { key: 'kertas', label: 'Kertas' },
  { key: 'deterjen', label: 'Deterjen/Kimia RT' },
  { key: 'plastik', label: 'Plastik/Kemasan' },
]

export const COMMODITY_LABEL = Object.fromEntries(COMMODITIES.map((c) => [c.key, c.label]))

// Faktor rambatan (pass-through) pelemahan kurs -> biaya bahan, per tingkat
// keterpaparan impor. Konservatif; rambatan penuh jarang terjadi & ada jeda 1-2 bulan.
export const EXPOSURE_FACTOR = { tinggi: 0.7, sedang: 0.4, rendah: 0.1 }

// HPP dasar = jumlah (qty x harga satuan) semua komponen.
export function computeHpp(rows) {
  return rows.reduce((s, r) => s + (Number(r.qty) || 0) * (Number(r.price_per_unit) || 0), 0)
}

// Margin (%) terhadap harga jual. price 0 -> 0.
export function marginPct(price, hpp) {
  const p = Number(price) || 0
  if (p <= 0) return 0
  return ((p - hpp) / p) * 100
}

// Harga jual yang dibutuhkan untuk margin tertentu (% dari harga jual).
export function priceForMargin(hpp, targetMarginPct) {
  const m = Math.min(95, Math.max(0, Number(targetMarginPct) || 0)) / 100
  return m >= 1 ? hpp : hpp / (1 - m)
}

// Terapkan skenario kenaikan per baris.
// adjustments: { [ingredientKeyOrId]: pct } — pct dalam persen (mis. 12 = +12%).
// Kembalikan HPP baru.
export function applyAdjustments(rows, getPctForRow) {
  return rows.reduce((s, r) => {
    const pct = Number(getPctForRow(r)) || 0
    const price = (Number(r.price_per_unit) || 0) * (1 + pct / 100)
    return s + (Number(r.qty) || 0) * price
  }, 0)
}

// Skenario otomatis dari sinyal makro: tiap baris yang punya commodity_key
// ter-mapping memakai rentang estimasi sinyal [min, max]; sisanya 0.
// signalsByKey: { [commodity_key]: { est_pct_min, est_pct_max } }
export function applyMacroScenario(rows, signalsByKey) {
  const base = computeHpp(rows)
  const min = applyAdjustments(rows, (r) => signalsByKey[r.commodity_key]?.est_pct_min ?? 0)
  const max = applyAdjustments(rows, (r) => signalsByKey[r.commodity_key]?.est_pct_max ?? 0)
  return { base, min: Math.min(min, max), max: Math.max(min, max) }
}

// Skenario pelemahan kurs: rupiah melemah kursPct% -> bahan naik sesuai
// faktor keterpaparan impor per baris.
export function applyKursScenario(rows, kursPct) {
  const base = computeHpp(rows)
  const next = applyAdjustments(rows, (r) => (Number(kursPct) || 0) * (EXPOSURE_FACTOR[r.import_exposure] ?? 0.1))
  return { base, next }
}
