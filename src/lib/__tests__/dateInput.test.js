import { describe, it, expect } from 'vitest'
import { bersihkanTanggal, BATAS_DATE, BATAS_DATETIME, BATAS_MONTH, TAHUN_MIN, TAHUN_MAX } from '../dateInput'

describe('bersihkanTanggal', () => {
  it('membiarkan tanggal yang sudah benar apa adanya', () => {
    expect(bersihkanTanggal('2026-08-07')).toBe('2026-08-07')
    expect(bersihkanTanggal('2026-08-07T14:30')).toBe('2026-08-07T14:30')
    expect(bersihkanTanggal('2026-08')).toBe('2026-08')
  })

  it('memotong tahun lebih dari 4 digit — inti dari aturan YYYY', () => {
    // Ruas tahun <input type="date"> di Chrome menerima sampai 6 digit.
    expect(bersihkanTanggal('20266-08-07')).toBe('2026-08-07')
    expect(bersihkanTanggal('202608-01-01')).toBe('2026-01-01')
  })

  it('menjepit tahun ke rentang yang masuk akal', () => {
    expect(bersihkanTanggal('0001-03-04')).toBe(`${TAHUN_MIN}-03-04`)
    expect(bersihkanTanggal('9999-03-04')).toBe(`${TAHUN_MAX}-03-04`)
  })

  it('membatasi bulan ke 2 digit dan rentang 1–12', () => {
    expect(bersihkanTanggal('2026-133-07')).toBe('2026-12-07')
    expect(bersihkanTanggal('2026-00-07')).toBe('2026-01-07')
  })

  it('membatasi hari ke 2 digit dan rentang 1–31', () => {
    expect(bersihkanTanggal('2026-08-077')).toBe('2026-08-07')
    expect(bersihkanTanggal('2026-08-99')).toBe('2026-08-31')
    expect(bersihkanTanggal('2026-08-00')).toBe('2026-08-01')
  })

  it('mempertahankan bagian jam pada datetime-local', () => {
    expect(bersihkanTanggal('20266-08-07T09:05')).toBe('2026-08-07T09:05')
  })

  it('mengembalikan string kosong untuk nilai kosong — mengosongkan tanggal itu sah', () => {
    expect(bersihkanTanggal('')).toBe('')
    expect(bersihkanTanggal(null)).toBe('')
    expect(bersihkanTanggal(undefined)).toBe('')
  })

  it('tidak melempar untuk masukan sampah', () => {
    expect(() => bersihkanTanggal('bukan-tanggal')).not.toThrow()
    expect(bersihkanTanggal('abc')).toBe('')
  })
})

describe('konstanta batas', () => {
  it('memakai pola nilai yang diterima masing-masing tipe input', () => {
    expect(BATAS_DATE.min).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(BATAS_DATE.max).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(BATAS_DATETIME.min).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    expect(BATAS_MONTH.max).toMatch(/^\d{4}-\d{2}$/)
  })
})
