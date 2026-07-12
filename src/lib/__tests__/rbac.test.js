import { describe, it, expect } from 'vitest'
import { canModule, filterNav, MODULES, OWNER_ONLY_KEYS } from '../rbac'

const NAV = [
  { sec: 'ringkasan', items: [{ key: 'dashboard' }] },
  { sec: 'transaksi', items: [{ key: 'transaksi' }, { key: 'piutang' }] },
  { sec: 'produk', items: [{ key: 'stok' }, { key: 'po' }] },
  { sec: 'analisis', items: [{ key: 'radar' }, { key: 'laporan' }] },
  { sec: 'lainnya', items: [{ key: 'feedback' }, { key: 'pengguna' }, { key: 'audit' }, { key: 'pengaturan' }] },
]

describe('canModule', () => {
  it('owner (membership null) selalu boleh', () => {
    expect(canModule(null, 'transaksi')).toBe(true)
    expect(canModule(null, 'produk')).toBe(true)
  })
  it('staf hanya boleh modul yang diberikan', () => {
    const m = { modules: ['produk'] }
    expect(canModule(m, 'produk')).toBe(true)
    expect(canModule(m, 'transaksi')).toBe(false)
    expect(canModule({ modules: [] }, 'produk')).toBe(false)
  })
})

describe('filterNav', () => {
  it('owner melihat semua menu apa adanya', () => {
    expect(filterNav(NAV, null)).toEqual(NAV)
  })
  it('staf gudang: hanya ringkasan, produk, dan lainnya tanpa item owner-only', () => {
    const out = filterNav(NAV, { modules: ['produk'] })
    expect(out.map((g) => g.sec)).toEqual(['ringkasan', 'produk', 'lainnya'])
    const lain = out.find((g) => g.sec === 'lainnya')
    expect(lain.items.map((i) => i.key)).toEqual(['feedback'])
  })
  it('staf multi-modul melihat gabungan grupnya', () => {
    const out = filterNav(NAV, { modules: ['transaksi', 'analisis'] })
    expect(out.map((g) => g.sec)).toEqual(['ringkasan', 'transaksi', 'analisis', 'lainnya'])
  })
  it('item owner-only tidak pernah bocor ke staf', () => {
    const out = filterNav(NAV, { modules: ['transaksi', 'produk', 'analisis'] })
    const keys = out.flatMap((g) => g.items.map((i) => i.key))
    for (const k of OWNER_ONLY_KEYS) expect(keys).not.toContain(k)
  })
})

describe('MODULES', () => {
  it('lima modul sesuai blueprint dan punya label', () => {
    expect(MODULES.map((m) => m.key)).toEqual(['operasional', 'transaksi', 'produk', 'hr', 'analisis'])
    for (const m of MODULES) expect(m.label.length).toBeGreaterThan(3)
  })
})
