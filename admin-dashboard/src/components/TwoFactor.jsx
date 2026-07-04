import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAdminAuth } from '../context/AdminAuthContext'

// Pengaturan 2FA (TOTP) admin via Supabase Auth MFA. Dipakai di dalam modal.
export default function TwoFactor() {
  const { refreshAal } = useAdminAuth()
  const [status, setStatus] = useState('loading')
  const [factorId, setFactorId] = useState('')
  const [qr, setQr] = useState('')
  const [secret, setSecret] = useState('')
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = async () => {
    try {
      const { data } = await supabase.auth.mfa.listFactors()
      const v = (data?.totp || []).find((f) => f.status === 'verified')
      if (v) { setFactorId(v.id); setStatus('active') } else setStatus('none')
    } catch { setStatus('none') }
  }
  useEffect(() => { refresh() }, [])

  const startEnroll = async () => {
    setErr(''); setBusy(true)
    try {
      const { data: list } = await supabase.auth.mfa.listFactors()
      for (const f of (list?.all || [])) {
        if (f.factor_type === 'totp' && f.status !== 'verified') {
          await supabase.auth.mfa.unenroll({ factorId: f.id })
        }
      }
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'BukuPintar Admin ' + Date.now() })
      if (error) throw error
      setFactorId(data.id); setQr(data.totp.qr_code); setSecret(data.totp.secret); setStatus('enrolling')
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const verify = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true)
    try {
      const { data: ch, error: cErr } = await supabase.auth.mfa.challenge({ factorId })
      if (cErr) throw cErr
      const { error: vErr } = await supabase.auth.mfa.verify({ factorId, challengeId: ch.id, code: code.trim() })
      if (vErr) throw vErr
      setCode(''); setQr(''); setSecret(''); setStatus('active')
      if (refreshAal) await refreshAal()
    } catch { setErr('Kode salah atau kedaluwarsa. Coba lagi.') } finally { setBusy(false) }
  }

  const disable = async () => {
    if (!confirm('Nonaktifkan verifikasi 2 langkah untuk akun admin?')) return
    setBusy(true); setErr('')
    try { await supabase.auth.mfa.unenroll({ factorId }); setStatus('none'); if (refreshAal) await refreshAal() }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <div>
      <h4 style={{ margin: '0 0 4px' }}>Verifikasi 2 Langkah (2FA)</h4>
      <p className="muted-sm" style={{ marginBottom: 12 }}>Selain kata sandi, login admin membutuhkan kode dari aplikasi authenticator.</p>
      {err && <div className="muted-sm" style={{ color: '#e11d48', marginBottom: 10 }}>{err}</div>}

      {status === 'loading' && <p className="muted-sm">Memuat...</p>}

      {status === 'none' && (
        <button className="btn btn-primary btn-sm" onClick={startEnroll} disabled={busy}>{busy ? 'Menyiapkan...' : 'Aktifkan 2FA'}</button>
      )}

      {status === 'enrolling' && (
        <form onSubmit={verify}>
          <p className="muted-sm" style={{ marginBottom: 4 }}>1. Pindai QR ini dengan Google Authenticator / Authy. Atau masukkan kode manual:</p>
          <div style={{ fontFamily: 'monospace', fontWeight: 700, wordBreak: 'break-all', marginBottom: 6 }}>{secret}</div>
          {qr && <img src={qr} alt="QR 2FA" style={{ width: 170, height: 170, display: 'block', margin: '10px 0 12px', border: '1px solid var(--line)', borderRadius: 10 }} />}
          <label className="muted-sm">2. Masukkan 6 digit kode</label>
          <input className="input" inputMode="numeric" maxLength={6} value={code} style={{ margin: '6px 0 10px' }}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="123456" />
          <div className="flex gap">
            <button className="btn btn-primary btn-sm" disabled={busy || code.length < 6}>{busy ? 'Memverifikasi...' : 'Verifikasi & Aktifkan'}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setStatus('none'); setQr(''); setCode('') }}>Batal</button>
          </div>
        </form>
      )}

      {status === 'active' && (
        <>
          <span className="badge badge-green" style={{ marginBottom: 12, display: 'inline-block' }}>2FA aktif</span>
          <div><button className="btn btn-danger btn-sm" onClick={disable} disabled={busy} style={{ marginTop: 8 }}>Nonaktifkan 2FA</button></div>
        </>
      )}
    </div>
  )
}
