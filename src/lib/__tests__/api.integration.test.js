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
    expect(rpc).toHaveBeenCalledWith('post_stock_opname', { p_opname_id: 'so-1', p_items: items })
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

  it('kembali ke workspace sendiri bila keanggotaan sudah dicabut', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'staff-9' } } })
    api.setSelectedWorkspace('boss-1')
    // Keanggotaan tidak ditemukan lagi (dicabut owner) -> jangan paksa masuk.
    fromImpl.mockImplementationOnce(() => makeChain({ data: [], error: null }))
    const owner = await api.effectiveOwnerId()
    expect(owner).toBe('staff-9')
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
