// ============================================================
// FASE 4 HR — helper murni (tanpa jaringan) untuk karyawan,
// absensi, dan penggajian. Semua angka deterministik.
// ============================================================

// Status absensi -> label & kelas badge.
export const ATTENDANCE_STATUS = [
  { key: 'hadir', label: 'Hadir', cls: 'badge-green' },
  { key: 'izin', label: 'Izin', cls: 'badge-indigo' },
  { key: 'sakit', label: 'Sakit', cls: 'badge-amber' },
  { key: 'cuti', label: 'Cuti', cls: 'badge-indigo' },
  { key: 'alpa', label: 'Alpa', cls: 'badge-red' },
]

export const SALARY_TYPES = [
  { key: 'bulanan', label: 'Bulanan (per bulan)' },
  { key: 'harian', label: 'Harian (per hari hadir)' },
]

// Periode 'YYYY-MM' bulan berjalan.
export function currentPeriod(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const MONTHS_ID = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']

export function periodLabel(period) {
  const [y, m] = String(period || '').split('-').map(Number)
  if (!y || !m || m < 1 || m > 12) return String(period || '')
  return `${MONTHS_ID[m - 1]} ${y}`
}

// Rentang tanggal (ISO) sebuah periode — untuk query absensi bulan tsb.
export function periodRange(period) {
  const [y, m] = String(period).split('-').map(Number)
  const last = new Date(y, m, 0).getDate() // hari terakhir bulan
  const mm = String(m).padStart(2, '0')
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, '0')}` }
}

// Jumlah hari HADIR dari baris absensi (status lain tidak dihitung upah harian).
export function countHadir(attRows, employeeId) {
  return (attRows || []).filter((a) => a.employee_id === employeeId && a.status === 'hadir').length
}

// Gaji pokok draf: bulanan = nominal tetap; harian = hari hadir x tarif.
export function buildPayrollBase(employee, hadirDays) {
  const amt = Number(employee?.salary_amount) || 0
  if (employee?.salary_type === 'harian') return Math.round(amt * (Number(hadirDays) || 0))
  return Math.round(amt)
}

// Total dibayar = pokok + bonus - potongan (tidak boleh negatif).
export function payrollTotal({ base_amount = 0, bonus = 0, deduction = 0 } = {}) {
  return Math.max(0, Math.round((Number(base_amount) || 0) + (Number(bonus) || 0) - (Number(deduction) || 0)))
}

export const PAYROLL_STATUS = {
  draft: { label: 'Draf', cls: 'badge-indigo' },
  paid: { label: 'Dibayar', cls: 'badge-green' },
}
