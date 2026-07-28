import { describe, it, expect } from 'vitest'
import { buildAggregateSummary, SENSITIVE_FIELDS } from '../aiSummary'

// ============================================================
// Kontrak privasi: ringkasan ke LLM WAJIB agregat, TIDAK PERNAH PII mentah.
// Test ini menjadi gerbang regresi untuk UU PDP & Kebijakan Privasi.
// ============================================================

const now = new Date('2026-07-26T12:00:00+07:00')

const richTx = [
  {
    direction: 'in', amount: 45000, category: 'Penjualan', payment_status: 'lunas',
    occurred_at: '2026-07-26T10:00:00Z',
    // Field sensitif — tidak boleh muncul di ringkasan
    customer_name: 'Bu Siti Aminah',
    description: 'transfer BCA 1234567890',
    phone: '0812-3456-7890',
    no_rekening: '9876543210',
    email: 'sitiaminah@example.com',
    address: 'Jl. Melati No. 12, Bandung',
    note: 'catatan rahasia internal',
  },
  {
    direction: 'out', amount: 150000, category: 'Operasional Listrik', payment_status: 'lunas',
    occurred_at: '2026-07-25T09:00:00Z',
    description: 'PLN token 100rb + BCA admin',
  },
  {
    direction: 'in', amount: 500000, category: 'Penjualan', payment_status: 'belum',
    occurred_at: '2026-07-26T08:00:00Z',
    customer_name: 'Pak Rahmat',
  },
]

describe('buildAggregateSummary — kontrak privasi & agregasi', () => {
  it('menghitung total agregat dengan benar', () => {
    const s = buildAggregateSummary({ transactions: richTx, now })
    expect(s).toMatch(/Total pemasukan.*Rp 545\.000/)
    expect(s).toMatch(/Total pengeluaran.*Rp 150\.000/)
    expect(s).toMatch(/Laba bersih.*Rp 395\.000/)
    expect(s).toMatch(/Jumlah transaksi tercatat: 3/)
    expect(s).toMatch(/Penjualan belum lunas: 1 \(total Rp 500\.000\)/)
  })

  it('tidak pernah memuat nama pelanggan / no rekening / deskripsi mentah', () => {
    const s = buildAggregateSummary({ transactions: richTx, now })
    // Kunci privasi UU PDP: kalau ini pernah gagal, PII bocor ke LLM
    expect(s).not.toMatch(/Siti|Aminah|Rahmat/)
    expect(s).not.toMatch(/BCA|PLN token|1234567890|9876543210/)
    expect(s).not.toMatch(/0812-3456-7890|sitiaminah|Melati|catatan rahasia/)
  })

  it('mendata SENSITIVE_FIELDS sebagai dokumentasi keras', () => {
    // Ini test dokumentasi — bila daftar bertambah/berkurang, auditor sadar.
    expect(SENSITIVE_FIELDS).toEqual(expect.arrayContaining([
      'customer_name', 'phone', 'no_rekening', 'description', 'address', 'email',
    ]))
  })

  it('menyebut top kategori pengeluaran (top 5)', () => {
    const s = buildAggregateSummary({ transactions: richTx, now })
    expect(s).toMatch(/Operasional Listrik Rp 150\.000/)
  })

  it('menyertakan produk stok menipis + label perangkat', () => {
    const products = [
      { name: 'Beras 5kg', stock: 2, min_stock: 5 },      // menipis
      { name: 'Gula 1kg', stock: 20, min_stock: 5 },      // aman
      { name: 'Minyak 1L', stock: 0, min_stock: 3 },      // menipis
      { name: 'Ex1', stock: 1, min_stock: 2 },
      { name: 'Ex2', stock: 1, min_stock: 2 },
      { name: 'Ex3', stock: 1, min_stock: 2 },
      { name: 'Ex4', stock: 1, min_stock: 2 },
      { name: 'Ex5', stock: 1, min_stock: 2 },
      { name: 'Kopi 200g', stock: 1, min_stock: 2 }, // menipis, nama ke-8 yang tampil
      { name: 'Ex6', stock: 1, min_stock: 2 }, // menipis ke-9, di luar 8 pertama
    ]
    const s = buildAggregateSummary({ transactions: [], products, device: 'mobile', now })
    expect(s).toMatch(/Produk stok menipis: 9/)
    expect(s).toMatch(/Beras 5kg/)
    expect(s).not.toMatch(/Ex6/) // dipangkas ke 8 nama pertama
    expect(s).toMatch(/Perangkat: mobile/)
  })

  it('device default = desktop bila tidak diberi', () => {
    const s = buildAggregateSummary({ transactions: [], now })
    expect(s).toMatch(/Perangkat: desktop/)
  })

  it('perhitungan WoW pemasukan (7 hari vs 7 hari sebelumnya)', () => {
    // 7 hari terakhir = 1.000.000; 7 hari sebelumnya = 500.000 -> +100%
    const txs = [
      { direction: 'in', amount: 1000000, category: 'Penjualan',
        payment_status: 'lunas', occurred_at: '2026-07-22T10:00:00Z' }, // dalam 7 hari
      { direction: 'in', amount: 500000, category: 'Penjualan',
        payment_status: 'lunas', occurred_at: '2026-07-15T10:00:00Z' }, // 7-14 hari
    ]
    const s = buildAggregateSummary({ transactions: txs, now })
    expect(s).toMatch(/perubahan minggu-ke-minggu: 100%/)
  })

  it('input kosong tidak throw & label default aman', () => {
    const s = buildAggregateSummary({})
    expect(s).toMatch(/Total pemasukan.*Rp 0/)
    expect(s).toMatch(/Belum ada data pengeluaran per kategori/)
    expect(s).toMatch(/Jumlah produk: 0; Produk stok menipis: 0/)
  })
})
