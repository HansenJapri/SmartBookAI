import { Link } from 'react-router-dom'

export default function Setup() {
  return (
    <div className="auth-main" style={{ minHeight: '100vh' }}>
      <div className="auth-card" style={{ maxWidth: 560 }}>
        <Link to="/" className="brand" style={{ marginBottom: 24, display: 'inline-flex' }}>
          <img src="/logo.svg" alt="" /><span>Buku<b>Pintar</b> AI</span>
        </Link>
        <h1>Hubungkan Supabase dulu</h1>
        <p className="sub">
          Aplikasi ini menyimpan data ke database Supabase Anda. Konfigurasi sekali, sekitar 3 menit.
        </p>

        <div className="card card-pad" style={{ marginBottom: 16 }}>
          <h3 className="card-title">1. Buat project Supabase</h3>
          <p className="muted-sm">
            Buka <a href="https://supabase.com" target="_blank" rel="noreferrer" style={{ color: 'var(--indigo)' }}>supabase.com</a> →
            New Project (gratis). Tunggu hingga database siap.
          </p>
        </div>

        <div className="card card-pad" style={{ marginBottom: 16 }}>
          <h3 className="card-title">2. Jalankan skema database</h3>
          <p className="muted-sm">
            Di dashboard Supabase: <b>SQL Editor → New query</b>, tempel seluruh isi file
            <code> supabase/schema.sql</code> (ada di folder project ini), lalu klik <b>Run</b>.
          </p>
        </div>

        <div className="card card-pad" style={{ marginBottom: 16 }}>
          <h3 className="card-title">3. Isi kredensial</h3>
          <p className="muted-sm">
            Salin <code>.env.example</code> menjadi <code>.env</code>, lalu isi dari
            <b> Project Settings → API</b>:
          </p>
          <pre style={{ background: 'var(--bg)', padding: 14, borderRadius: 10, fontSize: 12.5, overflow: 'auto', border: '1px solid var(--line)' }}>
{`VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci...`}
          </pre>
          <p className="muted-sm">Lalu jalankan ulang <code>npm run dev</code>.</p>
        </div>

        <div className="alert alert-info">
          💡 Tips: di <b>Authentication → Providers → Email</b>, matikan "Confirm email"
          agar bisa langsung login tanpa verifikasi email saat masih pengembangan.
        </div>
      </div>
    </div>
  )
}
