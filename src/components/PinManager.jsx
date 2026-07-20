import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { hasPin, setPin as savePin, clearPin, requestLock } from '../lib/applock'

// UI untuk mengatur PIN kunci layar (pasang, ganti, matikan, kunci sekarang).
export default function PinManager() {
  const { user } = useAuth()
  const uid = user?.id || ''
  const [on, setOn] = useState(false)
  const [p1, setP1] = useState('')
  const [p2, setP2] = useState('')
  const [msg, setMsg] = useState('')

  useEffect(() => { setOn(hasPin(uid)) }, [uid])

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(''), 2800) }

  const save = async (e) => {
    e.preventDefault()
    if (!/^\d{4,8}$/.test(p1)) return flash('⚠ PIN harus 4-8 angka.')
    if (p1 !== p2) return flash('⚠ Konfirmasi PIN tidak sama.')
    await savePin(uid, p1)
    setOn(true); setP1(''); setP2(''); flash('PIN tersimpan ✓')
  }
  const disable = () => { clearPin(uid); setOn(false); flash('Kunci layar dimatikan.') }

  return (
    <div className="card card-pad" style={{ marginBottom: 20 }}>
      <h3 className="card-title">Kunci Layar (PIN)</h3>
      <div className="card-sub">Mengunci aplikasi otomatis setelah 10 menit tidak aktif atau saat berpindah tab. Buka kembali dengan PIN. Berlaku di perangkat ini.</div>
      {msg && <div className={msg.startsWith('⚠') ? 'alert alert-err' : 'alert alert-ok'}>{msg}</div>}

      {on ? (
        <>
          <div className="alert alert-ok" style={{ marginBottom: 12 }}>Kunci layar aktif di perangkat ini.</div>
          <div className="flex gap" style={{ flexWrap: 'wrap', marginBottom: 16 }}>
            <button type="button" className="btn btn-ghost" onClick={() => requestLock(uid)}>Kunci sekarang</button>
            <button type="button" className="btn btn-danger" onClick={disable}>Matikan kunci</button>
          </div>
          <form onSubmit={save}>
            <div className="card-sub" style={{ marginBottom: 8 }}>Ganti PIN</div>
            <div className="grid-2">
              <div className="field"><label htmlFor="pin-new">PIN baru (4-8 angka)</label><input id="pin-new" className="input" type="password" inputMode="numeric" value={p1} onChange={(e) => setP1(e.target.value)} /></div>
              <div className="field"><label htmlFor="pin-new-repeat">Ulangi PIN</label><input id="pin-new-repeat" className="input" type="password" inputMode="numeric" value={p2} onChange={(e) => setP2(e.target.value)} /></div>
            </div>
            <button className="btn btn-primary">Simpan PIN baru</button>
          </form>
        </>
      ) : (
        <form onSubmit={save}>
          <div className="grid-2">
            <div className="field"><label htmlFor="pin-create">Buat PIN (4-8 angka)</label><input id="pin-create" className="input" type="password" inputMode="numeric" value={p1} onChange={(e) => setP1(e.target.value)} placeholder="cth: 1234" /></div>
            <div className="field"><label htmlFor="pin-create-repeat">Ulangi PIN</label><input id="pin-create-repeat" className="input" type="password" inputMode="numeric" value={p2} onChange={(e) => setP2(e.target.value)} /></div>
          </div>
          <button className="btn btn-primary">Aktifkan Kunci Layar</button>
        </form>
      )}
    </div>
  )
}
