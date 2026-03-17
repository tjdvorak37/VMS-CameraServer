import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Camera, Video, AlertTriangle, HardDrive,
  TrendingUp, Activity, Circle, ChevronRight
} from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { dashboardApi } from '../services/api'
import { formatDistanceToNow, format } from 'date-fns'

function StatCard({ icon: Icon, label, value, sub, color = 'accent', onClick }) {
  const colorMap = {
    accent:  'text-accent bg-accent/10 border-accent/20',
    success: 'text-success bg-success/10 border-success/20',
    danger:  'text-danger bg-danger/10 border-danger/20',
    warning: 'text-warning bg-warning/10 border-warning/20',
    info:    'text-info bg-info/10 border-info/20',
  }
  return (
    <div
      className={`card cursor-pointer hover:border-opacity-60 transition-all ${onClick ? 'hover:scale-[1.01]' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">{label}</p>
          <p className="text-3xl font-bold text-slate-100 mt-1">{value}</p>
          {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
        </div>
        <div className={`p-2.5 rounded-xl border ${colorMap[color]}`}>
          <Icon size={20} />
        </div>
      </div>
    </div>
  )
}

const SEVERITY_COLORS = { critical: 'text-danger', warning: 'text-warning', info: 'text-info' }

function EventRow({ event }) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-surface-600 last:border-0">
      <div className={`mt-0.5 ${SEVERITY_COLORS[event.severity] || 'text-slate-400'}`}>
        <AlertTriangle size={14} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-200 truncate">
            {event.camera_name || 'System'}
          </span>
          <span className={`badge ${event.severity === 'critical' ? 'badge-offline' : event.severity === 'warning' ? 'badge-warning' : 'badge-info'}`}>
            {event.severity}
          </span>
        </div>
        <p className="text-xs text-slate-400 mt-0.5">{event.description || event.event_type}</p>
        <p className="text-xs text-slate-600 mt-0.5">
          {formatDistanceToNow(new Date(event.created_at), { addSuffix: true })}
        </p>
      </div>
    </div>
  )
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-surface-700 border border-surface-500 rounded-lg p-2.5 text-xs shadow-xl">
      <p className="text-slate-400 mb-1">{label}</p>
      <p className="text-accent font-semibold">{payload[0]?.value} recordings</p>
    </div>
  )
}

export default function Dashboard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    const fetch = () => {
      dashboardApi.summary()
        .then(res => setData(res.data))
        .catch(console.error)
        .finally(() => setLoading(false))
    }
    fetch()
    const interval = setInterval(fetch, 30000)
    return () => clearInterval(interval)
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const { cameras, events, recordings, recentEvents, recordingActivity } = data || {}

  const chartData = recordingActivity?.map(r => ({
    day: format(new Date(r.day), 'MMM d'),
    recordings: r.count,
    gb: (r.bytes / 1024 / 1024 / 1024).toFixed(2),
  })) || []

  const storageGB = ((recordings?.storageBytes || 0) / 1024 / 1024 / 1024).toFixed(1)

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={Camera}
          label="Total Cameras"
          value={cameras?.total || 0}
          sub={`${cameras?.online || 0} online`}
          color="accent"
          onClick={() => navigate('/cameras')}
        />
        <StatCard
          icon={Circle}
          label="Online"
          value={cameras?.online || 0}
          sub={`${cameras?.recording || 0} recording`}
          color="success"
          onClick={() => navigate('/live')}
        />
        <StatCard
          icon={AlertTriangle}
          label="Active Alerts"
          value={events?.unacknowledged || 0}
          sub={`${events?.critical || 0} critical`}
          color={events?.critical > 0 ? 'danger' : events?.unacknowledged > 0 ? 'warning' : 'success'}
          onClick={() => navigate('/events')}
        />
        <StatCard
          icon={HardDrive}
          label="Storage Used"
          value={`${storageGB} GB`}
          sub={`${recordings?.total || 0} total segments`}
          color="info"
          onClick={() => navigate('/recordings')}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Recording Activity Chart */}
        <div className="xl:col-span-2 card">
          <div className="card-header">
            <div className="flex items-center gap-2">
              <TrendingUp size={16} className="text-accent" />
              <h3 className="font-semibold text-slate-200">Recording Activity (7 days)</h3>
            </div>
          </div>
          <div className="h-52">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradAcc" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#252840" />
                  <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="recordings"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    fill="url(#gradAcc)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-slate-500 text-sm">
                No recording data yet
              </div>
            )}
          </div>
        </div>

        {/* Camera Status */}
        <div className="card">
          <div className="card-header">
            <div className="flex items-center gap-2">
              <Activity size={16} className="text-accent" />
              <h3 className="font-semibold text-slate-200">Camera Status</h3>
            </div>
            <button onClick={() => navigate('/cameras')} className="btn-ghost text-xs py-1 px-2">
              View all <ChevronRight size={12} className="inline" />
            </button>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="status-dot-online" />
                <span className="text-sm text-slate-300">Online</span>
              </div>
              <span className="text-sm font-semibold text-success">{cameras?.online || 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="status-dot-offline" />
                <span className="text-sm text-slate-300">Offline</span>
              </div>
              <span className="text-sm font-semibold text-danger">{cameras?.offline || 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="status-dot bg-accent" />
                <span className="text-sm text-slate-300">Recording</span>
              </div>
              <span className="text-sm font-semibold text-accent">{cameras?.recording || 0}</span>
            </div>

            {cameras?.total > 0 && (
              <div className="mt-4 pt-3 border-t border-surface-500">
                <div className="flex justify-between text-xs text-slate-500 mb-1.5">
                  <span>Uptime</span>
                  <span>{cameras?.total > 0 ? Math.round((cameras.online / cameras.total) * 100) : 0}%</span>
                </div>
                <div className="h-2 bg-surface-600 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-success rounded-full transition-all duration-500"
                    style={{ width: `${cameras?.total > 0 ? (cameras.online / cameras.total) * 100 : 0}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Recent Events */}
      <div className="card">
        <div className="card-header">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-warning" />
            <h3 className="font-semibold text-slate-200">Recent Events</h3>
          </div>
          <button onClick={() => navigate('/events')} className="btn-ghost text-xs py-1 px-2">
            View all <ChevronRight size={12} className="inline" />
          </button>
        </div>
        <div>
          {recentEvents?.length > 0 ? (
            recentEvents.map(ev => <EventRow key={ev.id} event={ev} />)
          ) : (
            <div className="py-8 text-center text-slate-500 text-sm">
              No recent events — all systems nominal
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
