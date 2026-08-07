import { describe, it, expect } from 'vitest'
import { attendanceScore, recapAttendance, weightedTotal } from '../kpi'

// P17 — kehadiran, keterlambatan, dan cuti harus terhubung otomatis ke skor
// kehadiran pada KPI karyawan.

const absen = (employee_id, status, date) => ({ employee_id, status, date })

describe('recapAttendance', () => {
  it('menghitung per status hanya untuk karyawan yang diminta', () => {
    const rows = [
      absen('a', 'hadir', '2026-08-01'),
      absen('a', 'hadir', '2026-08-02'),
      absen('a', 'alpa', '2026-08-03'),
      absen('b', 'hadir', '2026-08-01'),
    ]
    expect(recapAttendance(rows, 'a')).toEqual({ hadir: 2, izin: 0, sakit: 0, cuti: 0, alpa: 1 })
    expect(recapAttendance(rows, 'b')).toEqual({ hadir: 1, izin: 0, sakit: 0, cuti: 0, alpa: 0 })
  })

  it('mengabaikan status yang tidak dikenal, bukan melempar', () => {
    expect(recapAttendance([absen('a', 'entah', '2026-08-01')], 'a'))
      .toEqual({ hadir: 0, izin: 0, sakit: 0, cuti: 0, alpa: 0 })
  })
})

describe('attendanceScore', () => {
  it('hadir penuh = 100', () => {
    expect(attendanceScore({ hadir: 20 })).toBe(100)
  })

  it('cuti tidak menghukum — cuti adalah hak, bukan pelanggaran', () => {
    expect(attendanceScore({ hadir: 18, cuti: 2 })).toBe(100)
  })

  it('izin & sakit dihitung setengah', () => {
    // (8 + 0.5*2) / 10 = 90
    expect(attendanceScore({ hadir: 8, izin: 1, sakit: 1 })).toBe(90)
  })

  it('alpa menekan skor penuh', () => {
    // 8 / 10 = 80
    expect(attendanceScore({ hadir: 8, alpa: 2 })).toBe(80)
    expect(attendanceScore({ alpa: 5 })).toBe(0)
  })

  it('tanpa catatan absensi mengembalikan null, bukan 0', () => {
    // 0 berarti "hadir nol hari"; null berarti "belum ada datanya". Membedakan
    // keduanya penting karena kriteria tanpa skor dilewati dari bobot total.
    expect(attendanceScore({})).toBe(null)
    expect(attendanceScore(null)).toBe(null)
    expect(attendanceScore({ hadir: 0, izin: 0, sakit: 0, cuti: 0, alpa: 0 })).toBe(null)
  })
})

describe('weightedTotal melewati kriteria tanpa skor', () => {
  it('bobot dinormalkan ke kriteria yang punya skor saja', () => {
    const criteria = [
      { id: 'k', weight: 40 },   // kehadiran
      { id: 't', weight: 30 },   // tugas — belum ada data
      { id: 'm', weight: 30 },   // manual
    ]
    // Hanya kehadiran (80) & manual (100) yang punya skor -> (80*40 + 100*30) / 70
    const total = weightedTotal(criteria, { k: 80, t: null, m: 100 })
    expect(total).toBe(Math.round((80 * 40 + 100 * 30) / 70))
  })

  it('semua kriteria tanpa skor menghasilkan null (belum dinilai), bukan 0 atau NaN', () => {
    // Membedakan "belum dinilai" dari "nilainya nol" penting: jenjang bonus
    // dibaca dari angka ini, dan 0 akan memicu potongan untuk karyawan yang
    // sebenarnya belum pernah dinilai sama sekali.
    expect(weightedTotal([{ id: 'a', weight: 50 }], { a: null })).toBe(null)
  })
})
