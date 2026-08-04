import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============================================================
// Integration test lapisan api.js — seam antara UI dan database.
// Supabase di-mock sepenuhnya (tanpa jaringan) sehingga test deterministik
// & repeatable. Fokus: kontrak pemanggilan RPC atomik (nama fungsi + argumen),
// pemetaan hasil, propagasi error (rollback = error dilempar ke pemanggil),
// dan resolusi owner efektif (RBAC).
// ============================================================

// Callback reset cache yang didaftarkan api.js lewat onAuthStateChange —
// dipanggil ulang tiap test untuk mengosongkan _ownerCache antar-kasus.
let authResetCb = null

const rpc = vi.fn()
const getUser = vi.fn(async () => ({ data: { user: { id: 'owner-1' } } }))
const fromImpl = vi.fn()

// Rantai thenable ala PostgrestBuilder: bisa di-chain (.select().eq()...) dan
// juga bisa langsung di-await (resolve ke {data,error}).
function makeChain(result = { data: null, error: null }) {
  const chain = {}
  for (const m of ['insert', 'select', 'update', 'delete', 'eq', 'is', 'in', 'order', 'limit', 'gte', 'lte', 'ilike']) {
    chain[m] = vi.fn(() => chain)
  }
  chain.maybeSingle = vi.fn(async () => result)
  chain.single = vi.fn(async () => result)
  chain.then = (onF, onR) => Promise.resolve(result).then(onF, onR)
  return chain
}

vi.mock('../supabase', () => ({
  supabase: {
    rpc: (...a) => rpc(...a),
    from: (...a) => fromImpl(...a),
    auth: {
      getUser: (...a) => getUser(...a),
      onAuthStateChange: (cb) => { authResetCb = cb },
    },
  },
}))

// Import SETELAH mock terpasang (vi.mock di-hoist, jadi aman).
const api = await import('../api')

// Stub localStorage: dipakai api.js untuk menyimpan workspace aktif.
// Lingkungan test berjalan di node tanpa localStorage bawaan.
beforeEach(() => {
  const store = new Map()
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)) },
    removeItem: (k) => { store.delete(k) },
    clear: () => { store.clear() },
  }
})

beforeEach(() => {
  rpc.mockReset()
  fromImpl.mockReset()
  getUser.mockReset()
  getUser.mockResolvedValue({ data: { user: { id: 'owner-1' } } })
  // Default: setiap .from(...) mengembalikan rantai kosong (dipakai track()).
  fromImpl.mockImplementation(() => makeChain({ data: null, error: null }))
  // Kosongkan cache owner efektif antar-test.
  authResetCb?.()
})

describe('addTransactionWithStock', () => {
  it('memanggil RPC add_transaction_with_stock dan meneruskan tx apa adanya', async () => {
    rpc.mockResolvedValueOnce({ data: { txn: { id: 'tx-1' }, changes: [{ name: 'Bolu' }] }, error: null })
    const tx = { description: 'Jual bolu', amount: 45000, direction: 'in', category: 'Penjualan' }
    const res = await api.addTransactionWithStock(tx, [{ productId: 'p1', qty: 2, extra: 'buang' }])

    expect(rpc).toHaveBeenCalledWith('add_transaction_with_stock', expect.objectContaining({ p_tx: tx }))
    // Baris produk dipetakan HANYA ke {productId, qty} (field lain dibuang).
    const arg = rpc.mock.calls[0][1]
    expect(arg.p_lines).toEqual([{ productId: 'p1', qty: 2 }])
    // Hasil dipetakan ke {txn, changes}.
    expect(res).toEqual({ txn: { id: 'tx-1' }, changes: [{ name: 'Bolu' }] })
  })

  it('default lines kosong bila tidak diberikan', async () => {
    rpc.mockResolvedValueOnce({ data: { txn: { id: 'tx-2' }, changes: [] }, error: null })
    await api.addTransactionWithStock({ direction: 'out', amount: 1000 })
    expect(rpc.mock.calls[0][1].p_lines).toEqual([])
  })

  it('melempar error bila RPC gagal (rollback → pemanggil tahu)', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: new Error('stok terkunci') })
    await expect(api.addTransactionWithStock({ direction: 'in', amount: 1 }, []))
      .rejects.toThrow('stok terkunci')
  })

  it('mengembalikan changes kosong bila data null', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null })
    const res = await api.addTransactionWithStock({ direction: 'in', amount: 1 })
    expect(res).toEqual({ txn: null, changes: [] })
  })
})

