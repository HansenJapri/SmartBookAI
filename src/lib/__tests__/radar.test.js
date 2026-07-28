import { describe, it, expect } from 'vitest'
import {
  expectedRunKey,
  priceFreshness,
  priceDelta,
  buildSignalInput,
  normalizeSignal,
  MAX_HEADLINES_PER_COMMODITY,
} from '../radar'

// ============================================================
// Unit tests: helper Radar Harga (radar.js)
// Fokus: aturan hari-data 06.00 WIB, freshness, delta, & pembatas payload LLM.
// ============================================================

describe('expectedRunKey (kunci hari data 06.00 WIB)', () => {
  it('jam 09:00 WIB -> kunci = hari ini', () => {
    // 26 Juli 2026 09:00 WIB = 26 Juli 02:00 UTC
    const now = new Date('2026-07-26T02:00:00Z')
    expect(expectedRunKey(now)).toBe('2026-07-26')
  })
  it('jam 04:00 WIB -> kunci = kemarin', () => {
    // 26 Juli 2026 04:00 WIB = 25 Juli 21:00 UTC
    const now = new Date('2026-07-25T21:00:00Z')
    expect(expectedRunKey(now)).toBe('2026-07-25')
  })
  it('tepat jam 06:00 WIB -> kunci = hari ini (batas inklusif)', () => {
    const now = new Date('2026-07-25T23:00:00Z') // 26 Juli 06:00 WIB
    expect(expectedRunKey(now)).toBe('2026-07-26')
  })
})

describe('priceFreshness', () => {
  const now = new Date('2026-07-26T02:00:00Z') // 09:00 WIB
  it('fresh bila price_date = hari ini', () => {
    const r = priceFreshness({ priceDate: '2026-07-26', now, maxAgeDays: 1 })
    expect(r.isFresh).toBe(true)
    expect(r.ageDays).toBe(0)
  })
  it('stale bila price_date > maxAgeDays', () => {
    const r = priceFreshness({ priceDate: '2026-07-24', now, maxAgeDays: 1 })
    expect(r.isFresh).toBe(false)
    expect(r.ageDays).toBe(2)
  })
  it('price_date invalid -> stale', () => {
    expect(priceFreshness({ priceDate: 'bukan-tanggal', now }).isFresh).toBe(false)
    expect(priceFreshness({ priceDate: '', now }).isFresh).toBe(false)
    expect(priceFreshness({ priceDate: null, now }).isFresh).toBe(false)
  })
})

describe('priceDelta', () => {
  it('menghitung persentase perubahan', () => {
    expect(priceDelta({ price: 14500, prevPrice: 14000 })).toBeCloseTo(3.57, 1)
    expect(priceDelta({ price: 9000, prevPrice: 10000 })).toBeCloseTo(-10, 1)
  })
  it('null bila prevPrice tak sah (nol / negatif / tidak ada)', () => {
    expect(priceDelta({ price: 14500, prevPrice: 0 })).toBeNull()
    expect(priceDelta({ price: 14500, prevPrice: null })).toBeNull()
    expect(priceDelta({ price: 14500, prevPrice: undefined })).toBeNull()
    expect(priceDelta({ price: 14500, prevPrice: -1 })).toBeNull()
  })
  it('null bila price tak sah', () => {
    expect(priceDelta({ price: 'abc', prevPrice: 100 })).toBeNull()
  })
})

describe('buildSignalInput (anti-bloat token)', () => {
  it(`membatasi max ${MAX_HEADLINES_PER_COMMODITY} headline per komoditas`, () => {
    const headlines = Array.from({ length: 12 }, (_, i) => ({
      title: `judul ${i}`, snippet: `ringkasan ${i}`, domain: 'kontan.co.id', link: `https://kontan.co.id/${i}`,
    }))
    const out = buildSignalInput([{ key: 'beras', label: 'Beras', headlines }])
    expect(out[0].berita).toHaveLength(5)
    expect(out[0].berita[0].judul).toBe('judul 0')
  })
  it('memotong judul ke 200 char & ringkasan ke 200 char (anti-payload)', () => {
    const longTitle = 'a'.repeat(400)
    const longSnip = 'b'.repeat(400)
    const out = buildSignalInput([{ key: 'x', label: 'X', headlines: [{ title: longTitle, snippet: longSnip, domain: 'kontan.co.id' }] }])
    expect(out[0].berita[0].judul.length).toBe(200)
    expect(out[0].berita[0].ringkasan.length).toBe(200)
  })
  it('menerima feed kosong tanpa error', () => {
    expect(buildSignalInput([])).toEqual([])
    expect(buildSignalInput([{ key: 'x', label: 'X', headlines: [] }])[0].berita).toEqual([])
  })
})

describe('normalizeSignal (kontrak keluaran LLM)', () => {
  it('clamp -30..+30 & kelipatan 0.5', () => {
    const s = normalizeSignal({ direction: 'naik', est_pct_min: -99, est_pct_max: 77.7, confidence: 'tinggi', drivers: [] })
    expect(s.est_pct_min).toBe(-30)
    expect(s.est_pct_max).toBe(30)
    const s2 = normalizeSignal({ est_pct_min: 3.3, est_pct_max: 4.4 })
    expect(s2.est_pct_min).toBe(3.5)
    expect(s2.est_pct_max).toBe(4.5)
  })
  it('menukar min>max menjadi urutan yang benar', () => {
    const s = normalizeSignal({ est_pct_min: 5, est_pct_max: 2 })
    expect(s.est_pct_min).toBe(2); expect(s.est_pct_max).toBe(5)
  })
  it('memfilter enum direction & confidence yang tak sah', () => {
    const s = normalizeSignal({ direction: 'meledak', confidence: 'sangat' })
    expect(s.direction).toBe('stabil')
    expect(s.confidence).toBe('rendah')
  })
  it('drivers max 3 @ max 140 char', () => {
    const long = 'x'.repeat(300)
    const s = normalizeSignal({ drivers: [long, long, long, long, long] })
    expect(s.drivers).toHaveLength(3)
    for (const d of s.drivers) expect(d.length).toBe(140)
  })
})
