import { Link, useNavigate } from 'react-router-dom'
import PrivacyContent from '../components/PrivacyContent'
import { APP_NAME } from '../lib/legal'
import useForceLightTheme from '../lib/useForceLightTheme'

export default function Privacy() {
  useForceLightTheme()
  const nav = useNavigate()
  return (
    <div className="legal-page">
      <header className="legal-head">
        <div className="brand"><img src="/logo-mark.png" alt="" /><span>Buku<b>Pintar</b> AI</span></div>
        <button className="btn btn-ghost" onClick={() => (window.history.length > 1 ? nav(-1) : nav('/'))}>Kembali</button>
      </header>
      <main className="legal-main">
        <h1>Kebijakan Privasi dan Persetujuan Pemrosesan Data</h1>
        <p className="legal-sub">Mohon baca dengan saksama sebelum menggunakan {APP_NAME}.</p>
        <PrivacyContent />
        <div className="legal-cta">
          <Link to="/" className="btn btn-ghost">Beranda</Link>
          <Link to="/ketentuan" className="btn btn-ghost">Syarat dan Ketentuan</Link>
          <Link to="/daftar" className="btn btn-primary">Daftar sekarang</Link>
        </div>
      </main>
    </div>
  )
}
