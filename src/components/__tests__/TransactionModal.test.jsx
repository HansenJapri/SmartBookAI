// Component test <TransactionModal> — pintu masuk utama data uang. Yang diuji
// adalah aturan yang kalau bocor langsung jadi data keuangan salah:
// validasi wajib (deskripsi/nominal/kategori), pemetaan payload ke onSave,
// piutang vs utang, dan perilaku kategori saat katalog telat termuat
// (regresi yang sudah didokumentasikan di komentar komponen).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const fetchProducts = vi.fn(async () => [])
const fetchSuppliers = vi.fn(async () => [])
vi.mock('../../lib/api', () => ({
  fetchProducts: (...a) => fetchProducts(...a),
  fetchSuppliers: (...a) => fetchSuppliers(...a),
}))

let katalog
vi.mock('../../context/CatalogContext', () => ({ useCatalog: () => katalog }))

beforeEach(() => {
  Element.prototype.getClientRects = function () {
    return this.isConnected ? [{ width: 10, height: 10 }] : []
  }
  fetchProducts.mockResolvedValue([])
  fetchSuppliers.mockResolvedValue([])
  katalog = {
    channels: [{ value: 'manual', label: 'Manual', icon: '' }],
    catNames: (dir) => (dir === 'in'
      ? ['Penjualan', 'Pendapatan Lain']
      : ['Belanja Stok', 'Pengeluaran Lain']),
  }
})

const TransactionModal = (await import('../TransactionModal')).default

const isiNominal = async (user, nilai) => {
  const input = screen.getByLabelText(/Nominal/i)
  await user.clear(input)
  await user.type(input, nilai)
}

describe('<TransactionModal> validasi', () => {
  it('menolak simpan tanpa deskripsi', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<TransactionModal onClose={() => {}} onSave={onSave} />)

    await isiNominal(user, '50000')
    await user.click(screen.getByRole('button', { name: 'Simpan' }))

    expect(await screen.findByText(/Deskripsi wajib diisi/i)).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('menolak nominal 0 — transaksi Rp 0 tidak boleh tersimpan', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<TransactionModal onClose={() => {}} onSave={onSave} />)

    await user.type(screen.getByLabelText('Deskripsi'), 'Penjualan kue')
    await isiNominal(user, '0')
    await user.click(screen.getByRole('button', { name: 'Simpan' }))

    expect(await screen.findByText(/Nominal harus lebih dari 0/i)).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
  })

  // Nominal negatif tidak bisa diketik ke <input type="number">, tapi BISA masuk
  // lewat data yang terlanjur tersimpan lalu dibuka untuk diedit. Di situ yang
  // menahan lebih dulu adalah constraint validation browser (min="0"), sebelum
  // validator JS sempat jalan. Yang penting: onSave TIDAK terpanggil.
  it('menolak nominal negatif yang datang dari data awal saat edit', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<TransactionModal
      initial={{ id: 'tx-9', direction: 'in', description: 'Koreksi', amount: -5000, category: 'Penjualan' }}
      onClose={() => {}} onSave={onSave} />)

    const nominal = screen.getByLabelText(/Nominal/i)
    expect(nominal).toHaveAttribute('min', '0')
    expect(nominal.checkValidity()).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Simpan' }))
    expect(onSave).not.toHaveBeenCalled()
  })
})

