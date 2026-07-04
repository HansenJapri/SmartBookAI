import { monthKey } from './format'

// ---------- DETEKSI DUPLIKAT / REKONSILIASI ----------
// Dua transaksi dianggap kandidat duplikat bila: arah sama, nominal sama,
// dan selisih waktu <= toleransi (default 1 hari). Berguna saat 1 transaksi
// masuk dari 2 channel (mis. notif WA + mutasi bank).
export function findDuplicateGroups(transactions, toleranceHours = 24) {
  const tolMs = toleranceHours * 3600 * 1000
  const sorted = [...transactions].sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at))
  const used = new Set()
  const groups = []

  for (let i = 0; i < sorted.length; i++) {
    if (used.has(sorted[i].id)) continue
    const group = [sorted[i]]
    for (let j = i + 1; j < sorted.length; j++) {
      if (used.has(sorted[j].id)) continue
      const a = sorted[i], b = sorted[j]
      const sameAmount = Math.abs(Number(a.amount) - Number(b.amount)) < 1
      const sameDir = a.direction === b.direction
      const dt = Math.abs(new Date(a.occurred_at) - new Date(b.occurred_at))
      if (sameAmount && sameDir && dt <= tolMs) group.push(b)
    }
    if (group.length > 1) {
      group.forEach((g) => used.add(g.id))
      groups.push(group)
    }
  }
  return groups
}

// ---------- RINGKASAN ----------
export function summarize(transactions) {
  let income = 0, expense = 0
  for (const t of transactions) {
    if (t.dismissed_dup) {} // tetap dihitung
    if (t.direction === 'in') income += Number(t.amount)
    else expense += Number(t.amount)
  }
  return { income, expense, profit: income - expense, count: transactions.length }
}

export function isSameDay(a, b) {
  const x = new Date(a), y = new Date(b)
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate()
}

export function todaySummary(transactions) {
  const now = new Date()
  const today = transactions.filter((t) => isSameDay(t.occurred_at, now))
  return summarize(today)
}

// Tren N hari terakhir untuk chart
export function trendDaily(transactions, days = 14) {
  const out = []
  const dayNames = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab']
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i)
    const dayTx = transactions.filter((t) => isSameDay(t.occurred_at, d))
    const { income, expense } = summarize(dayTx)
    out.push({
      label: `${d.getDate()}/${d.getMonth() + 1}`,
      hari: dayNames[d.getDay()],
      omzet: Math.round(income),
      pengeluaran: Math.round(expense),
      profit: Math.round(income - expense),
    })
  }
  return out
}

// Distribusi per channel (pemasukan)
export function channelMix(transactions) {
  const palette = {
    qris: '#4f46e5', bank: '#0ea5e9', marketplace: '#f97316', wa: '#16a34a',
    email: '#a855f7', struk: '#eab308', manual: '#64748b',
    shopee: '#f97316', tokopedia: '#16a34a', tiktok: '#0f172a', lazada: '#2563eb', blibli: '#f59e0b',
  }
  const labels = {
    qris: 'QRIS', bank: 'Bank', marketplace: 'Marketplace', wa: 'WhatsApp',
    email: 'Email', struk: 'Struk', manual: 'Manual',
    shopee: 'Shopee', tokopedia: 'Tokopedia', tiktok: 'TikTok Shop', lazada: 'Lazada', blibli: 'Blibli',
  }
  const map = {}
  for (const t of transactions) {
    if (t.direction !== 'in') continue
    map[t.channel] = (map[t.channel] || 0) + Number(t.amount)
  }
  return Object.entries(map)
    .map(([k, v]) => ({ name: labels[k] || k, value: Math.round(v), color: palette[k] || '#94a3b8' }))
    .sort((a, b) => b.value - a.value)
}

// Pengeluaran per kategori
export function expenseByCategory(transactions) {
  const map = {}
  for (const t of transactions) {
    if (t.direction !== 'out') continue
    map[t.category] = (map[t.category] || 0) + Number(t.amount)
  }
  return Object.entries(map).map(([name, value]) => ({ name, value: Math.round(value) }))
    .sort((a, b) => b.value - a.value)
}

// ---------- PERHITUNGAN PAJAK (PPh Final UMKM, sesuai UU) ----------
// Dasar hukum: PP No. 55 Tahun 2022 & UU No. 7 Tahun 2021 (UU HPP).
export const TAX = {
  RATE: 0.005,                 // tarif PPh Final UMKM 0,5%
  OMZET_BEBAS_PAJAK: 500_000_000,   // WP Orang Pribadi: omzet s.d. Rp 500 jt/th tidak kena pajak
  BATAS_FINAL: 4_800_000_000,  // batas peredaran bruto untuk skema final 0,5%/tahun
}

// Pajak per tahun atas total peredaran bruto setahun
export function taxYearly(annualTurnover, taxpayerType = 'pribadi') {
  const eligibleFinal = annualTurnover <= TAX.BATAS_FINAL
  const exemption = taxpayerType === 'pribadi' ? TAX.OMZET_BEBAS_PAJAK : 0
  const taxable = Math.max(0, annualTurnover - exemption)
  const pph = eligibleFinal ? Math.round(taxable * TAX.RATE) : 0
  return { eligibleFinal, exemption, taxable, pph, rate: TAX.RATE, annualTurnover, taxpayerType }
}

// Pajak per bulan dengan batas bebas pajak Rp 500 jt berjalan (kumulatif per tahun) untuk WP pribadi
// monthlyArr: [{ month: 'YYYY-MM', income }]
export function monthlyTaxRows(monthlyArr, taxpayerType = 'pribadi') {
  const exemptionPerYear = taxpayerType === 'pribadi' ? TAX.OMZET_BEBAS_PAJAK : 0
  const remaining = {}
  return [...monthlyArr]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((m) => {
      const year = m.month.slice(0, 4)
      if (remaining[year] === undefined) remaining[year] = exemptionPerYear
      const income = Number(m.income) || 0
      const exemptApplied = Math.min(remaining[year], income)
      remaining[year] -= exemptApplied
      const taxable = income - exemptApplied
      return { month: m.month, income, exemptApplied, taxable, pph: Math.round(taxable * TAX.RATE) }
    })
}

// Total peredaran bruto & pajak untuk rentang tahun tertentu (atau seluruhnya)
export function taxSummaryForYear(monthlyArr, year, taxpayerType = 'pribadi') {
  const inYear = year === 'all' ? monthlyArr : monthlyArr.filter((m) => m.month.startsWith(year))
  const annualTurnover = inYear.reduce((s, m) => s + (Number(m.income) || 0), 0)
  const rows = monthlyTaxRows(inYear, taxpayerType)
  const pphTotal = rows.reduce((s, r) => s + r.pph, 0)
  const base = taxYearly(annualTurnover, taxpayerType)
  return { ...base, pphTotal, rows }
}

// Rekap bulanan untuk laporan
export function monthlyBreakdown(transactions) {
  const map = {}
  for (const t of transactions) {
    const k = monthKey(t.occurred_at)
    if (!map[k]) map[k] = { month: k, income: 0, expense: 0 }
    if (t.direction === 'in') map[k].income += Number(t.amount)
    else map[k].expense += Number(t.amount)
  }
  return Object.values(map).sort((a, b) => a.month.localeCompare(b.month))
    .map((m) => ({ ...m, profit: m.income - m.expense }))
}
