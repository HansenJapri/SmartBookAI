import { describe, it, expect } from 'vitest'
import { nextDocNumber, buildOpnameItems, opnameDiff, opnameSummary } from '../gudang'

describe('nextDocNumber', () => {
  it('mulai dari 0001 saat belum ada dokumen', () => {
    expect(nextDocNumber('PO', [])).toBe('PO-0001')
  })
  it('melanjutkan dari nomor terbesar', () => {
    expect(nextDocNumber('PO', ['PO-0001', 'PO-0003', 'PO-0002'])).toBe('PO-0004')
  })
  it('tidak memakai ulang nomor walau ada dokumen terhapus di tengah', () => {
    expect(nextDocNumber('SO', ['SO-0005'])).toBe('SO-0006')
  })
  it('mengabaikan nomor dengan prefix lain atau format rusak', () => {
    expect(nextDocNumber('PO', ['SO-0009', 'PO-xx', null, 'PO-0002'])).toBe('PO-0003')
  })
  it('menembus 4 digit dengan benar', () => {
    expect(nextDocNumber('PO', ['PO-9999'])).toBe('PO-10000')
  })
})

describe('buildOpnameItems', () => {
  it('membuat snapshot stok sistem dengan counted_qty kosong', () => {
    const items = buildOpnameItems([
      { id: 'a', name: 'Bolu', unit: 'pcs', stock: 4 },
      { id: 'b', name: 'Terigu', unit: 'kg', stock: '2.5' },
    ])
    expect(items).toEqual([
      { product_id: 'a', name: 'Bolu', unit: 'pcs', system_qty: 4, counted_qty: null },
      { product_id: 'b', name: 'Terigu', unit: 'kg', system_qty: 2.5, counted_qty: null },
    ])
  })
})

describe('opnameDiff', () => {
  it('null bila belum dihitung fisik', () => {
    expect(opnameDiff({ system_qty: 4, counted_qty: null })).toBeNull()
    expect(opnameDiff({ system_qty: 4, counted_qty: '' })).toBeNull()
  })
  it('menghitung selisih plus/minus/nol', () => {
    expect(opnameDiff({ system_qty: 4, counted_qty: 6 })).toBe(2)
    expect(opnameDiff({ system_qty: 4, counted_qty: 1 })).toBe(-3)
    expect(opnameDiff({ system_qty: 4, counted_qty: 4 })).toBe(0)
  })
  it('aman dari residu floating point', () => {
    expect(opnameDiff({ system_qty: 0.1, counted_qty: 0.3 })).toBe(0.2)
  })
})

describe('opnameSummary', () => {
  it('merangkum baris terhitung, selisih plus & minus', () => {
    const s = opnameSummary([
      { product_id: 'a', system_qty: 4, counted_qty: 6 },  // +2
      { product_id: 'b', system_qty: 2, counted_qty: 1 },  // -1
      { product_id: 'c', system_qty: 5, counted_qty: 5 },  // 0
      { product_id: 'd', system_qty: 3, counted_qty: null }, // belum dihitung
    ])
    expect(s.total).toBe(4)
    expect(s.counted).toBe(3)
    expect(s.uncounted).toBe(1)
    expect(s.plus).toBe(1)
    expect(s.minus).toBe(1)
    expect(s.diffs.map((d) => d.diff)).toEqual([2, -1])
  })
})