describe('receivePurchaseOrder', () => {
  it('memetakan opsi ke argumen RPC receive_purchase_order', async () => {
    rpc.mockResolvedValueOnce({ data: { po: { id: 'po-1', status: 'received' }, stock: {}, txn: { id: 't' } }, error: null })
    await api.receivePurchaseOrder({ id: 'po-1' }, {
      createExpense: true, category: 'Pembelian Stok', paymentStatus: 'lunas', dueDate: null,
    })
    expect(rpc).toHaveBeenCalledWith('receive_purchase_order', {
      p_po_id: 'po-1',
      p_create_expense: true,
      p_category: 'Pembelian Stok',
      p_payment_status: 'lunas',
      p_due_date: null,
      p_owner: 'owner-1',   // workspace tujuan dikirim eksplisit ke server
    })
  })

  it('mengirim due_date HANYA saat pembayaran "belum" (kredit)', async () => {
    rpc.mockResolvedValueOnce({ data: { po: {}, stock: {}, txn: null }, error: null })
    await api.receivePurchaseOrder({ id: 'po-2' }, {
      createExpense: true, category: 'Pembelian Stok', paymentStatus: 'belum', dueDate: '2026-08-01',
    })
    expect(rpc.mock.calls[0][1].p_due_date).toBe('2026-08-01')
  })

  it('mengabaikan due_date saat lunas walau dueDate diisi', async () => {
    rpc.mockResolvedValueOnce({ data: { po: {}, stock: {}, txn: null }, error: null })
    await api.receivePurchaseOrder({ id: 'po-3' }, {
      createExpense: false, category: '', paymentStatus: 'lunas', dueDate: '2026-08-01',
    })
    expect(rpc.mock.calls[0][1].p_due_date).toBeNull()
  })

  it('melempar error bila RPC gagal (mis. PO sudah diterima)', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: new Error('PO ini sudah diterima atau dibatalkan.') })
    await expect(api.receivePurchaseOrder({ id: 'po-4' }, {}))
      .rejects.toThrow('sudah diterima')
  })
})

describe('postOpname', () => {
  it('memanggil RPC post_stock_opname dengan id & items sesi', async () => {
    const items = [{ product_id: 'p1', counted_qty: 5, system_qty: 8 }]
    rpc.mockResolvedValueOnce({ data: { opname: { id: 'so-1', status: 'posted' }, changes: [{ name: 'Bolu' }] }, error: null })
    const res = await api.postOpname({ id: 'so-1', items })
    expect(rpc).toHaveBeenCalledWith('post_stock_opname',
      { p_opname_id: 'so-1', p_items: items, p_owner: 'owner-1' })
    expect(res.opname.status).toBe('posted')
    expect(res.changes).toHaveLength(1)
  })

  it('items default [] bila sesi tak punya items', async () => {
    rpc.mockResolvedValueOnce({ data: { opname: {}, changes: [] }, error: null })
    await api.postOpname({ id: 'so-2' })
    expect(rpc.mock.calls[0][1].p_items).toEqual([])
  })

  it('melempar error bila RPC gagal (mis. sesi bukan draf)', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: new Error('Sesi opname ini bukan draf aktif.') })
    await expect(api.postOpname({ id: 'so-3', items: [] })).rejects.toThrow('bukan draf aktif')
  })
})

