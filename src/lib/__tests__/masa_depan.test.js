import { describe, it, expect } from 'vitest'
import { olsFit, dowIndex, percentile, dailyIncomeSeries, buildModel, forecastTarget, MIN_DAYS } from '../regression'
import { computeHpp, marginPct, priceForMargin, applyAdjustments, applyMacroScenario, applyKursScenario } from '../hpp'

// Transaksi sintetis: `daysAgo` hari lalu, nominal, arah.
const tx = (daysAgo, amount, direction = 'in') => ({
  direction,
  amount,
  occurred_at: new Date(Date.now() - daysAgo * 86400000).toISOString(),
})

// 28 hari histori: hari biasa 100rb, akhir pekan 200rb, plus tren naik tipis.
function sampleTx(days = 28) {
  const list = []
  for (let d = days - 1; d >= 0; d--) {
    const date = new Date(Date.now() - d * 86400000)
    const weekend = date.getDay() === 0 || date.getDay() === 6
    const base = weekend ? 200_000 : 100_000
    const growth = (days - d) * 1_000 // naik pelan
    list.push(tx(d, base + growth))
  }
  return list
}

describe('regression (prediksi target)', () => {
  it('olsFit menemukan kemiringan deret linier', () => {
    const { a, b } = olsFit([10, 20, 30, 40, 50])
    expect(b).toBeCloseTo(10, 5)
    expect(a).toBeCloseTo(10, 5)
  })

  it('percentile mengembalikan median yang benar', () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3)
  })

  it('dailyIncomeSeries mengisi hari kosong dengan 0', () => {
    const series = dailyIncomeSeries([tx(3, 50_000), tx(0, 70_000)])
    expect(series.length).toBe(4) // hari -3 .. hari ini
    expect(series[1].y).toBe(0)
    expect(series[3].y).toBe(70_000)
  })

  it('dowIndex menangkap pola akhir pekan', () => {
    const series = dailyIncomeSeries(sampleTx(28))
    const idx = dowIndex(series)
    // Indeks Sabtu (6) & Minggu (0) harus di atas rata-rata hari biasa.
    expect(idx[6]).toBeGreaterThan(idx[3])
    expect(idx[0]).toBeGreaterThan(idx[3])
  })

  it('belum aktif bila data < 14 hari (kejujuran fitur)', () => {
    const m = buildModel(sampleTx(7))
    expect(m.ready).toBe(false)
    expect(m.daysNeed).toBe(MIN_DAYS)
  })

  it('target: skenario optimis tercapai lebih dulu dari pesimis', () => {
    const txs = sampleTx(28)
    const start = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10)
    const fc = forecastTarget(txs, { amount: 5_000_000, start_date: start })
    expect(fc.ready).toBe(true)
    expect(fc.done).toBe(false)
    expect(fc.scenarios.realistis).toBeInstanceOf(Date)
    // Urutan wajib: optimis <= realistis <= pesimis (bila semua tercapai).
    if (fc.scenarios.optimis && fc.scenarios.pesimis) {
      expect(fc.scenarios.optimis.getTime()).toBeLessThanOrEqual(fc.scenarios.realistis.getTime())
      expect(fc.scenarios.realistis.getTime()).toBeLessThanOrEqual(fc.scenarios.pesimis.getTime())
    }
  })

  it('target yang sudah terlampaui ditandai done', () => {
    const txs = sampleTx(28)
    const start = new Date(Date.now() - 27 * 86400000).toISOString().slice(0, 10)
    const fc = forecastTarget(txs, { amount: 100_000, start_date: start })
    expect(fc.done).toBe(true)
    expect(fc.progressPct).toBeGreaterThanOrEqual(100)
  })
})

describe('hpp (simulasi biaya)', () => {
  const rows = [
    { qty: 200, price_per_unit: 12, commodity_key: 'terigu', import_exposure: 'tinggi' },  // 2.400
    { qty: 3, price_per_unit: 2_000, commodity_key: 'telur', import_exposure: 'rendah' }, // 6.000
    { qty: 1, price_per_unit: 1_600, commodity_key: '', import_exposure: 'rendah' },      // 1.600
  ]

  it('computeHpp menjumlah qty x harga', () => {
    expect(computeHpp(rows)).toBe(10_000)
  })

  it('marginPct & priceForMargin konsisten bolak-balik', () => {
    const price = priceForMargin(10_000, 30) // margin 30%
    expect(marginPct(price, 10_000)).toBeCloseTo(30, 5)
  })

  it('applyMacroScenario hanya menaikkan bahan yang ter-mapping', () => {
    const sig = { terigu: { est_pct_min: 10, est_pct_max: 10 } }
    const { base, min, max } = applyMacroScenario(rows, sig)
    expect(base).toBe(10_000)
    expect(min).toBe(10_240) // hanya terigu naik 10%: 2.400 -> 2.640
    expect(max).toBe(10_240)
  })

  it('applyKursScenario memakai faktor keterpaparan impor', () => {
    const { base, next } = applyKursScenario(rows, 10) // rupiah melemah 10%
    // terigu (tinggi, 0.7): 2400 * 1.07 = 2568 ; telur (rendah, 0.1): 6000 * 1.01 = 6060 ; lainnya 1600 * 1.01 = 1616
    expect(base).toBe(10_000)
    expect(next).toBeCloseTo(2_568 + 6_060 + 1_616, 5)
  })

  it('applyAdjustments 0% tidak mengubah HPP', () => {
    expect(applyAdjustments(rows, () => 0)).toBe(10_000)
  })
})
