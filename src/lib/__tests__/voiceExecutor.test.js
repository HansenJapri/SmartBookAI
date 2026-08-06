// ============================================================
// voiceExecutor.js — sebelumnya 38% baris dan 0% FUNGSI: tidak satu pun
// fungsi ekspornya pernah dipanggil test.
//
// Ini satu-satunya berkas di jalur suara yang MENULIS ke database (§1.3 objek
// uji E & G). Karena itu yang diuji paling keras bukan jalur suksesnya,
// melainkan jalur GAGALNYA: setiap penolakan wajib terjadi SEBELUM ada
// panggilan tulis. Perintah suara yang ambigu lalu ditebak adalah cara
// tercepat menghapus produk yang salah.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest'

const api = {
  addProduct: vi.fn(async () => ({ id: 'p-baru' })),
  addReminder: vi.fn(async () => ({ id: 'r1' })),
  addTransactionsBulk: vi.fn(async () => [{ id: 'tx1' }]),
  deleteProduct: vi.fn(async () => true),
  fetchProducts: vi.fn(async () => []),
  updateProduct: vi.fn(async () => true),
}
vi.mock('../api', () => api)

const {
  executeCommand, resolveProduct, buildTransactionRow, VoiceCommandError,
} = await import('../voiceExecutor')

/** Semua fungsi tulis di api — dipakai untuk membuktikan "tidak ada yang tersimpan". */
const semuaPenulis = () => [api.addProduct, api.addReminder, api.addTransactionsBulk,
  api.deleteProduct, api.updateProduct]
const tidakAdaYangDitulis = () => semuaPenulis().every((f) => f.mock.calls.length === 0)

beforeEach(() => {
  for (const f of Object.values(api)) f.mockClear()
  api.fetchProducts.mockResolvedValue([])
})

// ---------- Field wajib ----------

