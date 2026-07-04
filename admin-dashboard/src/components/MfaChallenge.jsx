import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { useAdminAuth } from '../context/AdminAuthContext'

// Tantangan 2FA saat login admin. Ditampilkan guard rute sebelum dashboard terbuka.
export default function MfaChallenge() {
  const { verifyMfa, signOut } = useAdminAuth()
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
        <p className="muted-sm">Masukkan 6 digit kode dari aplikasi authenticator admin (Google Authenticator, Authy, dan sejenisnya).</p>
        <input className="input" inputMode="numeric" autoFocus value={code} maxLength={6}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="123456" />
        {err && <div className="lock-err">{err}</div>}
        <button className="btn btn-primary" disabled={busy || code.length < 6}>
          {busy ? 'Memverifikasi...' : 'Verifikasi'}
        </button>
        <button type="button" className="linklike" onClick={signOut}>Keluar</button>
      </form>
    </div>
  )
}
