import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLang } from '../context/LangContext'
import AuthSide from '../components/AuthSide'

export default function Login() {
  const { signIn } = useAuth()
  const { t } = useLang()
  const a = t.auth
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setErr(''); setBusy(true)
    try {
      await signIn({ email, password })
      nav('/app')
    } catch (e) {
      const m = e.message || ''
      if (m === 'Invalid login credentials') setErr(a.errInvalid)
      else if (m.toLowerCase().includes('not confirmed') || m.toLowerCase().includes('confirm')) setErr(a.errUnconfirmed)
      else setErr(m)
    } finally { setBusy(false) }
  }

  return (
    <div className="auth-wrap">
      <AuthSide title={a.sideLoginTitle} subtitle={a.sideLoginSub}
        points={[a.sideLoginP1, a.sideLoginP2, a.sideLoginP3, a.sideLoginP4]} />
      <div className="auth-main">
        <form className="auth-card" onSubmit={submit}>
          <h1>{a.loginTitle}</h1>
          <p className="sub">{a.loginSub} 👋</p>
          {err && <div className="alert alert-err">{err}</div>}
          <div className="field">
            <label>{a.email}</label>
            <input className="input" type="email" required value={email}
              onChange={(e) => setEmail(e.target.value)} placeholder={a.emailPh} />
          </div>
          <div className="field">
            <div className="flex between">
              <label style={{ marginBottom: 0 }}>{a.password}</label>
              <Link to="/lupa-password" className="linklike" style={{ fontSize: 13 }}>{a.forgot}</Link>
            </div>
            <input className="input" type="password" required value={password} style={{ marginTop: 7 }}
              onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </div>
          <button className="btn btn-primary btn-block btn-lg" disabled={busy}>
            {busy ? a.signing : a.signin}
          </button>
          <p className="auth-foot">{a.noAccount} <Link to="/daftar">{a.toRegister}</Link></p>
          <p className="auth-terms">{a.loginTerms1}<Link to="/ketentuan">{a.loginTermsLink}</Link>{a.loginTerms2}</p>
        </form>
      </div>
    </div>
  )
}
