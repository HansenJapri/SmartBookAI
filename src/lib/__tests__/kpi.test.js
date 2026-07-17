import { describe, it, expect } from 'vitest'
import {
  attendanceScore, taskScore, weightedTotal, applyBonusTier,
  attendanceAdjustments, recapAttendance,
} from '../kpi'

describe('attendanceScore', () => {
  it('hadir & cuti penuh, izin/sakit setengah, alpa nol', () => {
    expect(attendanceScore({ hadir: 20, izin: 0, sakit: 0, cuti: 0, alpa: 0 })).toBe(100)
    expect(attendanceScore({ hadir: 10, izin: 0, sakit: 0, cuti: 0, alpa: 10 })).toBe(50)
    expect(attendanceScore({ hadir: 18, izin: 2, sakit: 0, cuti: 0, alpa: 0 })).toBe(95)
    expect(attendanceScore({ hadir: 18, izin: 0, sakit: 0, cuti: 2, alpa: 0 })).toBe(100)
  })
  it('tanpa catatan absensi -> null (belum bisa dinilai)', () => {
    expect(attendanceScore({})).toBe(null)
    expect(attendanceScore(null)).toBe(null)
  })
})

describe('taskScore', () => {
  const P = '2026-07'
  const tasks = [
    { assignee_id: 'a', status: 'selesai', due_date: '2026-07-10', done_at: '2026-07-09T10:00:00Z' },
    { assignee_id: 'a', status: 'selesai', due_date: '2026-07-05', done_at: '2026-07-08T10:00:00Z' }, // telat
    { assignee_id: 'a', status: 'antre', due_date: '2026-07-20' },
    { assignee_id: 'b', status: 'selesai', due_date: '2026-07-10', done_at: '2026-07-10T10:00:00Z' },
    { assignee_id: 'a', status: 'selesai', due_date: '2026-06-10', done_at: '2026-06-10T10:00:00Z' }, // periode lain
  ]
  it('selesai tepat=1, telat=0.5, belum selesai=0; hanya periode & karyawan tsb', () => {
    // a: tepat(1) + telat(0.5) + belum(0) dari 3 tugas = 50%
    expect(taskScore(tasks, 'a', P)).toBe(50)
    expect(taskScore(tasks, 'b', P)).toBe(100)
  })
  it('tanpa tugas pada periode -> null (kriteria dilewati)', () => {
    expect(taskScore(tasks, 'c', P)).toBe(null)
    expect(taskScore([], 'a', P)).toBe(null)
  })
})

describe('weightedTotal', () => {
  const criteria = [
    { id: 'k1', weight: 40, active: true },
    { id: 'k2', weight: 30, active: true },
    { id: 'k3', weight: 30, active: true },
  ]
  it('rata-rata tertimbang biasa', () => {
    expect(weightedTotal(criteria, { k1: 100, k2: 50, k3: 0 })).toBe(55)
  })
  it('kriteria tanpa skor tidak ikut membagi (bobot dinormalkan)', () => {
    expect(weightedTotal(criteria, { k1: 80, k2: null, k3: undefined })).toBe(80)
    expect(weightedTotal(criteria, { k1: 100, k3: 50 })).toBe(Math.round((100 * 40 + 50 * 30) / 70))
  })
  it('kriteria nonaktif diabaikan; tanpa skor sama sekali -> null', () => {
    expect(weightedTotal([{ id: 'x', weight: 100, active: false }], { x: 90 })).toBe(null)
    expect(weightedTotal(criteria, {})).toBe(null)
  })
})

describe('applyBonusTier', () => {
  const rules = [
    { min_score: 90, bonus: 300000, deduction: 0, label: 'Sangat baik' },
    { min_score: 75, bonus: 100000, deduction: 0 },
    { min_score: 0, bonus: 0, deduction: 150000, label: 'Perlu perbaikan' },
  ]
  it('jenjang min_score tertinggi yang terlampaui yang berlaku', () => {
    expect(applyBonusTier(rules, 95).bonus).toBe(300000)
    expect(applyBonusTier(rules, 80).bonus).toBe(100000)
    expect(applyBonusTier(rules, 40).deduction).toBe(150000)
  })
  it('skor null atau aturan kosong -> null', () => {
    expect(applyBonusTier(rules, null)).toBe(null)
    expect(applyBonusTier([], 80)).toBe(null)
  })
})

describe('attendanceAdjustments', () => {
  const rules = [
    { status: 'alpa', bonus_per_day: 0, deduction_per_day: 50000 },
    { status: 'hadir', bonus_per_day: 10000, deduction_per_day: 0 },
  ]
  it('Σ hari x aturan per hari, dengan rincian teks', () => {
    const r = attendanceAdjustments({ hadir: 20, alpa: 2, izin: 1 }, rules)
    expect(r.bonus).toBe(200000)
    expect(r.deduction).toBe(100000)
    expect(r.detail.join(' ')).toContain('alpa 2 hari')
  })
  it('tanpa aturan -> nol', () => {
    expect(attendanceAdjustments({ alpa: 5 }, [])).toEqual({ bonus: 0, deduction: 0, detail: [] })
  })
})

describe('recapAttendance', () => {
  it('menghitung per status milik karyawan tsb saja', () => {
    const rows = [
      { employee_id: 'a', status: 'hadir' }, { employee_id: 'a', status: 'alpa' },
      { employee_id: 'b', status: 'hadir' },
    ]
    expect(recapAttendance(rows, 'a')).toEqual({ hadir: 1, izin: 0, sakit: 0, cuti: 0, alpa: 1 })
  })
})