describe('effectiveOwnerId (RBAC)', () => {
  it('mengembalikan id sendiri bila bukan staf undangan', async () => {
    fromImpl.mockImplementationOnce(() => makeChain({ data: null, error: null }))
    const owner = await api.effectiveOwnerId()
    expect(owner).toBe('owner-1')
  })

  // REGRESI PENTING: dulu staf yang emailnya pernah diundang otomatis "diserap"
  // ke workspace pengundang, sehingga akun baru tidak pernah bisa punya usaha
  // sendiri. Sekarang default SELALU workspace milik sendiri.
  it('TIDAK ikut workspace orang lain bila pengguna belum memilihnya', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'staff-9' } } })
    api.setSelectedWorkspace('')
    fromImpl.mockImplementationOnce(() => makeChain({ data: [{ owner_id: 'boss-1' }], error: null }))
    const owner = await api.effectiveOwnerId()
    expect(owner).toBe('staff-9')
  })

  it('memakai workspace orang lain HANYA setelah dipilih & terverifikasi', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'staff-9' } } })
    api.setSelectedWorkspace('boss-1')
    fromImpl.mockImplementationOnce(() => makeChain({ data: [{ owner_id: 'boss-1' }], error: null }))
    const owner = await api.effectiveOwnerId()
    expect(owner).toBe('boss-1')
  })

  it('GAGAL TERTUTUP bila keanggotaan sudah dicabut', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'staff-9' } } })
    api.setSelectedWorkspace('boss-1')
    // Keanggotaan tidak ditemukan lagi (dicabut owner). Dulu fungsi ini diam-diam
    // mengembalikan 'staff-9' sementara UI masih menampilkan usaha boss, sehingga
    // tulisan mendarat di workspace yang salah. Sekarang harus melempar.
    fromImpl.mockImplementationOnce(() => makeChain({ data: [], error: null }))
    await expect(api.effectiveOwnerId()).rejects.toThrow(/tidak berlaku/i)
    expect(api.getSelectedWorkspace()).toBe('')
  })

  it('mengembalikan null bila tidak ada sesi login', async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    const owner = await api.effectiveOwnerId()
    expect(owner).toBeNull()
  })

  it('meng-cache hasil: panggilan kedua tidak query staff_members lagi', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'staff-9' } } })
    api.setSelectedWorkspace('boss-1')
    fromImpl.mockImplementationOnce(() => makeChain({ data: [{ owner_id: 'boss-1' }], error: null }))
    const a = await api.effectiveOwnerId()
    const callsAfterFirst = fromImpl.mock.calls.length
    const b = await api.effectiveOwnerId()
    expect(a).toBe('boss-1')
    expect(b).toBe('boss-1')
    // Tidak ada query staff_members tambahan pada panggilan kedua.
    expect(fromImpl.mock.calls.length).toBe(callsAfterFirst)
  })
})

// PostgREST saat fungsi RPC belum ada di database (klien lebih baru dari
// migrasi). Semua pemanggil RPC undangan wajib punya jalur mundur.
const MISSING_RPC = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }

