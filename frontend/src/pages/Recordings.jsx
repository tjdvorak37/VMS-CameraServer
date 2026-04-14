import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Camera as CameraIcon, Film, Play, Pause, Rewind, FastForward,
  Trash2, Download, ChevronLeft, ChevronRight, Loader2, X
} from 'lucide-react'
import { recordingApi, cameraApi } from '../services/api'
import {
  addDays,
  endOfDay,
  format,
  formatDuration,
  intervalToDuration,
  parseISO,
  startOfDay,
} from 'date-fns'
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

function toLocalInputValue(date) {
  const d = new Date(date)
  const shifted = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return shifted.toISOString().slice(0, 16)
}

function toIsoOrEmpty(value) {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toISOString()
}

function segmentBoundsMs(segment) {
  const startMs = Date.parse(segment.start_time)
  if (Number.isNaN(startMs)) return null

  let endMs = Date.parse(segment.end_time)
  if (Number.isNaN(endMs)) {
    endMs = startMs + Math.max(1, Number(segment.duration || 0)) * 1000
  }
  if (endMs <= startMs) endMs = startMs + 1000

  return { startMs, endMs }
}

function pickSegmentAt(segments, targetMs) {
  if (!segments?.length) return null

  const withBounds = segments
    .map(s => ({ segment: s, bounds: segmentBoundsMs(s) }))
    .filter(s => s.bounds)

  if (!withBounds.length) return null

  const containing = withBounds.find(({ bounds }) => targetMs >= bounds.startMs && targetMs <= bounds.endMs)
  if (containing) return containing.segment

  withBounds.sort((a, b) => {
    const da = Math.abs(a.bounds.startMs - targetMs)
    const db = Math.abs(b.bounds.startMs - targetMs)
    return da - db
  })

  return withBounds[0].segment
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

  const [reviewAt, setReviewAt] = useState(toLocalInputValue(new Date()))
  const [reviewCursorMs, setReviewCursorMs] = useState(null)
  const [reviewLoading, setReviewLoading] = useState(false)
  const [reviewPlaying, setReviewPlaying] = useState(false)
  const [reviewRate, setReviewRate] = useState(1)
  const [selectedReviewCameraIds, setSelectedReviewCameraIds] = useState([])
  const [reviewTiles, setReviewTiles] = useState([])

  const reviewVideoRefs = useRef(new Map())
  const reviewTickerRef = useRef(null)

  useEffect(() => {
    cameraApi.list().then(res => {
      const list = res.data || []
      setCameras(list)
      setSelectedReviewCameraIds(list.slice(0, 4).map(c => c.id))
    }).catch(() => {})
  }, [])

  const fetchRecordings = useCallback(() => {
    setLoading(true)
    const params = { limit: 25, ...filters }
    if (!params.cameraId) delete params.cameraId
    if (!params.start) delete params.start
    if (!params.end) delete params.end

    if (params.start) {
      const startIso = toIsoOrEmpty(params.start)
      if (startIso) params.start = startIso
      else delete params.start
    }
    if (params.end) {
      const endIso = toIsoOrEmpty(params.end)
      if (endIso) params.end = endIso
      else delete params.end
    }

    recordingApi.list(params)
      .then(res => {
        setRecordings(res.data.recordings)
        setPagination({ total: res.data.total, pages: res.data.pages })
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [filters])

  useEffect(() => { fetchRecordings() }, [fetchRecordings])

  const stopReviewTicker = useCallback(() => {
    if (reviewTickerRef.current) {
      clearInterval(reviewTickerRef.current)
      reviewTickerRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => stopReviewTicker()
  }, [stopReviewTicker])

  const syncVideosToCursor = useCallback((cursorMs, force = false) => {
    if (!cursorMs) return

    reviewTiles.forEach(tile => {
      if (!tile.segment) return

      const video = reviewVideoRefs.current.get(tile.camera.id)
      if (!video) return

      const bounds = segmentBoundsMs(tile.segment)
      if (!bounds) return

      const requested = (cursorMs - bounds.startMs) / 1000
      const maxDuration = Number.isFinite(video.duration) && video.duration > 0
        ? Math.max(0, video.duration - 0.1)
        : Math.max(0, (bounds.endMs - bounds.startMs) / 1000)
      const clamped = Math.max(0, Math.min(requested, maxDuration))

      if (force || Math.abs((video.currentTime || 0) - clamped) > 0.8) {
        try { video.currentTime = clamped } catch (_) {}
      }

      if (video.playbackRate !== reviewRate) {
        video.playbackRate = reviewRate
      }
    })
  }, [reviewRate, reviewTiles])

  const loadReview = useCallback(async () => {
    if (!selectedReviewCameraIds.length) {
      toast.error('Select at least one camera for review')
      return
    }

    const reviewDate = new Date(reviewAt)
    if (Number.isNaN(reviewDate.getTime())) {
      toast.error('Choose a valid review date/time')
      return
    }

    stopReviewTicker()
    setReviewPlaying(false)
    setReviewLoading(true)

    const targetMs = reviewDate.getTime()
    const windowStart = startOfDay(addDays(reviewDate, -1)).toISOString()
    const windowEnd = endOfDay(addDays(reviewDate, 1)).toISOString()

    try {
      const tiles = await Promise.all(
        selectedReviewCameraIds.map(async cameraId => {
          const camera = cameras.find(c => c.id === cameraId)
          if (!camera) {
            return { camera: { id: cameraId, name: `Camera ${cameraId}` }, segment: null }
          }

          try {
            const response = await recordingApi.timeline(cameraId, {
              start: windowStart,
              end: windowEnd,
            })
            const segments = response.data || []
            const chosen = pickSegmentAt(segments, targetMs)
            return { camera, segment: chosen }
          } catch {
            return { camera, segment: null, error: 'Failed to load timeline' }
          }
        })
      )

      setReviewTiles(tiles)
      setReviewCursorMs(targetMs)

      requestAnimationFrame(() => {
        syncVideosToCursor(targetMs, true)
      })
    } finally {
      setReviewLoading(false)
    }
  }, [cameras, reviewAt, selectedReviewCameraIds, stopReviewTicker, syncVideosToCursor])

  const shiftReviewCursor = useCallback((seconds) => {
    if (!reviewCursorMs) return
    const next = reviewCursorMs + seconds * 1000
    setReviewCursorMs(next)
    setReviewAt(toLocalInputValue(new Date(next)))
    syncVideosToCursor(next, true)
  }, [reviewCursorMs, syncVideosToCursor])

  const toggleReviewPlay = useCallback(async () => {
    if (!reviewTiles.length) {
      toast.error('Load review recordings first')
      return
    }

    if (reviewPlaying) {
      stopReviewTicker()
      reviewVideoRefs.current.forEach(video => {
        try { video.pause() } catch (_) {}
      })
      setReviewPlaying(false)
      return
    }

    const playable = Array.from(reviewVideoRefs.current.values())
    if (!playable.length) {
      toast.error('No playable recordings loaded')
      return
    }

    playable.forEach(video => {
      video.playbackRate = reviewRate
    })

    const results = await Promise.allSettled(playable.map(v => v.play()))
    const successCount = results.filter(r => r.status === 'fulfilled').length
    if (!successCount) {
      toast.error('Playback could not be started')
      return
    }

    setReviewPlaying(true)
    stopReviewTicker()
    reviewTickerRef.current = setInterval(() => {
      setReviewCursorMs(prev => {
        if (!prev) return prev
        const next = prev + 500 * reviewRate
        setReviewAt(toLocalInputValue(new Date(next)))
        return next
      })
    }, 500)
  }, [reviewPlaying, reviewRate, reviewTiles, stopReviewTicker])

  useEffect(() => {
    if (reviewPlaying && reviewCursorMs) {
      syncVideosToCursor(reviewCursorMs)
    }
  }, [reviewCursorMs, reviewPlaying, syncVideosToCursor])

  const applyReviewRate = (nextRate) => {
    setReviewRate(nextRate)
    reviewVideoRefs.current.forEach(video => {
      video.playbackRate = nextRate
    })
  }

  const toggleReviewCamera = (cameraId) => {
    setSelectedReviewCameraIds(prev => (
      prev.includes(cameraId)
        ? prev.filter(id => id !== cameraId)
        : [...prev, cameraId]
    ))
  }

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
      {/* Review mode */}
      <div className="card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-100">Recording Review</h2>
            <p className="text-xs text-slate-400">
              Select one or more cameras, load a review time, then use play, rewind, and fast-forward controls.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedReviewCameraIds(cameras.map(c => c.id))}
              className="btn-secondary text-xs"
            >
              Select All
            </button>
            <button
              onClick={() => setSelectedReviewCameraIds([])}
              className="btn-secondary text-xs"
            >
              Clear
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2 max-h-48 overflow-y-auto p-2 rounded-lg border border-surface-600 bg-surface-800/40">
              {cameras.map(cam => (
                <label key={cam.id} className="flex items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={selectedReviewCameraIds.includes(cam.id)}
                    onChange={() => toggleReviewCamera(cam.id)}
                  />
                  <span className="truncate">{cam.name}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="label text-xs">Review Date/Time</label>
            <input
              type="datetime-local"
              className="input"
              value={reviewAt}
              onChange={e => setReviewAt(e.target.value)}
            />
            <button
              className="btn-secondary w-full"
              onClick={loadReview}
              disabled={reviewLoading}
            >
              {reviewLoading ? 'Loading Review...' : 'Load Review'}
            </button>
            <button
              className="btn-ghost w-full"
              onClick={() => {
                const now = toLocalInputValue(new Date())
                setReviewAt(now)
              }}
            >
              Set to Now
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-surface-600 pt-3">
          <button
            className="btn-secondary p-2"
            onClick={() => shiftReviewCursor(-10)}
            title="Rewind 10 seconds"
          >
            <Rewind size={16} />
          </button>
          <button
            className="btn-secondary p-2"
            onClick={toggleReviewPlay}
            title={reviewPlaying ? 'Pause' : 'Play'}
          >
            {reviewPlaying ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <button
            className="btn-secondary p-2"
            onClick={() => shiftReviewCursor(10)}
            title="Fast-forward 10 seconds"
          >
            <FastForward size={16} />
          </button>

          <div className="ml-2 flex items-center gap-1">
            {[0.5, 1, 2, 4].map(rate => (
              <button
                key={rate}
                onClick={() => applyReviewRate(rate)}
                className={`px-2 py-1 rounded text-xs border ${reviewRate === rate
                  ? 'bg-accent/20 border-accent text-accent'
                  : 'border-surface-500 text-slate-300 hover:border-slate-400'}`}
              >
                {rate}x
              </button>
            ))}
          </div>

          <div className="ml-auto text-xs text-slate-400">
            Cursor: {reviewCursorMs ? format(new Date(reviewCursorMs), 'PPpp') : 'Not loaded'}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {reviewTiles.length === 0 ? (
            <div className="col-span-full rounded-lg border border-surface-600 bg-surface-800/40 p-6 text-center text-sm text-slate-500">
              Load review mode to preview selected camera recordings.
            </div>
          ) : reviewTiles.map(tile => (
            <div key={tile.camera.id} className="rounded-lg border border-surface-600 bg-surface-800/40 overflow-hidden">
              <div className="px-3 py-2 border-b border-surface-600">
                <div className="text-sm font-medium text-slate-200 truncate">{tile.camera.name}</div>
                <div className="text-xs text-slate-500 truncate">{tile.camera.location || 'No location'}</div>
              </div>

              {tile.segment ? (
                <>
                  <div className="bg-black" style={{ aspectRatio: '16/9' }}>
                    <video
                      ref={(el) => {
                        if (el) reviewVideoRefs.current.set(tile.camera.id, el)
                        else reviewVideoRefs.current.delete(tile.camera.id)
                      }}
                      src={recordingApi.playUrl(tile.segment.id)}
                      preload="metadata"
                      className="w-full h-full"
                      onLoadedMetadata={(e) => {
                        const bounds = segmentBoundsMs(tile.segment)
                        if (!bounds || !reviewCursorMs) return
                        const offset = Math.max(0, Math.min((reviewCursorMs - bounds.startMs) / 1000, e.currentTarget.duration || Number.MAX_VALUE))
                        try { e.currentTarget.currentTime = offset } catch (_) {}
                        e.currentTarget.playbackRate = reviewRate
                      }}
                    />
                  </div>
                  <div className="px-3 py-2 text-xs text-slate-400 border-t border-surface-600">
                    {format(parseISO(tile.segment.start_time), 'PPpp')}
                    {tile.segment.end_time ? ` → ${format(parseISO(tile.segment.end_time), 'p')}` : ''}
                  </div>
                </>
              ) : (
                <div className="p-6 text-center text-xs text-slate-500">
                  {tile.error || 'No recording segment near selected time'}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

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
