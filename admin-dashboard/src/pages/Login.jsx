import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAdminAuth } from '../context/AdminAuthContext'

export default function Login() {
  const { signIn } = useAdminAuth()
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
      nav('/')
    } catch (e) {
      const m = e.message || ''
      if (m === 'Invalid login credentials') setErr('Email atau kata sandi salah.')
      else if (m.includes('akses admin')) setErr('Akun ini bukan admin. Hanya akun admin yang boleh masuk.')
      else setErr(m)
    } finally { setBusy(false) }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="brand">
          <img src="/admin.svg" alt="" />
          <div><b>BukuPintar</b> <span className="muted-sm">· Dashboard Admin</span></div>
        </div>
        <h1>Masuk Admin</h1>
        <p className="sub">Akses khusus pemilik. Hanya satu akun admin yang diizinkan.</p>

        {err && <div className="alert alert-err">{err}</div>}

        <div className="field">
          <label>Email</label>
          <input className="input" type="email" required value={email} autoComplete="username"
            onChange={(e) => setEmail(e.target.value)} placeholder="admin@email.com" />
        </div>
        <div className="field">
          <label>Kata sandi</label>
          <input className="input" type="password" required value={password} autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        </div>
        <button className="btn btn-primary btn-block" disabled={busy} style={{ padding: 12 }}>
          {busy ? 'Memproses...' : 'Masuk'}
        </button>
        <p className="login-foot">🔒 Sesi terenkripsi oleh Supabase Auth · tidak ada pendaftaran publik</p>
      </form>
    </div>
  )
}