describe('undangan staf (tidak otomatis diklaim)', () => {
  it('fetchPendingInvitations memakai RPC my_pending_invitations', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'a_b@gmail.com' } } })
    rpc.mockResolvedValue({ data: [{ id: 'i1', owner_id: 'boss-1', business_name: 'Warung A' }], error: null })
    const list = await api.fetchPendingInvitations()
    expect(rpc).toHaveBeenCalledWith('my_pending_invitations')
    expect(list.map((x) => x.id)).toEqual(['i1'])
  })

  it('fetchPendingInvitations: jalur mundur menyaring email PERSIS sama', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'a_b@gmail.com' } } })
    rpc.mockResolvedValue(MISSING_RPC)
    // Baris kedua adalah kasus yang dulu bisa lolos lewat pola LIKE ("_" = wildcard).
    fromImpl.mockImplementationOnce(() => makeChain({
      data: [
        { id: 'i1', email: 'a_b@gmail.com', owner_id: 'boss-1' },
        { id: 'i2', email: 'axb@gmail.com', owner_id: 'boss-2' },
      ],
      error: null,
    }))
    const list = await api.fetchPendingInvitations()
    expect(list.map((x) => x.id)).toEqual(['i1'])
  })

  it('fetchMyMemberships memakai RPC my_workspaces (membawa nama usaha)', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'staff-9' } } })
    rpc.mockResolvedValue({
      data: [
        { id: 's1', owner_id: 'boss-1', business_name: 'Warung A' },
        { id: 's2', owner_id: 'boss-2', business_name: 'Toko B' },
      ],
      error: null,
    })
    const list = await api.fetchMyMemberships()
    expect(rpc).toHaveBeenCalledWith('my_workspaces')
    expect(list).toHaveLength(2)
    expect(list[0].business_name).toBe('Warung A')
  })

  it('fetchMyMemberships: jalur mundur ke tabel bila RPC belum terpasang', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'staff-9' } } })
    rpc.mockResolvedValue(MISSING_RPC)
    fromImpl.mockImplementationOnce(() => makeChain({
      data: [{ owner_id: 'boss-1' }, { owner_id: 'boss-2' }],
      error: null,
    }))
    const list = await api.fetchMyMemberships()
    expect(list).toHaveLength(2)
  })

  it('fetchMyMembership null saat berada di workspace sendiri', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'staff-9' } } })
    api.setSelectedWorkspace('')
    const m = await api.fetchMyMembership()
    expect(m).toBeNull()
  })

  it('acceptInvitation memakai RPC accept_invitation (bukan UPDATE langsung)', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'staff-9', email: 's@x.com' } } })
    rpc.mockResolvedValue({ data: [{ id: 'i1', owner_id: 'boss-1', modules: ['produk'] }], error: null })
    const row = await api.acceptInvitation('i1')
    expect(rpc).toHaveBeenCalledWith('accept_invitation', { p_invite_id: 'i1' })
    expect(row.owner_id).toBe('boss-1')
    // Tidak ada UPDATE tabel: modules & role tidak bisa disentuh penerima.
    expect(fromImpl).not.toHaveBeenCalledWith('staff_members')
  })

  it('declineInvitation mencatat penolakan di server, bukan localStorage', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'staff-9', email: 's@x.com' } } })
    rpc.mockResolvedValue({ data: true, error: null })
    await api.declineInvitation('i1')
    expect(rpc).toHaveBeenCalledWith('decline_invitation', { p_invite_id: 'i1' })
  })
})

