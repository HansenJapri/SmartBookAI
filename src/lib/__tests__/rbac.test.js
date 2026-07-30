import { describe, it, expect } from 'vitest'
import { canModule, canPath, filterNav, isOwnerView, MODULES, OWNER_ONLY_KEYS } from '../rbac'

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
  it('staf gudang: hanya ringkasan & produk — seksi lainnya owner-only sepenuhnya', () => {
    const out = filterNav(NAV, { modules: ['produk'] })
    expect(out.map((g) => g.sec)).toEqual(['ringkasan', 'produk'])
  })
  it('staf multi-modul melihat gabungan grupnya', () => {
    const out = filterNav(NAV, { modules: ['transaksi', 'analisis'] })
    expect(out.map((g) => g.sec)).toEqual(['ringkasan', 'transaksi', 'analisis'])
  })
  it('item owner-only tidak pernah bocor ke staf', () => {
    const out = filterNav(NAV, { modules: ['transaksi', 'produk', 'analisis'] })
    const keys = out.flatMap((g) => g.items.map((i) => i.key))
    for (const k of OWNER_ONLY_KEYS) expect(keys).not.toContain(k)
  })
})

describe('isOwnerView', () => {
  it('workspace belum dipilih = owner usaha sendiri', () => {
    expect(isOwnerView('u1', '')).toBe(true)
    expect(isOwnerView('u1', null)).toBe(true)
  })
  it('memilih workspace sendiri tetap owner', () => {
    expect(isOwnerView('u1', 'u1')).toBe(true)
  })
  it('memilih workspace orang lain BUKAN owner', () => {
    expect(isOwnerView('u1', 'boss-1')).toBe(false)
  })
  it('tanpa user tidak pernah dianggap owner', () => {
    expect(isOwnerView(null, '')).toBe(false)
  })
})

describe('canPath', () => {
  const staff = { isOwner: false, membership: { modules: ['produk'] } }

  it('owner boleh membuka semua rute', () => {
    const owner = { isOwner: true, membership: null }
    expect(canPath('/app/pengguna', owner)).toBe(true)
    expect(canPath('/app/gaji', owner)).toBe(true)
  })
  it('rute owner-only ditolak untuk staf, termasuk yang belum aktif', () => {
    for (const p of ['/app/pengguna', '/app/audit', '/app/pengaturan', '/app/feedback']) {
      expect(canPath(p, staff)).toBe(false)
      // membership null (undangan belum diterima) tidak boleh membuka pintu.
      expect(canPath(p, { isOwner: false, membership: null })).toBe(false)
    }
  })
  it('rute bermodul mengikuti modul yang diberikan', () => {
    expect(canPath('/app/stok', staff)).toBe(true)
    expect(canPath('/app/po', staff)).toBe(true)
    expect(canPath('/app/gaji', staff)).toBe(false)
    expect(canPath('/app/transaksi', staff)).toBe(false)
  })
  it('rute tanpa modul (dashboard) selalu boleh', () => {
    expect(canPath('/app', staff)).toBe(true)
  })
})

describe('MODULES', () => {
  it('lima modul sesuai blueprint dan punya label', () => {
    expect(MODULES.map((m) => m.key)).toEqual(['operasional', 'transaksi', 'produk', 'hr', 'analisis'])
    for (const m of MODULES) expect(m.label.length).toBeGreaterThan(3)
  })
})
