import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import SetupWizard from './pages/SetupWizard'
import Dashboard from './pages/Dashboard'
import LiveView from './pages/LiveView'
import CameraManagement from './pages/CameraManagement'
import Recordings from './pages/Recordings'
import Events from './pages/Events'
import UserManagement from './pages/UserManagement'
import Settings from './pages/Settings'
import About from './pages/About'

function PrivateRoute({ children, adminOnly = false }) {
  const { user, loading } = useAuth()
  if (loading) return (
    <div className="flex items-center justify-center h-screen bg-surface-900">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 border-4 border-accent border-t-transparent rounded-full animate-spin" />
        <span className="text-slate-400 text-sm">Loading VMS...</span>
      </div>
    </div>
  )
  if (!user) return <Navigate to="/login" replace />
  if (user.must_change_password) return <Navigate to="/login" replace />
  if (adminOnly && user.role !== 'admin') return <Navigate to="/" replace />
  return children
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/setup" element={<SetupWizard />} />
        <Route path="/" element={
          <PrivateRoute>
            <Layout />
          </PrivateRoute>
        }>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="live" element={<LiveView />} />
          <Route path="cameras" element={<CameraManagement />} />
          <Route path="recordings" element={<Recordings />} />
          <Route path="events" element={<Events />} />
          <Route path="about" element={<About />} />
          <Route path="users" element={
            <PrivateRoute adminOnly>
              <UserManagement />
            </PrivateRoute>
          } />
          <Route path="settings" element={
            <PrivateRoute adminOnly>
              <Settings />
            </PrivateRoute>
          } />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AuthProvider>
  )
}