// ============================================================
// Regresi bug kritis: data usaha owner tampak "ter-copy" ke usaha staf.
// Penyebabnya setiap query hanya bersandar pada RLS `own OR has_access(...)`,
// yang tidak tahu workspace mana yang sedang dibuka klien. Tes di bawah
// mengunci bahwa SETIAP baca/ubah/hapus terikat pemilik workspace aktif.
// ============================================================
describe('isolasi workspace', () => {
  // Staf yang sedang membuka usaha boss-1 (keanggotaan aktif terverifikasi).
  const asStaffInBossWorkspace = () => {
    getUser.mockResolvedValue({ data: { user: { id: 'staff-9', email: 's@x.com' } } })
    api.setSelectedWorkspace('boss-1')
    fromImpl.mockImplementationOnce(() => makeChain({ data: [{ owner_id: 'boss-1' }], error: null }))
  }

  it('effectiveOwnerId GAGAL TERTUTUP bila keanggotaan tidak lagi sah', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'staff-9' } } })
    api.setSelectedWorkspace('boss-1')
    // Verifikasi mengembalikan kosong = akses sudah dicabut.
    fromImpl.mockImplementationOnce(() => makeChain({ data: [], error: null }))
    await expect(api.effectiveOwnerId()).rejects.toThrow(/tidak berlaku/i)
    // Pilihan workspace dibersihkan supaya pengguna kembali ke usaha sendiri.
    expect(api.getSelectedWorkspace()).toBe('')
  })

  it('fetchTransactions memfilter user_id ke workspace aktif', async () => {
    asStaffInBossWorkspace()
    const chain = makeChain({ data: [], error: null })
    fromImpl.mockImplementationOnce(() => chain)
    await api.fetchTransactions()
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'boss-1')
  })

  it('fetchProducts memfilter user_id ke workspace aktif', async () => {
    asStaffInBossWorkspace()
    const chain = makeChain({ data: [], error: null })
    fromImpl.mockImplementationOnce(() => chain)
    await api.fetchProducts()
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'boss-1')
  })

  it('di workspace sendiri, filternya adalah id pengguna — bukan usaha boss', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'staff-9' } } })
    api.setSelectedWorkspace('')
    const chain = makeChain({ data: [], error: null })
    fromImpl.mockImplementationOnce(() => chain)
    await api.fetchTransactions()
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'staff-9')
    expect(chain.eq).not.toHaveBeenCalledWith('user_id', 'boss-1')
  })

  it('updateTransaction tidak bisa menyentuh baris workspace lain', async () => {
    asStaffInBossWorkspace()
    const chain = makeChain({ data: { id: 't1' }, error: null })
    fromImpl.mockImplementationOnce(() => chain)
    await api.updateTransaction('t1', { amount: 1 })
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'boss-1')
    expect(chain.eq).toHaveBeenCalledWith('id', 't1')
  })

  it('deleteProduct terikat workspace aktif', async () => {
    asStaffInBossWorkspace()
    const chain = makeChain({ data: null, error: null })
    fromImpl.mockImplementationOnce(() => chain)
    await api.deleteProduct('p1')
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'boss-1')
  })

  it('fetchAuditLogs memfilter owner_id (bukan user_id)', async () => {
    asStaffInBossWorkspace()
    const chain = makeChain({ data: [], error: null })
    fromImpl.mockImplementationOnce(() => chain)
    await api.fetchAuditLogs()
    expect(chain.eq).toHaveBeenCalledWith('owner_id', 'boss-1')
  })

  it('addTransactionWithStock mengirim p_owner workspace aktif', async () => {
    asStaffInBossWorkspace()
    rpc.mockResolvedValue({ data: { txn: { id: 't1' }, changes: [] }, error: null })
    await api.addTransactionWithStock({ direction: 'in', amount: 1 }, [])
    expect(rpc).toHaveBeenCalledWith('add_transaction_with_stock',
      expect.objectContaining({ p_owner: 'boss-1' }))
  })

  it('postOpname mengirim p_owner workspace aktif', async () => {
    asStaffInBossWorkspace()
    rpc.mockResolvedValue({ data: { opname: {}, changes: [] }, error: null })
    await api.postOpname({ id: 'o1', items: [] })
    expect(rpc).toHaveBeenCalledWith('post_stock_opname',
      expect.objectContaining({ p_owner: 'boss-1' }))
  })

  it('fetchMonthlySummary mengirim p_owner, tidak bergantung auth.uid()', async () => {
    asStaffInBossWorkspace()
    rpc.mockResolvedValue({ data: [], error: null })
    await api.fetchMonthlySummary()
    expect(rpc).toHaveBeenCalledWith('my_monthly_summary', { p_owner: 'boss-1' })
  })

  it('exportMyData hanya mengekspor baris akun sendiri, bukan usaha boss', async () => {
    asStaffInBossWorkspace()
    const chains = []
    fromImpl.mockImplementation(() => { const c = makeChain({ data: [], error: null }); chains.push(c); return c })
    await api.exportMyData()
    for (const c of chains) {
      if (c.eq.mock.calls.some(([k]) => k === 'user_id')) {
        expect(c.eq).toHaveBeenCalledWith('user_id', 'staff-9')
      }
    }
  })
})

