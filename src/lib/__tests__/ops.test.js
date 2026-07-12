import { describe, it, expect } from 'vitest'
import { nextStatus, prevStatus, isTaskOverdue, sortTasks, TASK_STATUSES } from '../ops'

const TODAY = new Date('2026-07-12T12:00:00')

describe('alur status papan', () => {
  it('antre -> dikerjakan -> selesai, ujung mengembalikan null', () => {
    expect(TASK_STATUSES.map((s) => s.key)).toEqual(['antre', 'dikerjakan', 'selesai'])
    expect(nextStatus('antre')).toBe('dikerjakan')
    expect(nextStatus('dikerjakan')).toBe('selesai')
    expect(nextStatus('selesai')).toBeNull()
    expect(prevStatus('antre')).toBeNull()
    expect(prevStatus('selesai')).toBe('dikerjakan')
  })
})

describe('isTaskOverdue', () => {
  it('terlambat hanya bila lewat jadwal dan belum selesai', () => {
    expect(isTaskOverdue({ due_date: '2026-07-10', status: 'antre' }, TODAY)).toBe(true)
    expect(isTaskOverdue({ due_date: '2026-07-12', status: 'antre' }, TODAY)).toBe(false)
    expect(isTaskOverdue({ due_date: '2026-07-10', status: 'selesai' }, TODAY)).toBe(false)
    expect(isTaskOverdue({ due_date: null, status: 'antre' }, TODAY)).toBe(false)
  })
})

describe('sortTasks', () => {
  it('prioritas tinggi dulu, lalu jadwal terdekat, lalu terlama dibuat', () => {
    const out = sortTasks([
      { title: 'c', priority: 'rendah', due_date: null, created_at: '2026-07-01' },
      { title: 'a', priority: 'tinggi', due_date: '2026-07-20', created_at: '2026-07-03' },
      { title: 'b', priority: 'tinggi', due_date: '2026-07-15', created_at: '2026-07-02' },
      { title: 'd', priority: 'normal', due_date: '2026-07-14', created_at: '2026-07-04' },
    ])
    expect(out.map((t) => t.title)).toEqual(['b', 'a', 'd', 'c'])
  })
})
