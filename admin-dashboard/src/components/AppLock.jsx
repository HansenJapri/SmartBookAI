import { useEffect, useState, useCallback } from 'react'
import { Lock } from 'lucide-react'
import { useAdminAuth } from '../context/AdminAuthContext'
import {
  LOCK_TIMEOUT_MS, hasPin, verifyPin, markActive, lastActive,
  isLocked, setLockedFlag, requestLock,
} from '../lib/applock'

// Overlay kunci layar dashboard admin. Aktif bila admin memasang PIN.
export default function AppLock() {
  const { user, signOut } = useAdminAuth()
  const uid = user?.id || ''
  const [enabled, setEnabled] = useState(false)
  const [locked, setLocked] = useState(false)
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')

  const sync = useCallback(() => {
    if (!uid) { setEnabled(false); setLocked(false); return }
    const on = hasPin(uid)
    setEnabled(on)
    setLocked(on && isLocked(uid))
  }, [uid])

  useEffect(() => {
    if (!uid) { setEnabled(false); setLocked(false); return }
    const on = hasPin(uid)
    setEnabled(on)
    if (on) {
      if (isLocked(uid) || Date.now() - lastActive(uid) > LOCK_TIMEOUT_MS) {
        setLockedFlag(uid, true); setLocked(true)
      } else { markActive(uid); setLocked(false) }
    }
  }, [uid])

  useEffect(() => {
    window.addEventListener('bpai-applock', sync)
    window.addEventListener('storage', sync)
    return () => { window.removeEventListener('bpai-applock', sync); window.removeEventListener('storage', sync) }
  }, [sync])

  useEffect(() => {
    if (!uid || !enabled) return
    const bump = () => { if (!isLocked(uid)) markActive(uid) }
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        if (Date.now() - lastActive(uid) > LOCK_TIMEOUT_MS) requestLock(uid)
      } else { bump() }
    }
    const evs = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click']
    evs.forEach((e) => window.addEventListener(e, bump, { passive: true }))
    document.addEventListener('visibilitychange', onVis)
    const iv = setInterval(() => {
      if (!isLocked(uid) && Date.now() - lastActive(uid) > LOCK_TIMEOUT_MS) requestLock(uid)
    }, 20000)
    return () => {
      evs.forEach((e) => window.removeEventListener(e, bump))
      document.removeEventListener('visibilitychange', onVis)
      clearInterval(iv)
    }
  }, [uid, enabled])

  if (!uid || !enabled || !locked) return null

  const submit = async (e) => {
    e.preventDefault()
    if (await verifyPin(uid, pin)) {
      setLockedFlag(uid, false); markActive(uid); setLocked(false); setPin(''); setErr('')
    } else { setErr('PIN salah. Coba lagi.'); setPin('') }
  }

  return (
    <div className="lock-screen" role="dialog" aria-modal="true">
      <form className="lock-card" onSubmit={submit}>
        <div className="lock-ic"><Lock size={26} /></div>
        <h2>Dashboard terkunci</h2>
        <p className="muted-sm">Terkunci otomatis karena tidak aktif selama 10 menit atau berpindah tab. Masukkan PIN untuk melanjutkan.</p>
        <input className="input" type="password" inputMode="numeric" autoFocus value={pin}
          onChange={(e) => setPin(e.target.value)} placeholder="Masukkan PIN" />
        {err && <div className="lock-err">{err}</div>}
        <button className="btn btn-primary">Buka Kunci</button>
        <button type="button" className="linklike" onClick={signOut}>Lupa PIN? Keluar</button>
      </form>
    </div>
  )
}
