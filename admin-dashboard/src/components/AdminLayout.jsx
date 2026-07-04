import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { LayoutDashboard, Users, Receipt, MessageSquare, LineChart, ScrollText, Menu, ShieldAlert, X, Lock } from 'lucide-react'
import { useAdminAuth } from '../context/AdminAuthContext'
import { supabase } from '../lib/supabase'
import { logAdminAction } from '../lib/adminApi'
import Chatbot from './Chatbot'
import AppLock from './AppLock'
import PinManager from './PinManager'
import TwoFactor from './TwoFactor'
import { Modal } from './ui'

const NAV = [
  { to: '/', end: true, Ic: LayoutDashboard, label: 'Overview' },
  { to: '/users', Ic: Users, label: 'Pengguna' },
  { to: '/transactions', Ic: Receipt, label: 'Transaksi' },
  { to: '/feedback', Ic: MessageSquare, label: 'Feedback' },
  { to: '/analytics', Ic: LineChart, label: 'Analitik' },
  { to: '/legal', Ic: ScrollText, label: 'Dokumen Legal' },
]
const TITLES = {
  '/': { t: 'Overview', s: 'Ringkasan kesehatan & dampak aplikasi' },
  '/users': { t: 'Pengguna', s: 'Semua akun pengguna - lihat, edit, hapus' },
  '/transactions': { t: 'Transaksi', s: 'Seluruh transaksi lintas pengguna' },
  '/feedback': { t: 'Feedback', s: 'Forum masukan pengguna & moderasi' },
  '/analytics': { t: 'Analitik', s: 'Efektivitas, adopsi & kepuasan pengguna' },
  '/legal': { t: 'Dokumen Legal', s: 'Edit Syarat & Ketentuan dan Kebijakan Privasi' },
}

export default function AdminLayout() {
  const { user, signOut } = useAdminAuth()
  const loc = useLocation()
  const [open, setOpen] = useState(false)
  const [mfaWarn, setMfaWarn] = useState(false)
  const [pinOpen, setPinOpen] = useState(false)
  const meta = TITLES[loc.pathname] || { t: 'Dashboard', s: '' }

  // Catat sesi admin (jejak audit) & ingatkan bila 2FA belum aktif.
  useEffect(() => {
    logAdminAction('admin_session_start')
    supabase.auth.mfa.listFactors()
      .then(({ data }) => {
        const factors = [...(data?.totp || []), ...(data?.all || [])]
        setMfaWarn(!factors.some((f) => f.status === 'verified'))
      })
      .catch(() => {})
  }, [])

  return (
    <div className="admin-shell">
      <Chatbot />
      <AppLock />
      <div className={`side-backdrop ${open ? 'show' : ''}`} onClick={() => setOpen(false)} />
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sb-brand">
          <img src="/admin.svg" alt="" />
          <div><b>BukuPintar</b><span>Admin</span></div>
        </div>
        <nav className="sb-nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} onClick={() => setOpen(false)}
              className={({ isActive }) => `sb-link ${isActive ? 'active' : ''}`}>
              <span className="ic"><n.Ic size={18} /></span> {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="sb-foot">
          <div className="sb-user"><b>Admin</b>{user?.email}</div>
          <button className="sb-pin" onClick={() => setPinOpen(true)}><Lock size={14} /> Keamanan akun</button>
          <button className="sb-logout" onClick={signOut}>Keluar</button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="flex center gap">
            <button className="menu-btn" onClick={() => setOpen(true)} aria-label="Buka menu"><Menu size={20} /></button>
            <div>
              <h1>{meta.t}</h1>
              {meta.s && <div className="sub">{meta.s}</div>}
            </div>
          </div>
          <span className="live-dot"><i />Realtime</span>
        </header>
        <div className="page">
          {mfaWarn && (
            <div className="alert-2fa">
              <ShieldAlert size={18} />
              <span><b>Keamanan akun admin:</b> aktifkan verifikasi dua langkah (2FA) di Supabase Authentication. Akun admin dapat membaca data seluruh pengguna, jadi 2FA sangat penting.</span>
              <a href="https://supabase.com/docs/guides/auth/auth-mfa" target="_blank" rel="noreferrer">Cara aktifkan</a>
              <button className="x" onClick={() => setMfaWarn(false)} aria-label="Tutup"><X size={16} /></button>
            </div>
          )}
          <Outlet />
        </div>
      </div>

      {pinOpen && (
        <Modal title="Keamanan Akun" onClose={() => setPinOpen(false)}>
          <TwoFactor />
          <hr style={{ border: 'none', borderTop: '1px solid var(--line)', margin: '18px 0' }} />
          <PinManager onClose={() => setPinOpen(false)} />
        </Modal>
      )}
    </div>
  )
}
