// Penjaga pemetaan draft asisten -> baris database.
//
// Nilai enum di sini SENGAJA dikunci ke CHECK constraint database. Kalau suatu
// saat skema regulasi AI diubah ke istilah lain (mis. 'todo'), test ini gagal
// SEBELUM pengguna menemukan tugasnya ditolak Postgres.
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Modul api.js membuka koneksi Supabase saat diimpor; untuk menguji pemetaan
// murni kita cukup memalsukannya.
vi.mock('../api', () => ({
  addTransaction: vi.fn(), addTransactionWithStock: vi.fn(), updateTransaction: vi.fn(),
  deleteTransaction: vi.fn(), addProduct: vi.fn(), updateProduct: vi.fn(), deleteProduct: vi.fn(),
  addSupplier: vi.fn(), updateSupplier: vi.fn(), deleteSupplier: vi.fn(),
  addCustomer: vi.fn(), updateCustomer: vi.fn(), deleteCustomer: vi.fn(),
  resolveCustomer: vi.fn(async () => ({ customer: null, created: false })),
  addEmployee: vi.fn(), updateEmployee: vi.fn(), deleteEmployee: vi.fn(),
  setAttendance: vi.fn(), addKpiCriteria: vi.fn(), updateKpiCriteria: vi.fn(),
  deleteKpiCriteria: vi.fn(), saveKpiScores: vi.fn(), addPurchaseOrder: vi.fn(),
  updatePurchaseOrder: vi.fn(), fetchPurchaseOrders: vi.fn(), addTask: vi.fn(),
  updateTask: vi.fn(), deleteTask: vi.fn(), addReminder: vi.fn(), deleteReminder: vi.fn(),
}))

// setAsalAI menyalakan header penanda asal aksi. Dipalsukan supaya urutan
// nyala/matinya bisa diamati tanpa jaringan.
const jejakAsal = []
vi.mock('../supabase', () => ({
  supabase: null,
  setAsalAI: vi.fn((nyala) => { jejakAsal.push(Boolean(nyala)) }),
}))

const { toTransactionRow, toTaskRow, remindAtIso, occurredAtIso, saveDraftAction } = await import('../aiActions')
const api = await import('../api')

const draftTransaksi = (values) => ({ entity: 'transaksi', operation: 'create', values })

describe('pemetaan draft transaksi', () => {
  it('membulatkan nominal dan memakai default yang aman', () => {
    const row = toTransactionRow({ direction: 'in', amount: 45000.4, description: 'Jual kue', category: 'Penjualan' })
    expect(row.amount).toBe(45000)
    expect(row.direction).toBe('in')
    expect(row.channel).toBe('asisten')       // tidak disebut -> penanda asal data
    expect(row.payment_status).toBe('lunas')
  })

  it('menyertakan produk & qty hanya bila produk dipilih', () => {
    const tanpa = toTransactionRow({ direction: 'in', amount: 1000 })
    expect(tanpa.product_id).toBeUndefined()

    const dengan = toTransactionRow({ direction: 'in', amount: 1000, product_id: 'p1', qty: 3 })
    expect(dengan.product_id).toBe('p1')
    expect(dengan.qty).toBe(3)
  })

  it('qty default 1 bila produk dipilih tanpa jumlah', () => {
    expect(toTransactionRow({ direction: 'in', amount: 1000, product_id: 'p1' }).qty).toBe(1)
  })

  it('jatuh tempo hanya ikut saat belum lunas', () => {
    const lunas = toTransactionRow({ direction: 'in', amount: 1, payment_status: 'lunas', due_date: '2026-09-01' })
    expect(lunas.due_date).toBeUndefined()

    const belum = toTransactionRow({ direction: 'in', amount: 1, payment_status: 'belum', due_date: '2026-09-01' })
    expect(belum.due_date).toBe('2026-09-01')
  })

  it('tidak pernah mengirim deskripsi kosong ke kolom NOT NULL', () => {
    expect(toTransactionRow({ direction: 'out', amount: 5000 }).description).toBe('Pengeluaran')
    expect(toTransactionRow({ direction: 'in', amount: 5000 }).description).toBe('Pemasukan')
  })

  it('mempertahankan tanggal apa adanya, tidak bergeser ke UTC', () => {
    expect(occurredAtIso('2026-08-03').length).toBeGreaterThan(10)
    // Tanggal tak sah -> hari ini, bukan Invalid Date.
    expect(Number.isNaN(new Date(occurredAtIso('bukan-tanggal')).getTime())).toBe(false)
  })
})

describe('pemetaan draft tugas', () => {
  it('memakai nilai status berbahasa Indonesia sesuai CHECK constraint', () => {
    expect(toTaskRow({ title: 'A' }).status).toBe('antre')
    expect(toTaskRow({ title: 'A', status: 'dikerjakan' }).status).toBe('dikerjakan')
  })

  it('menolak nilai Inggris yang akan ditolak database', () => {
    expect(toTaskRow({ title: 'A', status: 'todo' }).status).toBe('antre')
    expect(toTaskRow({ title: 'A', status: 'done' }).status).toBe('antre')
  })

  it('prioritas default normal dan hanya menerima nilai sah', () => {
    expect(toTaskRow({ title: 'A' }).priority).toBe('normal')
    expect(toTaskRow({ title: 'A', priority: 'tinggi' }).priority).toBe('tinggi')
    expect(toTaskRow({ title: 'A', priority: 'high' }).priority).toBe('normal')
  })
})

