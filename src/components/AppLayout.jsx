import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Wallet, Upload, ScanLine, Package, Truck,
  ArrowLeftRight, TrendingDown, FileText, MessageSquare, Settings, Menu,
  Newspaper, Calculator, Plus, ClipboardList, ClipboardCheck, HandCoins,
  Users, ScrollText, User, CalendarDays, Banknote, ListTodo, Gauge,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useLang } from '../context/LangContext'
import { CatalogProvider } from '../context/CatalogContext'
import {
  fetchProfile, fetchMyMembership, fetchMyMemberships,
  fetchPendingInvitations, acceptInvitation,
  dismissInvitation, isInvitationDismissed,
  setSelectedWorkspace,
} from '../lib/api'
import { filterNav, canModule } from '../lib/rbac'
import DisclaimerGate from './DisclaimerGate'
import Chatbot from './Chatbot'
import AppLock from './AppLock'
import LangToggle from './LangToggle'
import ThemeToggle from './ThemeToggle'
import './applayout.css'

// Menu dikelompokkan agar rapi. Label & judul diambil dari kamus i18n via key.
const NAV = [
  { sec: 'ringkasan', items: [
    { to: '/app', end: true, icon: LayoutDashboard, key: 'dashboard' },
  ] },
  { sec: 'operasional', items: [
    { to: '/app/tugas', icon: ListTodo, key: 'tugas' },
  ] },
  { sec: 'transaksi', items: [
    { to: '/app/transaksi', icon: Wallet, key: 'transaksi' },
    { to: '/app/import', icon: Upload, key: 'import' },
    { to: '/app/struk', icon: ScanLine, key: 'struk' },
    { to: '/app/rekonsiliasi', icon: ArrowLeftRight, key: 'rekonsiliasi' },
    { to: '/app/piutang', icon: HandCoins, key: 'piutang' },
  ] },
  { sec: 'produk', items: [
    { to: '/app/stok', icon: Package, key: 'stok' },
    { to: '/app/po', icon: ClipboardList, key: 'po' },
    { to: '/app/opname', icon: ClipboardCheck, key: 'opname' },
    { to: '/app/hpp', icon: Calculator, key: 'hpp' },
    { to: '/app/supplier', icon: Truck, key: 'pemasok' },
  ] },
  { sec: 'hr', items: [
    { to: '/app/karyawan', icon: User, key: 'karyawan' },
    { to: '/app/absensi', icon: CalendarDays, key: 'absensi' },
    { to: '/app/kpi', icon: Gauge, key: 'kpi' },
    { to: '/app/gaji', icon: Banknote, key: 'gaji' },
  ] },
  { sec: 'analisis', items: [
    { to: '/app/radar', icon: Newspaper, key: 'radar' },
    { to: '/app/reveal', icon: TrendingDown, key: 'reveal' },
    { to: '/app/laporan', icon: FileText, key: 'laporan' },
  ] },
  { sec: 'lainnya', items: [
    { to: '/app/feedback', icon: MessageSquare, key: 'feedback' },
    { to: '/app/pengguna', icon: Users, key: 'pengguna' },
    { to: '/app/audit', icon: ScrollText, key: 'audit' },
    { to: '/app/pengaturan', icon: Settings, key: 'pengaturan' },
  ] },
]

const TITLE_KEY = {
  '/app': 'dashboard', '/app/tugas': 'tugas', '/app/transaksi': 'transaksi', '/app/import': 'import',
  '/app/rekonsiliasi': 'rekonsiliasi', '/app/piutang': 'piutang', '/app/stok': 'stok', '/app/po': 'po', '/app/opname': 'opname', '/app/supplier': 'pemasok',
  '/app/karyawan': 'karyawan', '/app/absensi': 'absensi', '/app/kpi': 'kpi', '/app/gaji': 'gaji',
  '/app/hpp': 'hpp', '/app/radar': 'radar',
  '/app/reveal': 'reveal', '/app/laporan': 'laporan', '/app/feedback': 'feedback',
  '/app/pengguna': 'pengguna', '/app/audit': 'audit', '/app/pengaturan': 'pengaturan',
}

