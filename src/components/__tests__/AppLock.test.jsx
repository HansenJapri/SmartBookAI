// Component test <AppLock> — overlay PIN (S-5 di §1.7). Yang diuji: overlay
// hanya muncul bila PIN dipasang DAN status terkunci, PIN salah tidak membuka
// dan mengosongkan kolom, PIN benar membuka, serta ada jalan keluar bila PIN
// lupa. Modul applock di-mock agar test deterministik tanpa crypto.subtle.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const signOut = vi.fn()
const applock = {
  LOCK_TIMEOUT_MS: 600000,
  hasPin: vi.fn(() => true),
  verifyPin: vi.fn(async (_uid, pin) => pin === '1234'),
  markActive: vi.fn(),
  lastActive: vi.fn(() => Date.now()),
  isLocked: vi.fn(() => true),
  setLockedFlag: vi.fn(),
  requestLock: vi.fn(),
}

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, signOut: (...a) => signOut(...a) }),
}))
vi.mock('../../lib/applock', () => applock)

const AppLock = (await import('../AppLock')).default

describe('<AppLock>', () => {
  beforeEach(() => {
    signOut.mockReset()
    applock.hasPin.mockReturnValue(true)
    applock.isLocked.mockReturnValue(true)
    applock.lastActive.mockReturnValue(Date.now())
    applock.verifyPin.mockClear()
    applock.setLockedFlag.mockClear()
  })

  it('tidak merender apa pun bila pengguna belum memasang PIN', () => {
    applock.hasPin.mockReturnValue(false)
    const { container } = render(<AppLock />)
    expect(container).toBeEmptyDOMElement()
  })

  it('tidak merender apa pun bila PIN dipasang tapi status belum terkunci', () => {
    applock.isLocked.mockReturnValue(false)
    const { container } = render(<AppLock />)
    expect(container).toBeEmptyDOMElement()
  })

  it('menampilkan overlay kunci sebagai dialog modal saat terkunci', () => {
    render(<AppLock />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('heading', { name: /layar terkunci/i })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Masukkan PIN')).toHaveAttribute('type', 'password')
  })

  it('menolak PIN salah, menampilkan pesan, dan mengosongkan kolom', async () => {
    const user = userEvent.setup()
    render(<AppLock />)
    await user.type(screen.getByPlaceholderText('Masukkan PIN'), '9999')
    await user.click(screen.getByRole('button', { name: /buka kunci/i }))

    expect(await screen.findByText(/PIN salah/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Masukkan PIN')).toHaveValue('')
    // Layar TETAP terkunci — overlay tidak boleh hilang.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('membuka kunci dan menghapus overlay saat PIN benar', async () => {
    const user = userEvent.setup()
    render(<AppLock />)
    await user.type(screen.getByPlaceholderText('Masukkan PIN'), '1234')
    await user.click(screen.getByRole('button', { name: /buka kunci/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(applock.setLockedFlag).toHaveBeenCalledWith('user-1', false)
  })

  it('menyediakan jalan keluar "lupa PIN" lewat keluar akun', async () => {
    const user = userEvent.setup()
    render(<AppLock />)
    await user.click(screen.getByRole('button', { name: /lupa pin/i }))
    expect(signOut).toHaveBeenCalledTimes(1)
  })
})
