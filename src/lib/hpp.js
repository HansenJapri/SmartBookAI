// ============================================================
// Mesin HPP (Harga Pokok Produksi) — DETERMINISTIK (tanpa AI).
// Simulasi efek kenaikan bahan (sinyal makro / manual / kurs) dihitung kode;
// AI hanya dipakai untuk DRAF komposisi awal (Edge Function ai-hpp-draft).
// ============================================================

// Keranjang komoditas — WAJIB sinkron dengan Edge Functions makro-harian
// & ai-hpp-draft (kunci yang sama).
export const COMMODITIES = [
  { key: 'beras', label: 'Beras' },
  { key: 'jagung', label: 'Jagung' },
  { key: 'kedelai', label: 'Kedelai' },
  { key: 'gula', label: 'Gula Pasir' },
  { key: 'minyak_goreng', label: 'Minyak Goreng/CPO' },
  { key: 'terigu', label: 'Tepung Terigu/Gandum' },
  { key: 'cabai_merah', label: 'Cabai Merah' },
  { key: 'cabai_rawit', label: 'Cabai Rawit' },
  { key: 'bawang_merah', label: 'Bawang Merah' },
  { key: 'bawang_putih', label: 'Bawang Putih' },
  { key: 'daging_sapi', label: 'Daging Sapi' },
  { key: 'ayam', label: 'Daging Ayam' },
  { key: 'telur', label: 'Telur Ayam' },
  { key: 'ikan', label: 'Ikan Segar' },
  { key: 'garam', label: 'Garam' },
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

// ---------- Konversi kemasan & biaya per periode ----------
//
// Harga per satuan dari harga belanja per KEMASAN.
//
// Ini menutup akar bug "1200 terbaca 12000": pemilik warung tahu harganya
// sebagai "satu bungkus Rp 12.000, isinya 800 gram", bukan "Rp 15 per gram".
// Dulu satu-satunya kolom yang ada adalah harga per satuan, jadi angka kemasan
// diketik di sana dan langsung dikalikan takaran resep. Sekarang harga satuan
// DIHITUNG dari kemasan; kolom manual hanya dipakai bila kemasannya tidak diisi.
export function hargaPerSatuan(row) {
  const isi = Number(row?.pack_size) || 0
  const hargaKemasan = Number(row?.pack_price) || 0
  if (isi > 0 && hargaKemasan > 0) return hargaKemasan / isi
  return Number(row?.price_per_unit) || 0
}

// Biaya satu baris komposisi untuk MEMBUAT SATU unit produk.
//
// Dua dasar perhitungan, karena UMKM memang punya dua jenis biaya:
//   per_unit    -> takaran x harga satuan (bahan, kemasan)
//   per_periode -> biaya bulanan dibagi perkiraan hasil produksi periode itu
//                  (sewa tempat, listrik, gaji) — dibiarkan 0 bila jumlah
//                  produksinya belum diisi, karena membagi dengan 0 hanya akan
//                  menghasilkan HPP tak hingga yang membingungkan.
export function biayaBarisPerUnit(row) {
  if (row?.cost_basis === 'per_periode') {
    const hasil = Number(row.period_output) || 0
    return hasil > 0 ? (Number(row.period_amount) || 0) / hasil : 0
  }
  return (Number(row?.qty_per_unit ?? row?.qty) || 0) * hargaPerSatuan(row)
}

// HPP dari baris editor komposisi (sudah memperhitungkan kemasan & periode).
export function hppKomposisi(rows) {
  return (rows || []).reduce((s, r) => s + biayaBarisPerUnit(r), 0)
}

// Berapa unit produk yang bisa dibuat dari sisa stok satu bahan.
// stock/pack_size/opened_used mengikuti kolom products; qtyPerUnit = takaran resep.
export function yieldDariStok({ stock, pack_size, opened_used }, qtyPerUnit) {
  const takaran = Number(qtyPerUnit) || 0
  if (takaran <= 0) return null
  const isi = Number(pack_size) || 0
  const tersedia = isi > 0
    ? Math.max(0, (Number(stock) || 0) * isi - (Number(opened_used) || 0))
    : Math.max(0, Number(stock) || 0)
  return Math.floor(tersedia / takaran)
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
  // Memakai biayaBarisPerUnit agar skenario ikut menghormati harga kemasan dan
  // biaya per periode; baris lama berbentuk { qty, price_per_unit } tetap
  // menghasilkan angka yang sama karena keduanya punya jalur cadangan di sana.
  return rows.reduce((s, r) => {
    const pct = Number(getPctForRow(r)) || 0
    return s + biayaBarisPerUnit(r) * (1 + pct / 100)
  }, 0)
}

// Skenario otomatis dari sinyal makro: tiap baris yang punya commodity_key
// ter-mapping memakai rentang estimasi sinyal [min, max]; sisanya 0.
// signalsByKey: { [commodity_key]: { est_pct_min, est_pct_max } }
export function applyMacroScenario(rows, signalsByKey) {
  const base = hppKomposisi(rows)
  const min = applyAdjustments(rows, (r) => signalsByKey[r.commodity_key]?.est_pct_min ?? 0)
  const max = applyAdjustments(rows, (r) => signalsByKey[r.commodity_key]?.est_pct_max ?? 0)
  return { base, min: Math.min(min, max), max: Math.max(min, max) }
}

// Skenario pelemahan kurs: rupiah melemah kursPct% -> bahan naik sesuai
// faktor keterpaparan impor per baris.
export function applyKursScenario(rows, kursPct) {
  const base = hppKomposisi(rows)
  const next = applyAdjustments(rows, (r) => (Number(kursPct) || 0) * (EXPOSURE_FACTOR[r.import_exposure] ?? 0.1))
  return { base, next }
}
