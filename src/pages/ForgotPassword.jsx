import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLang } from '../context/LangContext'
import AuthSide from '../components/AuthSide'
import PasswordChecklist from '../components/PasswordChecklist'
import OtpInput from '../components/OtpInput'
import { isEmailValid, isPasswordValid } from '../lib/validators'

export default function ForgotPassword() {
  const { requestPasswordReset, verifyRecoveryAndSetPassword, updatePassword, user } = useAuth()
  const { t } = useLang()
  const a = t.auth
  const nav = useNavigate()
  const [step, setStep] = useState('email') // 'email' | 'reset' | 'link'
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (user && window.location.pathname === '/reset-password') setStep('link')
  }, [user])

  const sendCode = async (e) => {
    e.preventDefault(); setErr('')
    if (!isEmailValid(email)) return setErr(a.errEmailInvalid)
    setBusy(true)
    try {
      await requestPasswordReset(email)
      setInfo(`${a.fgInfoSent}${email}${a.fgInfoSpam}`)
      setStep('reset')
    } catch (e) {
      setErr(e.message.toLowerCase().includes('rate') ? a.errRateReq : e.message)
    } finally { setBusy(false) }
  }

  const doReset = async (e) => {
    e.preventDefault(); setErr('')
    if (step === 'reset' && otp.length < 6) return setErr(a.errOtpFull)
    if (!isPasswordValid(pw)) return setErr(a.errPwdReq)
    if (pw !== pw2) return setErr(a.errPwdMatch)
    setBusy(true)
    try {
      if (step === 'link') await updatePassword(pw)
      else await verifyRecoveryAndSetPassword({ email, token: otp, newPassword: pw })
      setInfo(a.pwdChanged)
      setTimeout(() => nav('/masuk'), 1400)
    } catch (e) {
      const m = (e.message || '').toLowerCase()
      if (m.includes('expired') || m.includes('invalid') || m.includes('token')) setErr(a.errOtpExpired)
      else setErr(e.message)
    } finally { setBusy(false) }
  }

  return (
    <div className="auth-wrap">
      <AuthSide title={a.sideFgTitle} subtitle={a.sideFgSub}
        points={[a.sideFgP1, a.sideFgP2, a.sideFgP3]} />
      <div className="auth-main">
        {step === 'email' && (
          <form className="auth-card" onSubmit={sendCode}>
            <h1>{a.fgTitle}</h1>
            <p className="sub">{a.fgSub}</p>
            {err && <div className="alert alert-err">{err}</div>}
            <div className="field">
              <label htmlFor="fg-email">{a.email}</label>
              <input id="fg-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={a.emailPh} />
            </div>
            <button className="btn btn-primary btn-block btn-lg" disabled={busy}>{busy ? a.fgSending : a.fgSend}</button>
            <p className="auth-foot"><Link to="/masuk">{a.backToLogin}</Link></p>
          </form>
        )}
        {(step === 'reset' || step === 'link') && (
          <form className="auth-card" onSubmit={doReset}>
            <h1>{a.npTitle}</h1>
            <p className="sub">{step === 'reset' ? a.npSubReset : a.npSubLink}</p>
            {info && <div className="alert alert-ok">{info}</div>}
            {err && <div className="alert alert-err">{err}</div>}
            {step === 'reset' && (
              <div className="field">
                <label>{a.otpLabel}</label>
                <OtpInput value={otp} onChange={setOtp} />
              </div>
            )}
            <div className="field">
              <label htmlFor="fg-new-password">{a.newPwd}</label>
              <input id="fg-new-password" className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="••••••••" />
              <PasswordChecklist value={pw} />
            </div>
            <div className="field">
              <label htmlFor="fg-repeat-password">{a.repeatPwd}</label>
              <input id="fg-repeat-password" className="input" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="••••••••" />
            </div>
            <button className="btn btn-primary btn-block btn-lg" disabled={busy}>{busy ? a.saving : a.savePwd}</button>
            <p className="auth-foot"><Link to="/masuk">{a.backToLogin}</Link></p>
          </form>
        )}
      </div>
    </div>
  )
}
