import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { DisclaimerSummary } from './LegalContent'
import { TERMS_ACK_KEY, TERMS_VERSION, APP_NAME } from '../lib/legal'
import { fetchProfile, acceptTerms } from '../lib/api'
import { useAuth } from '../context/AuthContext'

// Gate persetujuan WAJIB: pengguna harus menekan tombol setuju untuk memakai
// aplikasi. Status persetujuan disimpan permanen di database (kolom profil),
// sehingga cukup disetujui SEKALI per akun dan tidak muncul lagi di perangkat
// mana pun. Saat menekan setuju, pengguna dikonfirmasi sekali lagi.
export default function DisclaimerGate() {
  const { signOut } = useAuth()
  const [show, setShow] = useState(false)   // tampilkan gate?
  const [confirming, setConfirming] = useState(false) // langkah konfirmasi kedua
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    let active = true
    // Cek status persetujuan dari database. Cache localStorage hanya untuk
    // menghindari kedipan; database adalah sumber kebenaran.
    fetchProfile()
      .then((p) => {
        if (!active) return
        const accepted = p?.accepted_terms === true && p?.terms_version === TERMS_VERSION
        if (accepted) {
          try { localStorage.setItem(TERMS_ACK_KEY, p.accepted_terms_at || new Date().toISOString()) } catch { /* abaikan */ }
          setShow(false)
        } else {
          setShow(true)
        }
      })
      .catch(() => { if (active) setShow(true) }) // gagal memuat: tampilkan demi keamanan
    return () => { active = false }
  }, [])

  if (!show) return null

  const doAccept = async () => {
    setErr('')
    setBusy(true)
    try {
      await acceptTerms(TERMS_VERSION)
      try { localStorage.setItem(TERMS_ACK_KEY, new Date().toISOString()) } catch { /* abaikan */ }
      setShow(false)
    } catch (e) {
      setErr('Gagal menyimpan persetujuan. Periksa koneksi lalu coba lagi.')
      setBusy(false)
    }
  }

  return (
    <div className="disc-back" role="dialog" aria-modal="true">
      <div className="disc-modal">
        {!confirming ? (
          <>
            <h3>Sebelum lanjut, harap dibaca</h3>
            <p className="disc-lead">{APP_NAME} adalah <b>alat bantu pencatatan</b>. Untuk
              menggunakan aplikasi, Anda perlu menyetujui Syarat dan Ketentuan serta Kebijakan
              Privasi, dan menanggung sendiri seluruh risiko penggunaannya.</p>
            <DisclaimerSummary />
            {err && <div className="alert alert-err" style={{ marginTop: 12 }}>{err}</div>}
            <div className="disc-foot">
              <div className="disc-links">
                <Link to="/ketentuan" className="linklike" target="_blank" rel="noreferrer">Syarat dan Ketentuan</Link>
                <Link to="/privasi" className="linklike" target="_blank" rel="noreferrer">Kebijakan Privasi</Link>
              </div>
              <div className="disc-actions">
                <button className="btn btn-ghost" onClick={signOut}>Keluar</button>
                <button className="btn btn-primary" onClick={() => { setErr(''); setConfirming(true) }}>Saya Setuju</button>
              </div>
            </div>
          </>
        ) : (
          <>
            <h3>Konfirmasi persetujuan</h3>
            <p className="disc-lead">Apakah Anda <b>benar-benar yakin</b> sudah membaca dan
              menyetujui Syarat dan Ketentuan serta Kebijakan Privasi {APP_NAME}? Persetujuan
              ini akan tercatat secara permanen pada akun Anda.</p>
            {err && <div className="alert alert-err" style={{ marginTop: 12 }}>{err}</div>}
            <div className="disc-foot">
              <div className="disc-actions" style={{ marginLeft: 'auto' }}>
                <button className="btn btn-ghost" disabled={busy} onClick={() => setConfirming(false)}>Kembali</button>
                <button className="btn btn-primary" disabled={busy} onClick={doAccept}>
                  {busy ? 'Menyimpan...' : 'Ya, saya benar-benar setuju'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
