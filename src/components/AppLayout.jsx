import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, Wallet, Upload, ScanLine, Package, Truck,
  ArrowLeftRight, TrendingDown, FileText, MessageSquare, Settings, Menu,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useLang } from '../context/LangContext'
import { CatalogProvider } from '../context/CatalogContext'
import { fetchProfile } from '../lib/api'
import DisclaimerGate from './DisclaimerGate'
import Chatbot from './Chatbot'
import AppLock from './AppLock'
import LangToggle from './LangToggle'

// Menu dikelompokkan agar rapi. Label & judul diambil dari kamus i18n via key.
const NAV = [
  { sec: 'ringkasan', items: [
    { to: '/app', end: true, icon: LayoutDashboard, key: 'dashboard' },
  ] },
  { sec: 'transaksi', items: [
    { to: '/app/transaksi', icon: Wallet, key: 'transaksi' },
    { to: '/app/import', icon: Upload, key: 'import' },
    { to: '/app/struk', icon: ScanLine, key: 'struk' },
    { to: '/app/rekonsiliasi', icon: ArrowLeftRight, key: 'rekonsiliasi' },
  ] },
  { sec: 'produk', items: [
    { to: '/app/stok', icon: Package, key: 'stok' },
    { to: '/app/supplier', icon: Truck, key: 'pemasok' },
  ] },
  { sec: 'analisis', items: [
    { to: '/app/reveal', icon: TrendingDown, key: 'reveal' },
    { to: '/app/laporan', icon: FileText, key: 'laporan' },
  ] },
  { sec: 'lainnya', items: [
    { to: '/app/feedback', icon: MessageSquare, key: 'feedback' },
    { to: '/app/pengaturan', icon: Settings, key: 'pengaturan' },
  ] },
]

const TITLE_KEY = {
  '/app': 'dashboard', '/app/transaksi': 'transaksi', '/app/import': 'import',
  '/app/rekonsiliasi': 'rekonsiliasi', '/app/stok': 'stok', '/app/supplier': 'pemasok',
  '/app/reveal': 'reveal', '/app/laporan': 'laporan', '/app/feedback': 'feedback', '/app/pengaturan': 'pengaturan',
}

export default function AppLayout() {
  const { user, signOut } = useAuth()
  const { t } = useLang()
  const loc = useLocation()
  const [open, setOpen] = useState(false)
  const [profile, setProfile] = useState(null)

  useEffect(() => { fetchProfile().then(setProfile).catch(() => {}) }, [])
  useEffect(() => { setOpen(false) }, [loc.pathname])

  const title = loc.pathname === '/app/struk'
    ? t.app.titleStruk
    : (TITLE_KEY[loc.pathname] ? t.app.nav[TITLE_KEY[loc.pathname]] : 'BukuPintar')

  return (
    <div className="app-shell">
      <DisclaimerGate />
      <AppLock />
      <Chatbot />
      <div className={`side-backdrop ${open ? 'show' : ''}`} onClick={() => setOpen(false)} />
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand"><img src="/logo.svg" alt="" /><span>Buku<b>Pintar</b></span></div>
        <nav className="side-nav">
          {NAV.map((group) => (
            <div className="side-group" key={group.sec}>
              <div className="side-section">{t.app.sections[group.sec]}</div>
              {group.items.map((n) => {
                const Icon = n.icon
                return (
                  <NavLink key={n.to} to={n.to} end={n.end}
                    className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`}>
                    <Icon className="si" size={18} strokeWidth={2} aria-hidden="true" />
                    {t.app.nav[n.key]}
                  </NavLink>
                )
              })}
            </div>
          ))}
        </nav>
        <div className="side-foot">
          <div className="side-user">
            <b>{profile?.business_name || t.app.business}</b>
            {user?.email}
          </div>
          <button className="side-logout" onClick={signOut}>{t.app.logout}</button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="menu-btn" onClick={() => setOpen(true)} aria-label="Menu"><Menu size={22} /></button>
          <h1>{title}</h1>
          <div style={{ marginLeft: 'auto' }}><LangToggle /></div>
        </header>
        <div className="page">
          <CatalogProvider>
            <Outlet />
          </CatalogProvider>
        </div>
      </div>
    </div>
  )
}
