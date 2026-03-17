import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Search, Calendar, Camera as CameraIcon, Film, Play, Trash2,
  Download, ChevronLeft, ChevronRight, Loader2, X
} from 'lucide-react'
import { recordingApi, cameraApi } from '../services/api'
import { format, parseISO, formatDuration, intervalToDuration } from 'date-fns'
import { useAuth } from '../contexts/AuthContext'
import toast from 'react-hot-toast'

function formatBytes(bytes) {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatDur(seconds) {
  if (!seconds) return '—'
  const d = intervalToDuration({ start: 0, end: seconds * 1000 })
  return formatDuration(d, { format: ['hours', 'minutes', 'seconds'] })
}

function PlaybackModal({ recording, onClose }) {
  const videoRef = useRef(null)
  const playUrl = recordingApi.playUrl(recording.id)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 animate-fade-in" onClick={onClose}>
      <div className="bg-surface-800 border border-surface-500 rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden"
           onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-surface-600">
          <div>
            <h3 className="font-semibold text-slate-100">{recording.camera_name}</h3>
            <p className="text-xs text-slate-400">
              {format(parseISO(recording.start_time), 'PPpp')}
              {recording.end_time && ` — ${format(parseISO(recording.end_time), 'p')}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={playUrl}
              download={`recording-${recording.id}.mp4`}
              className="btn-secondary text-xs"
              onClick={e => e.stopPropagation()}
            >
              <Download size={12} className="mr-1" />Download
            </a>
            <button onClick={onClose} className="btn-ghost p-1.5"><X size={16} /></button>
          </div>
        </div>
        <div className="bg-black" style={{ aspectRatio: '16/9' }}>
          <video
            ref={videoRef}
            src={playUrl}
            controls
            autoPlay
            className="w-full h-full"
          />
        </div>
        <div className="px-5 py-3 flex items-center gap-4 text-xs text-slate-400 border-t border-surface-600">
          <span><Film size={12} className="inline mr-1" />{formatDur(recording.duration)}</span>
          <span><CameraIcon size={12} className="inline mr-1" />{recording.camera_location || recording.camera_name}</span>
          <span>{formatBytes(recording.file_size)}</span>
        </div>
      </div>
    </div>
  )
}

export default function Recordings() {
  const { isOperator } = useAuth()
  const [recordings, setRecordings] = useState([])
  const [cameras, setCameras] = useState([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({ cameraId: '', start: '', end: '', page: 1 })
  const [pagination, setPagination] = useState({ total: 0, pages: 1 })
  const [playing, setPlaying] = useState(null)

  useEffect(() => {
    cameraApi.list().then(res => setCameras(res.data)).catch(() => {})
  }, [])

  const fetchRecordings = useCallback(() => {
    setLoading(true)
    const params = { limit: 25, ...filters }
    if (!params.cameraId) delete params.cameraId
    if (!params.start) delete params.start
    if (!params.end) delete params.end

    recordingApi.list(params)
      .then(res => {
        setRecordings(res.data.recordings)
        setPagination({ total: res.data.total, pages: res.data.pages })
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [filters])

  useEffect(() => { fetchRecordings() }, [fetchRecordings])

  const deleteRecording = async (rec) => {
    if (!confirm('Delete this recording? This cannot be undone.')) return
    try {
      await recordingApi.delete(rec.id)
      toast.success('Recording deleted')
      fetchRecordings()
    } catch {
      toast.error('Delete failed')
    }
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Filters */}
      <div className="card">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="label text-xs">Camera</label>
            <select
              className="input"
              value={filters.cameraId}
              onChange={e => setFilters(f => ({ ...f, cameraId: e.target.value, page: 1 }))}
            >
              <option value="">All Cameras</option>
              {cameras.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label text-xs">From</label>
            <input
              type="datetime-local"
              className="input"
              value={filters.start}
              onChange={e => setFilters(f => ({ ...f, start: e.target.value, page: 1 }))}
            />
          </div>
          <div>
            <label className="label text-xs">To</label>
            <input
              type="datetime-local"
              className="input"
              value={filters.end}
              onChange={e => setFilters(f => ({ ...f, end: e.target.value, page: 1 }))}
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={() => setFilters({ cameraId: '', start: '', end: '', page: 1 })}
              className="btn-secondary w-full"
            >
              Clear Filters
            </button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-400">{pagination.total} recording{pagination.total !== 1 ? 's' : ''} found</span>
        <span className="text-slate-500">Page {filters.page} of {pagination.pages}</span>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={32} className="animate-spin text-accent" />
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <table className="table-base">
            <thead>
              <tr>
                <th>Camera</th>
                <th>Start Time</th>
                <th>Duration</th>
                <th>Size</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {recordings.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-500">
                    No recordings found
                  </td>
                </tr>
              ) : recordings.map(rec => (
                <tr key={rec.id}>
                  <td>
                    <div className="flex items-center gap-2">
                      <CameraIcon size={14} className="text-slate-500" />
                      <div>
                        <div className="font-medium text-slate-200">{rec.camera_name}</div>
                        {rec.camera_location && (
                          <div className="text-xs text-slate-500">{rec.camera_location}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="text-sm text-slate-200">
                      {format(parseISO(rec.start_time), 'MMM d, yyyy')}
                    </div>
                    <div className="text-xs text-slate-500 font-mono">
                      {format(parseISO(rec.start_time), 'HH:mm:ss')}
                      {rec.end_time && ` → ${format(parseISO(rec.end_time), 'HH:mm:ss')}`}
                    </div>
                  </td>
                  <td className="text-slate-400 text-sm">{formatDur(rec.duration)}</td>
                  <td className="text-slate-400 text-sm">{formatBytes(rec.file_size)}</td>
                  <td>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setPlaying(rec)}
                        className="btn-ghost p-1.5 text-accent"
                        title="Play"
                      >
                        <Play size={15} />
                      </button>
                      <a
                        href={recordingApi.playUrl(rec.id)}
                        download
                        className="btn-ghost p-1.5 text-slate-400"
                        title="Download"
                      >
                        <Download size={15} />
                      </a>
                      {isOperator && (
                        <button
                          onClick={() => deleteRecording(rec)}
                          className="btn-ghost p-1.5 text-danger"
                          title="Delete"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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

      {/* Playback modal */}
      {playing && (
        <PlaybackModal recording={playing} onClose={() => setPlaying(null)} />
      )}
    </div>
  )
}
