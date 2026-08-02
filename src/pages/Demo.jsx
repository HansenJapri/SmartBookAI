import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import Reveal from './Reveal'
import { sampleTransactions } from '../lib/sampleData'
import { APP_NAME } from '../lib/legal'
import { useLang } from '../context/LangContext'
import useForceLightTheme from '../lib/useForceLightTheme'

// Rute publik /demo — momen "aha" tanpa login dan tanpa input apa pun.
//
// Sengaja menampilkan Reveal, bukan Dashboard: Dashboard hanya meringkas apa
// yang sudah diketahui pengguna (omzet, laba), sedangkan Reveal menunjukkan
// yang TIDAK mereka ketahui — berapa yang hilang sebelum uangnya sampai.
//
// Halaman ini memakai komponen Reveal yang sama persis dengan versi ter-login,
// bukan salinannya, supaya angka di demo tidak pernah bisa berbeda dari angka
// yang didapat pengguna setelah mendaftar. Transaksi disuntik lewat prop
// sehingga fetchTransactions() tidak pernah terpanggil: nol query, baca maupun
// tulis. Tidak ada AuthProvider/WorkspaceProvider yang terlibat di rute ini.
export default function Demo() {
  useForceLightTheme()
  const { t } = useLang()
  const d = t.demo

  // Dihitung sekali: sampleTransactions() memakai tanggal relatif terhadap
  // "sekarang", dan identitas rujukan yang stabil menjaga useEffect di Reveal
  // tidak berulang.
  const tx = useMemo(() => sampleTransactions(), [])

  return (
    <div className="demo-page">
      <header className="demo-head">
        <Link to="/" className="demo-brand">{APP_NAME}</Link>
        <div className="flex gap" style={{ alignItems: 'center' }}>
          <Link to="/masuk" className="btn btn-ghost">{d.masuk}</Link>
          <Link to="/daftar" className="btn btn-primary">{d.daftar}</Link>
        </div>
      </header>

      {/* Banner tetap: menempel di atas saat digulir supaya status "ini contoh"
          tidak pernah lepas dari pandangan, berapa pun panjang halamannya. */}
      <div className="demo-banner">
        <span className="badge badge-amber">{d.badge}</span>
        <div className="demo-banner-copy">
          <b>{d.banner}</b>
          <span className="muted-sm">{d.bannerSub}</span>
        </div>
        <Link to="/daftar" className="btn btn-primary demo-banner-cta">
          <Sparkles size={16} aria-hidden="true" /> {d.daftar}
        </Link>
      </div>

      <main className="demo-main" id="main-content">
        <Reveal demoTx={tx} />
        <div className="demo-foot">
          <Link to="/" className="btn btn-ghost">{d.beranda}</Link>
          <Link to="/daftar" className="btn btn-primary">{d.daftar}</Link>
        </div>
      </main>
    </div>
  )
}
