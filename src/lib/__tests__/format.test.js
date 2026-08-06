// ============================================================
// format.js — pemformat yang dipakai di hampir setiap layar angka.
// rupiahShort dan monthKey sebelumnya tidak tersentuh test mana pun.
//
// Pemformat terasa sepele sampai ia salah: "Rp 1,5 jt" yang seharusnya
// "Rp 15 jt" tidak memicu error apa pun — ia hanya tampil, dan pemilik usaha
// mengambil keputusan dari angka itu.
// ============================================================
import { describe, it, expect } from 'vitest'
import { rupiah, rupiahShort, fmtDate, fmtDateTime, toDateInput, monthKey } from '../format'

describe('rupiah', () => {
  it('memberi pemisah ribuan gaya Indonesia (titik)', () => {
    expect(rupiah(1500000)).toBe('Rp 1.500.000')
    expect(rupiah(1000)).toBe('Rp 1.000')
    expect(rupiah(0)).toBe('Rp 0')
  })

  it('membulatkan pecahan ke rupiah terdekat', () => {
    expect(rupiah(1000.4)).toBe('Rp 1.000')
    expect(rupiah(1000.6)).toBe('Rp 1.001')
  })

  it('memperlakukan nilai non-angka sebagai 0, bukan "Rp NaN"', () => {
    expect(rupiah('abc')).toBe('Rp 0')
    expect(rupiah(null)).toBe('Rp 0')
    expect(rupiah(undefined)).toBe('Rp 0')
    expect(rupiah(NaN)).toBe('Rp 0')
  })

  it('menampilkan nominal negatif dengan tanda minus', () => {
    expect(rupiah(-50000)).toBe('Rp -50.000')
  })
})

describe('rupiahShort', () => {
  it('meringkas jutaan dengan satu desimal', () => {
    expect(rupiahShort(1500000)).toBe('Rp 1.5 jt')
    expect(rupiahShort(15000000)).toBe('Rp 15 jt')
  })

  it('membuang desimal nol agar tidak jadi "Rp 2.0 jt"', () => {
    expect(rupiahShort(2000000)).toBe('Rp 2 jt')
  })

  it('meringkas ribuan tanpa desimal', () => {
    expect(rupiahShort(45000)).toBe('Rp 45 rb')
    expect(rupiahShort(1000)).toBe('Rp 1 rb')
  })

  it('menampilkan angka apa adanya di bawah seribu', () => {
    expect(rupiahShort(999)).toBe('Rp 999')
    expect(rupiahShort(0)).toBe('Rp 0')
  })

  it('memakai nilai mutlak untuk memilih satuan, tanda tetap terbawa', () => {
    expect(rupiahShort(-2000000)).toBe('Rp -2 jt')
    expect(rupiahShort(-45000)).toBe('Rp -45 rb')
  })

  it('tepat di ambang satu juta memakai satuan juta', () => {
    expect(rupiahShort(1000000)).toBe('Rp 1 jt')
    expect(rupiahShort(999999)).toBe('Rp 1000 rb')
  })

  it('memperlakukan nilai non-angka sebagai 0', () => {
    expect(rupiahShort('abc')).toBe('Rp 0')
    expect(rupiahShort(null)).toBe('Rp 0')
  })
})

describe('fmtDate & fmtDateTime', () => {
  it('memakai nama bulan singkat Bahasa Indonesia', () => {
    expect(fmtDate('2026-08-05T10:30:00')).toBe('5 Agu 2026')
    expect(fmtDate('2026-01-01T00:00:00')).toBe('1 Jan 2026')
    expect(fmtDate('2026-12-31T00:00:00')).toBe('31 Des 2026')
  })

  it('memakai "Mei" dan "Okt", bukan ejaan Inggris', () => {
    expect(fmtDate('2026-05-10T00:00:00')).toBe('10 Mei 2026')
    expect(fmtDate('2026-10-10T00:00:00')).toBe('10 Okt 2026')
  })

  it('fmtDateTime menambahkan jam dengan nol di depan', () => {
    expect(fmtDateTime('2026-08-05T09:05:00')).toBe('5 Agu 2026 · 09:05')
    expect(fmtDateTime('2026-08-05T23:59:00')).toBe('5 Agu 2026 · 23:59')
  })
})

describe('toDateInput', () => {
  it('menghasilkan format yang diterima <input type="datetime-local">', () => {
    expect(toDateInput('2026-08-05T10:30:00')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  })

  it('mempertahankan jam LOKAL, bukan menggeser ke UTC', () => {
    // Kalau offset zona waktu tidak dikompensasi, transaksi pukul 07.00 WIB
    // tampil sebagai 00.00 di form edit — dan tersimpan salah saat disubmit.
    expect(toDateInput('2026-08-05T10:30:00')).toBe('2026-08-05T10:30')
  })

  it('memakai waktu sekarang bila argumen kosong', () => {
    expect(toDateInput()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  })
})

describe('monthKey', () => {
  it('menghasilkan kunci YYYY-MM untuk pengelompokan bulanan', () => {
    expect(monthKey('2026-08-05T10:30:00')).toBe('2026-08')
  })

  it('memberi nol di depan untuk bulan satu digit', () => {
    expect(monthKey('2026-01-15T00:00:00')).toBe('2026-01')
    expect(monthKey('2026-09-30T00:00:00')).toBe('2026-09')
  })

  it('konsisten untuk dua tanggal di bulan yang sama', () => {
    expect(monthKey('2026-03-01T00:00:00')).toBe(monthKey('2026-03-31T23:59:00'))
  })
})
