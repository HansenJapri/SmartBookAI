import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLang } from '../context/LangContext'
import AuthSide from '../components/AuthSide'
import PasswordChecklist from '../components/PasswordChecklist'
import OtpInput from '../components/OtpInput'
import { isPasswordValid, normalizePhone, isEmailValid } from '../lib/validators'
import useForceLightTheme from '../lib/useForceLightTheme'

export default function Register() {
  useForceLightTheme()
  const { signUp, verifyEmailOtp, resendSignupOtp, checkPhoneAvailable } = useAuth()
  const { t } = useLang()
  const a = t.auth
  const nav = useNavigate()
  const [step, setStep] = useState('form') // 'form' | 'otp'
  const [form, setForm] = useState({ businessName: '', ownerName: '', email: '', phone: '', password: '' })
  const [otp, setOtp] = useState('')
  const [agree, setAgree] = useState(false)
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const submitForm = async (e) => {
    e.preventDefault()
    setErr('')
    if (!form.businessName.trim() || !form.ownerName.trim()) return setErr(a.errReq)
    if (!isEmailValid(form.email)) return setErr(a.errEmail)
    // Telepon opsional (UU PDP: kumpulkan data seperlunya). Divalidasi hanya bila diisi.
    let phoneE164 = null
    if (form.phone.trim()) {
      phoneE164 = normalizePhone(form.phone)
      if (!phoneE164) return setErr(a.errPhone)
    }
    if (!isPasswordValid(form.password)) return setErr(a.errPwd)
    if (!agree) return setErr(a.errAgree)

    setBusy(true)
    try {
      // Keunikan telepon dicek manual bila diisi; keunikan email ditangani Supabase Auth
      if (phoneE164) {
        const phoneOk = await checkPhoneAvailable(phoneE164)
        if (!phoneOk) { setBusy(false); return setErr(a.errPhoneTaken) }
      }

      const res = await signUp({ ...form, phone: phoneE164 })
      if (res.user && Array.isArray(res.user.identities) && res.user.identities.length === 0) {
        setBusy(false)
        return setErr(a.errEmailTaken)
      }
      if (res.session) { nav('/app'); return }
      setInfo(`${a.infoCodeSent}${form.email}.`)
      setStep('otp')
    } catch (e) {
      const m = e.message || ''
      if (m.includes('already registered') || m.includes('already been registered')) setErr(a.errEmailTaken)
      else if (m.toLowerCase().includes('rate limit')) setErr(a.errRate)
      else setErr(m)
    } finally { setBusy(false) }
  }

  const submitOtp = async (e) => {
    e.preventDefault()
    setErr('')
    if (otp.length < 6) return setErr(a.errOtp)
    setBusy(true)
    try {
      await verifyEmailOtp({ email: form.email, token: otp })
      nav('/app')
    } catch (e) {
      setErr(a.errOtpWrong)
    } finally { setBusy(false) }
  }

  const resend = async () => {
    setErr(''); setInfo('')
    try { await resendSignupOtp(form.email); setInfo(a.infoResent) }
    catch (e) { setErr(e.message.toLowerCase().includes('rate') ? a.errRate : e.message) }
  }

  return (
    <div className="auth-wrap">
      <AuthSide title={a.sideRegTitle} subtitle={a.sideRegSub}
        points={[a.sideRegP1, a.sideRegP2, a.sideRegP3]} />
      <div className="auth-main">
        {step === 'form' ? (
          <form className="auth-card" onSubmit={submitForm}>
            <h1>{a.regTitle}</h1>
            <p className="sub">{a.regSub}</p>
            {err && <div className="alert alert-err">{err}</div>}
            <div className="field">
              <label htmlFor="reg-business-name">{a.bizName}</label>
              <input id="reg-business-name" className="input" value={form.businessName} onChange={set('businessName')} placeholder={a.bizNamePh} />
            </div>
            <div className="field">
              <label htmlFor="reg-owner-name">{a.ownerName}</label>
              <input id="reg-owner-name" className="input" value={form.ownerName} onChange={set('ownerName')} placeholder={a.ownerNamePh} />
            </div>
            <div className="field">
              <label htmlFor="reg-email">{a.email}</label>
              <input id="reg-email" className="input" type="email" value={form.email} onChange={set('email')} placeholder={a.emailPh} />
            </div>
            <div className="field">
              <label htmlFor="reg-phone">{a.phone}</label>
              <input id="reg-phone" className="input" value={form.phone} onChange={set('phone')} placeholder={a.phonePh} />
            </div>
            <div className="field">
              <label htmlFor="reg-password">{a.password}</label>
              <input id="reg-password" className="input" type="password" value={form.password} onChange={set('password')} placeholder="••••••••" />
              <PasswordChecklist value={form.password} />
            </div>
            <label className="agree">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              <span>{a.agree1}<Link to="/ketentuan" target="_blank" rel="noreferrer">{a.agreeTerms}</Link>{a.agreeAnd}<Link to="/privasi" target="_blank" rel="noreferrer">{a.agreePrivacy}</Link>{a.agree2}</span>
            </label>
            <button className="btn btn-primary btn-block btn-lg" disabled={busy || !agree}>
              {busy ? a.signing : a.regBtn}
            </button>
            <p className="auth-foot">{a.haveAccount} <Link to="/masuk">{a.toLogin}</Link></p>
          </form>
        ) : (
          <form className="auth-card" onSubmit={submitOtp}>
            <h1>{a.verifyTitle}</h1>
            <p className="sub">{a.verifySub}<b>{form.email}</b></p>
            {info && <div className="alert alert-ok">{info}</div>}
            {err && <div className="alert alert-err">{err}</div>}
            <OtpInput value={otp} onChange={setOtp} />
            <button className="btn btn-primary btn-block btn-lg" disabled={busy} style={{ marginTop: 18 }}>
              {busy ? a.verifying : a.verifyBtn}
            </button>
            <p className="auth-foot">
              {a.noCode} <button type="button" className="linklike" onClick={resend}>{a.resend}</button>
              <br />
              <button type="button" className="linklike" onClick={() => { setStep('form'); setOtp(''); setErr('') }}>{a.changeData}</button>
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
