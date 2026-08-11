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

// Tanggal tak sah punya dua wujud kegagalan yang berbeda, dan keduanya nyata:
//   - fmtDate  -> months[NaN] = undefined, tabel menampilkan "NaN undefined NaN";
//   - toDateInput -> .toISOString() MELEMPAR RangeError, dan karena fungsi itu
//     dipanggil saat inisialisasi state komponen, lemparannya terjadi di tengah
//     RENDER — ditangkap ErrorBoundary dan mematikan halamannya.
// Satu nilai yang tidak terbaca dari database tidak boleh sanggup melakukan itu.
const sah = (d) => d instanceof Date && !Number.isNaN(d.getTime())

export const fmtDate = (d) => {
  const date = new Date(d)
  if (!sah(date)) return '—'
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`
}

export const fmtDateTime = (d) => {
  const date = new Date(d)
  if (!sah(date)) return '—'
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${fmtDate(d)} · ${hh}:${mm}`
}

export const toDateInput = (d) => {
  const diminta = d ? new Date(d) : new Date()
  // Jatuh ke waktu sekarang, bukan melempar: kolom tanggal yang terisi hari ini
  // bisa langsung diperbaiki pengguna, sedangkan halaman yang mati tidak.
  const date = sah(diminta) ? diminta : new Date()
  const off = date.getTimezoneOffset()
  return new Date(date.getTime() - off * 60000).toISOString().slice(0, 16)
}

export const monthKey = (d) => {
  const date = new Date(d)
  if (!sah(date)) return ''
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}
