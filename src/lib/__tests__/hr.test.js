import { describe, it, expect } from 'vitest'
import {
  currentPeriod, periodLabel, periodRange, countHadir, buildPayrollBase, payrollTotal,
} from '../hr'

describe('currentPeriod & periodLabel', () => {
  it('format YYYY-MM dan label bulan Indonesia', () => {
    expect(currentPeriod(new Date('2026-07-11'))).toBe('2026-07')
    expect(periodLabel('2026-07')).toBe('Juli 2026')
    expect(periodLabel('2026-01')).toBe('Januari 2026')
    expect(periodLabel('rusak')).toBe('rusak')
  })
})

describe('periodRange', () => {
  it('rentang tanggal penuh bulan tsb (termasuk kabisat)', () => {
    expect(periodRange('2026-07')).toEqual({ from: '2026-07-01', to: '2026-07-31' })
    expect(periodRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(periodRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' })
  })
})

describe('countHadir', () => {
  const rows = [
    { employee_id: 'a', status: 'hadir' },
    { employee_id: 'a', status: 'hadir' },
    { employee_id: 'a', status: 'sakit' },
    { employee_id: 'b', status: 'hadir' },
  ]
  it('hanya menghitung status hadir milik karyawan tsb', () => {
    expect(countHadir(rows, 'a')).toBe(2)
    expect(countHadir(rows, 'b')).toBe(1)
    expect(countHadir(rows, 'c')).toBe(0)
  })
})

describe('buildPayrollBase', () => {
  it('bulanan: nominal tetap, abaikan hari hadir', () => {
    expect(buildPayrollBase({ salary_type: 'bulanan', salary_amount: 2000000 }, 5)).toBe(2000000)
  })
  it('harian: tarif x hari hadir', () => {
    expect(buildPayrollBase({ salary_type: 'harian', salary_amount: 100000 }, 22)).toBe(2200000)
    expect(buildPayrollBase({ salary_type: 'harian', salary_amount: 100000 }, 0)).toBe(0)
  })
})

describe('payrollTotal', () => {
  it('pokok + bonus - potongan, tidak pernah negatif', () => {
    expect(payrollTotal({ base_amount: 2000000, bonus: 250000, deduction: 50000 })).toBe(2200000)
    expect(payrollTotal({ base_amount: 100000, bonus: 0, deduction: 500000 })).toBe(0)
    expect(payrollTotal({})).toBe(0)
  })
})
