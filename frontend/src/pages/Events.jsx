import { useState, useEffect, useCallback } from 'react'
import {
  AlertTriangle, CheckCircle, Trash2, Filter, RefreshCw,
  ChevronLeft, ChevronRight, Loader2, Bell, BellOff, Camera
} from 'lucide-react'
import { eventApi, cameraApi } from '../services/api'
import { formatDistanceToNow, format, parseISO } from 'date-fns'
import { useAuth } from '../contexts/AuthContext'
import toast from 'react-hot-toast'

const SEVERITY_STYLES = {
  critical: { badge: 'badge-offline', icon: 'text-danger', bg: 'border-l-danger' },
  warning:  { badge: 'badge-warning', icon: 'text-warning', bg: 'border-l-warning' },
  info:     { badge: 'badge-info',    icon: 'text-info',    bg: 'border-l-info' },
}

export default function Events() {
  const { isOperator } = useAuth()
  const [events, setEvents] = useState([])
  const [cameras, setCameras] = useState([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({ cameraId: '', severity: '', acknowledged: '', page: 1 })
  const [pagination, setPagination] = useState({ total: 0, pages: 1, unacknowledged: 0 })
  const [selected, setSelected] = useState(new Set())

  useEffect(() => {
    cameraApi.list().then(res => setCameras(res.data)).catch(() => {})
  }, [])

  const fetchEvents = useCallback(() => {
    setLoading(true)
    const params = { limit: 30, ...filters }
    if (!params.cameraId) delete params.cameraId
    if (!params.severity) delete params.severity
    if (params.acknowledged === '') delete params.acknowledged

    eventApi.list(params)
      .then(res => {
        setEvents(res.data.events)
        setPagination({
          total: res.data.total,
          pages: Math.ceil(res.data.total / 30),
          unacknowledged: res.data.unacknowledged,
        })
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [filters])

  useEffect(() => { fetchEvents() }, [fetchEvents])
  useEffect(() => {
    const i = setInterval(fetchEvents, 20000)
    return () => clearInterval(i)
  }, [fetchEvents])

  const acknowledge = async (id) => {
    await eventApi.acknowledge(id).catch(() => toast.error('Failed'))
    fetchEvents()
  }

  const acknowledgeAll = async () => {
    await eventApi.acknowledgeAll().catch(() => toast.error('Failed'))
    toast.success('All events acknowledged')
    fetchEvents()
  }

  const deleteEvent = async (id) => {
    await eventApi.delete(id).catch(() => toast.error('Failed'))
    fetchEvents()
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header with counts */}
      <div className="flex flex-wrap items-center gap-4">
        {pagination.unacknowledged > 0 && (
          <div className="flex items-center gap-2 px-3 py-2 bg-warning/10 border border-warning/30 rounded-lg text-warning text-sm">
            <Bell size={14} className="animate-pulse" />
            <span>{pagination.unacknowledged} unacknowledged event{pagination.unacknowledged !== 1 ? 's' : ''}</span>
          </div>
        )}
        {isOperator && pagination.unacknowledged > 0 && (
          <button onClick={acknowledgeAll} className="btn-secondary text-sm">
            <CheckCircle size={14} className="mr-1.5" />Acknowledge All
          </button>
        )}
        <button onClick={fetchEvents} className="btn-ghost ml-auto">
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="label text-xs">Camera</label>
            <select className="input" value={filters.cameraId}
              onChange={e => setFilters(f => ({ ...f, cameraId: e.target.value, page: 1 }))}>
              <option value="">All Cameras</option>
              {cameras.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label text-xs">Severity</label>
            <select className="input" value={filters.severity}
              onChange={e => setFilters(f => ({ ...f, severity: e.target.value, page: 1 }))}>
              <option value="">All Severities</option>
              <option value="critical">Critical</option>
              <option value="warning">Warning</option>
              <option value="info">Info</option>
            </select>
          </div>
          <div>
            <label className="label text-xs">Status</label>
            <select className="input" value={filters.acknowledged}
              onChange={e => setFilters(f => ({ ...f, acknowledged: e.target.value, page: 1 }))}>
              <option value="">All</option>
              <option value="0">Unacknowledged</option>
              <option value="1">Acknowledged</option>
            </select>
          </div>
          <div className="flex items-end">
            <button
              onClick={() => setFilters({ cameraId: '', severity: '', acknowledged: '', page: 1 })}
              className="btn-secondary w-full"
            >
              Clear
            </button>
          </div>
        </div>
      </div>

      <div className="text-sm text-slate-400">{pagination.total} total event{pagination.total !== 1 ? 's' : ''}</div>

      {/* Events list */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={32} className="animate-spin text-accent" />
        </div>
      ) : (
        <div className="space-y-2">
          {events.length === 0 ? (
            <div className="card flex flex-col items-center py-12 text-slate-500">
              <BellOff size={36} className="mb-3 text-slate-600" />
              <p>No events found</p>
            </div>
          ) : events.map(ev => {
            const style = SEVERITY_STYLES[ev.severity] || SEVERITY_STYLES.info
            return (
              <div
                key={ev.id}
                className={`flex items-start gap-4 p-4 bg-surface-700 rounded-xl 
                            border border-surface-500 border-l-4 ${style.bg}
                            ${!ev.acknowledged ? 'bg-surface-600' : 'opacity-70'}`}
              >
                <AlertTriangle size={16} className={`flex-shrink-0 mt-0.5 ${style.icon}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-slate-200">
                      {ev.camera_name || 'System'}
                    </span>
                    {ev.camera_location && (
                      <span className="text-xs text-slate-500">{ev.camera_location}</span>
                    )}
                    <span className={ev.severity === 'critical' ? 'badge-offline' : ev.severity === 'warning' ? 'badge-warning' : 'badge-info'}>
                      {ev.severity}
                    </span>
                    <span className="text-xs text-slate-500 bg-surface-600 px-2 py-0.5 rounded">
                      {ev.event_type}
                    </span>
                    {!ev.acknowledged && (
                      <span className="badge bg-warning/20 text-warning text-xs">New</span>
                    )}
                  </div>
                  {ev.description && (
                    <p className="text-sm text-slate-300 mt-1">{ev.description}</p>
                  )}
                  <p className="text-xs text-slate-500 mt-1.5">
                    {format(parseISO(ev.created_at), 'MMM d, yyyy HH:mm:ss')}
                    {' · '}
                    {formatDistanceToNow(parseISO(ev.created_at), { addSuffix: true })}
                  </p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {!ev.acknowledged && isOperator && (
                    <button
                      onClick={() => acknowledge(ev.id)}
                      className="btn-ghost p-1.5 text-success"
                      title="Acknowledge"
                    >
                      <CheckCircle size={15} />
                    </button>
                  )}
                  {isOperator && (
                    <button
                      onClick={() => deleteEvent(ev.id)}
                      className="btn-ghost p-1.5 text-danger"
                      title="Delete"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Pagination */}
      {pagination.pages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            disabled={filters.page <= 1}
            onClick={() => setFilters(f => ({ ...f, page: f.page - 1 }))}
            className="btn-secondary p-2 disabled:opacity-50"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm text-slate-400 px-2">
            Page {filters.page} / {pagination.pages}
          </span>
          <button
            disabled={filters.page >= pagination.pages}
            onClick={() => setFilters(f => ({ ...f, page: f.page + 1 }))}
            className="btn-secondary p-2 disabled:opacity-50"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  )
}
