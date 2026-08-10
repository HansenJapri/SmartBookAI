import { describe, it, expect, beforeEach, vi } from 'vitest'

// supabase.rpc dimock supaya test tidak menyentuh jaringan.
const rpc = vi.fn()
vi.mock('../supabase', () => ({ supabase: { rpc: (...a) => rpc(...a) } }))

const {
  OTP_MAX_ATTEMPTS, OTP_BUCKET, statusOtp, catatOtpGagal, resetOtp, formatTunggu,
} = await import('../otpGuard')

const barisServer = (hits) => ({
  data: [{
    locked: hits >= OTP_MAX_ATTEMPTS,
    hits,
    remaining: Math.max(0, OTP_MAX_ATTEMPTS - hits),
    retry_after: 840,
  }],
  error: null,
})

beforeEach(() => {
  rpc.mockReset()
  localStorage.clear()
})

describe('statusOtp', () => {
  it('membaca status dari server tanpa menambah hitungan', async () => {
    rpc.mockResolvedValue(barisServer(2))
    const s = await statusOtp(OTP_BUCKET.login, 'Budi@Contoh.test')
    expect(rpc).toHaveBeenCalledWith('otp_attempt_status', expect.objectContaining({
      p_bucket: 'otp_login', p_subject: 'budi@contoh.test', p_limit: OTP_MAX_ATTEMPTS,
    }))
    expect(s).toMatchObject({ locked: false, hits: 2, remaining: 3, sumber: 'server' })
  })

  it('mengunci saat hitungan mencapai batas', async () => {
    rpc.mockResolvedValue(barisServer(OTP_MAX_ATTEMPTS))
    const s = await statusOtp(OTP_BUCKET.login, 'budi@contoh.test')
    expect(s.locked).toBe(true)
    expect(s.remaining).toBe(0)
  })

  it('jatuh ke cadangan lokal saat RPC gagal — penguncian tidak boleh hilang saat jaringan putus', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('offline') })
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) await catatOtpGagal(OTP_BUCKET.login, 'budi@contoh.test')
    const s = await statusOtp(OTP_BUCKET.login, 'budi@contoh.test')
    expect(s.sumber).toBe('lokal')
    expect(s.locked).toBe(true)
  })

  it('cadangan lokal boleh mengunci lebih ketat, tidak pernah lebih longgar', async () => {
    // Server bilang bersih, tapi peramban ini sudah mencatat 5 kegagalan.
    rpc.mockResolvedValueOnce({ data: null, error: new Error('offline') })
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      rpc.mockResolvedValueOnce({ data: null, error: new Error('offline') })
      await catatOtpGagal(OTP_BUCKET.login, 'budi@contoh.test')
    }
    rpc.mockResolvedValue(barisServer(0))
    const s = await statusOtp(OTP_BUCKET.login, 'budi@contoh.test')
    expect(s.locked).toBe(true)
  })

  it('email kosong tidak memicu permintaan jaringan', async () => {
    const s = await statusOtp(OTP_BUCKET.login, '')
    expect(rpc).not.toHaveBeenCalled()
    expect(s.locked).toBe(false)
  })
})

describe('catatOtpGagal', () => {
  it('meneruskan hasil hitungan server', async () => {
    rpc.mockResolvedValue(barisServer(3))
    const s = await catatOtpGagal(OTP_BUCKET.signup, 'a@b.test')
    expect(rpc).toHaveBeenCalledWith('otp_attempt_fail', expect.objectContaining({ p_bucket: 'otp_signup' }))
    expect(s).toMatchObject({ hits: 3, remaining: 2, locked: false })
  })
})

describe('resetOtp', () => {
  it('mengosongkan hitungan server dan cadangan lokal', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('offline') })
    await catatOtpGagal(OTP_BUCKET.recovery, 'a@b.test')
    rpc.mockResolvedValue({ data: null, error: null })
    await resetOtp(OTP_BUCKET.recovery, 'a@b.test')
    expect(rpc).toHaveBeenLastCalledWith('otp_attempt_reset', {
      p_bucket: 'otp_recovery', p_subject: 'a@b.test',
    })

    rpc.mockResolvedValue({ data: null, error: new Error('offline') })
    const s = await statusOtp(OTP_BUCKET.recovery, 'a@b.test')
    expect(s.hits).toBe(0)
  })
})

describe('pemisahan ember per alur', () => {
  it('gagal di alur login tidak menghabiskan jatah alur lupa-password', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('offline') })
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) await catatOtpGagal(OTP_BUCKET.login, 'a@b.test')
    const login = await statusOtp(OTP_BUCKET.login, 'a@b.test')
    const recovery = await statusOtp(OTP_BUCKET.recovery, 'a@b.test')
    expect(login.locked).toBe(true)
    expect(recovery.locked).toBe(false)
  })
})

describe('formatTunggu', () => {
  it('memakai mm:ss agar benar di kedua bahasa antarmuka', () => {
    expect(formatTunggu(90)).toBe('1:30')
    expect(formatTunggu(600)).toBe('10:00')
    expect(formatTunggu(5)).toBe('0:05')
    expect(formatTunggu(0)).toBe('0:00')
    expect(formatTunggu(-10)).toBe('0:00')
  })
})
