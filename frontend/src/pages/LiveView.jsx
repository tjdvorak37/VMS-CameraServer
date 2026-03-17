import { useState, useEffect, useCallback } from 'react'
import { Grid, Layout, Maximize2, RefreshCw, Camera as CameraIcon } from 'lucide-react'
import VideoPlayer from '../components/VideoPlayer'
import { cameraApi } from '../services/api'

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
  const [cameras, setCameras] = useState([])
  const [layout, setLayout] = useState(4)
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(true)

  const fetchCameras = useCallback(() => {
    cameraApi.list()
      .then(res => setCameras(res.data))
      .catch(console.error)
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
          <span className="text-slate-600">•</span>
          <span className="text-sm text-success font-medium">
            {cameras.filter(c => c.status === 'online').length} online
          </span>
        </div>

        <div className="flex items-center gap-2">
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

      {/* Camera Grid */}
      {cameras.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <CameraIcon size={48} className="text-slate-600 mb-4" />
          <h3 className="text-lg font-medium text-slate-400 mb-2">No cameras configured</h3>
          <p className="text-sm text-slate-500">Go to Camera Management to add cameras to your system.</p>
        </div>
      ) : (
        <div
          className={`flex-1 grid gap-2 content-start`}
          style={{
            gridTemplateColumns: selected ? '1fr' : `repeat(${layoutConfig?.cols || 2}, 1fr)`,
          }}
        >
          {visibleCameras.map(camera => (
            <div key={camera.id} className="relative group" onDoubleClick={() => setSelected(camera.id)}>
              <VideoPlayer
                src={camera.status === 'online' ? streamUrl(camera) : null}
                cameraName={camera.name}
                showControls
              />
              {/* Camera info bar */}
              <div className="absolute bottom-0 left-0 right-0 
                              bg-gradient-to-t from-black/70 to-transparent 
                              px-2 pb-1.5 pt-4
                              opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-300">{camera.location || 'No location'}</span>
                  <span className="text-slate-400">{camera.resolution}</span>
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
        Double-click a camera to expand it • {cameras.length} total cameras
      </p>
    </div>
  )
}
