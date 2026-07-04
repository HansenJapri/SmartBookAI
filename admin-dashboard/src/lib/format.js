export const rupiah = (n) => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID')

export const rupiahShort = (n) => {
  const v = Number(n) || 0
  if (Math.abs(v) >= 1_000_000_000) return 'Rp ' + (v / 1_000_000_000).toFixed(1).replace('.0', '') + ' M'
  if (Math.abs(v) >= 1_000_000) return 'Rp ' + (v / 1_000_000).toFixed(1).replace('.0', '') + ' jt'
  if (Math.abs(v) >= 1_000) return 'Rp ' + Math.round(v / 1_000) + ' rb'
  return 'Rp ' + Math.round(v)
}

export const num = (n) => (Number(n) || 0).toLocaleString('id-ID')

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']

export const fmtDate = (d) => {
  if (!d) return '-'
  const date = new Date(d)
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`
}

export const fmtDateTime = (d) => {
  if (!d) return '-'
  const date = new Date(d)
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${fmtDate(d)} · ${hh}:${mm}`
}

export const timeAgo = (d) => {
  if (!d) return '-'
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000)
  if (s < 60) return 'baru saja'
  if (s < 3600) return `${Math.floor(s / 60)} mnt lalu`
  if (s < 86400) return `${Math.floor(s / 3600)} jam lalu`
  if (s < 2592000) return `${Math.floor(s / 86400)} hari lalu`
  return fmtDate(d)
}

export const dayKey = (d) => new Date(d).toISOString().slice(0, 10)