describe('field wajib ditolak sebelum menyentuh jaringan', () => {
  it.each([
    ['create_transaksi', {}, 'direction, amount'],
    ['create_transaksi', { direction: 'in' }, 'amount'],
    ['create_produk', {}, 'name'],
    ['update_produk', {}, 'name'],
    ['delete_produk', {}, 'name'],
    ['create_pengingat', {}, 'title'],
  ])('%s tanpa %s ditolak', async (name, args, kurang) => {
    await expect(executeCommand({ name, args })).rejects.toThrow(
      new RegExp(kurang.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    )
    expect(tidakAdaYangDitulis()).toBe(true)
    // Bahkan pembacaan katalog pun tidak terjadi — tolak sedini mungkin.
    expect(api.fetchProducts).not.toHaveBeenCalled()
  })

  it('memperlakukan string kosong dan null sebagai belum diisi', async () => {
    await expect(executeCommand({ name: 'create_produk', args: { name: '' } })).rejects.toThrow(VoiceCommandError)
    await expect(executeCommand({ name: 'create_produk', args: { name: null } })).rejects.toThrow(VoiceCommandError)
    expect(tidakAdaYangDitulis()).toBe(true)
  })

  it('menolak nominal NaN/Infinity yang lolos dari pengenal suara', async () => {
    await expect(executeCommand({
      name: 'create_transaksi', args: { direction: 'in', amount: NaN },
    })).rejects.toThrow(VoiceCommandError)
    await expect(executeCommand({
      name: 'create_transaksi', args: { direction: 'in', amount: Infinity },
    })).rejects.toThrow(VoiceCommandError)
    expect(tidakAdaYangDitulis()).toBe(true)
  })

  it('memberi pesan dalam Bahasa Inggris bila lang = en', async () => {
    await expect(executeCommand({ name: 'create_produk', args: {} }, 'en'))
      .rejects.toThrow(/Incomplete data/)
  })

  it('kode error MISSING_FIELDS bisa dibedakan pemanggil', async () => {
    await executeCommand({ name: 'create_produk', args: {} }).catch((e) => {
      expect(e).toBeInstanceOf(VoiceCommandError)
      expect(e.code).toBe('MISSING_FIELDS')
    })
    expect.assertions(2)
  })
})

// ---------- Perintah tak dikenal ----------

describe('perintah tak dikenal', () => {
  it('ditolak dengan kode UNSUPPORTED tanpa menulis apa pun', async () => {
    await expect(executeCommand({ name: 'hapus_semua_transaksi', args: {} }))
      .rejects.toMatchObject({ code: 'UNSUPPORTED' })
    expect(tidakAdaYangDitulis()).toBe(true)
  })

  it('perintah tanpa nama juga ditolak', async () => {
    await expect(executeCommand({})).rejects.toMatchObject({ code: 'UNSUPPORTED' })
    await expect(executeCommand(null)).rejects.toMatchObject({ code: 'UNSUPPORTED' })
    expect(tidakAdaYangDitulis()).toBe(true)
  })
})

// ---------- Transaksi ----------

describe('create_transaksi', () => {
  it('menyimpan satu baris transaksi dengan nilai yang diucapkan', async () => {
    const hasil = await executeCommand({
      name: 'create_transaksi',
      args: { direction: 'in', amount: 45000, description: 'Jual kue', category: 'Penjualan' },
    })

    expect(api.addTransactionsBulk).toHaveBeenCalledTimes(1)
    const [baris] = api.addTransactionsBulk.mock.calls[0][0]
    expect(baris).toMatchObject({
      description: 'Jual kue', amount: 45000, direction: 'in',
      category: 'Penjualan', payment_status: 'lunas',
    })
    expect(hasil).toEqual({ ok: true, entity: 'transaksi', operation: 'create' })
  })

  it('menandai channel "asisten" agar asal catatan bisa ditelusuri pengguna', async () => {
    await executeCommand({ name: 'create_transaksi', args: { direction: 'in', amount: 1000 } })
    expect(api.addTransactionsBulk.mock.calls[0][0][0].channel).toBe('asisten')
  })

  it('menolak nominal nol dan negatif', async () => {
    for (const amount of [0, -5000]) {
      await expect(executeCommand({ name: 'create_transaksi', args: { direction: 'in', amount } }))
        .rejects.toMatchObject({ code: 'MISSING_FIELDS' })
    }
    expect(api.addTransactionsBulk).not.toHaveBeenCalled()
  })

  it('membulatkan nominal pecahan', async () => {
    await executeCommand({ name: 'create_transaksi', args: { direction: 'in', amount: 45000.7 } })
    expect(api.addTransactionsBulk.mock.calls[0][0][0].amount).toBe(45001)
  })

  it('arah selain "in" dianggap pengeluaran', async () => {
    await executeCommand({ name: 'create_transaksi', args: { direction: 'apa pun', amount: 1000 } })
    expect(api.addTransactionsBulk.mock.calls[0][0][0].direction).toBe('out')
  })
})

describe('buildTransactionRow', () => {
  it('memberi deskripsi bawaan sesuai arah bila tidak disebutkan', () => {
    expect(buildTransactionRow({ direction: 'in', amount: 1 }).description).toBe('Penjualan')
    expect(buildTransactionRow({ direction: 'out', amount: 1 }).description).toBe('Pengeluaran')
  })

  it('memotong deskripsi pada 200 karakter', () => {
    expect(buildTransactionRow({ direction: 'in', amount: 1, description: 'x'.repeat(300) })
      .description).toHaveLength(200)
  })

  it('kategori kosong disimpan sebagai null, bukan string kosong', () => {
    expect(buildTransactionRow({ direction: 'in', amount: 1 }).category).toBeNull()
  })

  it('occurred_at berupa ISO string yang sah', () => {
    const row = buildTransactionRow({ direction: 'in', amount: 1 })
    expect(Number.isNaN(new Date(row.occurred_at).getTime())).toBe(false)
  })
})

// ---------- Pencocokan produk ----------

describe('resolveProduct — menolak menebak', () => {
  it('cocok persis tanpa peduli huruf besar-kecil', async () => {
    api.fetchProducts.mockResolvedValue([{ id: 'p1', name: 'Tepung Terigu' }])
    expect((await resolveProduct('tepung terigu')).id).toBe('p1')
  })

  it('cocok sebagian bila hanya satu kandidat', async () => {
    api.fetchProducts.mockResolvedValue([{ id: 'p1', name: 'Tepung Terigu Segitiga' }])
    expect((await resolveProduct('terigu')).id).toBe('p1')
  })

  it('BERHENTI dan bertanya bila beberapa produk cocok sebagian', async () => {
    api.fetchProducts.mockResolvedValue([
      { id: 'p1', name: 'Tepung Terigu Segitiga' },
      { id: 'p2', name: 'Tepung Terigu Cakra' },
    ])
    await expect(resolveProduct('terigu')).rejects.toMatchObject({ code: 'AMBIGUOUS' })
  })

  it('BERHENTI bila ada dua produk bernama sama persis', async () => {
    api.fetchProducts.mockResolvedValue([
      { id: 'p1', name: 'Gula' }, { id: 'p2', name: 'Gula' },
    ])
    await expect(resolveProduct('gula')).rejects.toMatchObject({ code: 'AMBIGUOUS' })
  })

  it('menyebut nama-nama kandidat agar pengguna bisa memilih', async () => {
    api.fetchProducts.mockResolvedValue([
      { id: 'p1', name: 'Tepung A' }, { id: 'p2', name: 'Tepung B' },
    ])
    await expect(resolveProduct('tepung')).rejects.toThrow(/Tepung A.*Tepung B/)
  })

  it('membatasi daftar kandidat yang dibacakan agar tidak kepanjangan', async () => {
    api.fetchProducts.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, name: `Tepung ${i}` })),
    )
    const err = await resolveProduct('tepung').catch((e) => e)
    expect(err.message.match(/Tepung \d/g)).toHaveLength(5)
  })

  it('mengabaikan spasi ganda dari pengenal suara', async () => {
    api.fetchProducts.mockResolvedValue([{ id: 'p1', name: 'gula pasir' }])
    expect((await resolveProduct('  Gula   Pasir  ')).id).toBe('p1')
  })

  it('NOT_FOUND bila katalog kosong atau tidak ada yang cocok', async () => {
    await expect(resolveProduct('apa saja')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    api.fetchProducts.mockResolvedValue([{ id: 'p1', name: 'Gula' }])
    await expect(resolveProduct('semen')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

// ---------- Produk ----------

describe('create_produk', () => {
  it('menyimpan produk dengan nilai bawaan yang aman', async () => {
    await executeCommand({ name: 'create_produk', args: { name: 'Kue Coklat' } })
    expect(api.addProduct).toHaveBeenCalledWith({
      name: 'Kue Coklat', category: '', unit: 'pcs', stock: 0, price: 0, cost_price: 0,
    })
  })

  it('memotong nama produk pada 120 karakter', async () => {
    await executeCommand({ name: 'create_produk', args: { name: 'x'.repeat(200) } })
    expect(api.addProduct.mock.calls[0][0].name).toHaveLength(120)
  })

  it('memperlakukan angka non-numerik sebagai 0', async () => {
    await executeCommand({ name: 'create_produk', args: { name: 'A', stock: 'banyak', price: 'mahal' } })
    expect(api.addProduct.mock.calls[0][0]).toMatchObject({ stock: 0, price: 0 })
  })
})

describe('update_produk', () => {
  beforeEach(() => api.fetchProducts.mockResolvedValue([{ id: 'p1', name: 'Gula' }]))

  it('memperbarui hanya field yang disebutkan', async () => {
    const hasil = await executeCommand({ name: 'update_produk', args: { name: 'Gula', stock: 50 } })
    expect(api.updateProduct).toHaveBeenCalledWith('p1', { stock: 50 })
    expect(hasil).toMatchObject({ operation: 'update', target: 'Gula' })
  })

  it('bisa memperbarui harga jual dan harga modal sekaligus', async () => {
    await executeCommand({ name: 'update_produk', args: { name: 'Gula', price: 15000, cost_price: 12000 } })
    expect(api.updateProduct).toHaveBeenCalledWith('p1', { price: 15000, cost_price: 12000 })
  })

  it('memperbolehkan stok 0 (bukan dianggap "tidak disebutkan")', async () => {
    await executeCommand({ name: 'update_produk', args: { name: 'Gula', stock: 0 } })
    expect(api.updateProduct).toHaveBeenCalledWith('p1', { stock: 0 })
  })

  it('menolak bila tidak ada nilai baru yang disebutkan', async () => {
    await expect(executeCommand({ name: 'update_produk', args: { name: 'Gula' } }))
      .rejects.toMatchObject({ code: 'MISSING_FIELDS' })
    expect(api.updateProduct).not.toHaveBeenCalled()
  })

  it('tidak memperbarui apa pun bila produknya ambigu', async () => {
    api.fetchProducts.mockResolvedValue([{ id: 'p1', name: 'Gula A' }, { id: 'p2', name: 'Gula B' }])
    await expect(executeCommand({ name: 'update_produk', args: { name: 'Gula', stock: 5 } }))
      .rejects.toMatchObject({ code: 'AMBIGUOUS' })
    expect(api.updateProduct).not.toHaveBeenCalled()
  })
})

describe('delete_produk', () => {
  it('menghapus produk yang cocok tunggal dan melaporkan namanya', async () => {
    api.fetchProducts.mockResolvedValue([{ id: 'p1', name: 'Gula' }])
    const hasil = await executeCommand({ name: 'delete_produk', args: { name: 'Gula' } })
    expect(api.deleteProduct).toHaveBeenCalledWith('p1')
    expect(hasil).toMatchObject({ operation: 'delete', target: 'Gula' })
  })

  it('TIDAK menghapus apa pun bila nama ambigu', async () => {
    api.fetchProducts.mockResolvedValue([{ id: 'p1', name: 'Gula A' }, { id: 'p2', name: 'Gula B' }])
    await expect(executeCommand({ name: 'delete_produk', args: { name: 'Gula' } }))
      .rejects.toMatchObject({ code: 'AMBIGUOUS' })
    expect(api.deleteProduct).not.toHaveBeenCalled()
  })

  it('TIDAK menghapus apa pun bila produk tidak ditemukan', async () => {
    await expect(executeCommand({ name: 'delete_produk', args: { name: 'Semen' } }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(api.deleteProduct).not.toHaveBeenCalled()
  })
})

// ---------- Pengingat ----------

describe('create_pengingat', () => {
  it('menyimpan pengingat dengan judul dan catatan', async () => {
    await executeCommand({
      name: 'create_pengingat', args: { title: 'Bayar listrik', note: 'sebelum tanggal 20' },
    })
    expect(api.addReminder).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Bayar listrik', note: 'sebelum tanggal 20',
    }))
  })

  it('menjadwalkan satu jam dari sekarang bila waktunya tidak disebutkan', async () => {
    const sebelum = Date.now()
    await executeCommand({ name: 'create_pengingat', args: { title: 'Cek stok' } })

    const waktu = new Date(api.addReminder.mock.calls[0][0].remind_at).getTime()
    expect(waktu).toBeGreaterThanOrEqual(sebelum + 3600_000 - 5000)
    expect(waktu).toBeLessThanOrEqual(Date.now() + 3600_000 + 5000)
  })

  it('memakai waktu yang disebutkan pengguna bila ada', async () => {
    await executeCommand({
      name: 'create_pengingat', args: { title: 'X', remind_at: '2026-09-01T08:00:00.000Z' },
    })
    expect(api.addReminder.mock.calls[0][0].remind_at).toBe('2026-09-01T08:00:00.000Z')
  })

  it('memotong judul 200 dan catatan 500 karakter', async () => {
    await executeCommand({
      name: 'create_pengingat', args: { title: 'x'.repeat(300), note: 'y'.repeat(700) },
    })
    const arg = api.addReminder.mock.calls[0][0]
    expect(arg.title).toHaveLength(200)
    expect(arg.note).toHaveLength(500)
  })

  it('catatan kosong disimpan sebagai string kosong', async () => {
    await executeCommand({ name: 'create_pengingat', args: { title: 'X' } })
    expect(api.addReminder.mock.calls[0][0].note).toBe('')
  })
})
