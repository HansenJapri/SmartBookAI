import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

// otpGuard dimock supaya test ini menguji PERILAKU HOOK (tarik status, hitung
// mundur, buka kunci sendiri) — bukan mengulang test aritmetika yang sudah ada
// di otpGuard.test.js.
const statusOtp = vi.fn()
const catatOtpGagal = vi.fn()
const resetOtp = vi.fn()

vi.mock('../otpGuard', async () => {
  const asli = await vi.importActual('../otpGuard')
  return {
    ...asli,
    statusOtp: (...a) => statusOtp(...a),
    catatOtpGagal: (...a) => catatOtpGagal(...a),
    resetOtp: (...a) => resetOtp(...a),
  }
})

const { useOtpLock, OTP_BUCKET, OTP_MAX_ATTEMPTS } = await import('../useOtpLock')

const status = (over = {}) => ({
  locked: false, hits: 0, remaining: OTP_MAX_ATTEMPTS, retryAfter: 0, sumber: 'server', ...over,
})

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  statusOtp.mockReset().mockResolvedValue(status())
  catatOtpGagal.mockReset().mockResolvedValue(status({ hits: 1, remaining: OTP_MAX_ATTEMPTS - 1 }))
  resetOtp.mockReset().mockResolvedValue(undefined)
})
afterEach(() => { vi.useRealTimers() })

describe('useOtpLock — penarikan status', () => {
  it('menarik status saat layar kode aktif', async () => {
    renderHook(() => useOtpLock(OTP_BUCKET.login, 'budi@contoh.test', true))
    await waitFor(() => expect(statusOtp).toHaveBeenCalledWith(OTP_BUCKET.login, 'budi@contoh.test'))
  })

  it('TIDAK menarik status saat layar kode belum aktif', () => {
    // Halaman login dibuka jauh lebih sering daripada layar OTP; menarik status
    // di setiap kunjungan adalah permintaan jaringan yang tak berguna.
    renderHook(() => useOtpLock(OTP_BUCKET.login, 'budi@contoh.test', false))
    expect(statusOtp).not.toHaveBeenCalled()
  })

  it('TIDAK menarik status saat email masih kosong', () => {
    renderHook(() => useOtpLock(OTP_BUCKET.login, '', true))
    expect(statusOtp).not.toHaveBeenCalled()
  })

  it('memunculkan penguncian yang sudah ada saat layar dibuka ulang', async () => {
    // Penguncian harus terbaca walau halaman dimuat ulang atau dibuka di tab lain.
    statusOtp.mockResolvedValue(status({ locked: true, hits: 5, remaining: 0, retryAfter: 90 }))
    const { result } = renderHook(() => useOtpLock(OTP_BUCKET.login, 'a@b.test', true))
    await waitFor(() => expect(result.current.terkunci).toBe(true))
    expect(result.current.sisaDetik).toBe(90)
    expect(result.current.tungguTeks).toBe('1:30')
  })

  it('mengabaikan balasan yang datang setelah hook dilepas', async () => {
    let selesaikan
    statusOtp.mockReturnValue(new Promise((r) => { selesaikan = r }))
    const { unmount } = renderHook(() => useOtpLock(OTP_BUCKET.login, 'a@b.test', true))
    unmount()
    // Menyetel state setelah unmount memicu peringatan React dan menandakan
    // kebocoran; hook harus membatalkan diri.
    await act(async () => { selesaikan(status({ locked: true, retryAfter: 60 })) })
  })
})

