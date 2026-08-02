// Data contoh untuk mode demo (Dashboard pratinjau dan rute /demo).
// TIDAK PERNAH disimpan ke database — hanya hidup di state React.
//
// ---------- KENAPA ANGKANYA SEGINI ----------
// Target dari task B4: kebocoran 15–20% omzet kotor, tersebar di >=3 channel,
// marginDikira ~22%, marginAsli ~14%.
//
// Ketiganya tidak bisa dipenuhi sekaligus. Dari rumus di src/lib/reveal.js:
//   marginDikira = (gross - opex) / gross
//   marginAsli   = (gross - opex - leak) / gross
// sehingga selisihnya SELALU tepat sama dengan leak/gross. Meminta selisih
// 22% - 14% = 8 poin berarti meminta kebocoran 8%, yang bertentangan dengan
// permintaan kebocoran 15–20% pada kalimat yang sama.
//
// Yang dipilih di sini: kebocoran 15% dan marginAsli 14% (dua angka yang
// disebut paling spesifik dan paling sering dipakai di materi penjualan),
// yang memaksa marginDikira jadi 29%. Alternatifnya — menahan marginDikira di
// 22% — akan menekan marginAsli ke 7%, justru melanggar perintah "realistis,
// bukan dramatis" di task yang sama.
//
// Sasaran pasti (diuji di src/lib/__tests__/sampleData.test.js):
//   omzet kotor  50.000.000
//   kebocoran     7.500.000  (15,0%)  admin 2.440.000 + ongkir 1.490.000 + iklan 3.570.000
//   opex         35.500.000
//   laba asli     7.000.000  -> marginAsli   14,0%
//   laba dikira  14.500.000  -> marginDikira 29,0%
//
// Channel sengaja memakai kunci platform (shopee/tokopedia/tiktok), bukan
// 'marketplace' seperti versi sebelumnya. Dengan satu kunci gabungan, tabel
// per-channel di Reveal melebur jadi satu baris dan justru menyembunyikan
// perbandingan antar platform yang menjadi inti fitur ini.

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
    // ---------- SHOPEE — omzet 18.000.000, potongan 2.920.000 (16,2%) ----------
    mk(1, 'Shopee - Order #SP-4471', 2450000, 'in', 'shopee', 'Penjualan Marketplace'),
    mk(4, 'Shopee - Order #SP-4412', 1890000, 'in', 'shopee', 'Penjualan Marketplace'),
    mk(7, 'Shopee - Order #SP-4388', 3120000, 'in', 'shopee', 'Penjualan Marketplace'),
    mk(11, 'Shopee - Order #SP-4290', 1675000, 'in', 'shopee', 'Penjualan Marketplace'),
    mk(15, 'Shopee - Order #SP-4201', 2340000, 'in', 'shopee', 'Penjualan Marketplace'),
    mk(19, 'Shopee - Order #SP-4155', 2880000, 'in', 'shopee', 'Penjualan Marketplace'),
    mk(23, 'Shopee - Order #SP-4098', 1995000, 'in', 'shopee', 'Penjualan Marketplace'),
    mk(27, 'Shopee - Order #SP-4022', 1650000, 'in', 'shopee', 'Penjualan Marketplace'),
    mk(2, 'Biaya admin & komisi Shopee', 320000, 'out', 'shopee', 'Biaya Admin & Transaksi'),
    mk(9, 'Biaya admin & komisi Shopee', 285000, 'out', 'shopee', 'Biaya Admin & Transaksi'),
    mk(17, 'Biaya admin & komisi Shopee', 310000, 'out', 'shopee', 'Biaya Admin & Transaksi'),
    mk(25, 'Biaya admin & komisi Shopee', 255000, 'out', 'shopee', 'Biaya Admin & Transaksi'),
    mk(6, 'Subsidi ongkir Gratis Ongkir XTRA', 340000, 'out', 'shopee', 'Transportasi & Ongkir'),
    mk(20, 'Subsidi ongkir Gratis Ongkir XTRA', 260000, 'out', 'shopee', 'Transportasi & Ongkir'),
    mk(3, 'Iklan Shopee Ads', 450000, 'out', 'shopee', 'Iklan & Promosi'),
    mk(13, 'Iklan Shopee Ads', 380000, 'out', 'shopee', 'Iklan & Promosi'),
    mk(24, 'Iklan Shopee Ads', 320000, 'out', 'shopee', 'Iklan & Promosi'),

    // ---------- TOKOPEDIA — omzet 13.500.000, potongan 1.740.000 (12,9%) ----------
    mk(2, 'Tokopedia - Invoice #TKP-9912', 2180000, 'in', 'tokopedia', 'Penjualan Marketplace'),
    mk(6, 'Tokopedia - Invoice #TKP-9877', 2650000, 'in', 'tokopedia', 'Penjualan Marketplace'),
    mk(12, 'Tokopedia - Invoice #TKP-9801', 1940000, 'in', 'tokopedia', 'Penjualan Marketplace'),
    mk(17, 'Tokopedia - Invoice #TKP-9745', 2420000, 'in', 'tokopedia', 'Penjualan Marketplace'),
    mk(22, 'Tokopedia - Invoice #TKP-9688', 2310000, 'in', 'tokopedia', 'Penjualan Marketplace'),
    mk(26, 'Tokopedia - Invoice #TKP-9601', 2000000, 'in', 'tokopedia', 'Penjualan Marketplace'),
    mk(5, 'Biaya layanan Tokopedia', 265000, 'out', 'tokopedia', 'Biaya Admin & Transaksi'),
    mk(14, 'Biaya layanan Tokopedia', 240000, 'out', 'tokopedia', 'Biaya Admin & Transaksi'),
    mk(23, 'Biaya layanan Tokopedia', 235000, 'out', 'tokopedia', 'Biaya Admin & Transaksi'),
    mk(8, 'Subsidi ongkir Bebas Ongkir', 260000, 'out', 'tokopedia', 'Transportasi & Ongkir'),
    mk(21, 'Subsidi ongkir Bebas Ongkir', 220000, 'out', 'tokopedia', 'Transportasi & Ongkir'),
    mk(10, 'TopAds Tokopedia', 290000, 'out', 'tokopedia', 'Iklan & Promosi'),
    mk(25, 'TopAds Tokopedia', 230000, 'out', 'tokopedia', 'Iklan & Promosi'),

    // ---------- TIKTOK SHOP — omzet 10.500.000, potongan 2.840.000 (27,0%) ----------
    // Porsi iklannya sengaja paling besar: inilah channel yang biasanya terlihat
    // ramai tapi paling tipis hasil bersihnya.
    mk(0, 'TikTok Shop - Order #TT-7731', 1650000, 'in', 'tiktok', 'Penjualan Marketplace'),
    mk(5, 'TikTok Shop - Order #TT-7690', 2100000, 'in', 'tiktok', 'Penjualan Marketplace'),
    mk(9, 'TikTok Shop - Order #TT-7644', 1480000, 'in', 'tiktok', 'Penjualan Marketplace'),
    mk(14, 'TikTok Shop - Order #TT-7588', 1920000, 'in', 'tiktok', 'Penjualan Marketplace'),
    mk(20, 'TikTok Shop - Order #TT-7501', 1750000, 'in', 'tiktok', 'Penjualan Marketplace'),
    mk(28, 'TikTok Shop - Order #TT-7433', 1600000, 'in', 'tiktok', 'Penjualan Marketplace'),
    mk(4, 'Biaya komisi TikTok Shop', 195000, 'out', 'tiktok', 'Biaya Admin & Transaksi'),
    mk(16, 'Biaya komisi TikTok Shop', 180000, 'out', 'tiktok', 'Biaya Admin & Transaksi'),
    mk(26, 'Biaya komisi TikTok Shop', 155000, 'out', 'tiktok', 'Biaya Admin & Transaksi'),
    mk(7, 'Ongkir ditanggung penjual', 220000, 'out', 'tiktok', 'Transportasi & Ongkir'),
    mk(19, 'Ongkir ditanggung penjual', 190000, 'out', 'tiktok', 'Transportasi & Ongkir'),
    mk(1, 'Iklan TikTok - GMV Max', 620000, 'out', 'tiktok', 'Iklan & Promosi'),
    mk(8, 'Iklan TikTok - GMV Max', 540000, 'out', 'tiktok', 'Iklan & Promosi'),
    mk(15, 'Boost live streaming', 410000, 'out', 'tiktok', 'Iklan & Promosi'),
    mk(24, 'Iklan TikTok - GMV Max', 330000, 'out', 'tiktok', 'Iklan & Promosi'),

    // ---------- QRIS — omzet 4.200.000, tanpa potongan channel ----------
    mk(0, 'Penjualan QRIS - etalase', 680000, 'in', 'qris', 'Penjualan QRIS'),
    mk(3, 'Penjualan QRIS - etalase', 520000, 'in', 'qris', 'Penjualan QRIS'),
    mk(8, 'Penjualan QRIS - akhir pekan', 750000, 'in', 'qris', 'Penjualan QRIS'),
    mk(12, 'Penjualan QRIS - etalase', 610000, 'in', 'qris', 'Penjualan QRIS'),
    mk(18, 'Penjualan QRIS - etalase', 490000, 'in', 'qris', 'Penjualan QRIS'),
    mk(22, 'Penjualan QRIS - akhir pekan', 580000, 'in', 'qris', 'Penjualan QRIS'),
    mk(27, 'Penjualan QRIS - etalase', 570000, 'in', 'qris', 'Penjualan QRIS'),

    // ---------- TUNAI / OFFLINE — omzet 3.800.000, tanpa potongan channel ----------
    mk(1, 'Penjualan tunai etalase', 720000, 'in', 'struk', 'Penjualan'),
    mk(6, 'Penjualan tunai etalase', 540000, 'in', 'struk', 'Penjualan'),
    mk(11, 'Pesanan grosir - Bu Sari', 810000, 'in', 'bank', 'Penjualan', { unpaid: true }),
    mk(16, 'Penjualan tunai etalase', 630000, 'in', 'struk', 'Penjualan'),
    mk(21, 'Penjualan tunai etalase', 590000, 'in', 'struk', 'Penjualan'),
    mk(28, 'Penjualan tunai etalase', 510000, 'in', 'struk', 'Penjualan'),

    // ---------- BIAYA OPERASIONAL — 35.500.000 (bukan potongan channel) ----------
    mk(2, 'Belanja stok - supplier utama', 7200000, 'out', 'bank', 'Pembelian Stok'),
    mk(9, 'Belanja stok - Pasar Induk', 6800000, 'out', 'bank', 'Pembelian Stok'),
    mk(16, 'Belanja stok - supplier utama', 5400000, 'out', 'bank', 'Pembelian Stok'),
    mk(22, 'Belanja stok grosir', 4900000, 'out', 'bank', 'Pembelian Stok'),
    mk(28, 'Belanja stok - restock cepat', 3700000, 'out', 'manual', 'Pembelian Stok'),
    mk(3, 'Gaji karyawan toko', 1800000, 'out', 'bank', 'Gaji Karyawan'),
    mk(27, 'Gaji karyawan toko', 1800000, 'out', 'bank', 'Gaji Karyawan'),
    mk(5, 'Sewa ruko bulanan', 1800000, 'out', 'bank', 'Sewa Tempat'),
    mk(10, 'Token listrik PLN', 380000, 'out', 'manual', 'Operasional Listrik'),
    mk(24, 'Token listrik PLN', 320000, 'out', 'manual', 'Operasional Listrik'),
    mk(12, 'Paket data & internet toko', 220000, 'out', 'manual', 'Operasional Pulsa/Internet'),
    mk(26, 'Pulsa & paket data', 180000, 'out', 'manual', 'Operasional Pulsa/Internet'),
    mk(7, 'Kardus, bubble wrap, lakban', 560000, 'out', 'manual', 'Pengeluaran Lain'),
    mk(20, 'Kardus & label pengiriman', 440000, 'out', 'manual', 'Pengeluaran Lain'),
  ]
}
