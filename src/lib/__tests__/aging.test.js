import { describe, it, expect } from 'vitest'
import {
  daysOutstanding, isOverdue, agingBucketKey, buildAgingSummary,
  normalizePhone, waReminderLink,
} from '../aging'

const TODAY = new Date('2026-07-11T12:00:00')

describe('daysOutstanding', () => {
  it('menghitung umur tagihan dalam hari sejak occurred_at', () => {
    expect(daysOutstanding({ occurred_at: '2026-07-11T08:00:00' }, TODAY)).toBe(0)
    expect(daysOutstanding({ occurred_at: '2026-07-01T12:00:00' }, TODAY)).toBe(10)
    expect(daysOutstanding({ occurred_at: '2026-03-01T12:00:00' }, TODAY)).toBe(132)
  })
  it('tanggal invalid atau masa depan tidak negatif', () => {
    expect(daysOutstanding({ occurred_at: 'bukan-tanggal' }, TODAY)).toBe(0)
    expect(daysOutstanding({ occurred_at: '2026-08-01T00:00:00' }, TODAY)).toBe(0)
  })
})

describe('isOverdue', () => {
  it('false bila due_date kosong', () => {
    expect(isOverdue({ due_date: null }, TODAY)).toBe(false)
  })
  it('membandingkan per tanggal: jatuh tempo hari ini belum terlambat', () => {
    expect(isOverdue({ due_date: '2026-07-11' }, TODAY)).toBe(false)
    expect(isOverdue({ due_date: '2026-07-10' }, TODAY)).toBe(true)
    expect(isOverdue({ due_date: '2026-07-20' }, TODAY)).toBe(false)
  })
})

describe('agingBucketKey', () => {
  it('memetakan hari ke bucket yang benar', () => {
    expect(agingBucketKey(0)).toBe('b30')
    expect(agingBucketKey(30)).toBe('b30')
    expect(agingBucketKey(31)).toBe('b60')
    expect(agingBucketKey(60)).toBe('b60')
    expect(agingBucketKey(90)).toBe('b90')
    expect(agingBucketKey(91)).toBe('b90p')
    expect(agingBucketKey(400)).toBe('b90p')
  })
})

describe('buildAgingSummary', () => {
  it('menjumlah total, per-bucket, dan yang lewat jatuh tempo', () => {
    const txs = [
      { amount: 100, occurred_at: '2026-07-05T00:00:00', due_date: '2026-07-08' }, // 6 hari, overdue
      { amount: 50, occurred_at: '2026-06-01T00:00:00', due_date: null },          // 40 hari
      { amount: 25, occurred_at: '2026-02-01T00:00:00', due_date: '2026-12-01' },  // >90 hari, belum tempo
    ]
    const s = buildAgingSummary(txs, TODAY)
    expect(s.count).toBe(3)
    expect(s.total).toBe(175)
    expect(s.buckets.b30).toEqual({ count: 1, total: 100 })
    expect(s.buckets.b60).toEqual({ count: 1, total: 50 })
    expect(s.buckets.b90).toEqual({ count: 0, total: 0 })
    expect(s.buckets.b90p).toEqual({ count: 1, total: 25 })
    expect(s.overdueCount).toBe(1)
    expect(s.overdueTotal).toBe(100)
  })
})

describe('normalizePhone', () => {
  it('mengubah 08xx menjadi 628xx dan membersihkan karakter', () => {
    expect(normalizePhone('0812-3456-789')).toBe('62812345678 9'.replace(' ', ''))
    expect(normalizePhone('+62 812 3456')).toBe('628123456')
    expect(normalizePhone('81234')).toBe('6281234')
    expect(normalizePhone('')).toBe('')
    expect(normalizePhone(null)).toBe('')
  })
})

describe('waReminderLink', () => {
  it('membuat tautan wa.me dengan pesan ter-encode', () => {
    const url = waReminderLink(
      { customer_contact: '08123', customer_name: 'Bu Sari', description: 'Bolu 2 pcs', amount: 40000, due_date: '2026-07-15' },
      'Toko Kue Uji',
      (n) => `Rp ${n}`,
    )
    expect(url.startsWith('https://wa.me/628123?text=')).toBe(true)
    const msg = decodeURIComponent(url.split('text=')[1])
    expect(msg).toContain('Bu Sari')
    expect(msg).toContain('Bolu 2 pcs')
    expect(msg).toContain('Rp 40000')
    expect(msg).toContain('2026-07-15')
    expect(msg).toContain('Toko Kue Uji')
  })
  it('kembalikan string kosong bila kontak tidak ada', () => {
    expect(waReminderLink({ customer_contact: '' }, 'X')).toBe('')
  })
})
