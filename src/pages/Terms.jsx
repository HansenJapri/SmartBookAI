import { Link, useNavigate } from 'react-router-dom'
import LegalContent from '../components/LegalContent'
import { APP_NAME } from '../lib/legal'
import useForceLightTheme from '../lib/useForceLightTheme'

export default function Terms() {
  useForceLightTheme()
  const nav = useNavigate()
  return (
    <div className="legal-page">
      <header className="legal-head">
        <div className="brand"><img src="/logo.svg" alt="" /><span>Buku<b>Pintar</b> AI</span></div>
        <button className="btn btn-ghost" onClick={() => (window.history.length > 1 ? nav(-1) : nav('/'))}>Kembali</button>
      </header>
      <main className="legal-main">
        <h1>Syarat &amp; Ketentuan dan Penafian (Disclaimer)</h1>
        <p className="legal-sub">Mohon baca dengan saksama sebelum menggunakan {APP_NAME}.</p>
        <LegalContent />
        <div className="legal-cta">
          <Link to="/" className="btn btn-ghost">Beranda</Link>
          <Link to="/privasi" className="btn btn-ghost">Kebijakan Privasi</Link>
          <Link to="/daftar" className="btn btn-primary">Saya mengerti, lanjut daftar</Link>
        </div>
      </main>
    </div>
  )
}
