import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLang } from '../context/LangContext'
import AuthSide from '../components/AuthSide'
import OtpInput from '../components/OtpInput'
import OtpCountdown from '../components/OtpCountdown'
import useForceLightTheme from '../lib/useForceLightTheme'
import { useOtpLock, OTP_BUCKET, OTP_MAX_ATTEMPTS } from '../lib/useOtpLock'

// Login dua langkah: password -> kode 8 digit dari email.
//
// Sesi TIDAK terbit saat password benar. Langkah 1 hanya memicu Edge Function
// auth-login-otp yang memverifikasi password di server lalu meminta Supabase
// mengirim kode. Browser baru mendapat sesi di langkah 2, setelah verifyOtp()
// menerima kode yang cocok dan belum kedaluwarsa.
export default function Login() {
  useForceLightTheme()
  const { startLogin, verifyLoginOtp, resendLoginOtp, OTP_TTL_SECONDS } = useAuth()
  const { t } = useLang()
  const a = t.auth
  const nav = useNavigate()
  const [step, setStep] = useState('form')   // 'form' | 'otp'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [sentAt, setSentAt] = useState(0)
  const [kedaluwarsa, setKedaluwarsa] = useState(false)
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)
  // Detik tersisa sebelum "Kirim ulang" boleh ditekan. Supabase membatasi jeda
  // antar-email ke alamat yang sama (bawaan 60 detik); tanpa penghitung ini
  // pengguna menekan tombolnya berulang kali dan hanya mendapat pesan gagal.
  const [tungguKirim, setTungguKirim] = useState(0)
  // Pembatas percobaan kode (P2): 5 kali salah -> input dikunci 15 menit.
  const kunci = useOtpLock(OTP_BUCKET.login, email, step === 'otp')

  useEffect(() => {
    if (tungguKirim <= 0) return
    const id = setInterval(() => setTungguKirim((n) => Math.max(0, n - 1)), 1000)
    return () => clearInterval(id)
  }, [tungguKirim])

  // Edge Function menjawab dengan kode sebab, bukan kalimat — supaya pesan ke
  // pengguna tetap konsisten di kedua bahasa dan tidak membocorkan detail.
  // Sebab yang tidak dikenali TIDAK boleh jatuh ke "password salah" — lihat
  // catatan di startLogin(). Kegagalan layanan punya pesannya sendiri.
  const pesanSebab = (e2) => {
    const map = {
      invalid_credentials: a.errInvalid,
      // Dibedakan dari invalid_credentials sejak 8 Sep 2026: pengguna yang
      // belum pernah mendaftar perlu tahu bahwa yang kurang adalah AKUNNYA,
      // bukan ketepatan kata sandinya.
      email_not_registered: a.errNotRegistered,
      email_not_confirmed: a.errUnconfirmed,
      otp_send_failed: a.errOtpSend,
      email_delivery_failed: a.errEmailDelivery,
      // Kuota per jam — TIDAK punya hitung mundur detik. Menjanjikan angka di
      // sini justru menyesatkan: pengguna menunggu sebentar lalu gagal lagi.
      email_quota_exceeded: a.errEmailQuota,
      service_unavailable: a.errService,
    }
    // Pembatas milik aplikasi sendiri (5/10 menit, 30/jam per email & IP),
    // dipasang sebelum password diperiksa. Berbeda dari throttle Supabase.
    if (e2.message === 'too_many_requests') return a.errTooMany
    if (e2.message === 'rate_limited') {
      // Angka detiknya ditampilkan hidup di tombol, bukan dibekukan di pesan.
      return a.errRateShort
    }
    return map[e2.message] || a.errService
  }

  const submitForm = async (e) => {
    e.preventDefault()
    setErr(''); setInfo(''); setBusy(true)
    try {
      const { resendAfter } = await startLogin({ email, password })
      setOtp(''); setKedaluwarsa(false)
      setSentAt(Date.now())
      setTungguKirim(resendAfter)
      setInfo(`${a.infoCodeSent}${email}.`)
      setStep('otp')
    } catch (e2) {
      if (e2.message === 'rate_limited' || e2.message === 'too_many_requests') {
        setTungguKirim(e2.retryAfter || 60)
      }
      setErr(pesanSebab(e2))
    } finally { setBusy(false) }
  }

  const submitOtp = async (e) => {
    e.preventDefault()
    setErr('')
    if (kunci.terkunci) return setErr(a.errOtpLocked.replace('{waktu}', kunci.tungguTeks))
    if (otp.length < 8) return setErr(a.errOtp8)
    setBusy(true)
    try {
      await verifyLoginOtp({ email, token: otp })
      await kunci.bersihkan()
      nav('/app')
    } catch {
      // Kode salah dicatat sebagai satu percobaan. Setelah batas tercapai,
      // input dikunci — kode 8 digit yang boleh ditebak tanpa batas selama masa
      // berlakunya adalah permukaan brute-force yang nyata.
      const s = await kunci.catatGagal()
      setOtp('')
      setErr(s.locked
        ? a.errOtpLocked.replace('{waktu}', kunci.tungguTeks || `${Math.ceil(s.retryAfter / 60)} menit`)
        : a.errOtpWrongLeft.replace('{n}', s.remaining))
    } finally { setBusy(false) }
  }

  const resend = async () => {
    if (tungguKirim > 0) return
    setErr(''); setInfo(''); setBusy(true)
    try {
      const { resendAfter } = await resendLoginOtp({ email, password })
      setOtp(''); setKedaluwarsa(false)
      setSentAt(Date.now())
      setTungguKirim(resendAfter)
      setInfo(a.infoResent)
    } catch (e2) {
      if (e2.message === 'rate_limited' || e2.message === 'too_many_requests') {
        setTungguKirim(e2.retryAfter || 60)
      }
      setErr(pesanSebab(e2))
    } finally { setBusy(false) }
  }

  const kembali = () => {
    setStep('form'); setOtp(''); setErr(''); setInfo(''); setKedaluwarsa(false)
  }

  return (
    <div className="auth-wrap">
      <AuthSide title={a.sideLoginTitle} subtitle={a.sideLoginSub}
        points={[a.sideLoginP1, a.sideLoginP2, a.sideLoginP3, a.sideLoginP4]} />
      <div className="auth-main">
        {step === 'form' ? (
          <form className="auth-card" onSubmit={submitForm}>
            <h1>{a.loginTitle}</h1>
            <p className="sub">{a.loginSub} 👋</p>
            {err && <div className="alert alert-err">{err}</div>}
            <div className="field">
              <label htmlFor="login-email">{a.email}</label>
              <input id="login-email" className="input" type="email" required value={email}
                onChange={(e) => setEmail(e.target.value)} placeholder={a.emailPh} />
            </div>
            <div className="field">
              <div className="flex between">
                <label htmlFor="login-password" style={{ marginBottom: 0 }}>{a.password}</label>
                <Link to="/lupa-password" className="linklike" style={{ fontSize: 13 }}>{a.forgot}</Link>
              </div>
              <input id="login-password" className="input" type="password" required value={password} style={{ marginTop: 7 }}
                onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
            </div>
            {/* Selama jeda throttle, tombolnya dikunci dan menampilkan hitung
                mundur yang hidup — supaya pengguna tidak menekan berulang kali
                dan justru memperpanjang jedanya sendiri. */}
            <button className="btn btn-primary btn-block btn-lg" disabled={busy || tungguKirim > 0}>
              {busy ? a.signing : tungguKirim > 0 ? a.signinWait.replace('{detik}', tungguKirim) : a.signin}
            </button>
            <p className="auth-foot">{a.noAccount} <Link to="/daftar">{a.toRegister}</Link></p>
            <p className="auth-terms">{a.loginTerms1}<Link to="/ketentuan">{a.loginTermsLink}</Link>{a.loginTerms2}</p>
          </form>
        ) : (
          <form className="auth-card" onSubmit={submitOtp}>
            <h1>{a.verifyTitle}</h1>
            <p className="sub">{a.verifySub}<b>{email}</b></p>
            {info && <div className="alert alert-ok">{info}</div>}
            {err && <div className="alert alert-err">{err}</div>}
            {kunci.terkunci && (
              <div className="alert alert-err">{a.errOtpLocked.replace('{waktu}', kunci.tungguTeks)}</div>
            )}
            <OtpInput value={otp} onChange={setOtp} maxLength={8} disabled={kunci.terkunci} />
            <OtpCountdown startedAt={sentAt} seconds={OTP_TTL_SECONDS}
              onExpire={() => setKedaluwarsa(true)} />
            {!kunci.terkunci && kunci.sisaPercobaan < OTP_MAX_ATTEMPTS && (
              <p className="muted-sm" style={{ marginTop: 4 }}>{a.otpAttemptsLeft.replace('{n}', kunci.sisaPercobaan)}</p>
            )}
            <button className="btn btn-primary btn-block btn-lg" disabled={busy || kedaluwarsa || kunci.terkunci}
              style={{ marginTop: 6 }}>
              {busy ? a.verifying : a.verifyBtn}
            </button>
            <p className="auth-foot">
              {a.noCode}{' '}
              <button type="button" className="linklike" onClick={resend}
                disabled={busy || tungguKirim > 0 || kunci.terkunci}>
                {tungguKirim > 0 ? a.resendWait.replace('{detik}', tungguKirim) : a.resend}
              </button>
              <br />
              <button type="button" className="linklike" onClick={kembali}>{a.backToLogin}</button>
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
