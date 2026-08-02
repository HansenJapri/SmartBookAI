import { describe, it, expect } from 'vitest'
import { sampleTransactions } from '../sampleData'
import { revealLeak } from '../reveal'

// Data contoh adalah materi penjualan: inilah angka pertama yang dilihat calon
// pengguna di /demo. Kalau seseorang menambah satu transaksi tanpa menghitung
// ulang, rasionya melenceng tanpa ada yang tahu. Test ini yang menahannya.
const r = () => revealLeak(sampleTransactions(), 'all')

describe('sasaran angka data contoh', () => {
  it('omzet kotor tepat 50 juta', () => {
    expect(r().grossOmzet).toBe(50_000_000)
  })

  it('kebocoran 7,5 juta = 15% omzet, di dalam rentang 15-20% yang diminta', () => {
    const v = r()
    expect(v.leak).toBe(7_500_000)
    const pct = (v.leak / v.grossOmzet) * 100
    expect(pct).toBeCloseTo(15, 5)
    expect(pct).toBeGreaterThanOrEqual(15)
    expect(pct).toBeLessThanOrEqual(20)
  })

  it('rincian kebocoran terbagi ke admin, ongkir, dan iklan', () => {
    const v = r()
    expect(v.feeAdmin).toBe(2_440_000)
    expect(v.feeOngkir).toBe(1_490_000)
    expect(v.feeIklan).toBe(3_570_000)
    expect(v.feeAdmin + v.feeOngkir + v.feeIklan).toBe(v.leak)
  })

  it('margin asli 14% — angka yang diminta spesifik oleh B4', () => {
    expect(r().marginAsli * 100).toBeCloseTo(14, 5)
  })

  it('margin dikira 29%, konsekuensi aritmetika dari kebocoran 15%', () => {
    const v = r()
    expect(v.marginDikira * 100).toBeCloseTo(29, 5)
    // Identitas yang membuat target 22%/14% + kebocoran 15-20% mustahil:
    // selisih margin SELALU sama dengan porsi kebocoran.
    expect(v.marginDikira - v.marginAsli).toBeCloseTo(v.leak / v.grossOmzet, 10)
  })

  it('laba asli 7 juta, jauh di bawah 14,5 juta yang dikira', () => {
    const v = r()
    expect(v.labaAsli).toBe(7_000_000)
    expect(v.labaDikira).toBe(14_500_000)
  })
})

describe('sebaran channel', () => {
  it('potongan tersebar di minimal 3 channel, bukan melebur jadi satu', () => {
    const berbiaya = r().perChannel.filter((c) => c.fee > 0)
    expect(berbiaya.length).toBeGreaterThanOrEqual(3)
  })

  it('memakai kunci platform, bukan label gabungan "marketplace"', () => {
    const kunci = r().perChannel.map((c) => c.channel)
    expect(kunci).toEqual(expect.arrayContaining(['shopee', 'tokopedia', 'tiktok']))
    expect(kunci).not.toContain('marketplace')
  })

  it('TikTok tampil sebagai channel paling boros meski omzetnya bukan terbesar', () => {
    const v = r()
    const tiktok = v.perChannel.find((c) => c.channel === 'tiktok')
    const shopee = v.perChannel.find((c) => c.channel === 'shopee')
    expect(tiktok.pct).toBeGreaterThan(shopee.pct)
    expect(tiktok.gross).toBeLessThan(shopee.gross)
  })

  it('setiap channel punya nama tampilan yang layak dibaca', () => {
    for (const c of r().perChannel) {
      expect(c.name).toBeTruthy()
      expect(c.name).not.toBe(c.channel)
    }
  })
})

describe('kelayakan sebagai data demo', () => {
  it('tidak menyentuh database: hanya objek biasa tanpa id server', () => {
    for (const t of sampleTransactions()) {
      expect(String(t.id)).toMatch(/^demo-/)
    }
  })

  it('dipanggil dua kali menghasilkan angka yang sama', () => {
    expect(revealLeak(sampleTransactions(), 'all').leak)
      .toBe(revealLeak(sampleTransactions(), 'all').leak)
  })

  it('jumlah transaksi cukup banyak agar terlihat seperti sebulan berjualan', () => {
    expect(sampleTransactions().length).toBeGreaterThanOrEqual(50)
  })
})
