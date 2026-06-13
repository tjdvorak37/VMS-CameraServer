import { useState, useEffect, useCallback, useRef } from 'react'
import { Grid, Layout, Maximize2, RefreshCw, Camera as CameraIcon, RotateCw } from 'lucide-react'
import VideoPlayer from '../components/VideoPlayer'
import { cameraApi, streamApi } from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import toast from 'react-hot-toast'

const LAYOUTS = [
  { id: 1,  label: '1×1',  cols: 1 },
  { id: 4,  label: '2×2',  cols: 2 },
  { id: 9,  label: '3×3',  cols: 3 },
  { id: 16, label: '4×4',  cols: 4 },
]

function LayoutButton({ layout, active, onClick }) {
  const dots = Array.from({ length: layout.id })
  return (
    <button
      onClick={onClick}
      title={`${layout.label} grid`}
      className={`p-2 rounded-lg border transition-colors ${
        active
          ? 'bg-accent/20 border-accent text-accent'
          : 'border-surface-500 text-slate-400 hover:border-slate-400 hover:text-slate-200'
      }`}
    >
      <div
        className="grid gap-0.5"
        style={{ gridTemplateColumns: `repeat(${layout.cols}, 1fr)`, width: 18, height: 18 }}
      >
        {dots.map((_, i) => (
          <div key={i} className="bg-current rounded-sm" style={{ width: 4, height: 4 }} />
        ))}
      </div>
    </button>
  )
}

