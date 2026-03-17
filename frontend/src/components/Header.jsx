import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { Bell, Search, Wifi } from 'lucide-react'
import { eventApi } from '../services/api'

const PAGE_TITLES = {
  '/dashboard':  'Dashboard',
  '/live':       'Live View',
  '/cameras':    'Camera Management',
  '/recordings': 'Recordings',
  '/events':     'Events & Alerts',
  '/about':      'About and Docs',
  '/users':      'User Management',
  '/settings':   'System Settings',
}

export default function Header() {
  const location = useLocation()
  const title = PAGE_TITLES[location.pathname] || 'VMS'
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    const fetchUnread = () => {
      eventApi.list({ acknowledged: '0', limit: 1 })
        .then(res => setUnreadCount(res.data.total || 0))
        .catch(() => {})
    }
    fetchUnread()
    const interval = setInterval(fetchUnread, 30000)
    return () => clearInterval(interval)
  }, [])

  return (
    <header className="h-14 flex-shrink-0 bg-surface-800 border-b border-surface-600 
                        flex items-center justify-between px-6">
      {/* Page title */}
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold text-slate-100">{title}</h1>
        <div className="flex items-center gap-1.5 text-xs text-success">
          <Wifi size={12} className="animate-pulse-slow" />
          <span>Live</span>
        </div>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-3">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Quick search..."
            className="bg-surface-700 border border-surface-500 text-slate-300 text-sm
                       rounded-lg pl-9 pr-3 py-1.5 w-48
                       placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>

        <button
          onClick={() => window.location.href = '/events'}
          className="relative p-2 rounded-lg text-slate-400 hover:text-slate-100 
                     hover:bg-surface-600 transition-colors"
        >
          <Bell size={18} />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-danger text-white 
                             text-xs flex items-center justify-center rounded-full font-bold">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>

        <div className="text-xs text-slate-500 font-mono">
          {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </header>
  )
}
