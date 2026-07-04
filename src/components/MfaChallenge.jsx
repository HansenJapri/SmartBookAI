import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { useAuth } from '../context/AuthContext'

// Layar tantangan 2FA saat login: muncul bila akun punya 2FA aktif tapi sesi
// belum diverifikasi. Ditampilkan oleh guard rute sebelum aplikasi terbuka.
export default function MfaChallenge() {
  const { verifyMfa, signOut } = useAuth()
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true)
    try { await verifyMfa(code.trim()) }
    catch { setErr('Kode salah atau kedaluwarsa. Coba lagi.') }
    finally { setBusy(false) }
  }

  return (
    <div className="lock-screen" role="dialog" aria-modal="true">
      <form className="lock-card" onSubmit={submit}>
        <div className="lock-ic"><ShieldCheck size={26} /></div>
        <h2>Verifikasi 2 Langkah</h2>
        <p className="muted-sm">Masukkan 6 digit kode dari aplikasi authenticator Anda (Google Authenticator, Authy, dan sejenisnya).</p>
        <input className="input" inputMode="numeric" autoFocus value={code} maxLength={6}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="123456" />
        {err && <div className="lock-err">{err}</div>}
        <button className="btn btn-primary btn-block btn-lg" disabled={busy || code.length < 6}>
          {busy ? 'Memverifikasi...' : 'Verifikasi'}
        </button>
        <button type="button" className="linklike" onClick={signOut}>Keluar</button>
      </form>
    </div>
  )
}
