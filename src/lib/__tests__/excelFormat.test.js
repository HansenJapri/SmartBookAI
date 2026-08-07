import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import {
  NUMFMT_RUPIAH, formatRibuan, formatRibuanDesimal, terapkanFormatRibuan, sheetRibuan,
} from '../excelFormat'

describe('formatRibuan', () => {
  it('memberi titik setiap tiga digit dari belakang', () => {
    expect(formatRibuan(1200000)).toBe('1.200.000')
    expect(formatRibuan(12000)).toBe('12.000')
    expect(formatRibuan(999)).toBe('999')
    expect(formatRibuan(1000)).toBe('1.000')
  })

  it('membulatkan pecahan dan menangani negatif', () => {
    expect(formatRibuan(1200000.6)).toBe('1.200.001')
    expect(formatRibuan(-2500000)).toBe('-2.500.000')
  })

  it('mengembalikan "0" untuk nilai yang bukan angka', () => {
    for (const nilai of [null, undefined, '', 'abc', NaN, Infinity]) {
      expect(formatRibuan(nilai)).toBe('0')
    }
  })

  it('versi desimal memakai koma sebagai pemisah desimal (gaya Indonesia)', () => {
    expect(formatRibuanDesimal(1200000.5)).toBe('1.200.000,5')
    expect(formatRibuanDesimal(12.345, 2)).toBe('12,35')
  })
})

describe('terapkanFormatRibuan', () => {
  it('menstempel format Indonesia pada sel angka saja', () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Label', 'Nilai'],
      ['Total Pendapatan', 2330500],
      ['Laba Bersih', 1484000],
    ])
    terapkanFormatRibuan(ws)

    expect(ws.B2.z).toBe(NUMFMT_RUPIAH)
    expect(ws.B3.z).toBe(NUMFMT_RUPIAH)
    // sel teks tidak boleh ikut diberi format angka
    expect(ws.A1.z).toBeUndefined()
    expect(ws.A2.z).toBeUndefined()
  })

  it('tidak menyentuh properti sheet (kunci berawalan "!")', () => {
    const ws = XLSX.utils.aoa_to_sheet([['a', 1]])
    ws['!cols'] = [{ wch: 10 }]
    expect(() => terapkanFormatRibuan(ws)).not.toThrow()
    expect(ws['!cols']).toEqual([{ wch: 10 }])
  })

  it('nilai sel tetap ANGKA agar SUM di Excel tetap bekerja', () => {
    const ws = sheetRibuan(XLSX, [['Nominal'], [1200000]])
    expect(ws.A2.t).toBe('n')
    expect(ws.A2.v).toBe(1200000)
    expect(ws.A2.z).toBe(NUMFMT_RUPIAH)
  })

  it('format yang tersimpan memakai penanda lokal Indonesia', () => {
    // Tanpa [$-421], Excel berbahasa Inggris merender 1,200,000 — bukan yang diminta.
    expect(NUMFMT_RUPIAH).toContain('[$-421]')
  })
})

describe('sheetRibuan', () => {
  it('mengatur lebar kolom sekaligus format angka', () => {
    const ws = sheetRibuan(XLSX, [['A', 'B'], ['x', 5000]], [{ wch: 20 }, { wch: 12 }])
    expect(ws['!cols']).toEqual([{ wch: 20 }, { wch: 12 }])
    expect(ws.B2.z).toBe(NUMFMT_RUPIAH)
  })
})