describe('penautan pelanggan saat menyimpan transaksi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.resolveCustomer.mockResolvedValue({ customer: null, created: false })
  })

  it('tidak memanggil pencocokan bila kalimat tak menyebut pelanggan', async () => {
    await saveDraftAction(draftTransaksi({ direction: 'in', amount: 5000, description: 'Jual kopi' }))
    expect(api.resolveCustomer).not.toHaveBeenCalled()
    expect(api.addTransaction).toHaveBeenCalledOnce()
  })

  it('menautkan customer_id ketika pelanggan ditemukan', async () => {
    api.resolveCustomer.mockResolvedValue({ customer: { id: 'c1', name: 'Budi' }, created: false })
    await saveDraftAction(draftTransaksi({ direction: 'in', amount: 5000, customer_name: 'Budi' }))
    expect(api.addTransaction.mock.calls[0][0].customer_id).toBe('c1')
  })

  it('tetap mengisi kolom teks lama agar Piutang & Invoice tidak patah', async () => {
    api.resolveCustomer.mockResolvedValue({ customer: { id: 'c1', name: 'Budi' }, created: false })
    await saveDraftAction(draftTransaksi({
      direction: 'in', amount: 5000, customer_name: 'Budi', customer_contact: '08123',
    }))
    const row = api.addTransaction.mock.calls[0][0]
    expect(row.customer_name).toBe('Budi')
    expect(row.customer_contact).toBe('08123')
  })

  it('TIDAK menebak saat ada beberapa pelanggan bernama sama', async () => {
    api.resolveCustomer.mockResolvedValue({
      customer: null, created: false, candidates: [{ id: 'a' }, { id: 'b' }],
    })
    const pesan = await saveDraftAction(draftTransaksi({ direction: 'in', amount: 5000, customer_name: 'Budi' }))
    expect(api.addTransaction.mock.calls[0][0].customer_id).toBeUndefined()
    expect(pesan).toMatch(/2 pelanggan bernama/i)
  })

  it('kegagalan penautan tidak menggagalkan pencatatan transaksi', async () => {
    api.resolveCustomer.mockRejectedValue(new Error('jaringan mati'))
    await expect(
      saveDraftAction(draftTransaksi({ direction: 'in', amount: 5000, customer_name: 'Budi' })),
    ).resolves.toMatch(/tersimpan/i)
    expect(api.addTransaction).toHaveBeenCalledOnce()
  })

  it('menyimpan pelanggan lewat perintah khusus pelanggan', async () => {
    await saveDraftAction({ entity: 'pelanggan', operation: 'create', values: { name: 'Siti', phone: '08129' } })
    expect(api.addCustomer).toHaveBeenCalledWith(expect.objectContaining({ name: 'Siti', phone: '08129' }))
  })
})

describe('waktu pengingat', () => {
  it('tanggal tanpa jam dijadwalkan pukul 09.00 lokal', () => {
    const iso = remindAtIso('2026-08-05')
    expect(new Date(iso).getHours()).toBe(9)
  })

  it('menghormati jam yang disebut pengguna', () => {
    const iso = remindAtIso('2026-08-05T14:30')
    expect(new Date(iso).getHours()).toBe(14)
  })

  it('nilai rusak tidak menghasilkan Invalid Date', () => {
    expect(Number.isNaN(new Date(remindAtIso('xx')).getTime())).toBe(false)
  })
})


// ---------- Penanda asal aksi (audit log) ----------
//
// Bendera ini menentukan apakah baris audit tercatat via = 'ai' atau 'manual'.
// Bendera yang tertinggal menyala akan MELABELI AKSI MANUAL BERIKUTNYA sebagai
// aksi AI — kesalahan yang tidak akan disadari siapa pun sampai ada sengketa
// dan jejaknya ternyata bohong.
describe('penanda asal aksi AI', () => {
  beforeEach(() => { jejakAsal.length = 0 })

  it('menyala sebelum menyimpan dan padam sesudahnya', async () => {
    api.addTask.mockResolvedValueOnce({ id: 't1' })
    await saveDraftAction({ entity: 'tugas', operation: 'create', values: { title: 'Cek stok' } })
    expect(jejakAsal).toEqual([true, false])
  })

  it('PADAM meski penyimpanan gagal', async () => {
    // Tanpa blok finally, satu kegagalan menyimpan membuat setiap aksi manual
    // sesudahnya tercatat sebagai "dilakukan oleh AI".
    api.addTask.mockRejectedValueOnce(new Error('jaringan putus'))
    await expect(
      saveDraftAction({ entity: 'tugas', operation: 'create', values: { title: 'Cek stok' } }),
    ).rejects.toThrow('jaringan putus')
    expect(jejakAsal).toEqual([true, false])
  })

  it('padam juga saat draft ditolak validasi sebelum menyentuh jaringan', async () => {
    await expect(
      saveDraftAction({ entity: 'transaksi', operation: 'create', values: { product_id: 'bukan-uuid' } }),
    ).rejects.toThrow()
    expect(jejakAsal[jejakAsal.length - 1]).toBe(false)
  })
})
