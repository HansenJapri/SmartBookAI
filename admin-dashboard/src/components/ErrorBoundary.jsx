import { Component } from 'react'

// Menangkap error render agar dashboard tidak blank/collapse.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary (admin) menangkap error:', error, info)
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: '#0b1220' }}>
        <div style={{ maxWidth: 420, textAlign: 'center', background: '#fff', borderRadius: 18, padding: '32px 28px', boxShadow: '0 24px 64px rgba(0,0,0,.4)' }}>
          <div style={{ fontSize: 40 }}>⚠️</div>
          <h2 style={{ margin: '12px 0 8px', fontSize: 20, color: '#0f172a' }}>Terjadi kendala</h2>
          <p style={{ color: '#64748b', fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
            Halaman dashboard gagal dimuat. Silakan muat ulang.
          </p>
          <button onClick={() => window.location.reload()}
            style={{ background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 10, padding: '11px 22px', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
            Muat ulang
          </button>
        </div>
      </div>
    )
  }
}