export default function LiveView() {
  const { isOperator } = useAuth()
  const [cameras, setCameras] = useState([])
  const [layout, setLayout] = useState(4)
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(true)
  const [recovering, setRecovering] = useState(false)
  const [rotating, setRotating] = useState({})
  const [diagnosing, setDiagnosing] = useState(false)
  const [diagnostics, setDiagnostics] = useState({})
  const [diagnosticsUpdatedAt, setDiagnosticsUpdatedAt] = useState(null)
  const [cameraLoadError, setCameraLoadError] = useState('')
  const lastGoodCamerasRef = useRef([])

  const fetchCameras = useCallback(() => {
    cameraApi.list()
      .then(res => {
        const nextCameras = Array.isArray(res.data) ? res.data : []

        if (nextCameras.length > 0) {
          lastGoodCamerasRef.current = nextCameras
          setCameras(nextCameras)
          setCameraLoadError('')
          return
        }

        if (lastGoodCamerasRef.current.length > 0) {
          setCameraLoadError('Camera list temporarily unavailable. Showing last known cameras.')
          return
        }

        setCameras([])
        setCameraLoadError('')
      })
      .catch(err => {
        console.error(err)
        if (lastGoodCamerasRef.current.length > 0) {
          setCameras(lastGoodCamerasRef.current)
          setCameraLoadError('Camera list temporarily unavailable. Showing last known cameras.')
          return
        }

        setCameraLoadError('Unable to load camera list')
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetchCameras()
    const interval = setInterval(fetchCameras, 30000)
    return () => clearInterval(interval)
  }, [fetchCameras])

  const layoutConfig = LAYOUTS.find(l => l.id === layout)
  const visibleCameras = selected
    ? [cameras.find(c => c.id === selected)].filter(Boolean)
    : cameras.slice(0, layout)

  const streamUrl = (camera) =>
    `/api/streams/${camera.id}/live.m3u8`

  const recoverLiveView = async () => {
    setRecovering(true)
    try {
      const res = await streamApi.reconnectAll()
      const restarted = res.data?.restarted || 0
      toast.success(`Live recovery started for ${restarted} camera${restarted === 1 ? '' : 's'}`)
      setTimeout(fetchCameras, 1500)
    } catch (err) {
      toast.error(err.response?.data?.error || 'Unable to start live view recovery')
    } finally {
      setRecovering(false)
    }
  }

  const runStreamDiagnostics = async () => {
    if (diagnosing || cameras.length === 0) return

    setDiagnosing(true)
    try {
      const checks = await Promise.all(cameras.map(async (camera) => {
        try {
          const res = await cameraApi.testStream(camera.id)
          const result = res.data || {}
          return [camera.id, {
            ok: Boolean(result.ok),
            reason: result.reason || (result.ok ? 'ok' : 'unknown'),
            message: result.message || (result.ok ? 'RTSP connection successful' : 'RTSP check failed'),
            detail: result.detail || '',
          }]
        } catch (err) {
          return [camera.id, {
            ok: false,
            reason: 'probe_error',
            message: err.response?.data?.error || 'RTSP check failed',
            detail: err.response?.data?.details || '',
          }]
        }
      }))

      const nextDiagnostics = Object.fromEntries(checks)
      const failedCount = Object.values(nextDiagnostics).filter(result => !result.ok).length

      setDiagnostics(nextDiagnostics)
      setDiagnosticsUpdatedAt(new Date())

      if (failedCount === 0) {
        toast.success('All camera RTSP checks passed')
      } else {
        toast.error(`${failedCount} camera${failedCount === 1 ? '' : 's'} failed RTSP diagnostics`)
      }
    } finally {
      setDiagnosing(false)
    }
  }

  const rotateCamera = async (camera) => {
    if (!isOperator) return
    if (rotating[camera.id]) return

    const current = Number(camera.rotation) || 0
    const nextRotation = (current + 90) % 360

    setRotating(prev => ({ ...prev, [camera.id]: true }))
    try {
      await cameraApi.update(camera.id, { rotation: nextRotation })
      toast.success(`${camera.name} rotated to ${nextRotation}\u00b0`)
      fetchCameras()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to rotate camera')
    } finally {
      setRotating(prev => ({ ...prev, [camera.id]: false }))
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full gap-4 animate-fade-in">
      {/* Toolbar */}
      <div className="flex-shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-400">{cameras.length} camera{cameras.length !== 1 ? 's' : ''}</span>
           <span className="text-slate-600">|</span>
          <span className="text-sm text-success font-medium">
            {cameras.filter(c => c.status === 'online').length} online
          </span>
        </div>

        <div className="flex items-center gap-2">
          {isOperator && (
            <button
              onClick={runStreamDiagnostics}
              disabled={diagnosing || cameras.length === 0}
              className="btn-secondary text-sm"
              title="Run RTSP diagnostics for all cameras"
            >
              {diagnosing ? 'Diagnosing...' : 'Diagnose Streams'}
            </button>
          )}

          <button
            onClick={recoverLiveView}
            disabled={recovering}
            className="btn-secondary text-sm"
            title="Restart all camera streams"
          >
            {recovering ? 'Recovering...' : 'Recover Live View'}
          </button>

          <button
            onClick={fetchCameras}
            className="btn-ghost p-2"
            title="Refresh"
          >
            <RefreshCw size={15} />
          </button>

          {selected && (
            <button
              onClick={() => setSelected(null)}
              className="btn-secondary text-sm"
            >
              Show All
            </button>
          )}

          <div className="flex items-center gap-1 bg-surface-700 border border-surface-500 rounded-lg p-1">
            {LAYOUTS.map(l => (
              <LayoutButton
                key={l.id}
                layout={l}
                active={layout === l.id && !selected}
                onClick={() => { setLayout(l.id); setSelected(null) }}
              />
            ))}
          </div>
        </div>
      </div>

      {cameraLoadError && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-slate-300">
          {cameraLoadError}
        </div>
      )}

      {Object.keys(diagnostics).length > 0 && (
        <div className="rounded-lg border border-surface-500 bg-surface-700/60 px-4 py-3 text-sm text-slate-300">
          <div className="flex items-center justify-between gap-3 mb-2">
            <span className="font-medium text-slate-200">Stream Diagnostics</span>
            <span className="text-xs text-slate-500">
              {diagnosticsUpdatedAt ? `Updated ${diagnosticsUpdatedAt.toLocaleTimeString()}` : ''}
            </span>
          </div>
          <div className="grid gap-1">
            {cameras.map(camera => {
              const result = diagnostics[camera.id]
              if (!result) return null

              const statusClass = result.ok
                ? 'text-success'
                : (result.reason === 'network_unreachable' || result.reason === 'timeout')
                  ? 'text-warning'
                  : 'text-danger'

              return (
                <div key={`diag-${camera.id}`} className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-slate-300 truncate pr-2">{camera.name}</span>
                  <span className={`${statusClass} text-right`}>
                    {result.ok ? 'OK' : `${result.reason || 'failed'}: ${result.message}`}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Camera Grid */}
      {cameras.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <CameraIcon size={48} className="text-slate-600 mb-4" />
          <h3 className="text-lg font-medium text-slate-400 mb-2">No cameras configured</h3>
          <p className="text-sm text-slate-500">Go to Camera Management to add cameras to your system.</p>
        </div>
      ) : (
        <>
          {cameras.filter(c => c.status === 'online').length === 0 && (
            <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-slate-300 flex items-center justify-between gap-3">
              <span>No cameras are currently online. Use recovery to restart all streams.</span>
              <button
                type="button"
                onClick={recoverLiveView}
                disabled={recovering}
                className="btn-secondary text-xs"
              >
                {recovering ? 'Recovering...' : 'Run Recovery'}
              </button>
            </div>
          )}

          <div
            className={`flex-1 grid gap-2 content-start`}
            style={{
              gridTemplateColumns: selected ? '1fr' : `repeat(${layoutConfig?.cols || 2}, 1fr)`,
            }}
          >
            {visibleCameras.map(camera => (
              <div key={camera.id} className="flex flex-col gap-1" onDoubleClick={() => setSelected(camera.id)}>
                <div className="relative group">
                  <VideoPlayer
                    src={streamUrl(camera)}
                    cameraName={camera.name}
                    cameraRotation={camera.rotation}
                    connectionLabel={camera.status === 'offline' ? 'Camera offline' : 'Connecting to stream...'}
                    unavailableLabel={camera.status === 'offline' ? 'Camera unreachable' : 'Stream warming up or unavailable'}
                    showControls
                  />
                </div>
                <div className="flex items-center justify-between gap-2 px-1 text-xs text-slate-400">
                  <span className="truncate pr-2">{camera.location || 'No location'}</span>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span>{String(camera.resolution || '').replace('×', 'x')}</span>
                    {diagnostics[camera.id] && !diagnostics[camera.id].ok && (
                      <span
                        className={`rounded-md px-2 py-0.5 text-[11px] ${
                          diagnostics[camera.id].reason === 'network_unreachable' || diagnostics[camera.id].reason === 'timeout'
                            ? 'bg-warning/20 text-warning'
                            : 'bg-danger/20 text-danger'
                        }`}
                        title={diagnostics[camera.id].message}
                      >
                        {diagnostics[camera.id].reason === 'network_unreachable' || diagnostics[camera.id].reason === 'timeout'
                          ? 'Network'
                          : 'RTSP Error'}
                      </span>
                    )}
                    {isOperator && (
                      <button
                        type="button"
                        onClick={() => rotateCamera(camera)}
                        disabled={Boolean(rotating[camera.id])}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-600/80 bg-surface-800/80 px-2 py-0.5 text-[11px] text-slate-300 hover:border-accent hover:text-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Rotate camera"
                        aria-label="Rotate camera"
                      >
                        <RotateCw size={12} />
                        {rotating[camera.id] ? 'Rotating...' : 'Rotate'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {/* Empty placeholder cells */}
            {!selected && cameras.length < layout &&
              Array.from({ length: layout - cameras.length }).map((_, i) => (
                <div key={`empty-${i}`} className="camera-cell flex items-center justify-center">
                  <div className="flex flex-col items-center gap-2 text-slate-700">
                    <CameraIcon size={24} />
                    <span className="text-xs">Empty</span>
                  </div>
                </div>
              ))
            }
          </div>
        </>
      )}

      {/* Camera strip (thumbnail selector) */}
      {cameras.length > layout && !selected && (
        <div className="flex-shrink-0">
          <div className="flex gap-2 overflow-x-auto pb-2">
            {cameras.slice(layout).map(camera => (
              <button
                key={camera.id}
                onClick={() => setSelected(camera.id)}
                className="flex-shrink-0 w-28 h-16 relative rounded-lg overflow-hidden 
                           border border-surface-500 hover:border-accent transition-colors"
              >
                <div className="w-full h-full bg-black flex items-center justify-center">
                  <CameraIcon size={16} className="text-slate-600" />
                </div>
                <div className="absolute bottom-0 left-0 right-0 bg-black/70 px-1 py-0.5">
                  <span className="text-xs text-slate-300 truncate block">{camera.name}</span>
                </div>
                <span className={`absolute top-1 right-1 status-dot ${
                  camera.status === 'online' ? 'status-dot-online' : 'status-dot-offline'
                }`} />
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-slate-600 text-center">
         Double-click a camera to expand it | {cameras.length} total cameras
      </p>
    </div>
  )
}