export default function AppLayout() {
  const { user, signOut } = useAuth()
  const { t } = useLang()
  const loc = useLocation()
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [sheet, setSheet] = useState(false) // lembar aksi "+ Catat" (mobile)
  const [profile, setProfile] = useState(null)
  // null = sedang di workspace SENDIRI (akses penuh). Terisi = sedang melihat
  // workspace orang lain sebagai staf, dengan modul terbatas.
  const [membership, setMembership] = useState(null)
  const [memberships, setMemberships] = useState([])   // workspace lain yang bisa diakses
  const [invites, setInvites] = useState([])           // undangan menunggu persetujuan

  // PENTING: undangan TIDAK lagi diklaim otomatis. Akun baru selalu menjadi
  // owner workspace-nya sendiri; bergabung ke usaha orang lain harus dipilih
  // sadar oleh pengguna lewat kartu undangan di bawah.
  useEffect(() => {
    fetchMyMembership().then(setMembership).catch(() => setMembership(null))
    fetchMyMemberships().then(setMemberships).catch(() => setMemberships([]))
    fetchProfile().then(setProfile).catch(() => {})
    fetchPendingInvitations()
      .then((list) => setInvites(list.filter((i) => !isInvitationDismissed(i.id))))
      .catch(() => setInvites([]))
  }, [])

  const acceptInvite = async (inv) => {
    try {
      await acceptInvitation(inv.id)
      setSelectedWorkspace(inv.owner_id)   // langsung masuk ke workspace itu
      window.location.reload()             // muat ulang agar seluruh data ikut berganti
    } catch { /* biarkan kartu tetap tampil bila gagal */ }
  }

  const rejectInvite = (inv) => {
    dismissInvitation(inv.id)
    setInvites((prev) => prev.filter((x) => x.id !== inv.id))
  }

  const switchWorkspace = (ownerId) => {
    setSelectedWorkspace(ownerId === user?.id ? '' : ownerId)
    window.location.reload()
  }
  useEffect(() => { setOpen(false); setSheet(false) }, [loc.pathname])

  // Menu tersaring sesuai hak akses (owner = semua; staf = modul yang diizinkan)
  const nav2 = filterNav(NAV, membership)

  const title = loc.pathname === '/app/struk'
    ? t.app.titleStruk
    : (TITLE_KEY[loc.pathname] ? t.app.nav[TITLE_KEY[loc.pathname]] : 'SmartBook')

  const openAsisten = () => {
    setSheet(false)
    // Chatbot mendengarkan event ini dan langsung membuka mode Catat.
    window.dispatchEvent(new CustomEvent('open-chat-catat'))
  }

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">Lewati ke konten utama</a>
      <DisclaimerGate />
      <AppLock />
      <Chatbot />
      <div className={`side-backdrop ${open ? 'show' : ''}`} onClick={() => setOpen(false)} />
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand"><span>Smart<b>Book</b> AI</span></div>
        <nav className="side-nav">
          {nav2.map((group) => (
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
          <div className="topbar-tools">
            <ThemeToggle />
            <LangToggle />
          </div>
        </header>
        <main id="main-content" className="page" tabIndex={-1}>
          {/* Undangan menunggu persetujuan — pengguna yang memutuskan, bukan
              otomatis. Sebelum diterima, pengguna tetap owner workspace-nya. */}
          {invites.map((inv) => (
            <div className="alert alert-ok" key={inv.id}
              style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <Users size={16} style={{ flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 220 }}>
                Anda diundang bergabung sebagai <b>staf</b> di usaha orang lain
                {inv.modules?.length ? <> (akses: {inv.modules.join(', ')})</> : null}.
                {' '}Usaha Anda sendiri tetap milik Anda dan tidak terpengaruh.
              </span>
              <button className="btn btn-primary" onClick={() => acceptInvite(inv)}>Terima</button>
              <button className="btn btn-ghost" onClick={() => rejectInvite(inv)}>Nanti</button>
            </div>
          ))}

          {/* Penanda jelas saat sedang melihat workspace ORANG LAIN. Tanpa ini,
              menu yang terbatas terasa seperti aplikasi rusak. */}
          {membership && (
            <div className="alert alert-warn"
              style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <Users size={16} style={{ flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 220 }}>
                Anda sedang membuka <b>usaha orang lain</b> sebagai staf, jadi menu
                yang tampil dibatasi sesuai izin
                {membership.modules?.length ? <> ({membership.modules.join(', ')})</> : null}.
              </span>
              <button className="btn btn-ghost" onClick={() => switchWorkspace(user?.id)}>
                Kembali ke usaha saya
              </button>
            </div>
          )}

          {/* Pengalih workspace — hanya muncul bila memang punya lebih dari satu. */}
          {!membership && memberships.length > 0 && (
            <div className="alert alert-info"
              style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <Users size={16} style={{ flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 200 }}>
                Anda juga punya akses sebagai staf di {memberships.length} usaha lain.
              </span>
              {memberships.map((m) => (
                <button key={m.id} className="btn btn-ghost"
                  onClick={() => switchWorkspace(m.owner_id)}>
                  Buka usaha ({m.modules?.join(', ') || 'staf'})
                </button>
              ))}
            </div>
          )}

          <CatalogProvider>
            <Outlet />
          </CatalogProvider>
        </main>
      </div>

      {/* Navigasi bawah — hanya tampil di layar sempit (mobile-first). */}
      <nav className="bottom-nav" aria-label="Navigasi bawah">
        <NavLink to="/app" end className={({ isActive }) => `bn-item ${isActive ? 'active' : ''}`}>
          <LayoutDashboard size={20} /><span>Beranda</span>
        </NavLink>
        {canModule(membership, 'transaksi') && (
          <NavLink to="/app/transaksi" className={({ isActive }) => `bn-item ${isActive ? 'active' : ''}`}>
            <Wallet size={20} /><span>Transaksi</span>
          </NavLink>
        )}
        {canModule(membership, 'transaksi') && (
          <button type="button" className="bn-fab" onClick={() => setSheet(true)} aria-label="Catat cepat">
            <Plus size={26} />
          </button>
        )}
        {canModule(membership, 'analisis') && (
          <NavLink to="/app/radar" className={({ isActive }) => `bn-item ${isActive ? 'active' : ''}`}>
            <Newspaper size={20} /><span>Radar</span>
          </NavLink>
        )}
        <button type="button" className="bn-item" onClick={() => setOpen(true)}>
          <Menu size={20} /><span>Menu</span>
        </button>
      </nav>

      {sheet && (
        <div className="sheet-backdrop" onClick={() => setSheet(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h4>Catat transaksi</h4>
            <button type="button" onClick={openAsisten}>🎙️ Ketik / Suara (Asisten AI)</button>
            <button type="button" onClick={() => { setSheet(false); nav('/app/struk') }}>📷 Scan Struk</button>
            <button type="button" onClick={() => { setSheet(false); nav('/app/transaksi') }}>✍️ Input Manual</button>
            <button type="button" className="sheet-cancel" onClick={() => setSheet(false)}>Batal</button>
          </div>
        </div>
      )}
    </div>
  )
}