describe('useOtpLock — hitung mundur', () => {
  it('menghitung mundur tiap detik lalu MEMBUKA kunci sendiri', async () => {
    statusOtp.mockResolvedValue(status({ locked: true, remaining: 0, retryAfter: 3 }))
    const { result } = renderHook(() => useOtpLock(OTP_BUCKET.login, 'a@b.test', true))
    await waitFor(() => expect(result.current.terkunci).toBe(true))

    await act(async () => { vi.advanceTimersByTime(1000) })
    expect(result.current.sisaDetik).toBe(2)

    await act(async () => { vi.advanceTimersByTime(2000) })
    // Tanpa pembukaan otomatis, pengguna sah harus memuat ulang halaman untuk
    // bisa mencoba lagi — padahal masa kuncinya sudah lewat.
    expect(result.current.sisaDetik).toBe(0)
    expect(result.current.terkunci).toBe(false)
    expect(result.current.sisaPercobaan).toBe(OTP_MAX_ATTEMPTS)
  })

  it('tidak menjalankan pengatur waktu saat tidak terkunci', async () => {
    const { result } = renderHook(() => useOtpLock(OTP_BUCKET.login, 'a@b.test', true))
    await waitFor(() => expect(statusOtp).toHaveBeenCalled())
    await act(async () => { vi.advanceTimersByTime(5000) })
    expect(result.current.sisaDetik).toBe(0)
    expect(result.current.terkunci).toBe(false)
  })
})

describe('useOtpLock — catatGagal', () => {
  it('meneruskan hasil hitungan server ke pemanggil', async () => {
    const { result } = renderHook(() => useOtpLock(OTP_BUCKET.signup, 'a@b.test', true))
    await waitFor(() => expect(statusOtp).toHaveBeenCalled())

    catatOtpGagal.mockResolvedValue(status({ hits: 2, remaining: 3 }))
    let hasil
    await act(async () => { hasil = await result.current.catatGagal() })

    expect(catatOtpGagal).toHaveBeenCalledWith(OTP_BUCKET.signup, 'a@b.test')
    expect(hasil.remaining).toBe(3)
    expect(result.current.sisaPercobaan).toBe(3)
    expect(result.current.terkunci).toBe(false)
  })

  it('kegagalan ke-5 mengunci dan langsung memulai hitung mundur', async () => {
    const { result } = renderHook(() => useOtpLock(OTP_BUCKET.login, 'a@b.test', true))
    await waitFor(() => expect(statusOtp).toHaveBeenCalled())

    catatOtpGagal.mockResolvedValue(status({ locked: true, hits: 5, remaining: 0, retryAfter: 120 }))
    await act(async () => { await result.current.catatGagal() })

    expect(result.current.terkunci).toBe(true)
    expect(result.current.sisaDetik).toBe(120)
    expect(result.current.tungguTeks).toBe('2:00')
  })

  it('menjamin hitung mundur minimal 1 detik saat server mengembalikan 0', async () => {
    // retryAfter 0 + terkunci akan membekukan input selamanya karena pengatur
    // waktu tidak pernah jalan.
    const { result } = renderHook(() => useOtpLock(OTP_BUCKET.login, 'a@b.test', true))
    await waitFor(() => expect(statusOtp).toHaveBeenCalled())

    catatOtpGagal.mockResolvedValue(status({ locked: true, remaining: 0, retryAfter: 0 }))
    await act(async () => { await result.current.catatGagal() })
    expect(result.current.sisaDetik).toBeGreaterThanOrEqual(1)
  })
})

describe('useOtpLock — bersihkan', () => {
  it('mengembalikan jatah penuh setelah kode benar', async () => {
    statusOtp.mockResolvedValue(status({ locked: true, hits: 5, remaining: 0, retryAfter: 60 }))
    const { result } = renderHook(() => useOtpLock(OTP_BUCKET.recovery, 'a@b.test', true))
    await waitFor(() => expect(result.current.terkunci).toBe(true))

    await act(async () => { await result.current.bersihkan() })

    expect(resetOtp).toHaveBeenCalledWith(OTP_BUCKET.recovery, 'a@b.test')
    expect(result.current.terkunci).toBe(false)
    expect(result.current.sisaDetik).toBe(0)
    expect(result.current.sisaPercobaan).toBe(OTP_MAX_ATTEMPTS)
  })
})
