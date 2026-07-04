// Mesin auto-kategori rule-based (jalan tanpa API).
// Aturan dari user (DB) diprioritaskan, lalu aturan bawaan di bawah ini.

export const CATEGORIES = {
  in: ['Penjualan', 'Penjualan QRIS', 'Penjualan Marketplace', 'Modal/Investasi', 'Pendapatan Lain'],
  out: [
    'Pembelian Stok', 'Biaya Admin & Transaksi', 'Operasional Listrik', 'Operasional Pulsa/Internet',
    'Sewa Tempat', 'Gaji Karyawan', 'Transportasi & Ongkir', 'Iklan & Promosi', 'Pajak', 'Pengeluaran Lain',
  ],
}

// Aturan bawaan: { match: [kata kunci...], category, direction (opsional) }
const DEFAULT_RULES = [
  { match: ['token pln', 'pln', 'listrik'], category: 'Operasional Listrik', direction: 'out' },
  { match: ['pulsa', 'telkomsel', 'indosat', 'xl ', 'paket data', 'wifi', 'indihome'], category: 'Operasional Pulsa/Internet', direction: 'out' },
  { match: ['sewa', 'kontrak ruko', 'kontrakan'], category: 'Sewa Tempat', direction: 'out' },
  { match: ['gaji', 'upah', 'bonus karyawan', 'thr'], category: 'Gaji Karyawan', direction: 'out' },
  { match: ['bensin', 'pertamina', 'spbu', 'parkir', 'ojek', 'grab', 'gojek', 'ongkir', 'jne', 'j&t', 'sicepat', 'anteraja'], category: 'Transportasi & Ongkir', direction: 'out' },
  { match: ['iklan', 'ads', 'promo', 'boost', 'topup saldo iklan'], category: 'Iklan & Promosi', direction: 'out' },
  { match: ['pajak', 'pph', 'ppn', 'djp', 'coretax'], category: 'Pajak', direction: 'out' },
  { match: ['biaya admin', 'admin fee', 'biaya layanan', 'fee mdr', 'potongan'], category: 'Biaya Admin & Transaksi', direction: 'out' },
  { match: ['belanja', 'stok', 'grosir', 'pasar', 'supplier', 'kulakan', 'restock', 'indogrosir'], category: 'Pembelian Stok', direction: 'out' },

  { match: ['shopee', 'tokopedia', 'tiktok shop', 'lazada', 'blibli'], category: 'Penjualan Marketplace', direction: 'in' },
  { match: ['qris', 'qr '], category: 'Penjualan QRIS', direction: 'in' },
  { match: ['gopay', 'ovo', 'dana', 'shopeepay', 'linkaja'], category: 'Penjualan', direction: 'in' },
  { match: ['trf masuk', 'transfer masuk', 'setoran', 'pembayaran dari', 'terima dari', 'pelunasan'], category: 'Penjualan', direction: 'in' },
  { match: ['modal', 'investasi', 'suntikan'], category: 'Modal/Investasi', direction: 'in' },
]

const norm = (s) => (s || '').toString().toLowerCase()

/**
 * @param {string} description
 * @param {'in'|'out'} direction
 * @param {Array<{keyword:string,category:string,direction?:string}>} userRules
 * @returns {string} category
 */
export function categorize(description, direction, userRules = []) {
  const text = norm(description)

  // 1) Aturan user (prioritas)
  for (const r of userRules) {
    if (!r.keyword) continue
    if (r.direction && r.direction !== direction) continue
    if (text.includes(norm(r.keyword))) return r.category
  }

  // 2) Aturan bawaan
  for (const r of DEFAULT_RULES) {
    if (r.direction && r.direction !== direction) continue
    if (r.match.some((m) => text.includes(m))) return r.category
  }

  // 3) Default
  return direction === 'in' ? 'Pendapatan Lain' : 'Pengeluaran Lain'
}

// Tebak arah (in/out) dari teks bila tidak diketahui
export function guessDirection(description) {
  const t = norm(description)
  const inHints = ['masuk', 'terima', 'diterima', 'kredit', 'cr ', 'penjualan', 'pembayaran dari', 'setoran']
  const outHints = ['keluar', 'bayar', 'pembelian', 'debit', 'db ', 'beli', 'belanja', 'tarik']
  if (inHints.some((h) => t.includes(h))) return 'in'
  if (outHints.some((h) => t.includes(h))) return 'out'
  return 'out'
}