describe('<TransactionModal> penyimpanan', () => {
  it('meneruskan payload lengkap ke onSave lalu menutup modal', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async () => {})
    const onClose = vi.fn()
    render(<TransactionModal onClose={onClose} onSave={onSave} />)

    await user.type(screen.getByLabelText('Deskripsi'), 'Jual 3 kue coklat')
    await isiNominal(user, '45000')
    // Kategori dipilih eksplisit: yang diuji di sini pemetaan payload, bukan
    // tebakan auto-kategori (itu sudah punya test sendiri di categorize.test).
    await user.selectOptions(screen.getByLabelText('Kategori'), 'Penjualan')
    await user.click(screen.getByRole('button', { name: 'Simpan' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    const [payload, meta] = onSave.mock.calls[0]
    expect(payload).toMatchObject({
      description: 'Jual 3 kue coklat',
      amount: 45000,
      direction: 'in',
      category: 'Penjualan',
      payment_status: 'lunas',
      due_date: null,
    })
    expect(typeof payload.occurred_at).toBe('string')
    expect(meta).toMatchObject({ isNew: true, direction: 'in' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('memakai kategori pengeluaran saat arah diubah ke Pengeluaran', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async () => {})
    render(<TransactionModal onClose={() => {}} onSave={onSave} />)

    await user.click(screen.getByRole('button', { name: /Pengeluaran/ }))
    await user.type(screen.getByLabelText('Deskripsi'), 'Beli tepung')
    await isiNominal(user, '120000')
    await user.selectOptions(screen.getByLabelText('Kategori'), 'Belanja Stok')
    // Kategori belanja stok -> pemasok wajib (P11).
    await user.type(screen.getByLabelText('Nama pemasok baru'), 'Toko Grosir Jaya')
    await user.click(screen.getByRole('button', { name: 'Simpan' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0][0]).toMatchObject({
      direction: 'out',
      category: 'Belanja Stok',
      supplier_name: 'Toko Grosir Jaya',
    })
  })

  it('menolak pengeluaran belanja stok tanpa pemasok — pembelian tanpa lawan transaksi tidak bisa ditelusuri', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async () => {})
    render(<TransactionModal onClose={() => {}} onSave={onSave} />)

    await user.click(screen.getByRole('button', { name: /Pengeluaran/ }))
    await user.type(screen.getByLabelText('Deskripsi'), 'Beli tepung')
    await isiNominal(user, '120000')
    await user.selectOptions(screen.getByLabelText('Kategori'), 'Belanja Stok')
    await user.click(screen.getByRole('button', { name: 'Simpan' }))

    expect(await screen.findByText(/Pilih pemasok/i)).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('tidak mewajibkan pemasok untuk pengeluaran non-stok', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async () => {})
    render(<TransactionModal onClose={() => {}} onSave={onSave} />)

    await user.click(screen.getByRole('button', { name: /Pengeluaran/ }))
    await user.type(screen.getByLabelText('Deskripsi'), 'Bayar listrik')
    await isiNominal(user, '250000')
    await user.selectOptions(screen.getByLabelText('Kategori'), 'Pengeluaran Lain')
    await user.click(screen.getByRole('button', { name: 'Simpan' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0][0]).toMatchObject({ direction: 'out', supplier_id: null })
  })

  it('menandai piutang dan menyimpan jatuh tempo saat status "Belum Lunas"', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async () => {})
    render(<TransactionModal onClose={() => {}} onSave={onSave} />)

    await user.type(screen.getByLabelText('Deskripsi'), 'Bon Bu Sari')
    await isiNominal(user, '75000')
    await user.click(screen.getByRole('button', { name: 'Belum Lunas' }))

    expect(screen.getByText(/Tercatat sebagai PIUTANG/i)).toBeInTheDocument()
    await user.type(screen.getByLabelText(/Jatuh tempo/i), '2026-09-01')
    await user.click(screen.getByRole('button', { name: 'Simpan' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0][0]).toMatchObject({
      payment_status: 'belum',
      due_date: '2026-09-01',
    })
  })

  it('menampilkan pesan error dari onSave dan TIDAK menutup modal', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async () => { throw new Error('Koneksi terputus') })
    const onClose = vi.fn()
    render(<TransactionModal onClose={onClose} onSave={onSave} />)

    await user.type(screen.getByLabelText('Deskripsi'), 'Penjualan')
    await isiNominal(user, '10000')
    await user.click(screen.getByRole('button', { name: 'Simpan' }))

    expect(await screen.findByText('Koneksi terputus')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    // Tombol harus bisa ditekan lagi setelah gagal.
    expect(screen.getByRole('button', { name: 'Simpan' })).toBeEnabled()
  })

  it('memotong deskripsi pada 200 karakter', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async () => {})
    render(<TransactionModal onClose={() => {}} onSave={onSave} />)

    // Ditempel sekali, bukan diketik 220 kali: mengetik per-karakter memicu 220
    // siklus render dan membuat test ini menembus batas 5 detik saat suite
    // berjalan paralel — flaky yang tidak ada hubungannya dengan yang diuji.
    await user.click(screen.getByLabelText('Deskripsi'))
    await user.paste('x'.repeat(220))
    await isiNominal(user, '1000')
    await user.click(screen.getByRole('button', { name: 'Simpan' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0][0].description).toHaveLength(200)
  })
})

describe('<TransactionModal> kategori saat katalog telat termuat', () => {
  it('mengisi kategori begitu katalog datang, bukan membiarkannya kosong', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async () => {})
    // Katalog kosong saat modal pertama dirender (kondisi nyata: fetch belum selesai).
    katalog = { channels: [], catNames: () => [] }
    const { rerender } = render(<TransactionModal onClose={() => {}} onSave={onSave} />)
    expect(screen.getByText('(belum ada kategori)')).toBeInTheDocument()

    katalog = {
      channels: [{ value: 'manual', label: 'Manual', icon: '' }],
      catNames: (dir) => (dir === 'in' ? ['Penjualan'] : ['Belanja Stok']),
    }
    rerender(<TransactionModal onClose={() => {}} onSave={onSave} />)

    await user.type(screen.getByLabelText('Deskripsi'), 'Penjualan hari ini')
    await isiNominal(user, '25000')
    await user.click(screen.getByRole('button', { name: 'Simpan' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0][0].category).toBe('Penjualan')
  })
})

describe('<TransactionModal> aksesibilitas', () => {
  it('adalah dialog berlabel dengan judul yang sesuai mode', () => {
    render(<TransactionModal onClose={() => {}} onSave={vi.fn()} />)
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Tambah Transaksi')
  })

  it('berjudul "Edit Transaksi" dan menyembunyikan baris produk saat mengedit', () => {
    render(<TransactionModal
      initial={{ id: 'tx-1', direction: 'out', description: 'Listrik', amount: 300000, category: 'Belanja Stok' }}
      onClose={() => {}} onSave={vi.fn()} />)
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Edit Transaksi')
    expect(screen.queryByText(/Produk yang dibeli/i)).not.toBeInTheDocument()
  })
})
