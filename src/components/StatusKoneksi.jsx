import { useEffect, useState } from 'react'
import { CloudOff, WifiOff } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useLang } from '../context/LangContext'
import { useOnline } from '../lib/useOnline'

// ============================================================
// Dua pengumuman yang sebelumnya tidak pernah sampai ke pengguna.
//
// 1. OFFLINE. Tanpa ini, koneksi yang putus muncul sebagai
//    "TypeError: Failed to fetch" di sudut layar — tidak memberi tahu apa pun,
//    dan yang terpenting tidak membedakan "internet Anda putus" (akan pulih)
//    dari "data Anda bermasalah" (tidak akan). Banner ini menjawabnya sebelum
//    pengguna sempat menyimpulkan yang kedua.
//
// 2. SESI BERAKHIR. Ini kegagalan paling menyesatkan di seluruh aplikasi:
//    setiap query ditolak, tiap halaman menampilkan keadaan kosong, sementara
//    aplikasinya sendiri tampak masih masuk. Lapisan penuh dipakai — bukan
//    banner tipis — karena tidak ada gunanya melanjutkan: apa pun yang
//    dilakukan pengguna setelah titik ini pasti gagal.
// ============================================================

export default function StatusKoneksi() {
  const { t } = useLang()
  const { sesiBerakhir, signOut } = useAuth()
  const online = useOnline()
  const [pernahOffline, setPernahOffline] = useState(false)

  useEffect(() => { if (!online) setPernahOffline(true) }, [online])

  if (sesiBerakhir) {
    return (
      <div className="modal-backdrop" style={{ zIndex: 9000 }} role="alertdialog" aria-modal="true" aria-labelledby="sesi-judul">
        <div className="modal" style={{ maxWidth: 400, textAlign: 'center', padding: '28px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'center', color: 'var(--muted)' }}><CloudOff size={38} /></div>
          <h3 id="sesi-judul" style={{ margin: '12px 0 8px', fontSize: 18 }}>{t.sesi.judul}</h3>
          <p className="muted-sm" style={{ lineHeight: 1.6, marginBottom: 20 }}>{t.sesi.pesan}</p>
          <button className="btn btn-primary btn-block" onClick={() => { signOut().finally(() => { window.location.href = '/masuk' }) }}>
            {t.sesi.aksi}
          </button>
        </div>
      </div>
    )
  }

  if (!online) {
    return (
      <div className="alert alert-err" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 12px' }} role="status">
        <WifiOff size={16} style={{ flexShrink: 0 }} />
        <span>{t.koneksi.offline}</span>
      </div>
    )
  }

  // Hanya ditampilkan kepada orang yang memang sempat kehilangan koneksi —
  // "Koneksi tersambung" kepada seseorang yang tidak pernah putus adalah
  // pemberitahuan tentang kejadian yang tidak pernah ia alami.
  if (pernahOffline) {
    return <PulihSebentar onSelesai={() => setPernahOffline(false)} teks={t.koneksi.pulih} />
  }
  return null
}

function PulihSebentar({ onSelesai, teks }) {
  useEffect(() => {
    const id = setTimeout(onSelesai, 4000)
    return () => clearTimeout(id)
  }, [onSelesai])
  return <div className="alert alert-ok" style={{ margin: '0 0 12px' }} role="status">{teks}</div>
}