describe('batas hak akses pengelolaan staf (owner-only)', () => {
  it('fetchStaff memfilter owner_id — baris workspace lain tidak ikut terbaca', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'owner-1' } } })
    const chain = makeChain({ data: [], error: null })
    fromImpl.mockImplementationOnce(() => chain)
    await api.fetchStaff()
    expect(chain.eq).toHaveBeenCalledWith('owner_id', 'owner-1')
  })

  it('updateStaff memfilter owner_id dan menolak kolom di luar whitelist', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'owner-1' } } })
    const chain = makeChain({ data: { id: 's1', modules: ['produk'] }, error: null })
    fromImpl.mockImplementationOnce(() => chain)
    await api.updateStaff('s1', { modules: ['produk'], member_id: 'penyusup', owner_id: 'penyusup' })
    expect(chain.update).toHaveBeenCalledWith({ modules: ['produk'] })
    expect(chain.eq).toHaveBeenCalledWith('owner_id', 'owner-1')
  })

  it('updateStaff menolak modul karangan', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'owner-1' } } })
    await expect(api.updateStaff('s1', { modules: ['superadmin'] })).rejects.toThrow()
  })

  it('updateStaff menolak status di luar daftar', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'owner-1' } } })
    await expect(api.updateStaff('s1', { status: 'owner' })).rejects.toThrow()
  })

  it('deleteStaff memfilter owner_id', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'owner-1' } } })
    const chain = makeChain({ data: null, error: null })
    fromImpl.mockImplementationOnce(() => chain)
    await api.deleteStaff('s1')
    expect(chain.eq).toHaveBeenCalledWith('owner_id', 'owner-1')
  })

  it('addStaff menolak mengundang email sendiri', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'owner-1', email: 'boss@x.com' } } })
    await expect(api.addStaff('BOSS@x.com', ['produk'])).rejects.toThrow(/email Anda sendiri/i)
  })

  it('addStaff membuang modul yang tidak dikenal', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'owner-1', email: 'boss@x.com' } } })
    const chain = makeChain({ data: { id: 's1' }, error: null })
    fromImpl.mockImplementationOnce(() => chain)
    await api.addStaff('staf@x.com', ['produk', 'superadmin'])
    expect(chain.insert).toHaveBeenCalledWith(expect.objectContaining({ modules: ['produk'] }))
  })
})

// ============================================================
// TARGET PENJUALAN
// Regresi untuk tiga cara fitur ini gagal diam-diam sebelumnya:
//   1) nilai form yang bukan angka lolos ke PostgREST sebagai NaN,
//   2) galat saat menonaktifkan target lama ditelan sehingga insert tetap
//      jalan dan workspace berakhir dengan dua target aktif,
//   3) deactivate yang tidak mengenai baris apa pun dilaporkan sukses.
// ============================================================
describe('addTarget', () => {
  const base = { name: 'Q3', start_date: '2026-07-01', deadline: '2026-09-30' }

  it('menolak target tanpa angka apa pun (CHECK amount > 0 di basis data)', async () => {
    await expect(api.addTarget({ ...base })).rejects.toThrow(/minimal salah satu/i)
  })

  it('memperlakukan angka <= 0 sebagai "tidak diisi"', async () => {
    await expect(api.addTarget({ ...base, revenue_target: '0', profit_target: '' }))
      .rejects.toThrow(/minimal salah satu/i)
  })

  it('menolak input yang bukan angka alih-alih mengirim NaN ke database', async () => {
    await expect(api.addTarget({ ...base, revenue_target: 'abc' })).rejects.toThrow(/harus berupa angka/i)
  })

  it('menolak nilai yang melampaui numeric(14,2)', async () => {
    await expect(api.addTarget({ ...base, revenue_target: '1e13' })).rejects.toThrow(/terlalu besar/i)
  })

  it('mengisi amount dari revenue lalu profit demi kompatibilitas kolom lama', async () => {
    const insertChain = makeChain({ data: { id: 't1' }, error: null })
    fromImpl.mockImplementationOnce(() => makeChain({ data: null, error: null })) // deactivate
    fromImpl.mockImplementationOnce(() => insertChain)
    await api.addTarget({ ...base, profit_target: '1500000' })
    expect(insertChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      revenue_target: null, profit_target: 1500000, amount: 1500000, user_id: 'owner-1',
    }))
  })

  it('TIDAK menyisipkan target baru bila menonaktifkan target lama gagal', async () => {
    const insertChain = makeChain({ data: { id: 't2' }, error: null })
    fromImpl.mockImplementationOnce(() => makeChain({ data: null, error: new Error('rls') }))
    fromImpl.mockImplementationOnce(() => insertChain)
    await expect(api.addTarget({ ...base, revenue_target: '5000000' })).rejects.toThrow(/rls/)
    expect(insertChain.insert).not.toHaveBeenCalled()
  })
})

