import { Component } from 'react'
import { AlertTriangle } from 'lucide-react'
import { logClientError } from '../lib/monitoring'

// Menangkap error render agar aplikasi tidak "blank/collapse".
// Menampilkan pesan ramah + tombol muat ulang.
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
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: '#f8fafc' }}>
        <div style={{ maxWidth: 440, textAlign: 'center', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: '32px 28px', boxShadow: '0 8px 24px rgba(15,23,42,.06)' }}>
          <div style={{ display: 'flex', justifyContent: 'center', color: '#f59e0b' }}><AlertTriangle size={44} /></div>
          <h2 style={{ margin: '12px 0 8px', fontSize: 20, color: '#0f172a' }}>Maaf, terjadi kendala</h2>
          <p style={{ color: '#64748b', fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
            Halaman gagal dimuat. Coba muat ulang. Jika berlanjut, periksa koneksi atau hubungi kami.
          </p>
          <button onClick={() => window.location.reload()}
            style={{ background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 10, padding: '11px 22px', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
            Muat ulang halaman
          </button>
        </div>
      </div>
    )
  }
}
