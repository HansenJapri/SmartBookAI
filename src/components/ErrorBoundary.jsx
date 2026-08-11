import { Component } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { logClientError } from '../lib/monitoring'

// ============================================================
// Menangkap error render agar aplikasi tidak "blank/collapse".
//
// Dipasang di DUA lapis: sekali di main.jsx sebagai jaring terakhir, dan sekali
// lagi di AppLayout mengelilingi <Outlet /> dengan `key={pathname}`. Lapis kedua
// itulah yang penting — dengan boundary akar saja, galat render di satu halaman
// menghapus seluruh aplikasi (sidebar, menu, navigasi) dan menyisakan layar
// galat dengan satu jalan keluar: muat ulang. Galat di grafik Laporan tidak
// boleh memutus akses seseorang ke menu Transaksi.
//
// `variant="inline"` dipakai lapis kedua supaya kerangka navigasi tetap
// terlihat, dan tombol "Coba lagi" me-reset boundary tanpa memuat ulang halaman
// — untuk galat sesaat (data yang belum siap, satu render yang meleset), itu
// pemulihan yang jauh lebih murah daripada memuat ulang seluruh aplikasi.
//
// Pesan error MENTAH sengaja tidak pernah dirender. Nilainya bagi pemilik usaha
// nol, dan isinya bisa memuat potongan data atau jalur berkas.
// ============================================================
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, message: '' }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || 'Terjadi kesalahan tak terduga.' }
  }

  componentDidCatch(error, info) {
    // Dicatat ke console untuk diagnosis; tidak mengganggu pengguna.
    console.error('ErrorBoundary menangkap error:', error, info)
    logClientError('react.render', error?.message, { stack: String(error?.stack || '').slice(0, 500) })
  }

  render() {
    if (!this.state.hasError) return this.props.children

    const inline = this.props.variant === 'inline'
    const luar = inline
      ? { padding: '32px 16px' }
      : { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'var(--bg, #f7f9fc)' }

    return (
      <div style={luar}>
        <div style={{ maxWidth: 440, margin: '0 auto', textAlign: 'center', background: 'var(--card, #fff)', border: '1px solid var(--line, #e3e8f2)', borderRadius: 16, padding: '32px 28px', boxShadow: '0 8px 24px rgba(28,54,238,.06)' }}>
          <div style={{ display: 'flex', justifyContent: 'center', color: 'var(--warn-ink, #f59e0b)' }}><AlertTriangle size={44} /></div>
          <h2 style={{ margin: '12px 0 8px', fontSize: 20, color: 'var(--ink, #000)' }}>Maaf, terjadi kendala</h2>
          <p style={{ color: 'var(--muted, #66708a)', fontSize: 14, lineHeight: 1.6, marginBottom: 8 }}>
            {inline
              ? 'Halaman ini gagal ditampilkan. Coba lagi, atau pindah ke menu lain — menu yang lain tetap bisa dibuka.'
              : 'Halaman gagal dimuat. Coba muat ulang. Jika berlanjut, periksa koneksi atau hubungi kami.'}
          </p>
          {/* Jaminan yang sama seperti di <GagalMuat>: yang gagal adalah
              tampilannya, bukan catatan pengguna. */}
          <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 20 }}>
            Catatan Anda tetap tersimpan aman.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            {inline && (
              <button onClick={() => this.setState({ hasError: false, message: '' })}
                style={{ background: 'var(--card, #fff)', color: 'var(--ink, #000)', border: '1px solid var(--line, #e3e8f2)', borderRadius: 10, padding: '11px 22px', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                <RefreshCw size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
                Coba lagi
              </button>
            )}
            <button onClick={() => window.location.reload()}
              style={{ background: 'var(--primary, #1c36ee)', color: '#fff', border: 'none', borderRadius: 10, padding: '11px 22px', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
              Muat ulang halaman
            </button>
          </div>
        </div>
      </div>
    )
  }
}
