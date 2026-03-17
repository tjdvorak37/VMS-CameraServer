import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Video, Camera, Film, AlertTriangle,
  Users, Settings, LogOut, Shield, ChevronRight
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/live',      icon: Video,           label: 'Live View' },
  { to: '/cameras',   icon: Camera,          label: 'Cameras' },
  { to: '/recordings',icon: Film,            label: 'Recordings' },
  { to: '/events',    icon: AlertTriangle,   label: 'Events' },
]

const adminItems = [
  { to: '/users',    icon: Users,    label: 'Users' },
  { to: '/settings', icon: Settings, label: 'Settings' },
]

export default function Sidebar() {
  const { user, logout, isAdmin } = useAuth()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <aside className="w-60 flex-shrink-0 bg-surface-800 border-r border-surface-600 flex flex-col h-full">
      {/* Logo */}
      <div className="px-4 py-5 border-b border-surface-600">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center">
            <Shield size={16} className="text-white" />
          </div>
          <div>
            <div className="font-bold text-slate-100 text-sm leading-tight">VMS Pro</div>
            <div className="text-xs text-slate-500">Video Management</div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 mb-2">
          Monitoring
        </div>
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `nav-item ${isActive ? 'active' : ''}`
            }
          >
            <Icon size={17} className="flex-shrink-0" />
            <span className="flex-1">{label}</span>
          </NavLink>
        ))}

        {isAdmin && (
          <>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 mt-4 mb-2">
              Administration
            </div>
            {adminItems.map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `nav-item ${isActive ? 'active' : ''}`
                }
              >
                <Icon size={17} className="flex-shrink-0" />
                <span className="flex-1">{label}</span>
              </NavLink>
            ))}
          </>
        )}
      </nav>

      {/* User section */}
      <div className="px-3 pb-4 border-t border-surface-600 pt-3">
        <div className="flex items-center gap-2 px-3 py-2 mb-2 rounded-lg bg-surface-700">
          <div className="w-7 h-7 rounded-full bg-accent/20 flex items-center justify-center text-xs font-bold text-accent">
            {user?.username?.[0]?.toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-slate-200 truncate">{user?.username}</div>
            <div className="text-xs text-slate-500 capitalize">{user?.role}</div>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="nav-item w-full text-red-400 hover:text-red-300 hover:bg-red-500/10"
        >
          <LogOut size={16} />
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
  )
}
