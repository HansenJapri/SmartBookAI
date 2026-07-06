// ============================================================
// Mesin prediksi target penjualan — DETERMINISTIK (tanpa AI).
// Metode: indeks musiman hari-dalam-minggu + regresi linier OLS pada deret
// yang sudah dibersihkan musiman, lalu 3 skenario dari persentil residual.
// AI (Gemini) tidak pernah menghitung angka ini — sesuai prinsip PRD:
// kode berhitung, AI hanya menarasikan.
// ============================================================

const DAY_MS = 86400000

// Deret omzet harian (pemasukan) maksimal `maxDays` hari terakhir,
// dimulai dari transaksi pertama pengguna. Hari kosong diisi 0.
export function dailyIncomeSeries(transactions, maxDays = 90) {
  let first = null
  const map = {}
  for (const t of transactions) {
    if (t.direction !== 'in') continue
    const d = new Date(t.occurred_at)
    d.setHours(0, 0, 0, 0)
    if (!first || d < first) first = d
    map[d.getTime()] = (map[d.getTime()] || 0) + (Number(t.amount) || 0)
  }
  if (!first) return []
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const start = new Date(Math.max(today.getTime() - (maxDays - 1) * DAY_MS, first.getTime()))
  const days = Math.floor((today.getTime() - start.getTime()) / DAY_MS) + 1
  const series = []
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getTime() + i * DAY_MS)
    series.push({ date: d, dow: d.getDay(), y: map[d.getTime()] || 0 })
  }
  return series
}

// Indeks musiman per hari-dalam-minggu: rata-rata omzet hari itu / rata-rata umum.
// Menangkap pola akhir pekan yang kuat di UMKM. Hari tanpa data -> indeks 1.
export function dowIndex(series) {
  const sum = [0, 0, 0, 0, 0, 0, 0]
  const cnt = [0, 0, 0, 0, 0, 0, 0]
  let total = 0
  for (const p of series) {
    sum[p.dow] += p.y
    cnt[p.dow]++
    total += p.y
  }
  const overall = series.length ? total / series.length : 0
  return sum.map((s, i) => {
    if (!cnt[i] || overall <= 0) return 1
    const avg = s / cnt[i]
    const idx = avg / overall
    // Batasi agar satu hari ekstrem tidak mendistorsi (0.2x - 3x).
    return Math.min(3, Math.max(0.2, idx || 1))
  })
}

// Regresi linier kuadrat-terkecil sederhana: y = a + b x.
export function olsFit(ys) {
  const n = ys.length
  if (n < 2) return { a: ys[0] || 0, b: 0 }
  let sx = 0, sy = 0, sxx = 0, sxy = 0
  for (let x = 0; x < n; x++) {
    sx += x; sy += ys[x]; sxx += x * x; sxy += x * ys[x]
  }
  const denom = n * sxx - sx * sx
  const b = denom !== 0 ? (n * sxy - sx * sy) / denom : 0
  const a = (sy - b * sx) / n
  return { a, b }
}

export function percentile(values, p) {
  if (!values.length) return 0
  const sorted = [...values].sort((x, y) => x - y)
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx), hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

// Syarat aktivasi fitur prediksi (sesuai PRD): >= 14 hari histori & >= 10 transaksi.
export const MIN_DAYS = 14
export const MIN_TX = 10

// Bangun model lengkap. Mengembalikan { ready, ... } — jujur bila belum siap.
export function buildModel(transactions) {
  const txIn = transactions.filter((t) => t.direction === 'in')
  const series = dailyIncomeSeries(transactions)
  if (series.length < MIN_DAYS || txIn.length < MIN_TX) {
    return {
      ready: false,
      daysHave: series.length,
      daysNeed: MIN_DAYS,
      txHave: txIn.length,
      txNeed: MIN_TX,
    }
  }
  const idx = dowIndex(series)
  const deseason = series.map((p) => (idx[p.dow] > 0 ? p.y / idx[p.dow] : p.y))
  const { a, b } = olsFit(deseason)
  const residuals = deseason.map((y, x) => y - (a + b * x))
  const p25 = percentile(residuals, 0.25)
  const p75 = percentile(residuals, 0.75)
  const last14 = series.slice(-14)
  const avg14 = last14.reduce((s, p) => s + p.y, 0) / (last14.length || 1)
  return { ready: true, series, idx, a, b, p25, p75, avg14, n: series.length }
}

// Prediksi omzet 1 hari ke depan (t = n-1+ahead) untuk 1 skenario.
function predictDay(model, ahead, scenario) {
  const t = model.n - 1 + ahead
  const lastDate = model.series[model.series.length - 1].date
  const d = new Date(lastDate.getTime() + ahead * DAY_MS)
  const q = scenario === 'optimis' ? model.p75 : scenario === 'pesimis' ? model.p25 : 0
  const base = (model.a + model.b * t + q) * model.idx[d.getDay()]
  return { date: d, y: Math.max(0, base) }
}

// Kapan akumulasi omzet (sejak start_date target) menyentuh nominal target?
// Mengembalikan tanggal per skenario, atau null bila > horizon (365 hari).
export function forecastTarget(transactions, target) {
  const model = buildModel(transactions)
  const start = new Date((target.start_date || '') + 'T00:00:00')
  let achieved = 0
  for (const t of transactions) {
    if (t.direction === 'in' && new Date(t.occurred_at) >= start) achieved += Number(t.amount) || 0
  }
  const amount = Number(target.amount) || 0
  const progressPct = amount > 0 ? Math.min(999, Math.round((achieved / amount) * 100)) : 0
  const base = { achieved, amount, progressPct, model }

  if (!model.ready) return { ...base, ready: false }
  if (achieved >= amount) return { ...base, ready: true, done: true }

  const remaining = amount - achieved
  const scenarios = {}
  for (const s of ['optimis', 'realistis', 'pesimis']) {
    let cum = 0
    let hit = null
    for (let ahead = 1; ahead <= 365; ahead++) {
      cum += predictDay(model, ahead, s).y
      if (cum >= remaining) { hit = predictDay(model, ahead, s).date; break }
    }
    scenarios[s] = hit
  }
  // Kejujuran: bila tren datar/turun dan tak tercapai, hitung laju yang dibutuhkan.
  const trendDown = model.b <= 0
  const requiredDaily = target.deadline
    ? remaining / Math.max(1, Math.ceil((new Date(target.deadline + 'T23:59:59') - Date.now()) / DAY_MS))
    : null
  return { ...base, ready: true, done: false, scenarios, trendDown, requiredDaily, remaining }
}
