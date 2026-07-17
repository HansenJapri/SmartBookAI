// ============================================================
// KPI KARYAWAN — helper murni (tanpa jaringan), deterministik & mudah diuji.
// Skor 0-100 per kriteria; total = rata-rata tertimbang bobot kriteria
// yang PUNYA skor (kriteria tanpa skor tidak menyeret total ke bawah).
// ============================================================

export const KPI_SOURCES = [
  { key: 'kehadiran', label: 'Otomatis: Kehadiran', desc: 'Dihitung dari absensi periode tsb' },
  { key: 'tugas', label: 'Otomatis: Tugas', desc: 'Dihitung dari Papan Tugas periode tsb' },
  { key: 'manual', label: 'Manual', desc: 'Diisi sendiri (0-100)' },
]

const clamp100 = (n) => Math.max(0, Math.min(100, Number(n) || 0))

// Skor kehadiran dari rekap absensi: hadir & cuti tidak menghukum,
// izin/sakit setengah, alpa nol. Tanpa catatan absensi -> null (belum dinilai).
export function attendanceScore(recap) {
  const r = recap || {}
  const hadir = Number(r.hadir) || 0
  const izin = Number(r.izin) || 0
  const sakit = Number(r.sakit) || 0
  const cuti = Number(r.cuti) || 0
  const alpa = Number(r.alpa) || 0
  const total = hadir + izin + sakit + cuti + alpa
  if (total <= 0) return null
  const efektif = hadir + cuti + 0.5 * (izin + sakit)
  const dasar = total - 0 // semua hari tercatat jadi pembagi
  return Math.round(clamp100((efektif / dasar) * 100))
}

// Skor tugas dari Papan Tugas: % tugas selesai dari tugas yang ditugaskan
// ke karyawan tsb dan jatuh tempo/selesai pada periode itu; selesai
// terlambat dihargai setengah. Tanpa tugas -> null (kriteria dilewati).
export function taskScore(tasks, employeeId, period) {
  const inPeriod = (d) => typeof d === 'string' && d.slice(0, 7) === period
  const list = (tasks || []).filter((t) =>
    t.assignee_id === employeeId &&
    (inPeriod(t.due_date) || inPeriod(String(t.done_at || '').slice(0, 10))))
  if (!list.length) return null
  let poin = 0
  for (const t of list) {
    if (t.status !== 'selesai') continue
    const telat = t.due_date && t.done_at && String(t.done_at).slice(0, 10) > t.due_date
    poin += telat ? 0.5 : 1
  }
  return Math.round(clamp100((poin / list.length) * 100))
}

// Total tertimbang: hanya kriteria aktif yang punya skor (bukan null).
// Bobot dinormalkan terhadap jumlah bobot kriteria yang ikut dihitung.
export function weightedTotal(criteria, scoreByCriteria) {
  let sumW = 0
  let sum = 0
  for (const c of criteria || []) {
    if (c.active === false) continue
    const s = scoreByCriteria?.[c.id]
    if (s === null || s === undefined || s === '') continue
    const w = Number(c.weight) || 0
    if (w <= 0) continue
    sumW += w
    sum += clamp100(s) * w
  }
  if (sumW <= 0) return null
  return Math.round(sum / sumW)
}

// Jenjang bonus/potongan: baris dengan min_score TERTINGGI yang terlampaui.
// Skor null -> tidak ada jenjang yang berlaku.
export function applyBonusTier(rules, totalScore) {
  if (totalScore === null || totalScore === undefined) return null
  const sorted = [...(rules || [])].sort((a, b) => Number(b.min_score) - Number(a.min_score))
  for (const r of sorted) {
    if (Number(totalScore) >= Number(r.min_score)) {
      return { rule: r, bonus: Math.round(Number(r.bonus) || 0), deduction: Math.round(Number(r.deduction) || 0) }
    }
  }
  return null
}

// Efek aturan absensi terhadap gaji: Σ (jumlah hari status × aturan per hari).
// Mengembalikan { bonus, deduction, detail[] } — detail untuk catatan gaji.
export function attendanceAdjustments(recap, rules) {
  const out = { bonus: 0, deduction: 0, detail: [] }
  const byStatus = {}
  for (const r of rules || []) byStatus[r.status] = r
  for (const [status, hari] of Object.entries(recap || {})) {
    const n = Number(hari) || 0
    const rule = byStatus[status]
    if (!n || !rule) continue
    const b = Math.round(n * (Number(rule.bonus_per_day) || 0))
    const d = Math.round(n * (Number(rule.deduction_per_day) || 0))
    if (b > 0) { out.bonus += b; out.detail.push(`bonus ${status} ${n} hari`) }
    if (d > 0) { out.deduction += d; out.detail.push(`potongan ${status} ${n} hari`) }
  }
  return out
}

// Rekap absensi per karyawan dari baris attendance mentah.
export function recapAttendance(attRows, employeeId) {
  const rc = { hadir: 0, izin: 0, sakit: 0, cuti: 0, alpa: 0 }
  for (const a of attRows || []) {
    if (a.employee_id !== employeeId) continue
    if (rc[a.status] !== undefined) rc[a.status]++
  }
  return rc
}

// Kriteria bawaan saat pengguna pertama kali membuka halaman KPI.
export const DEFAULT_CRITERIA = [
  { name: 'Kehadiran', weight: 40, source: 'kehadiran' },
  { name: 'Penyelesaian Tugas', weight: 30, source: 'tugas' },
  { name: 'Penilaian Pemilik', weight: 30, source: 'manual' },
]
