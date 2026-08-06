// Component test <Modal> — fokus pada kontrak AKSESIBILITAS (useModalA11y),
// bukan tampilan. Empat perilaku yang diuji adalah yang benar-benar menjebak
// pengguna keyboard bila rusak: focus awal, focus trap, Escape, dan
// pengembalian fokus ke pemicu.
import { useState } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Modal from '../Modal'

// jsdom tidak menghitung layout, jadi getClientRects() selalu kosong dan
// useModalA11y akan menganggap SEMUA elemen tak terlihat. Dipalsukan agar
// elemen yang ada di DOM dianggap punya kotak layout.
beforeEach(() => {
  Element.prototype.getClientRects = function () {
    return this.isConnected ? [{ width: 10, height: 10 }] : []
  }
})

describe('<Modal> aksesibilitas', () => {
  it('memberi semantik dialog: role, aria-modal, dan aria-labelledby', () => {
    render(
      <Modal onClose={() => {}} labelledBy="judul">
        <h3 id="judul">Tambah Transaksi</h3>
        <button>Simpan</button>
      </Modal>,
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-labelledby', 'judul')
    expect(dialog).toHaveAccessibleName('Tambah Transaksi')
  })

  it('memindahkan fokus ke elemen fokusabel pertama saat dibuka', () => {
    render(
      <Modal onClose={() => {}}>
        <button>Pertama</button>
        <button>Kedua</button>
      </Modal>,
    )
    expect(screen.getByRole('button', { name: 'Pertama' })).toHaveFocus()
  })

  it('menahan Tab di elemen terakhir agar berputar ke elemen pertama', async () => {
    const user = userEvent.setup()
    render(
      <Modal onClose={() => {}}>
        <button>Pertama</button>
        <button>Terakhir</button>
      </Modal>,
    )
    const pertama = screen.getByRole('button', { name: 'Pertama' })
    const terakhir = screen.getByRole('button', { name: 'Terakhir' })

    await user.tab()
    expect(terakhir).toHaveFocus()
    // Dari elemen terakhir, Tab harus kembali ke pertama — tidak lolos ke halaman.
    await user.tab()
    expect(pertama).toHaveFocus()
  })

  it('menahan Shift+Tab di elemen pertama agar berputar ke elemen terakhir', async () => {
    const user = userEvent.setup()
    render(
      <Modal onClose={() => {}}>
        <button>Pertama</button>
        <button>Terakhir</button>
      </Modal>,
    )
    expect(screen.getByRole('button', { name: 'Pertama' })).toHaveFocus()
    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Terakhir' })).toHaveFocus()
  })

  it('menutup dialog saat Escape ditekan', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <Modal onClose={onClose}>
        <button>Simpan</button>
      </Modal>,
    )
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('menutup dialog saat backdrop diklik, tapi TIDAK saat isi dialog diklik', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { container } = render(
      <Modal onClose={onClose}>
        <button type="button">Isi</button>
      </Modal>,
    )
    await user.click(screen.getByRole('button', { name: 'Isi' }))
    expect(onClose).not.toHaveBeenCalled()

    await user.click(container.querySelector('.modal-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('mengembalikan fokus ke elemen pemicu setelah dialog ditutup', async () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>Buka</button>
          {open && (
            <Modal onClose={() => setOpen(false)}>
              <button onClick={() => setOpen(false)}>Tutup</button>
            </Modal>
          )}
        </>
      )
    }
    const user = userEvent.setup()
    render(<Harness />)
    const pemicu = screen.getByRole('button', { name: 'Buka' })
    await user.click(pemicu)
    expect(screen.getByRole('button', { name: 'Tutup' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Tutup' }))
    expect(pemicu).toHaveFocus()
  })

  it('merender <form> dan meneruskan submit bila onSubmit diberikan', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn((e) => e.preventDefault())
    render(
      <Modal onClose={() => {}} onSubmit={onSubmit}>
        <button type="submit">Simpan</button>
      </Modal>,
    )
    expect(screen.getByRole('dialog').tagName).toBe('FORM')
    await user.click(screen.getByRole('button', { name: 'Simpan' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })
})
