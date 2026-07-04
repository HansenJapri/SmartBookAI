// Data contoh untuk pratinjau Dashboard (mode demo). TIDAK disimpan ke database;
// hanya untuk membantu pengguna baru melihat manfaat aplikasi sebelum memasukkan
// data nyata. Sengaja memuat biaya marketplace (admin, ongkir, iklan) agar
// "kebocoran" untung terlihat jelas.

function iso(daysAgo, hour = 10, min = 0) {
  const d = new Date()
  d.setHours(hour, min, 0, 0)
  d.setDate(d.getDate() - daysAgo)
  return d.toISOString()
}

let _seq = 1
const mk = (daysAgo, description, amount, direction, channel, category, extra = {}) => ({
  id: `demo-${_seq++}`,
  occurred_at: iso(daysAgo, extra.hour ?? 10, extra.min ?? 0),
  description, amount, direction, channel, category,
  payment_status: direction === 'in' ? (extra.unpaid ? 'belum' : 'lunas') : null,
})

export function sampleTransactions() {
  _seq = 1
  return [
    mk(0, 'Penjualan QRIS - Ibu Tini', 35000, 'in', 'qris', 'Penjualan QRIS'),
    mk(0, 'Shopee - Order #SP-2291', 189000, 'in', 'marketplace', 'Penjualan Marketplace'),
    mk(0, 'Biaya admin Shopee', 11340, 'out', 'marketplace', 'Biaya Admin & Transaksi'),
    mk(1, 'Tokopedia - Order #TKP-8841', 245000, 'in', 'marketplace', 'Penjualan Marketplace'),
    mk(1, 'Ongkir ditanggung penjual', 18000, 'out', 'marketplace', 'Transportasi & Ongkir'),
    mk(1, 'Penjualan tunai etalase', 120000, 'in', 'struk', 'Penjualan'),
    mk(2, 'Penjualan QRIS - Pak Andi', 64000, 'in', 'qris', 'Penjualan QRIS'),
    mk(2, 'Iklan Shopee', 50000, 'out', 'marketplace', 'Iklan & Promosi'),
    mk(3, 'Belanja stok Pasar Induk', 350000, 'out', 'struk', 'Pembelian Stok'),
    mk(3, 'Transfer masuk - pelanggan grosir', 480000, 'in', 'bank', 'Penjualan', { unpaid: true }),
    mk(4, 'Penjualan QRIS ramai', 92000, 'in', 'qris', 'Penjualan QRIS'),
    mk(4, 'Token listrik PLN', 100000, 'out', 'manual', 'Operasional Listrik'),
    mk(5, 'Shopee - Order #SP-2310', 156000, 'in', 'marketplace', 'Penjualan Marketplace'),
    mk(5, 'Biaya admin Shopee', 9360, 'out', 'marketplace', 'Biaya Admin & Transaksi'),
    mk(6, 'Penjualan tunai', 210000, 'in', 'struk', 'Penjualan'),
    mk(7, 'Tokopedia - Order #TKP-8902', 320000, 'in', 'marketplace', 'Penjualan Marketplace'),
    mk(7, 'Ongkir ditanggung penjual', 22000, 'out', 'marketplace', 'Transportasi & Ongkir'),
    mk(8, 'Penjualan QRIS', 47000, 'in', 'qris', 'Penjualan QRIS'),
    mk(8, 'Pulsa & paket data', 60000, 'out', 'manual', 'Operasional Pulsa/Internet'),
    mk(9, 'Penjualan tunai', 175000, 'in', 'struk', 'Penjualan'),
    mk(10, 'Belanja stok grosir', 540000, 'out', 'bank', 'Pembelian Stok'),
    mk(10, 'Shopee - Order #SP-2333', 98000, 'in', 'marketplace', 'Penjualan Marketplace'),
    mk(11, 'Penjualan QRIS - Bu Sari', 58000, 'in', 'qris', 'Penjualan QRIS'),
    mk(12, 'Iklan TikTok', 75000, 'out', 'marketplace', 'Iklan & Promosi'),
    mk(12, 'Penjualan tunai', 132000, 'in', 'struk', 'Penjualan'),
    mk(13, 'Tokopedia - Order #TKP-8950', 268000, 'in', 'marketplace', 'Penjualan Marketplace'),
    mk(13, 'Biaya admin Tokopedia', 16080, 'out', 'marketplace', 'Biaya Admin & Transaksi'),
    mk(13, 'Sewa lapak bulanan', 300000, 'out', 'bank', 'Sewa Tempat'),
  ]
}
