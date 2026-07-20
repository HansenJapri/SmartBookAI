import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

// Pengaturan 2FA (TOTP) berbasis Supabase Auth MFA: aktifkan (scan QR + verifikasi),
// lihat status, dan nonaktifkan.
export default function TwoFactor() {
  const { refreshAal } = useAuth()
  const [status, setStatus] = useState('loading') // loading | none | enrolling | active
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
      // Bersihkan faktor TOTP yang belum terverifikasi agar tidak menumpuk.
      const { data: list } = await supabase.auth.mfa.listFactors()
      for (const f of (list?.all || [])) {
        if (f.factor_type === 'totp' && f.status !== 'verified') {
          await supabase.auth.mfa.unenroll({ factorId: f.id })
        }
      }
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'BukuPintar ' + Date.now() })
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
    if (!confirm('Nonaktifkan verifikasi 2 langkah?')) return
    setBusy(true); setErr('')
    try { await supabase.auth.mfa.unenroll({ factorId }); setStatus('none'); if (refreshAal) await refreshAal() }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="card card-pad" style={{ marginBottom: 20 }}>
      <h3 className="card-title">Verifikasi 2 Langkah (2FA)</h3>
      <div className="card-sub">Keamanan tambahan: selain kata sandi, login membutuhkan kode dari aplikasi authenticator.</div>
      {err && <div className="alert alert-err">{err}</div>}

      {status === 'loading' && <p className="muted-sm">Memuat...</p>}

      {status === 'none' && (
        <button className="btn btn-primary" onClick={startEnroll} disabled={busy}>{busy ? 'Menyiapkan...' : 'Aktifkan 2FA'}</button>
      )}

      {status === 'enrolling' && (
        <form onSubmit={verify}>
          <p className="muted-sm" style={{ marginBottom: 4 }}>1. Pindai QR ini dengan Google Authenticator atau Authy. Tidak bisa pindai? Masukkan kode manual ini di aplikasi:</p>
          <div style={{ fontFamily: 'monospace', fontWeight: 700, wordBreak: 'break-all', marginBottom: 6 }}>{secret}</div>
          {qr && <img src={qr} alt="QR 2FA" style={{ width: 180, height: 180, display: 'block', margin: '10px 0 14px', border: '1px solid var(--line)', borderRadius: 10 }} />}
          <div className="field"><label htmlFor="tfa-code">2. Masukkan 6 digit kode dari aplikasi</label>
            <input id="tfa-code" className="input" inputMode="numeric" maxLength={6} value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="123456" /></div>
          <div className="flex gap">
            <button className="btn btn-primary" disabled={busy || code.length < 6}>{busy ? 'Memverifikasi...' : 'Verifikasi & Aktifkan'}</button>
            <button type="button" className="btn btn-ghost" onClick={() => { setStatus('none'); setQr(''); setCode('') }}>Batal</button>
          </div>
        </form>
      )}

      {status === 'active' && (
        <>
          <div className="alert alert-ok" style={{ marginBottom: 12 }}>2FA aktif. Akun Anda terlindungi verifikasi 2 langkah saat login.</div>
          <button className="btn btn-danger" onClick={disable} disabled={busy}>Nonaktifkan 2FA</button>
        </>
      )}
    </div>
  )
}
