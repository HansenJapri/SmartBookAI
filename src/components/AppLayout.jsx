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
import { fetchProfile } from '../lib/api'
import { filterNav, canModule } from '../lib/rbac'
import { useWorkspace } from '../context/WorkspaceContext'
import Chatbot from './Chatbot'
import AppLock from './AppLock'
import ErrorBoundary from './ErrorBoundary'
import StatusKoneksi from './StatusKoneksi'
import LangToggle from './LangToggle'
import ThemeToggle from './ThemeToggle'
import WorkspaceSwitcher from './WorkspaceSwitcher'
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
  const { signOut } = useAuth()
  const { t } = useLang()
  const loc = useLocation()
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [sheet, setSheet] = useState(false) // lembar aksi "+ Catat" (mobile)
  const [profile, setProfile] = useState(null)
  const [inviteErr, setInviteErr] = useState('')
  // PENTING: undangan TIDAK diklaim otomatis. Akun baru selalu menjadi owner
  // workspace-nya sendiri; bergabung ke usaha orang lain harus dipilih sadar
  // lewat kartu undangan di bawah atau pengalih workspace di sidebar.
  // membership terisi = sedang melihat workspace orang lain sebagai staf.
  const {
    isOwner, membership, visibleInvites,
    switchWorkspace, accept, decline, snooze,
  } = useWorkspace()

  useEffect(() => { fetchProfile().then(setProfile).catch(() => {}) }, [])

  const acceptInvite = async (inv) => {
    setInviteErr('')
    try { await accept(inv.id) } catch (e) { setInviteErr(e.message || 'Gagal menerima undangan.') }
  }

  const declineInvite = async (inv) => {
    setInviteErr('')
    try { await decline(inv.id) } catch (e) { setInviteErr(e.message || 'Gagal menolak undangan.') }
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
      {/* Persetujuan S&K + Kebijakan Privasi diminta SEKALI saja, yaitu saat
          pembuatan akun (checkbox wajib di halaman Daftar; nilainya disalin
          trigger handle_new_user ke kolom persetujuan pada profil). Tidak ada
          lagi dialog persetujuan di dalam aplikasi. */}
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
          <WorkspaceSwitcher businessName={profile?.business_name} />
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
          {inviteErr && <div className="alert alert-err">{inviteErr}</div>}

          {/* Undangan menunggu persetujuan — pengguna yang memutuskan, bukan
              otomatis. Sebelum diterima, pengguna tetap owner workspace-nya.
              "Nanti" hanya menyembunyikan sampai halaman dimuat lagi, dan
              undangan selalu bisa ditemukan kembali di pengalih workspace —
              dulu sekali ditutup, undangan hilang selamanya dari browser itu. */}
          {visibleInvites.map((inv) => (
            <div className="alert alert-ok" key={inv.id}
              style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <Users size={16} style={{ flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 220 }}>
                {t.workspace.inviteFrom
                  .replace('{business}', inv.business_name || t.workspace.otherBusiness)
                  .replace('{email}', inv.owner_email || '')}
                {inv.modules?.length ? (
                  <> {t.workspace.inviteAccess.replace('{modules}',
                    inv.modules.map((k) => t.team.moduleLabels[k] || k).join(', '))}</>
                ) : null}
                {' '}{t.workspace.inviteSafe}
              </span>
              <button className="btn btn-primary" onClick={() => acceptInvite(inv)}>{t.workspace.accept}</button>
              <button className="btn btn-ghost" onClick={() => snooze(inv.id)}>{t.workspace.later}</button>
              <button className="btn btn-ghost" onClick={() => declineInvite(inv)}>{t.workspace.decline}</button>
            </div>
          ))}

          {/* Penanda jelas saat sedang melihat workspace ORANG LAIN. Tanpa ini,
              menu yang terbatas terasa seperti aplikasi rusak. */}
          {!isOwner && membership && (
            <div className="alert alert-warn"
              style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <Users size={16} style={{ flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 220 }}>
                {t.workspace.viewingBanner.replace('{business}', membership.business_name || t.workspace.otherBusiness)}
                {membership.modules?.length ? (
                  <> {t.workspace.inviteAccess.replace('{modules}',
                    membership.modules.map((k) => t.team.moduleLabels[k] || k).join(', '))}</>
                ) : null}
              </span>
              <button className="btn btn-ghost" onClick={() => switchWorkspace(null)}>
                {t.workspace.backToMine}
              </button>
            </div>
          )}

          <StatusKoneksi />

          {/* ErrorBoundary DI SINI, bukan hanya di akar aplikasi.
              Dengan satu boundary di main.jsx, galat render di satu halaman
              menghapus seluruh aplikasi — sidebar, menu, navigasi — dan
              menyisakan layar galat dengan satu tombol muat ulang. Galat kecil
              di grafik Laporan tidak boleh memutus akses pengguna ke menu
              Transaksi. `key={pathname}` membuat boundary ini pulih sendiri
              begitu pengguna berpindah halaman, jadi ada jalan keluar yang
              tidak menuntut muat ulang penuh. */}
          <CatalogProvider>
            <ErrorBoundary key={loc.pathname} variant="inline">
              <Outlet />
            </ErrorBoundary>
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
