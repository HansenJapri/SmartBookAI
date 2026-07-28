// ============================================================
// Builder ringkasan teragregasi untuk asisten AI (mode Tanya).
// Cerminan logika di edge function `BukuPencatatan`: HANYA mengirim total /
// rata-rata / jumlah ke LLM, TIDAK PERNAH nama pelanggan, deskripsi mentah,
// nomor rekening, atau field sensitif lain (sesuai UU PDP & Kebijakan Privasi).
//
// Diekstrak agar kontrak privasi ini bisa diuji unit di sisi klien maupun
// referensi ulang di sisi server (edge tidak di-redeploy).
// ============================================================

const rupiah = (n) => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID')

// Daftar field yang DILARANG masuk ringkasan (whitelist di bawah adalah lawan
// dari daftar ini — dokumentasi keras untuk auditor).
export const SENSITIVE_FIELDS = [
  'customer_name', 'customer', 'phone', 'no_rekening', 'account_number',
  'description', 'note', 'address', 'email',
]

// Hanya field ini yang dipakai untuk agregasi.
const WHITELIST = ['direction', 'amount', 'category', 'payment_status', 'occurred_at']

function pickWhitelisted(tx) {
  const out = {}
  for (const k of WHITELIST) out[k] = tx[k]
  return out
}

export function buildAggregateSummary({ transactions = [], products = [], device = 'desktop', now = new Date() } = {}) {
  const txs = transactions.map(pickWhitelisted) // buang field sensitif SEJAK AWAL
  let income = 0, expense = 0
  const catExpense = {}
  let unpaidCount = 0, unpaidTotal = 0
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const weekAgo = new Date(now.getTime() - 7 * 86400000)
  const twoWeeksAgo = new Date(now.getTime() - 14 * 86400000)
  let monthIncome = 0, monthExpense = 0, wk1Income = 0, wk2Income = 0

  for (const t of txs) {
    const amt = Number(t.amount) || 0
    const dt = new Date(t.occurred_at)
    const inMonth = dt >= monthStart
    if (t.direction === 'in') {
      income += amt; if (inMonth) monthIncome += amt
      if (dt >= weekAgo) wk1Income += amt
      else if (dt >= twoWeeksAgo) wk2Income += amt
      if (t.payment_status === 'belum') { unpaidCount++; unpaidTotal += amt }
    } else {
      expense += amt; if (inMonth) monthExpense += amt
      catExpense[t.category] = (catExpense[t.category] || 0) + amt
    }
  }

  const topCats = Object.entries(catExpense).sort((a, b) => b[1] - a[1]).slice(0, 5)
  const wow = wk2Income > 0 ? Math.round(((wk1Income - wk2Income) / wk2Income) * 100) : null

  const lowStock = (products || []).filter(
    (p) => Number(p.min_stock) > 0 && Number(p.stock) <= Number(p.min_stock),
  )
  const lowStockNames = lowStock.slice(0, 8).map((p) => p.name).filter(Boolean)

  return [
    `Total pemasukan (semua waktu): ${rupiah(income)}`,
    `Total pengeluaran (semua waktu): ${rupiah(expense)}`,
    `Laba bersih (semua waktu): ${rupiah(income - expense)}`,
    `Pemasukan bulan ini: ${rupiah(monthIncome)}; Pengeluaran bulan ini: ${rupiah(monthExpense)}`,
    `Pemasukan 7 hari terakhir: ${rupiah(wk1Income)}; 7 hari sebelumnya: ${rupiah(wk2Income)}${wow === null ? '' : `; perubahan minggu-ke-minggu: ${wow}%`}`,
    `Jumlah transaksi tercatat: ${txs.length}`,
    `Penjualan belum lunas: ${unpaidCount} (total ${rupiah(unpaidTotal)})`,
    topCats.length
      ? `Pengeluaran terbesar per kategori: ${topCats.map(([k, v]) => `${k} ${rupiah(v)}`).join('; ')}`
      : 'Belum ada data pengeluaran per kategori.',
    `Jumlah produk: ${(products || []).length}; Produk stok menipis: ${lowStock.length}${lowStockNames.length ? ' (' + lowStockNames.join(', ') + ')' : ''}`,
    `Perangkat: ${device === 'mobile' ? 'mobile' : 'desktop'}`,
  ].join('\n')
}