describe('deactivateTarget', () => {
  it('melempar bila tidak ada baris yang terkena (target milik workspace lain)', async () => {
    fromImpl.mockImplementationOnce(() => makeChain({ data: null, error: null, count: 0 }))
    await expect(api.deactivateTarget('t-lain')).rejects.toThrow(/tidak ditemukan/i)
  })

  it('lolos bila satu baris terkena', async () => {
    fromImpl.mockImplementationOnce(() => makeChain({ data: null, error: null, count: 1 }))
    await expect(api.deactivateTarget('t1')).resolves.toBeUndefined()
  })
})

describe('fetchTargetTransactions', () => {
  it('memfilter rentang target di server, bukan di klien', async () => {
    const chain = makeChain({ data: [], error: null })
    fromImpl.mockImplementationOnce(() => chain)
    await api.fetchTargetTransactions({ start_date: '2026-07-01', deadline: '2026-09-30' })
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'owner-1')
    expect(chain.gte).toHaveBeenCalledWith('occurred_at', expect.any(String))
    expect(chain.lte).toHaveBeenCalledWith('occurred_at', expect.any(String))
  })

  it('tanpa deadline hanya memberi batas bawah', async () => {
    const chain = makeChain({ data: [], error: null })
    fromImpl.mockImplementationOnce(() => chain)
    await api.fetchTargetTransactions({ start_date: '2026-07-01', deadline: null })
    expect(chain.gte).toHaveBeenCalled()
    expect(chain.lte).not.toHaveBeenCalled()
  })

  it('mengembalikan array kosong tanpa menyentuh database bila target null', async () => {
    await api.fetchTargetTransactions(null)
    expect(fromImpl).not.toHaveBeenCalled()
  })
})

