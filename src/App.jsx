import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import { WorkspaceProvider, useWorkspace } from './context/WorkspaceContext'
import { canPath, firstAllowedPath } from './lib/rbac'
import Landing from './pages/Landing'
import Login from './pages/Login'
import Register from './pages/Register'
import ForgotPassword from './pages/ForgotPassword'
import Setup from './pages/Setup'
import Terms from './pages/Terms'
import Privacy from './pages/Privacy'
import AppLayout from './components/AppLayout'
import MfaChallenge from './components/MfaChallenge'

// Halaman aplikasi dimuat sesuai kebutuhan (code-splitting → load awal lebih cepat)
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Transactions = lazy(() => import('./pages/Transactions'))
const Struk = lazy(() => import('./pages/Struk'))
const Import = lazy(() => import('./pages/Import'))
const Stok = lazy(() => import('./pages/Stok'))
const StokHistori = lazy(() => import('./pages/StokHistori'))
const Supplier = lazy(() => import('./pages/Supplier'))
const Reconciliation = lazy(() => import('./pages/Reconciliation'))
const Reveal = lazy(() => import('./pages/Reveal'))
const Reports = lazy(() => import('./pages/Reports'))
const Settings = lazy(() => import('./pages/Settings'))
const Feedback = lazy(() => import('./pages/Feedback'))
const Radar = lazy(() => import('./pages/Radar'))
const Hpp = lazy(() => import('./pages/Hpp'))
const PurchaseOrders = lazy(() => import('./pages/PurchaseOrders'))
const Opname = lazy(() => import('./pages/Opname'))
const Receivables = lazy(() => import('./pages/Receivables'))
const Team = lazy(() => import('./pages/Team'))
const Audit = lazy(() => import('./pages/Audit'))
const Tasks = lazy(() => import('./pages/Tasks'))
const Employees = lazy(() => import('./pages/Employees'))
const Attendance = lazy(() => import('./pages/Attendance'))
const Payroll = lazy(() => import('./pages/Payroll'))
const Kpi = lazy(() => import('./pages/Kpi'))

const Loader = () => <div className="full-center"><div className="spinner" /></div>

function Protected({ children }) {
  const { user, loading, configured, mfaPending } = useAuth()
  if (!configured) return <Navigate to="/setup" replace />
  if (loading) return <Loader />
  if (!user) return <Navigate to="/masuk" replace />
  if (mfaPending) return <MfaChallenge />
  return children
}

function GuestOnly({ children }) {
  const { user, loading, configured } = useAuth()
  if (!configured) return <Navigate to="/setup" replace />
  if (loading) return <Loader />
  if (user) return <Navigate to="/app" replace />
  return children
}

// Penjaga hak akses per rute. Menyembunyikan tautan di sidebar TIDAK menghalangi
// siapa pun yang mengetik URL-nya langsung; ini lapis kedua di atas RLS database.
// Owner selalu lolos — dia pemilik workspace yang sedang dibuka.
function Guarded({ children }) {
  const { pathname } = useLocation()
  const { isOwner, membership, loading } = useWorkspace()
  if (loading) return <Loader />
  if (!canPath(pathname, { isOwner, membership })) {
    // Tujuan alihan TIDAK boleh dipatok ke '/app': sejak dashboard menjadi
    // modul yang bisa dicabut, staf tanpa akses dashboard akan dipantulkan ke
    // '/app' berulang kali tanpa henti. firstAllowedPath() memilih halaman
    // pertama yang memang boleh dia buka.
    const tujuan = firstAllowedPath({ isOwner, membership })
    if (!tujuan || tujuan === pathname) return <NoAccess />
    return <Navigate to={tujuan} replace />
  }
  return children
}

// Staf yang seluruh modulnya dicabut owner. Tanpa layar ini dia hanya melihat
// halaman kosong tanpa penjelasan.
function NoAccess() {
  return (
    <div className="card card-pad" style={{ margin: 24 }}>
      <h3 className="card-title">Belum ada modul yang bisa dibuka</h3>
      <p className="muted-sm">
        Pemilik usaha belum memberi Anda akses ke modul mana pun, atau aksesnya baru saja dicabut.
        Hubungi pemilik usaha, lalu muat ulang halaman ini.
      </p>
    </div>
  )
}

function ConfigOnly({ children }) {
  const { configured, loading } = useAuth()
  if (!configured) return <Navigate to="/setup" replace />
  if (loading) return <Loader />
  return children
}

export default function App() {
  return (
    <Suspense fallback={<Loader />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/setup" element={<Setup />} />
        <Route path="/ketentuan" element={<Terms />} />
        <Route path="/privasi" element={<Privacy />} />
        <Route path="/masuk" element={<GuestOnly><Login /></GuestOnly>} />
        <Route path="/daftar" element={<GuestOnly><Register /></GuestOnly>} />
        <Route path="/lupa-password" element={<GuestOnly><ForgotPassword /></GuestOnly>} />
        <Route path="/reset-password" element={<ConfigOnly><ForgotPassword /></ConfigOnly>} />
        <Route path="/app" element={<Protected><WorkspaceProvider><AppLayout /></WorkspaceProvider></Protected>}>
          <Route index element={<Guarded><Dashboard /></Guarded>} />
          <Route path="tugas" element={<Guarded><Tasks /></Guarded>} />
          <Route path="transaksi" element={<Guarded><Transactions /></Guarded>} />
          <Route path="struk" element={<Guarded><Struk /></Guarded>} />
          <Route path="import" element={<Guarded><Import /></Guarded>} />
          <Route path="stok" element={<Guarded><Stok /></Guarded>} />
          <Route path="stok/histori" element={<Guarded><StokHistori /></Guarded>} />
          <Route path="po" element={<Guarded><PurchaseOrders /></Guarded>} />
          <Route path="opname" element={<Guarded><Opname /></Guarded>} />
          <Route path="supplier" element={<Guarded><Supplier /></Guarded>} />
          <Route path="karyawan" element={<Guarded><Employees /></Guarded>} />
          <Route path="absensi" element={<Guarded><Attendance /></Guarded>} />
          <Route path="kpi" element={<Guarded><Kpi /></Guarded>} />
          <Route path="gaji" element={<Guarded><Payroll /></Guarded>} />
          <Route path="rekonsiliasi" element={<Guarded><Reconciliation /></Guarded>} />
          <Route path="piutang" element={<Guarded><Receivables /></Guarded>} />
          <Route path="radar" element={<Guarded><Radar /></Guarded>} />
          <Route path="hpp" element={<Guarded><Hpp /></Guarded>} />
          <Route path="reveal" element={<Guarded><Reveal /></Guarded>} />
          <Route path="laporan" element={<Guarded><Reports /></Guarded>} />
          <Route path="feedback" element={<Guarded><Feedback /></Guarded>} />
          <Route path="pengguna" element={<Guarded><Team /></Guarded>} />
          <Route path="audit" element={<Guarded><Audit /></Guarded>} />
          <Route path="pengaturan" element={<Guarded><Settings /></Guarded>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
