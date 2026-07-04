// ---------- "REVEAL KEBOCORAN" ----------
// Menghitung ke mana uang dari penjualan pergi: biaya admin/komisi, ongkir yang
// ditanggung penjual, dan iklan — lintas channel/marketplace. Dibaca dari transaksi
// yang sudah berkategori (hasil impor marketplace memisahkan biaya-biaya ini).
import { rupiah, monthKey } from './format'

// Kategori biaya yang dianggap "kebocoran channel" (biaya jualan, bukan operasional inti).
export const FEE_CATEGORIES = ['Biaya Admin & Transaksi', 'Transportasi & Ongkir', 'Iklan & Promosi']
// Pemasukan yang BUKAN penjualan (dikecualikan dari omzet kotor).
const NON_SALES_IN = ['Modal/Investasi']

// Label channel untuk tampilan (mendukung platform marketplace spesifik).
export const CHANNEL_LABELS = {
  shopee: 'Shopee', tokopedia: 'Tokopedia', tiktok: 'TikTok Shop', lazada: 'Lazada', blibli: 'Blibli',
  marketplace: 'Marketplace lain', qris: 'QRIS', bank: 'Transfer Bank', manual: 'Manual/Cash',
  wa: 'WhatsApp', email: 'Email', struk: 'Struk/Cash',
}
export const channelName = (v) => CHANNEL_LABELS[v] || v

const num = (v) => Number(v) || 0
const sum = (arr) => arr.reduce((s, t) => s + num(t.amount), 0)
const inPeriod = (t, period) => period === 'all' || monthKey(t.occurred_at) === period

/**
 * Hitung kebocoran & margin asli dari daftar transaksi.
 * @param {Array} transactions transaksi user
 * @param {string} period 'all' atau 'YYYY-MM'
 */
export function revealLeak(transactions, period = 'all') {
  const tx = (transactions || []).filter((t) => !t.dismissed_dup && inPeriod(t, period))
  const isSaleIn = (t) => t.direction === 'in' && !NON_SALES_IN.includes(t.category)
  const isFee = (t) => t.direction === 'out' && FEE_CATEGORIES.includes(t.category)

  const grossOmzet = sum(tx.filter(isSaleIn))
  const feeAdmin = sum(tx.filter((t) => t.direction === 'out' && t.category === 'Biaya Admin & Transaksi'))
  const feeOngkir = sum(tx.filter((t) => t.direction === 'out' && t.category === 'Transportasi & Ongkir'))
  const feeIklan = sum(tx.filter((t) => t.direction === 'out' && t.category === 'Iklan & Promosi'))
  const leak = feeAdmin + feeOngkir + feeIklan
  const netReceived = grossOmzet - leak
  const opex = sum(tx.filter((t) => t.direction === 'out' && !FEE_CATEGORIES.includes(t.category)))
  const labaAsli = netReceived - opex
  const labaDikira = grossOmzet - opex
  const marginAsli = grossOmzet ? labaAsli / grossOmzet : 0
  const marginDikira = grossOmzet ? labaDikira / grossOmzet : 0

  // Rincian per channel: omzet kotor vs potongan.
  const map = {}
  for (const t of tx) {
    const ch = t.channel || 'manual'
    if (!map[ch]) map[ch] = { channel: ch, gross: 0, fee: 0 }
    if (isSaleIn(t)) map[ch].gross += num(t.amount)
    else if (isFee(t)) map[ch].fee += num(t.amount)
  }
  const perChannel = Object.values(map)
    .map((c) => ({ ...c, net: c.gross - c.fee, pct: c.gross ? c.fee / c.gross : 0, name: channelName(c.channel) }))
    .filter((c) => c.gross > 0 || c.fee > 0)
    .sort((a, b) => b.fee - a.fee)

  return {
    grossOmzet, feeAdmin, feeOngkir, feeIklan, leak, netReceived, opex,
    labaAsli, labaDikira, marginAsli, marginDikira, perChannel, count: tx.length,
  }
}

// Kalimat insight siap-tempel (untuk dibaca sendiri / dikirim ke seller saat concierge).
export function leakInsight(r) {
  if (!r || !r.grossOmzet) return 'Belum ada data penjualan pada periode ini untuk dianalisis.'
  const a = Math.round(r.marginAsli * 1000) / 10
  const d = Math.round(r.marginDikira * 1000) / 10
  return `Omzet kotor ${rupiah(r.grossOmzet)}, tapi yang benar-benar masuk ${rupiah(r.netReceived)}. `
    + `Sekitar ${rupiah(r.leak)} terpotong biaya channel (admin, ongkir, iklan). `
    + `Margin aslimu ${a}%, bukan ${d}% seperti yang dikira.`
}
