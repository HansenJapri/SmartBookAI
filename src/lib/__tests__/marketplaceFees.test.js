import { describe, it, expect } from 'vitest'
import { expandMarketplaceReport, expandMarketplaceRows, PERAN_PENTING } from '../marketplaceFees'

// Deteksi kolom berbasis sinonim adalah pembeda utama produk ini — dan selama
// ini ia GAGAL DALAM DIAM. Kalau kolom biaya iklan tidak dikenali, angka
// kebocoran keluar terlalu kecil dan tidak ada satu pun tanda bahwa ada yang
// hilang. Tes di bawah memakai bentuk berkas dari platform yang berbeda-beda
// supaya kegagalan itu tidak bisa lolos diam-diam lagi.

// ---------- Format Shopee: lengkap, memakai kolom kotor ----------
const shopeeHeaders = [
  'No. Pesanan', 'Waktu Pesanan Dibuat', 'Total Harga Produk',
  'Biaya Administrasi', 'Ongkos Kirim Dibayar Penjual', 'Biaya Iklan',
  'Total Penghasilan', 'Status Pesanan',
]
const shopeeRows = [
  {
    'No. Pesanan': 'SP-1', 'Waktu Pesanan Dibuat': '01/07/2026', 'Total Harga Produk': '1.000.000',
    'Biaya Administrasi': '65.000', 'Ongkos Kirim Dibayar Penjual': '20.000', 'Biaya Iklan': '50.000',
    'Total Penghasilan': '865.000', 'Status Pesanan': 'Selesai',
  },
  {
    'No. Pesanan': 'SP-2', 'Waktu Pesanan Dibuat': '02/07/2026', 'Total Harga Produk': '500.000',
    'Biaya Administrasi': '32.500', 'Ongkos Kirim Dibayar Penjual': '10.000', 'Biaya Iklan': '0',
    'Total Penghasilan': '457.500', 'Status Pesanan': 'Selesai',
  },
]

// ---------- Format Tokopedia: tanpa kolom iklan sama sekali ----------
const topedHeaders = [
  'Nomor Invoice', 'Tanggal Pembayaran', 'Total Pembayaran',
  'Biaya Layanan', 'Biaya Pengiriman', 'Total Dana Diterima',
]
const topedRows = [{
  'Nomor Invoice': 'TKP-1', 'Tanggal Pembayaran': '03/07/2026', 'Total Pembayaran': '2.000.000',
  'Biaya Layanan': '100.000', 'Biaya Pengiriman': '30.000', 'Total Dana Diterima': '1.820.000',
}]

// ---------- Format minim: hanya nilai bersih, kotor harus direkonstruksi ----------
const minimHeaders = ['Order ID', 'Order Time', 'Settlement Amount']
const minimRows = [{ 'Order ID': 'TT-1', 'Order Time': '04/07/2026', 'Settlement Amount': '750.000' }]

describe('keyakinan hasil deteksi kolom', () => {
  it('berkas lengkap: keyakinan tinggi, tidak ada peran penting yang hilang', () => {
    const { diagnostics: d } = expandMarketplaceReport(shopeeRows, shopeeHeaders, 'shopee')
    expect(d.confidence).toBe('tinggi')
    expect(d.unmatched).toEqual([])
    expect(d.matched.gross).toBe('Total Harga Produk')
    expect(d.matched.admin).toBe('Biaya Administrasi')
    expect(d.matched.iklan).toBe('Biaya Iklan')
  })

  // Kriteria terima C3: "impor file tanpa kolom iklan -> confidence turun".
  // Ini yang memaksa ambang 'tinggi' diperketat jadi KETIGA kolom biaya; dengan
  // aturan ">=2" yang tertulis di badan spec, berkas ini akan tetap 'tinggi'
  // dan kriteria terimanya tidak akan pernah terpenuhi.
  it('berkas tanpa kolom iklan: keyakinan turun dan iklan terdaftar hilang', () => {
    const { diagnostics: d } = expandMarketplaceReport(topedRows, topedHeaders, 'tokopedia')
    expect(d.confidence).not.toBe('tinggi')
    expect(d.confidence).toBe('sedang')
    expect(d.unmatched).toContain('iklan')
    expect(d.matched.iklan).toBeUndefined()
  })

  it('iklan menyumbang porsi terbesar kebocoran, jadi ketiadaannya harus menurunkan keyakinan', () => {
    const lengkap = expandMarketplaceReport(shopeeRows, shopeeHeaders, 'shopee').diagnostics
    const tanpaIklan = expandMarketplaceReport(
      shopeeRows, shopeeHeaders.filter((h) => h !== 'Biaya Iklan'), 'shopee',
    ).diagnostics
    expect(lengkap.confidence).toBe('tinggi')
    expect(tanpaIklan.confidence).toBe('sedang')
  })

  it('hanya satu kolom biaya: keyakinan sedang', () => {
    const headers = ['Tanggal', 'Total Harga Produk', 'Biaya Administrasi']
    const rows = [{ Tanggal: '01/07/2026', 'Total Harga Produk': '100.000', 'Biaya Administrasi': '6.000' }]
    const { diagnostics: d } = expandMarketplaceReport(rows, headers, 'shopee')
    expect(d.confidence).toBe('sedang')
  })

  it('tidak ada kolom biaya sama sekali: keyakinan rendah', () => {
    const headers = ['Tanggal', 'Total Harga Produk']
    const rows = [{ Tanggal: '01/07/2026', 'Total Harga Produk': '100.000' }]
    expect(expandMarketplaceReport(rows, headers, 'shopee').diagnostics.confidence).toBe('rendah')
  })

  it('kotor direkonstruksi dari bersih: keyakinan rendah', () => {
    const { diagnostics: d } = expandMarketplaceReport(minimRows, minimHeaders, 'tiktok')
    expect(d.confidence).toBe('rendah')
    expect(d.matched.gross).toBeUndefined()
    expect(d.reconstructedRows).toBe(1)
  })
})

