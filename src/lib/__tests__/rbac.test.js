import { describe, it, expect } from 'vitest'
import { canManageUsers, canModule, canPath, filterNav, firstAllowedPath, isOwnerView, MODULES, OWNER_ONLY_KEYS, staffDisplayName } from '../rbac'

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
    const out = filterNav(NAV, { modules: ['dashboard', 'produk'] })
    expect(out.map((g) => g.sec)).toEqual(['ringkasan', 'produk'])
  })
  it('staf multi-modul melihat gabungan grupnya', () => {
    const out = filterNav(NAV, { modules: ['dashboard', 'transaksi', 'analisis'] })
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
  // Dashboard kini modul tersendiri yang bisa dicabut owner — dulu selalu boleh.
  it('dashboard mengikuti modul dashboard, bukan selalu terbuka', () => {
    expect(canPath('/app', staff)).toBe(false)
    expect(canPath('/app', { isOwner: false, membership: { modules: ['dashboard'] } })).toBe(true)
    expect(canPath('/app', { isOwner: true, membership: null })).toBe(true)
  })

  it('staf tanpa dashboard tetap punya tujuan alihan (tidak memantul tanpa henti)', () => {
    const tujuan = firstAllowedPath(staff)
    expect(tujuan).not.toBe('/app')
    expect(canPath(tujuan, staff)).toBe(true)
  })

  it('staf tanpa modul sama sekali tidak punya tujuan', () => {
    expect(firstAllowedPath({ isOwner: false, membership: { modules: [] } })).toBeNull()
  })
})

describe('MODULES', () => {
  it('enam modul sesuai blueprint dan punya label', () => {
    expect(MODULES.map((m) => m.key)).toEqual(['dashboard', 'operasional', 'transaksi', 'produk', 'hr', 'analisis'])
    for (const m of MODULES) expect(m.label.length).toBeGreaterThan(3)
  })
})

// ============================================================
// CRUD DATA PENGGUNA — hanya owner workspace yang sedang dibuka.
// ============================================================
describe('canManageUsers', () => {
  it('mengizinkan owner workspace yang sedang dibuka', () => {
    expect(canManageUsers({ isOwner: true, membership: null })).toBe(true)
  })

  it('menolak staf, termasuk yang punya semua modul', () => {
    const semua = { modules: MODULES.map((m) => m.key) }
    expect(canManageUsers({ isOwner: false, membership: semua })).toBe(false)
  })

  it('menolak keadaan rancu: mengaku owner tapi punya baris keanggotaan', () => {
    expect(canManageUsers({ isOwner: true, membership: { modules: ['hr'] } })).toBe(false)
  })

  // Gagal-tertutup. Konteks workspace dimuat asinkron, jadi selama render
  // pertama isOwner bisa undefined — saat itu tabel pengelolaan pengguna tidak
  // boleh sempat muncul walau sekejap.
  it('menolak nilai yang belum jelas (undefined / null / tanpa argumen)', () => {
    expect(canManageUsers()).toBe(false)
    expect(canManageUsers({})).toBe(false)
    expect(canManageUsers({ isOwner: undefined })).toBe(false)
    expect(canManageUsers({ isOwner: null })).toBe(false)
  })

  it('menolak nilai truthy yang bukan boolean true', () => {
    expect(canManageUsers({ isOwner: 1 })).toBe(false)
    expect(canManageUsers({ isOwner: 'yes' })).toBe(false)
  })

  it('sejalan dengan isOwnerView untuk staf yang membuka usaha orang lain', () => {
    const isOwner = isOwnerView('user-1', 'owner-2')
    expect(isOwner).toBe(false)
    expect(canManageUsers({ isOwner, membership: { modules: ['hr'] } })).toBe(false)
  })
})

describe('staffDisplayName', () => {
  it('memakai nama bila ada', () => {
    expect(staffDisplayName({ name: 'Budi Santoso', email: 'budi@x.com' })).toBe('Budi Santoso')
  })

  // Baris lama (sebelum kolom `name`) tetap harus mengenali orangnya, tanpa
  // memampangkan alamat email lengkap di tabel.
  it('jatuh ke bagian lokal email bila nama kosong', () => {
    expect(staffDisplayName({ name: '', email: 'budi.s@usaha.com' })).toBe('budi.s')
    expect(staffDisplayName({ email: 'budi.s@usaha.com' })).toBe('budi.s')
    expect(staffDisplayName({ name: '   ', email: 'budi.s@usaha.com' })).toBe('budi.s')
  })

  it('tidak pernah membocorkan domain lewat jalur cadangan', () => {
    expect(staffDisplayName({ email: 'x@rahasia.co.id' })).not.toContain('@')
    expect(staffDisplayName({ email: 'x@rahasia.co.id' })).not.toContain('rahasia')
  })

  it('mengembalikan em dash bila tidak ada data sama sekali', () => {
    expect(staffDisplayName({})).toBe('—')
    expect(staffDisplayName(null)).toBe('—')
  })
})
