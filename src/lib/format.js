export const rupiah = (n) => {
  const v = Number(n) || 0
  return 'Rp ' + Math.round(v).toLocaleString('id-ID')
}

export const rupiahShort = (n) => {
  const v = Number(n) || 0
  if (Math.abs(v) >= 1_000_000) return 'Rp ' + (v / 1_000_000).toFixed(1).replace('.0', '') + ' jt'
  if (Math.abs(v) >= 1_000) return 'Rp ' + Math.round(v / 1_000) + ' rb'
  return 'Rp ' + v
}

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']

export const fmtDate = (d) => {
  const date = new Date(d)
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`
}

export const fmtDateTime = (d) => {
  const date = new Date(d)
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${fmtDate(d)} · ${hh}:${mm}`
}

export const toDateInput = (d) => {
  const date = d ? new Date(d) : new Date()
  const off = date.getTimezoneOffset()
  return new Date(date.getTime() - off * 60000).toISOString().slice(0, 16)
}

export const monthKey = (d) => {
  const date = new Date(d)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}
