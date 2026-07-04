import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAdminAuth } from './context/AdminAuthContext'
import AdminLayout from './components/AdminLayout'
import Login from './pages/Login'
import MfaChallenge from './components/MfaChallenge'

const Overview = lazy(() => import('./pages/Overview'))
const Users = lazy(() => import('./pages/Users'))
const Transactions = lazy(() => import('./pages/Transactions'))
const FeedbackAdmin = lazy(() => import('./pages/FeedbackAdmin'))
const Analytics = lazy(() => import('./pages/Analytics'))
const LegalAdmin = lazy(() => import('./pages/LegalAdmin'))

const Loader = () => <div className="full-center"><div className="spinner" /></div>

function Protected({ children }) {
  const { user, isAdmin, loading, configured, mfaPending } = useAdminAuth()
  if (!configured) return <ConfigError />
  if (loading) return <Loader />
  if (!user || !isAdmin) return <Navigate to="/login" replace />
  if (mfaPending) return <MfaChallenge />
  return children
}

function GuestOnly({ children }) {
  const { user, isAdmin, loading } = useAdminAuth()
  if (loading) return <Loader />
  if (user && isAdmin) return <Navigate to="/" replace />
  return children
}

function ConfigError() {
  return (
    <div className="full-center">
      <div className="card" style={{ maxWidth: 460, textAlign: 'center' }}>
        <h2>⚙️ Belum dikonfigurasi</h2>
        <p className="muted">Isi <code>admin-dashboard/.env</code> dengan VITE_SUPABASE_URL &amp;
          VITE_SUPABASE_ANON_KEY dari project Supabase yang sama.</p>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <Suspense fallback={<Loader />}>
      <Routes>
        <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
        <Route path="/" element={<Protected><AdminLayout /></Protected>}>
          <Route index element={<Overview />} />
          <Route path="users" element={<Users />} />
          <Route path="transactions" element={<Transactions />} />
          <Route path="feedback" element={<FeedbackAdmin />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="legal" element={<LegalAdmin />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
