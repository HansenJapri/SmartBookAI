import { useEffect, useState } from 'react'
import { useAdminAuth } from '../context/AdminAuthContext'
import { hasPin, setPin as savePin, clearPin, requestLock } from '../lib/applock'

// Pengaturan PIN kunci layar admin (dipakai di dalam modal).
export default function PinManager({ onClose }) {
  const { user } = useAdminAuth()
  const uid = user?.id || ''
  const [on, setOn] = useState(false)
  const [p1, setP1] = useState('')
  const [p2, setP2] = useState('')
  const [msg, setMsg] = useState('')

  useEffect(() => { setOn(hasPin(uid)) }, [uid])

  const save = async (e) => {
    e.preventDefault()
    if (!/^\d{4,8}$/.test(p1)) return setMsg('PIN harus 4-8 angka.')
    if (p1 !== p2) return setMsg('Konfirmasi PIN tidak sama.')
    await savePin(uid, p1); setOn(true); setP1(''); setP2(''); setMsg('PIN tersimpan.')
  }
  const disable = () => { clearPin(uid); setOn(false); setMsg('Kunci layar dimatikan.') }
  const lockNow = () => { requestLock(uid); if (onClose) onClose() }

  return (
    <div>
      <p className="muted-sm" style={{ marginBottom: 12 }}>
        Mengunci dashboard otomatis setelah 10 menit tidak aktif atau saat berpindah tab.
        Buka kembali dengan PIN. Berlaku di perangkat ini.
      </p>
      {msg && <div className="muted-sm" style={{ color: 'var(--indigo)', marginBottom: 10 }}>{msg}</div>}

      {on ? (
        <>
          <div className="flex gap" style={{ flexWrap: 'wrap', marginBottom: 14 }}>
            <button className="btn btn-ghost btn-sm" onClick={lockNow}>Kunci sekarang</button>
            <button className="btn btn-danger btn-sm" onClick={disable}>Matikan kunci</button>
          </div>
          <form onSubmit={save}>
            <label className="muted-sm">Ganti PIN</label>
            <input className="input" type="password" inputMode="numeric" placeholder="PIN baru (4-8 angka)"
              value={p1} onChange={(e) => setP1(e.target.value)} style={{ margin: '6px 0' }} />
            <input className="input" type="password" inputMode="numeric" placeholder="Ulangi PIN"
              value={p2} onChange={(e) => setP2(e.target.value)} style={{ marginBottom: 10 }} />
            <button className="btn btn-primary btn-sm">Simpan PIN baru</button>
          </form>
        </>
      ) : (
        <form onSubmit={save}>
          <input className="input" type="password" inputMode="numeric" placeholder="Buat PIN (4-8 angka)"
            value={p1} onChange={(e) => setP1(e.target.value)} style={{ margin: '6px 0' }} />
          <input className="input" type="password" inputMode="numeric" placeholder="Ulangi PIN"
            value={p2} onChange={(e) => setP2(e.target.value)} style={{ marginBottom: 10 }} />
          <button className="btn btn-primary btn-sm">Aktifkan Kunci Layar</button>
        </form>
      )}
    </div>
  )
}
