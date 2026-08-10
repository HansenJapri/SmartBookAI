import { describe, it, expect } from 'vitest'
import { bersihkanBarisTransaksi } from '../api'

// Penjaga untuk P13. Baris hasil impor datang dari beberapa parser berbeda
// (CSV umum, laporan marketplace 5 platform, OCR struk) dan tiap parser
// menempelkan field kerjanya sendiri. Satu kunci yang tidak punya kolom padanan
// membuat PostgREST menolak SELURUH batch — impor 300 baris gagal total dengan
// pesan Postgres mentah.

describe('bersihkanBarisTransaksi', () => {
  it('membuang field kerja parser yang tidak punya kolom di database', () => {
    const dariParser = {
      occurred_at: '2026-08-07T00:00:00.000Z',
      description: 'Penjualan Shopee',
      amount: 125000,
      direction: 'in',
      channel: 'marketplace',
      category: 'Penjualan Marketplace',
      raw: 'kolom | mentah | gabungan',
      // --- di bawah ini murni field kerja UI/parser ---
      _id: 12,
      _include: true,
      _dateUncertain: true,
      _dateReason: 'format ambigu',
      _dateRaw: '07/08/26',
    }
    expect(bersihkanBarisTransaksi(dariParser)).toEqual({
      occurred_at: '2026-08-07T00:00:00.000Z',
      description: 'Penjualan Shopee',
      amount: 125000,
      direction: 'in',
      channel: 'marketplace',
      category: 'Penjualan Marketplace',
      raw: 'kolom | mentah | gabungan',
    })
  })

  it('mempertahankan seluruh kolom sah yang dipakai jalur impor & OCR', () => {
    const lengkap = {
      occurred_at: '2026-08-07T00:00:00.000Z', description: 'Belanja', amount: 1,
      direction: 'out', category: 'Pembelian Stok', channel: 'struk',
      source_ref: 'struk.jpg', raw: 'x', receipt_url: 'a/b.jpg',
      payment_status: 'belum', due_date: '2026-09-01',
      customer_name: 'Bu Sari', customer_contact: '628123', customer_id: 'c1',
      supplier_id: 's1', product_id: 'p1', qty: 3,
      import_confidence: 'tinggi', is_duplicate: false, dismissed_dup: false,
    }
    expect(bersihkanBarisTransaksi(lengkap)).toEqual(lengkap)
  })

  it('tidak menyisipkan kunci untuk field yang tidak ada di baris asal', () => {
    // undefined yang ikut terkirim akan menimpa default kolom di database.
    const hasil = bersihkanBarisTransaksi({ description: 'a', amount: 1, direction: 'in' })
    expect(Object.keys(hasil).sort()).toEqual(['amount', 'description', 'direction'])
    expect('payment_status' in hasil).toBe(false)
  })

  it('membiarkan nilai null lewat — null itu nilai yang sah, bukan field yang hilang', () => {
    const hasil = bersihkanBarisTransaksi({ description: 'a', due_date: null, supplier_id: null })
    expect(hasil).toEqual({ description: 'a', due_date: null, supplier_id: null })
  })

  it('membuang supplier_name (nama pemasok ditautkan jadi supplier_id lebih dulu)', () => {
    const hasil = bersihkanBarisTransaksi({ description: 'a', supplier_name: 'Toko Jaya' })
    expect(hasil).toEqual({ description: 'a' })
  })
})