describe('kolom yang tidak dikenali', () => {
  it('didaftarkan supaya sinonim baru bisa ditambahkan', () => {
    const { diagnostics: d } = expandMarketplaceReport(shopeeRows, shopeeHeaders, 'shopee')
    expect(d.unknownColumns).toEqual(['Status Pesanan'])
  })

  it('kolom yang sudah dipakai tidak ikut terdaftar sebagai tidak dikenal', () => {
    const { diagnostics: d } = expandMarketplaceReport(topedRows, topedHeaders, 'tokopedia')
    for (const dipakai of Object.values(d.matched)) {
      expect(d.unknownColumns).not.toContain(dipakai)
    }
  })
})

describe('selisih yang belum terjelaskan', () => {
  it('dijumlahkan lintas baris, bukan hanya ditandai per baris', () => {
    const rows = [{
      'No. Pesanan': 'SP-9', 'Waktu Pesanan Dibuat': '01/07/2026', 'Total Harga Produk': '1.000.000',
      'Biaya Administrasi': '50.000', 'Ongkos Kirim Dibayar Penjual': '0', 'Biaya Iklan': '0',
      // 1.000.000 - 875.000 - 50.000 = 75.000 tidak terjelaskan
      'Total Penghasilan': '875.000', 'Status Pesanan': 'Selesai',
    }]
    const { diagnostics: d } = expandMarketplaceReport(rows, shopeeHeaders, 'shopee')
    expect(d.unexplainedAmount).toBe(75000)
  })

  it('nol saat seluruh potongan terjelaskan', () => {
    const { diagnostics: d } = expandMarketplaceReport(shopeeRows, shopeeHeaders, 'shopee')
    expect(d.unexplainedAmount).toBe(0)
  })
})

describe('baris yang terbuang', () => {
  it('baris tanpa nilai kotor dihitung, tidak hilang tanpa jejak', () => {
    const rows = [
      ...shopeeRows,
      { 'No. Pesanan': 'SP-X', 'Waktu Pesanan Dibuat': '05/07/2026', 'Total Harga Produk': '0', 'Total Penghasilan': '0' },
    ]
    const { diagnostics: d } = expandMarketplaceReport(rows, shopeeHeaders, 'shopee')
    expect(d.rowCount).toBe(2)
    expect(d.skippedRows).toBe(1)
  })
})

describe('kecocokan dengan bentuk lama', () => {
  it('expandMarketplaceRows tetap mengembalikan transaksi yang sama', () => {
    const lama = expandMarketplaceRows(shopeeRows, shopeeHeaders, 'shopee')
    const baru = expandMarketplaceReport(shopeeRows, shopeeHeaders, 'shopee').transactions
    expect(lama).toEqual(baru)
  })

  it('memecah pesanan jadi penjualan kotor dan biaya terpisah', () => {
    const txs = expandMarketplaceRows(shopeeRows.slice(0, 1), shopeeHeaders, 'shopee')
    const jual = txs.find((t) => t.direction === 'in')
    expect(jual.amount).toBe(1000000)
    expect(txs.filter((t) => t.direction === 'out').map((t) => t.amount).sort((a, b) => a - b))
      .toEqual([20000, 50000, 65000])
  })

  it('daftar peran penting tidak memuat nomor pesanan', () => {
    expect(PERAN_PENTING).not.toContain('order')
    expect(PERAN_PENTING).toContain('iklan')
  })
})
