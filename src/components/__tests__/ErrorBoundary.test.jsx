// Component test <ErrorBoundary> — gerbang G-14 / metrik "crash & layar putih
// saat AI gagal = 0" bergantung pada komponen ini. Yang diuji: error render
// ditangkap, pesan ramah muncul (bukan layar kosong), dan insiden dilaporkan
// ke monitoring.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const logClientError = vi.fn()
vi.mock('../../lib/monitoring', () => ({ logClientError: (...a) => logClientError(...a) }))

const ErrorBoundary = (await import('../ErrorBoundary')).default

function Meledak({ pesan = 'Gagal memuat insight AI' }) {
  throw new Error(pesan)
}

describe('<ErrorBoundary>', () => {
  beforeEach(() => {
    logClientError.mockReset()
    // React memang mencetak error yang tertangkap ke console; dibungkam agar
    // keluaran test tetap terbaca.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('merender anak seperti biasa saat tidak ada error', () => {
    render(<ErrorBoundary><p>Isi halaman</p></ErrorBoundary>)
    expect(screen.getByText('Isi halaman')).toBeInTheDocument()
  })

  it('menangkap error render dan menampilkan pesan ramah, bukan layar kosong', () => {
    const { container } = render(<ErrorBoundary><Meledak /></ErrorBoundary>)
    expect(screen.getByRole('heading', { name: /terjadi kendala/i })).toBeInTheDocument()
    expect(container).not.toBeEmptyDOMElement()
  })

  it('menyediakan jalan keluar berupa tombol muat ulang', async () => {
    const user = userEvent.setup()
    const reload = vi.fn()
    // window.location.reload tidak bisa di-spy langsung di jsdom; diganti objek.
    const asli = window.location
    delete window.location
    window.location = { ...asli, reload }

    render(<ErrorBoundary><Meledak /></ErrorBoundary>)
    await user.click(screen.getByRole('button', { name: /muat ulang/i }))
    expect(reload).toHaveBeenCalledTimes(1)

    window.location = asli
  })

  it('melaporkan error ke monitoring untuk diagnosis', () => {
    render(<ErrorBoundary><Meledak pesan="Boom insight" /></ErrorBoundary>)
    expect(logClientError).toHaveBeenCalledWith(
      'react.render',
      'Boom insight',
      expect.objectContaining({ stack: expect.any(String) }),
    )
  })

  it('tidak membocorkan pesan error mentah ke pengguna', () => {
    render(<ErrorBoundary><Meledak pesan="TypeError: undefined is not a function at api.js:42" /></ErrorBoundary>)
    expect(screen.queryByText(/api\.js:42/)).not.toBeInTheDocument()
  })
})
