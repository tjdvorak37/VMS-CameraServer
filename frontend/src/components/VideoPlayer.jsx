import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'
import { Volume2, VolumeX, Maximize2, RefreshCw, WifiOff, RotateCw } from 'lucide-react'

/**
 * HLS Live Video Player component.
 * src: the HLS .m3u8 manifest URL
 */
export default function VideoPlayer({
  src,
  cameraName,
  className = '',
  showControls = true,
  cameraRotation = 0,
  onRotate = null,
  rotateDisabled = false,
  rotateTitle = 'Rotate camera',
}) {
  const videoRef = useRef(null)
  const hlsRef = useRef(null)
  const [state, setState] = useState({ muted: true, status: 'loading', error: null })

  const initHls = () => {
    const video = videoRef.current
    if (!video || !src) return

    setState(s => ({ ...s, status: 'loading', error: null }))

    // Cleanup previous instance
    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 30,
        maxBufferLength: 10,
        maxMaxBufferLength: 30,
        liveSyncDurationCount: 2,
        liveMaxLatencyDurationCount: 4,
        xhrSetup: (xhr) => {
          const token = localStorage.getItem('vms_token')
          if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
        },
      })

      hls.loadSource(src)
      hls.attachMedia(video)

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setState(s => ({ ...s, status: 'playing' }))
        video.play().catch(() => {})
      })

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          setState(s => ({ ...s, status: 'error', error: 'Stream unavailable' }))
          setTimeout(initHls, 5000) // Auto-retry
        }
      })

      hlsRef.current = hls
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS (Safari)
      video.src = src
      video.addEventListener('loadedmetadata', () => {
        setState(s => ({ ...s, status: 'playing' }))
        video.play().catch(() => {})
      })
    } else {
      setState(s => ({ ...s, status: 'error', error: 'HLS not supported in this browser' }))
    }
  }

  useEffect(() => {
    initHls()
    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy()
        hlsRef.current = null
      }
    }
  }, [src])

  const toggleMute = () => {
    if (videoRef.current) videoRef.current.muted = !state.muted
    setState(s => ({ ...s, muted: !s.muted }))
  }

  const handleFullscreen = () => {
    if (videoRef.current) {
      if (document.fullscreenElement) {
        document.exitFullscreen()
      } else {
        videoRef.current.closest('.camera-cell')?.requestFullscreen?.()
      }
    }
  }

  return (
    <div className={`camera-cell group ${className}`}>
      {typeof onRotate === 'function' && (
        <button
          onClick={onRotate}
          disabled={rotateDisabled}
          className={`absolute top-2 right-2 z-30 inline-flex items-center justify-center rounded-lg px-2 py-1 text-xs backdrop-blur-sm transition-colors ${
            rotateDisabled
              ? 'bg-black/40 text-white/30 cursor-not-allowed'
              : 'bg-black/55 text-white/80 hover:text-white hover:bg-black/75'
          }`}
          title={rotateTitle}
          aria-label={rotateTitle}
        >
          <RotateCw size={14} />
        </button>
      )}

      <video
        ref={videoRef}
        muted={state.muted}
        playsInline
        autoPlay
        className="w-full h-full object-cover"
        style={{ transform: `rotate(${Number(cameraRotation) || 0}deg)` }}
      />

      {/* Loading overlay */}
      {state.status === 'loading' && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/60">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mb-2" />
          <span className="text-xs text-slate-400">Connecting...</span>
        </div>
      )}

      {/* Error overlay */}
      {state.status === 'error' && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/80">
          <WifiOff size={28} className="text-slate-500 mb-2" />
          <span className="text-xs text-slate-400">{state.error || 'Stream offline'}</span>
          <button
            onClick={initHls}
            className="mt-3 flex items-center gap-1.5 text-xs text-accent hover:text-accent-light 
                       bg-accent/10 hover:bg-accent/20 px-3 py-1.5 rounded-lg transition-colors"
          >
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      )}

      {/* Camera name overlay */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between 
               bg-gradient-to-b from-black/60 to-transparent px-2 py-1.5
               opacity-0 group-hover:opacity-100 transition-opacity duration-200">
        <div className="flex items-center gap-1.5">
          <span className={`status-dot ${state.status === 'playing' ? 'status-dot-online' : 'status-dot-offline'}`} />
          <span className="text-xs font-medium text-white truncate max-w-[120px]">{cameraName}</span>
        </div>
        {state.status === 'playing' && (
          <span className="text-xs text-danger font-semibold bg-danger/20 px-1.5 py-0.5 rounded">LIVE</span>
        )}
      </div>

      {/* Controls overlay */}
      {showControls && (
        <div className="absolute bottom-0 left-0 right-0 z-20 flex items-center justify-end gap-1
             bg-gradient-to-t from-black/60 to-transparent px-2 py-1.5
             opacity-100 transition-opacity duration-200">
          <button
            onClick={toggleMute}
            className="p-1 text-white/70 hover:text-white transition-colors"
            title={state.muted ? 'Unmute' : 'Mute'}
          >
            {state.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </button>
          {typeof onRotate === 'function' && (
            <button
              onClick={onRotate}
              disabled={rotateDisabled}
              className={`p-1 transition-colors ${
                rotateDisabled
                  ? 'text-white/30 cursor-not-allowed'
                  : 'text-white/70 hover:text-white'
              }`}
              title={rotateTitle}
            >
              <RotateCw size={14} />
            </button>
          )}
          <button
            onClick={handleFullscreen}
            className="p-1 text-white/70 hover:text-white transition-colors"
            title="Fullscreen"
          >
            <Maximize2 size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
