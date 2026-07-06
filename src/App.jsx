import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
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
const Supplier = lazy(() => import('./pages/Supplier'))
const Reconciliation = lazy(() => import('./pages/Reconciliation'))
const Reveal = lazy(() => import('./pages/Reveal'))
const Reports = lazy(() => import('./pages/Reports'))
const Settings = lazy(() => import('./pages/Settings'))
const Feedback = lazy(() => import('./pages/Feedback'))
const Radar = lazy(() => import('./pages/Radar'))
const Hpp = lazy(() => import('./pages/Hpp'))

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
        <Route path="/app" element={<Protected><AppLayout /></Protected>}>
          <Route index element={<Dashboard />} />
          <Route path="transaksi" element={<Transactions />} />
          <Route path="struk" element={<Struk />} />
          <Route path="import" element={<Import />} />
          <Route path="stok" element={<Stok />} />
          <Route path="supplier" element={<Supplier />} />
          <Route path="rekonsiliasi" element={<Reconciliation />} />
          <Route path="radar" element={<Radar />} />
          <Route path="hpp" element={<Hpp />} />
          <Route path="reveal" element={<Reveal />} />
          <Route path="laporan" element={<Reports />} />
          <Route path="feedback" element={<Feedback />} />
          <Route path="pengaturan" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