// ============================================================
// CRUD DATA PENGGUNA — penjaga owner di lapisan api.js.
//
// RLS `owner_id = auth.uid()` TIDAK cukup sendirian: staf yang sedang membuka
// usaha orang lain tetap merupakan owner di usahanya sendiri, jadi database
// dengan senang hati menerima tulisannya — hanya saja mendarat di workspace
// yang salah. Penjaga di bawah menolak seluruh operasi selama workspace yang
// dibuka bukan milik pengguna itu.
// ============================================================
describe('CRUD pengguna hanya untuk owner workspace aktif', () => {
  const asStaffViewingOtherWorkspace = () => {
    localStorage.setItem('bp-active-workspace', 'owner-lain')
  }

  it('fetchStaff ditolak saat membuka workspace orang lain', async () => {
    asStaffViewingOtherWorkspace()
    await expect(api.fetchStaff()).rejects.toThrow(/hanya pemilik usaha/i)
    expect(fromImpl).not.toHaveBeenCalled()
  })

  it('addStaff ditolak dan tidak menyentuh database', async () => {
    asStaffViewingOtherWorkspace()
    await expect(api.addStaff('x@y.com', ['produk'])).rejects.toThrow(/hanya pemilik usaha/i)
    expect(fromImpl).not.toHaveBeenCalled()
  })

  it('updateStaff ditolak', async () => {
    asStaffViewingOtherWorkspace()
    await expect(api.updateStaff('s1', { status: 'revoked' })).rejects.toThrow(/hanya pemilik usaha/i)
    expect(fromImpl).not.toHaveBeenCalled()
  })

  it('deleteStaff ditolak', async () => {
    asStaffViewingOtherWorkspace()
    await expect(api.deleteStaff('s1')).rejects.toThrow(/hanya pemilik usaha/i)
    expect(fromImpl).not.toHaveBeenCalled()
  })

  it('reinviteStaff ditolak (lewat updateStaff)', async () => {
    asStaffViewingOtherWorkspace()
    await expect(api.reinviteStaff('s1')).rejects.toThrow(/hanya pemilik usaha/i)
  })

  it('diizinkan saat workspace aktif memang milik sendiri', async () => {
    localStorage.setItem('bp-active-workspace', 'owner-1')
    const chain = makeChain({ data: [], error: null })
    fromImpl.mockImplementationOnce(() => chain)
    await expect(api.fetchStaff()).resolves.toEqual([])
    expect(chain.eq).toHaveBeenCalledWith('owner_id', 'owner-1')
  })

  it('diizinkan saat belum ada workspace dipilih (default: usaha sendiri)', async () => {
    const chain = makeChain({ data: [], error: null })
    fromImpl.mockImplementationOnce(() => chain)
    await expect(api.fetchStaff()).resolves.toEqual([])
  })
})

describe('addStaff — nama pengguna & peran', () => {
  it('menyimpan nama yang sudah dirapikan spasinya', async () => {
    const chain = makeChain({ data: { id: 's1' }, error: null })
    fromImpl.mockImplementationOnce(() => chain)
    await api.addStaff('budi@x.com', ['produk'], 'staf', '  Budi   Santoso  ')
    expect(chain.insert).toHaveBeenCalledWith(expect.objectContaining({ name: 'Budi Santoso' }))
  })

  it('nama kosong sah — tabel jatuh ke bagian lokal email', async () => {
    const chain = makeChain({ data: { id: 's1' }, error: null })
    fromImpl.mockImplementationOnce(() => chain)
    await api.addStaff('budi@x.com', ['produk'])
    expect(chain.insert).toHaveBeenCalledWith(expect.objectContaining({ name: '' }))
  })

  it('menolak nama yang melampaui batas kolom', async () => {
    await expect(api.addStaff('budi@x.com', ['produk'], 'staf', 'a'.repeat(61)))
      .rejects.toThrow(/maksimal 60 karakter/i)
  })

  // Kepemilikan berasal dari staff_members.owner_id, bukan dari kolom role.
  // Nilai role di luar daftar putih diturunkan ke 'staf', tidak pernah dipakai apa adanya.
  it('tidak pernah menuliskan role owner walau diminta', async () => {
    const chain = makeChain({ data: { id: 's1' }, error: null })
    fromImpl.mockImplementationOnce(() => chain)
    await api.addStaff('budi@x.com', ['produk'], 'owner')
    expect(chain.insert).toHaveBeenCalledWith(expect.objectContaining({ role: 'staf' }))
  })
})

describe('updateStaff — whitelist patch', () => {
  it('mengabaikan kolom sensitif dan hanya menulis yang sah', async () => {
    const chain = makeChain({ data: { id: 's1' }, error: null })
    fromImpl.mockImplementationOnce(() => chain)
    await api.updateStaff('s1', {
      modules: ['produk'], name: 'Budi',
      owner_id: 'penyerang', member_id: 'penyerang', email: 'baru@x.com', role: 'owner',
    })
    expect(chain.update).toHaveBeenCalledWith({ modules: ['produk'], name: 'Budi' })
  })
})
