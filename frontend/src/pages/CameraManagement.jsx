import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  Plus, Search, RefreshCw, Loader2, Camera, Wifi, WifiOff,
  Circle, Trash2, Edit3, Radio, StopCircle, Scan, Image, RotateCw
} from 'lucide-react'
import { cameraApi } from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import toast from 'react-hot-toast'
import { formatDistanceToNow } from 'date-fns'

function StatusBadge({ status }) {
  if (status === 'online')
    return <span className="badge-online"><Circle size={6} className="mr-1 fill-current" />Online</span>
  return <span className="badge-offline"><Circle size={6} className="mr-1 fill-current" />Offline</span>
}

function defaultRtspPath(manufacturer = '') {
  const m = manufacturer.toLowerCase()
  if (m.includes('arecont')) return '/h264.sdp'
  if (m.includes('avigilon')) return '/defaultPrimary?streamType=u'
  if (m.includes('axis')) return '/axis-media/media.amp'
  if (m.includes('hikvision')) return '/Streaming/Channels/101'
  if (m.includes('dahua') || m.includes('amcrest')) return '/cam/realmonitor?channel=1&subtype=0'
  if (m.includes('hanwha') || m.includes('wisenet')) return '/profile2/media.smp'
  return '/stream1'
}

function buildDefaultRtspUrl({ ip_address, port, username, password, manufacturer }) {
  const ip = ip_address || ''
  const rtspPort = port || 554
  const user = username || ''
  const pass = password || ''
  const creds = user
    ? `${encodeURIComponent(user)}${pass ? `:${encodeURIComponent(pass)}` : ''}@`
    : ''
  const path = defaultRtspPath(manufacturer)
  return `rtsp://${creds}${ip}:${rtspPort}${path}`
}

function buildChannelRtspUrl(baseUrl, channel) {
  const safeChannel = Math.max(1, Math.min(64, Number(channel) || 1))

  try {
    const url = new URL(baseUrl)

    if (url.searchParams.has('channel')) {
      url.searchParams.set('channel', String(safeChannel))
      return url.toString()
    }

    const streamChannelsMatch = url.pathname.match(/^(.*\/Streaming\/Channels\/)(\d+)(\d{2})$/i)
    if (streamChannelsMatch) {
      const [, prefix, , streamSuffix] = streamChannelsMatch
      url.pathname = `${prefix}${safeChannel}${streamSuffix}`
      return url.toString()
    }

    if (/\/stream\d+$/i.test(url.pathname)) {
      url.pathname = url.pathname.replace(/\/stream\d+$/i, `/stream${safeChannel}`)
      return url.toString()
    }

    url.pathname = `/stream${safeChannel}`
    return url.toString()
  } catch {
    const replaced = String(baseUrl || '').replace(/\/stream\d+$/i, `/stream${safeChannel}`)
    if (replaced !== baseUrl) return replaced
    const trimmed = String(baseUrl || '').replace(/\/+$/, '')
    if (!trimmed) return `rtsp://0.0.0.0:554/stream${safeChannel}`
    return `${trimmed}/stream${safeChannel}`
  }
}

function shouldExpandToChannels(device) {
  const type = String(device?.device_type || '').toLowerCase()
  const model = String(device?.model || '').toLowerCase()
  const profileLabel = String(device?.profile_label || '').toLowerCase()
  const suggestedRtsp = String(device?.suggested_rtsp || '').toLowerCase()

  return /\b(recorder|nvr|dvr|xvr)\b/.test(type)
    || /\b(recorder|nvr|dvr|xvr|quad|4ch|4-channel|multi)\b/.test(model)
    || /\brecorder\b/.test(profileLabel)
    || /channel=1|\/stream1$|\/Streaming\/Channels\/101$/i.test(suggestedRtsp)
}

function expandDiscoveredDevices(rawDevices = []) {
  const expanded = []

  rawDevices.forEach((device, index) => {
    const baseName = `${device.manufacturer || 'Camera'} ${device.model || ''}`.trim()

    if (shouldExpandToChannels(device)) {
      for (let channel = 1; channel <= 4; channel += 1) {
        const suggestedRtsp = buildChannelRtspUrl(
          device.suggested_rtsp || buildDefaultRtspUrl({
            ip_address: device.ip,
            port: device.port || 554,
            manufacturer: device.manufacturer,
          }),
          channel
        )

        expanded.push({
          ...device,
          channel,
          channel_label: `Stream ${channel}`,
          display_name: `${baseName} Stream ${channel}`,
          suggested_rtsp: suggestedRtsp,
          _device_key: `${device.ip}|stream${channel}|${index}`,
        })
      }
      return
    }

    expanded.push({
      ...device,
      _device_key: `${device.ip}|single|${index}`,
      display_name: baseName,
    })
  })

  return expanded
}

function AddEditModal({ camera, onClose, onSave }) {
  const [form, setForm] = useState({
    name: camera?.name || '',
    ip_address: camera?.ip_address || '',
    rtsp_url: camera?.rtsp_url || buildDefaultRtspUrl({
      ip_address: camera?.ip_address || '',
      port: camera?.port || 554,
      username: camera?.username || '',
      password: camera?.password || '',
      manufacturer: camera?.manufacturer || '',
    }),
    port: camera?.port || 554,
    onvif_port: camera?.onvif_port || 80,
    username: camera?.username || '',
    password: camera?.password || '',
    snapshot_url: camera?.snapshot_url || '',
    manufacturer: camera?.manufacturer || '',
    model: camera?.model || '',
    location: camera?.location || '',
    resolution: camera?.resolution || '1920x1080',
    fps: camera?.fps || 15,
    rotation: Number(camera?.rotation) || 0,
    recording_enabled: camera?.recording_enabled !== 0,
  })
  const [saving, setSaving] = useState(false)
  const [addingChannels, setAddingChannels] = useState(false)
  const [streamCount, setStreamCount] = useState(4)
  const rtspEdited = useRef(false)

  const updateRtsp = (field, value) => {
    const next = { ...form, [field]: value }
    if (!camera && !rtspEdited.current) {
      next.rtsp_url = buildDefaultRtspUrl(next)
    }
    setForm(next)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      if (camera?.id) {
        await cameraApi.update(camera.id, form)
        toast.success('Camera updated')
      } else {
        await cameraApi.create(form)
        toast.success('Camera added')
      }
      onSave()
      onClose()
    } catch (err) {
      toast.error(err.response?.data?.error || err.response?.data?.errors?.[0]?.msg || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleAddChannels = async () => {
    if (camera?.id) return

    const ip = String(form.ip_address || '').trim()
    const baseRtsp = String(form.rtsp_url || '').trim()

    if (!ip || !baseRtsp) {
      toast.error('IP address and RTSP URL are required')
      return
    }

    setAddingChannels(true)
    let added = 0
    let failed = 0

    try {
      const baseName = String(form.name || '').trim() || `${form.manufacturer || 'Camera'} ${form.model || ''}`.trim() || ip

      const count = Math.max(1, Math.min(32, Number(streamCount) || 1))

      for (let channel = 1; channel <= count; channel += 1) {
        try {
          await cameraApi.create({
            ...form,
            name: `${baseName} Stream ${channel}`,
            rtsp_url: buildChannelRtspUrl(baseRtsp, channel),
          })
          added += 1
        } catch (_) {
          failed += 1
        }
      }

      if (added > 0) {
        toast.success(`Added ${added} stream${added === 1 ? '' : 's'} from ${ip}`)
        onSave()
        onClose()
      }

      if (failed > 0) {
        toast.error(`${failed} stream${failed === 1 ? '' : 's'} failed to add`)
      }
    } finally {
      setAddingChannels(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 animate-fade-in">
      <div className="bg-surface-700 border border-surface-500 rounded-2xl w-full max-w-xl shadow-2xl overflow-y-auto max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-500">
          <h2 className="text-lg font-semibold text-slate-100">
            {camera ? `Edit: ${camera.name}` : 'Add Camera'}
          </h2>
          <button onClick={onClose} className="btn-ghost p-1.5">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {!camera?.id && (
            <div className="rounded-lg border border-accent/40 bg-accent/10 p-3">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-40">
                  <label className="label text-xs">Multi-Cam on One IP</label>
                  <select
                    className="input"
                    value={streamCount}
                    onChange={e => setStreamCount(parseInt(e.target.value, 10) || 4)}
                  >
                    <option value="2">2 streams</option>
                    <option value="4">4 streams</option>
                    <option value="8">8 streams</option>
                    <option value="16">16 streams</option>
                  </select>
                </div>
                <button
                  type="button"
                  onClick={handleAddChannels}
                  disabled={saving || addingChannels}
                  className="btn-primary"
                  title={`Create ${streamCount} camera entries from one IP as Stream 1 through Stream ${streamCount}`}
                >
                  {addingChannels ? <Loader2 size={16} className="animate-spin inline mr-2" /> : null}
                  Add Stream 1-{streamCount}
                </button>
              </div>
              <p className="text-xs text-slate-300/90 mt-2">Use this when one recorder IP has multiple camera channels.</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="label">Camera Name *</label>
              <input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
            </div>
            <div>
              <label className="label">IP Address *</label>
              <input className="input" value={form.ip_address} onChange={e => updateRtsp('ip_address', e.target.value)} required />
            </div>
            <div>
              <label className="label">RTSP Port</label>
              <input type="number" className="input" value={form.port} onChange={e => updateRtsp('port', parseInt(e.target.value, 10) || 0)} />
            </div>
            <div className="col-span-2">
              <label className="label">ONVIF Port</label>
              <input type="number" className="input" value={form.onvif_port} onChange={e => setForm(f => ({ ...f, onvif_port: parseInt(e.target.value, 10) || 0 }))} />
            </div>
            <div className="col-span-2">
              <label className="label">RTSP URL *</label>
              <input className="input font-mono text-sm" value={form.rtsp_url} onChange={e => { rtspEdited.current = true; setForm(f => ({ ...f, rtsp_url: e.target.value })) }} required />
              <p className="text-xs text-slate-500 mt-1">e.g. rtsp://user:pass@192.168.1.100:554/h264.sdp (Arecont) or /stream1</p>
            </div>
            <div className="col-span-2">
              <label className="label">Snapshot URL (optional)</label>
              <input
                className="input font-mono text-sm"
                value={form.snapshot_url}
                onChange={e => setForm(f => ({ ...f, snapshot_url: e.target.value }))}
                placeholder="http://camera-ip/cgi-bin/snapshot.jpg"
              />
            </div>
            <div>
              <label className="label">Username</label>
              <input className="input" value={form.username} onChange={e => updateRtsp('username', e.target.value)} autoComplete="off" />
            </div>
            <div>
              <label className="label">Password</label>
              <input type="password" className="input" value={form.password} onChange={e => updateRtsp('password', e.target.value)} autoComplete="new-password" />
            </div>
            <div>
              <label className="label">Manufacturer</label>
              <input className="input" value={form.manufacturer} onChange={e => updateRtsp('manufacturer', e.target.value)} placeholder="e.g. Hikvision, Arecont Vision" />
            </div>
            <div>
              <label className="label">Model</label>
              <input className="input" value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} placeholder="e.g. DS-2CD2143G2" />
            </div>
            <div className="col-span-2">
              <label className="label">Location / Description</label>
              <input className="input" value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="e.g. Front Door, Parking Lot" />
            </div>
            <div>
              <label className="label">Resolution</label>
              <select className="input" value={form.resolution} onChange={e => setForm(f => ({ ...f, resolution: e.target.value }))}>
                <option>3840x2160</option>
                <option>1920x1080</option>
                <option>1280x720</option>
                <option>640x480</option>
              </select>
            </div>
            <div>
              <label className="label">FPS</label>
              <select className="input" value={form.fps} onChange={e => setForm(f => ({ ...f, fps: parseInt(e.target.value) }))}>
                <option value="30">30 fps</option>
                <option value="25">25 fps</option>
                <option value="15">15 fps</option>
                <option value="10">10 fps</option>
                <option value="5">5 fps</option>
              </select>
            </div>
            <div>
              <label className="label">Rotation</label>
              <select className="input" value={form.rotation} onChange={e => setForm(f => ({ ...f, rotation: parseInt(e.target.value, 10) || 0 }))}>
                <option value="0">0° (Normal)</option>
                <option value="90">90°</option>
                <option value="180">180° (Upside down)</option>
                <option value="270">270°</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded accent-blue-500"
                  checked={form.recording_enabled}
                  onChange={e => setForm(f => ({ ...f, recording_enabled: e.target.checked }))}
                />
                <span className="text-sm text-slate-300">Enable continuous recording</span>
              </label>
            </div>
          </div>

          <div className="flex gap-3 pt-2 border-t border-surface-500">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1">
              {saving ? <Loader2 size={16} className="animate-spin inline mr-2" /> : null}
              {camera ? 'Save Changes' : 'Add Camera'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function DiscoverModal({ onAdd, onAddBatch, onClose }) {
  const [scanning, setScanning] = useState(true)
  const [devices, setDevices] = useState([])
  const [profileFilter, setProfileFilter] = useState('avigilon-like')
  const [styleFilter, setStyleFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [discoverySubnets, setDiscoverySubnets] = useState('')
  const [selectedDeviceKeys, setSelectedDeviceKeys] = useState(new Set())
  const [addingBatch, setAddingBatch] = useState(false)
  const [sharedUsername, setSharedUsername] = useState('')
  const [sharedPassword, setSharedPassword] = useState('')

  const parseSubnets = useCallback((value) => {
    return value
      .split(/[\n,]/)
      .map(subnet => subnet.trim())
      .filter(Boolean)
  }, [])

  const runDiscovery = useCallback(() => {
    setScanning(true)
    const subnets = parseSubnets(discoverySubnets)
    cameraApi.discover(subnets.length > 0 ? { subnets } : undefined)
      .then(res => setDevices(expandDiscoveredDevices(res.data.devices || [])))
      .catch((err) => {
        const status = err.response?.status
        const details = err.response?.data?.details
        const error = err.response?.data?.error
        const passwordResetRequired = Boolean(err.response?.data?.passwordResetRequired)

        if (status === 403 && passwordResetRequired) {
          toast.error('Discovery blocked: password reset required for this account')
          return
        }

        if (status === 403) {
          toast.error(`Discovery blocked: ${error || 'insufficient permissions'}`)
          return
        }

        if (status === 429) {
          toast.error(error || 'Discovery rate limit reached, please wait and retry')
          return
        }

        const message = details || error || err.message
        toast.error(message ? `Discovery failed: ${message}` : 'Discovery failed')
      })
      .finally(() => setScanning(false))
  }, [discoverySubnets, parseSubnets])

  useEffect(() => {
    runDiscovery()
  }, [runDiscovery])

  const styleOptions = useMemo(() => {
    const allStyles = Array.from(
      new Set(devices.map(d => d.camera_style || 'Standard IP'))
    ).sort((a, b) => a.localeCompare(b))

    return ['all', ...allStyles]
  }, [devices])

  const filteredDevices = useMemo(() => {
    const term = query.trim().toLowerCase()

    return [...devices]
      .filter(d => {
        const manufacturer = (d.manufacturer || '').toLowerCase()
        if (profileFilter === 'all') return true
        if (profileFilter === 'avigilon-only') {
          return d.is_avigilon || manufacturer.includes('avigilon')
        }
        return d.is_avigilon_like || manufacturer.includes('avigilon')
      })
      .filter(d => {
        if (styleFilter === 'all') return true
        return (d.camera_style || 'Standard IP') === styleFilter
      })
      .filter(d => {
        if (!term) return true
        return [
          d.manufacturer,
          d.model,
          d.ip,
          d.protocol,
          d.camera_style,
          d.device_type,
          d.scope_name,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(term)
      })
      .sort((a, b) => {
        const rank = { high: 3, medium: 2, low: 1 }
        const confidenceDiff = (rank[b.match_confidence] || 0) - (rank[a.match_confidence] || 0)
        if (confidenceDiff !== 0) return confidenceDiff

        const profileDiff = (b.is_avigilon_like ? 1 : 0) - (a.is_avigilon_like ? 1 : 0)
        if (profileDiff !== 0) return profileDiff

        return (a.manufacturer || '').localeCompare(b.manufacturer || '')
      })
  }, [devices, profileFilter, styleFilter, query])

  const buildRtspWithCreds = useCallback((device) => {
    const baseUrl = device.suggested_rtsp || buildDefaultRtspUrl({
      ip_address: device.ip,
      port: device.port || 554,
      manufacturer: device.manufacturer,
    })
    if (!sharedUsername) return baseUrl
    try {
      const url = new URL(baseUrl)
      if (!url.username) url.username = encodeURIComponent(sharedUsername)
      if (!url.password && sharedPassword) url.password = encodeURIComponent(sharedPassword)
      return url.toString()
    } catch {
      const creds = `${encodeURIComponent(sharedUsername)}${sharedPassword ? `:${encodeURIComponent(sharedPassword)}` : ''}@`
      return baseUrl.replace(/^rtsp:\/\//i, `rtsp://${creds}`)
    }
  }, [sharedUsername, sharedPassword])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 animate-fade-in">
      <div className="bg-surface-700 border border-surface-500 rounded-2xl w-full max-w-3xl shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-500">
          <h2 className="text-lg font-semibold text-slate-100">Discover Cameras</h2>
          <div className="flex items-center gap-2">
            <button onClick={runDiscovery} className="btn-secondary text-xs py-1.5 px-3" disabled={scanning}>
              <RefreshCw size={12} className={`inline mr-1 ${scanning ? 'animate-spin' : ''}`} />
              Scan Again
            </button>
            <button onClick={onClose} className="btn-ghost p-1.5">✕</button>
          </div>
        </div>

        <div className="p-6 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="label text-xs">Camera Profile</label>
              <select className="input" value={profileFilter} onChange={e => setProfileFilter(e.target.value)}>
                <option value="avigilon-like">Avigilon + alike (recommended)</option>
                <option value="avigilon-only">Avigilon only</option>
                <option value="all">All ONVIF devices</option>
              </select>
            </div>
            <div>
              <label className="label text-xs">Style / Type</label>
              <select className="input" value={styleFilter} onChange={e => setStyleFilter(e.target.value)}>
                {styleOptions.map(style => (
                  <option key={style} value={style}>
                    {style === 'all' ? 'All styles' : style}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label text-xs">Search</label>
              <input
                className="input"
                placeholder="Manufacturer, model, IP..."
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="label text-xs">Discovery Subnets (optional)</label>
            <textarea
              className="input min-h-[72px] font-mono text-sm"
              placeholder="192.168.1.0/24, 10.0.0.0/24"
              value={discoverySubnets}
              onChange={e => setDiscoverySubnets(e.target.value)}
            />
            <p className="text-xs text-slate-500 mt-1">
              Useful for Docker or remote deployments when the server cannot infer the camera LAN automatically.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="label text-xs">Shared Username (optional)</label>
              <input
                className="input"
                placeholder="Use for Add/Add Selected"
                value={sharedUsername}
                onChange={e => setSharedUsername(e.target.value)}
              />
            </div>
            <div>
              <label className="label text-xs">Shared Password (optional)</label>
              <input
                type="password"
                className="input"
                placeholder="Use for Add/Add Selected"
                value={sharedPassword}
                onChange={e => setSharedPassword(e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">
              Showing {filteredDevices.length} of {devices.length} discovered device{devices.length !== 1 ? 's' : ''}
            </p>
            {filteredDevices.length > 0 && (
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="w-3.5 h-3.5 rounded accent-blue-500"
                    checked={filteredDevices.every(d => selectedIps.has(d.ip))}
                    onChange={e => {
                      if (e.target.checked) setSelectedDeviceKeys(new Set(filteredDevices.map(d => d._device_key)))
                      else setSelectedDeviceKeys(new Set())
                    }}
                  />
                  Select all
                </label>
                {selectedDeviceKeys.size > 0 && (
                  <button
                    onClick={async () => {
                      setAddingBatch(true)
                      await onAddBatch(
                        filteredDevices.filter(d => selectedDeviceKeys.has(d._device_key)),
                        { username: sharedUsername, password: sharedPassword, rtspForDevice: buildRtspWithCreds }
                      )
                      setAddingBatch(false)
                      setSelectedDeviceKeys(new Set())
                    }}
                    disabled={addingBatch}
                    className="btn-primary text-xs py-1 px-3"
                  >
                    {addingBatch
                      ? <Loader2 size={12} className="inline mr-1 animate-spin" />
                      : <Plus size={12} className="inline mr-1" />}
                    Add Selected ({selectedDeviceKeys.size})
                  </button>
                )}
              </div>
            )}
          </div>

          {scanning ? (
            <div className="flex flex-col items-center py-8 gap-3">
              <Loader2 size={32} className="animate-spin text-accent" />
              <p className="text-slate-400">Scanning network for ONVIF cameras...</p>
            </div>
          ) : filteredDevices.length === 0 ? (
            <div className="text-center py-8">
              <Wifi size={32} className="text-slate-600 mx-auto mb-3" />
              {devices.length === 0 ? (
                <>
                  <p className="text-slate-400">No ONVIF cameras found on the network.</p>
                  <p className="text-xs text-slate-500 mt-2">Try adding cameras manually using their RTSP URL.</p>
                </>
              ) : (
                <>
                  <p className="text-slate-400">No cameras match the selected profile/style filters.</p>
                  <p className="text-xs text-slate-500 mt-2">Switch to "All ONVIF devices" to view everything discovered.</p>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {filteredDevices.map((d, i) => (
                <div key={d._device_key || `${d.ip}-${i}`} className="flex items-center justify-between p-3 bg-surface-800 rounded-lg border border-surface-600">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      className="w-4 h-4 rounded accent-blue-500 flex-shrink-0"
                      checked={selectedDeviceKeys.has(d._device_key)}
                      onChange={e => {
                        setSelectedDeviceKeys(prev => {
                          const next = new Set(prev)
                          if (e.target.checked) next.add(d._device_key)
                          else next.delete(d._device_key)
                          return next
                        })
                      }}
                    />
                    <div>
                      <div className="text-sm font-medium text-slate-200">{d.display_name || `${d.manufacturer} ${d.model}`}</div>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        <span className="text-xs text-slate-500 font-mono">{d.ip} | {d.protocol}</span>
                        {d.channel_label ? <span className="badge-info">{d.channel_label}</span> : null}
                        <span className="badge-info">{d.camera_style || 'Standard IP'}</span>
                        <span className="badge bg-surface-500 text-slate-300">{d.device_type || 'IP Camera'}</span>
                        <span className={d.is_avigilon_like ? 'badge-online' : 'badge bg-surface-500 text-slate-400'}>
                          {d.profile_label || (d.is_avigilon_like ? 'Avigilon-like' : 'Other ONVIF')}
                        </span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => onAdd(d, {
                      username: sharedUsername,
                      password: sharedPassword,
                      rtsp_url: buildRtspWithCreds(d),
                    })}
                    className="btn-primary text-xs py-1 px-3 flex-shrink-0"
                  >
                    <Plus size={12} className="inline mr-1" />Add
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function CameraManagement() {
  const { user, isOperator, isAdmin, loading: authLoading } = useAuth()
  const [cameras, setCameras] = useState([])
  const [loading, setLoading] = useState(true)
  const [cameraLoadError, setCameraLoadError] = useState('')
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(null) // null | 'add' | 'edit' | 'discover'
  const [editCamera, setEditCamera] = useState(null)
  const [processing, setProcessing] = useState({})
  const [diagnosingOffline, setDiagnosingOffline] = useState(false)
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
      .catch((err) => {
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
    // Wait for auth context to load before fetching cameras
    if (authLoading) return
    
    fetchCameras()
    const i = setInterval(fetchCameras, 20000)
    return () => clearInterval(i)
  }, [fetchCameras, authLoading])

  const deleteCamera = async (cam) => {
    if (!confirm(`Delete camera "${cam.name}"? This will also delete all recordings.`)) return
    try {
      await cameraApi.delete(cam.id)
      toast.success('Camera deleted')
      fetchCameras()
    } catch {
      toast.error('Delete failed')
    }
  }

  const toggleRecording = async (cam) => {
    const key = `rec-${cam.id}`
    setProcessing(p => ({ ...p, [key]: true }))
    try {
      if (cam.recording_enabled) {
        await cameraApi.stopRecording(cam.id)
        toast.success(`Recording stopped: ${cam.name}`)
      } else {
        await cameraApi.startRecording(cam.id)
        toast.success(`Recording started: ${cam.name}`)
      }
      fetchCameras()
    } catch {
      toast.error('Failed to toggle recording')
    } finally {
      setProcessing(p => ({ ...p, [key]: false }))
    }
  }

  const toggleStream = async (cam) => {
    const key = `stream-${cam.id}`
    setProcessing(p => ({ ...p, [key]: true }))
    try {
      if (cam.status === 'online') {
        await cameraApi.stopStream(cam.id)
        toast.success(`Stream stopped: ${cam.name}`)
      } else {
        await cameraApi.startStream(cam.id)
        toast.success(`Stream starting: ${cam.name}`)
      }
      fetchCameras()
    } catch {
      toast.error('Failed to toggle stream')
    } finally {
      setProcessing(p => ({ ...p, [key]: false }))
    }
  }

  const takeSnapshot = async (cam) => {
    const key = `snap-${cam.id}`
    setProcessing(p => ({ ...p, [key]: true }))
    try {
      await cameraApi.snapshot(cam.id)
      toast.success(`Snapshot captured: ${cam.name}`)
      fetchCameras()
    } catch {
      toast.error('Snapshot failed')
    } finally {
      setProcessing(p => ({ ...p, [key]: false }))
    }
  }

  const rotateCamera = async (cam) => {
    const key = `rotate-${cam.id}`
    setProcessing(p => ({ ...p, [key]: true }))
    try {
      const current = Number(cam.rotation) || 0
      const nextRotation = (current + 90) % 360
      await cameraApi.update(cam.id, { rotation: nextRotation })
      toast.success(`${cam.name} rotated to ${nextRotation} deg`)
      fetchCameras()
    } catch {
      toast.error('Failed to rotate camera')
    } finally {
      setProcessing(p => ({ ...p, [key]: false }))
    }
  }

  const testRtsp = async (cam) => {
    const key = `test-${cam.id}`
    setProcessing(p => ({ ...p, [key]: true }))
    try {
      const res = await cameraApi.testStream(cam.id)
      const result = res.data || {}
      const endpoint = `${cam.ip_address}:${cam.port || 554}`

      if (result.ok) {
        toast.success(`RTSP OK: ${cam.name}`)
      } else {
        const reason = result.reason === 'network_unreachable' || result.reason === 'timeout'
          ? `Server cannot reach ${endpoint}. Check route/firewall between server and camera LAN.`
          : (result.message || 'RTSP test failed')
        toast.error(`${cam.name}: ${reason}`)
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'RTSP test failed')
    } finally {
      setProcessing(p => ({ ...p, [key]: false }))
    }
  }

  const diagnoseOfflineCameras = async () => {
    const offline = cameras.filter(c => c.status !== 'online')
    if (offline.length === 0) {
      toast.success('No offline cameras to diagnose')
      return
    }

    setDiagnosingOffline(true)
    try {
      let successCount = 0
      const failures = []

      for (const cam of offline) {
        try {
          const res = await cameraApi.testStream(cam.id)
          const result = res.data || {}
          if (result.ok) successCount += 1
          else failures.push({ name: cam.name, reason: result.reason, message: result.message })
        } catch (err) {
          failures.push({
            name: cam.name,
            reason: 'probe_error',
            message: err.response?.data?.error || 'RTSP test failed',
          })
        }
      }

      if (failures.length === 0) {
        toast.success(`RTSP diagnostics passed for ${successCount} camera${successCount === 1 ? '' : 's'}`)
      } else {
        const networkFailures = failures.filter(f => f.reason === 'network_unreachable' || f.reason === 'timeout').length
        if (networkFailures === failures.length) {
          toast.error('All offline cameras are unreachable from the server. This is server-to-camera network routing/firewall, not browser access.')
        } else {
          const names = failures.map(f => f.name).join(', ')
          toast.error(`RTSP issues detected: ${names}`)
        }
      }
    } finally {
      setDiagnosingOffline(false)
    }
  }

  const handleAddBatch = async (devices, options = {}) => {
    const { username = '', password = '', rtspForDevice } = options
    let added = 0, failed = 0
    for (const device of devices) {
      try {
        await cameraApi.create({
          name: device.display_name || `${device.manufacturer} ${device.model}`,
          ip_address: device.ip,
          rtsp_url: typeof rtspForDevice === 'function'
            ? rtspForDevice(device)
            : (device.suggested_rtsp || buildDefaultRtspUrl({
              ip_address: device.ip,
              port: device.port || 554,
              manufacturer: device.manufacturer,
            })),
          port: device.port || 554,
          username: username || undefined,
          password: password || undefined,
          manufacturer: device.manufacturer,
          model: device.model,
          onvif_port: device.onvif_port || 80,
        })
        added++
      } catch {
        failed++
      }
    }
    if (added) toast.success(`${added} camera${added !== 1 ? 's' : ''} added`)
    if (failed) toast.error(`${failed} camera${failed !== 1 ? 's' : ''} failed to add`)
    fetchCameras()
    setModal(null)
  }

  const filtered = cameras.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.ip_address.includes(search) ||
    (c.location || '').toLowerCase().includes(search.toLowerCase())
  )

  if (authLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 size={32} className="animate-spin text-accent" />
      </div>
    )
  }

  if (!isOperator) {
    return (
      <div className="space-y-5">
        <div className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-slate-300">
          You do not have permission to manage cameras. Admin or Operator role is required.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {/* User context display */}
      <div className="text-xs text-slate-500">
        Logged in as: <span className="text-slate-300 font-medium">{user?.username}</span> ({user?.role})
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            className="input pl-9"
            placeholder="Search cameras by name, IP, or location..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <button onClick={fetchCameras} className="btn-secondary">
          <RefreshCw size={14} className="mr-1.5" />Refresh
        </button>
        {isOperator && (
          <button onClick={diagnoseOfflineCameras} className="btn-secondary" disabled={diagnosingOffline}>
            {diagnosingOffline
              ? <Loader2 size={14} className="mr-1.5 animate-spin" />
              : <Scan size={14} className="mr-1.5" />}
            Diagnose Offline
          </button>
        )}
        {isOperator && (
          <>
            <button onClick={() => setModal('discover')} className="btn-secondary">
              <Scan size={14} className="mr-1.5" />Discover
            </button>
            <button onClick={() => { setEditCamera(null); setModal('add') }} className="btn-primary">
              <Plus size={14} className="mr-1.5" />Add Camera
            </button>
          </>
        )}
      </div>

      {/* Stats bar */}
      {cameraLoadError && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-slate-300">
          {cameraLoadError}
        </div>
      )}

      <div className="flex items-center gap-6 text-sm">
        <span className="text-slate-400">{cameras.length} total</span>
        <span className="text-success">{cameras.filter(c => c.status === 'online').length} online</span>
        <span className="text-danger">{cameras.filter(c => c.status !== 'online').length} offline</span>
        <span className="text-accent">{cameras.filter(c => c.recording_enabled && c.status === 'online').length} recording</span>
      </div>

      {/* Camera table */}
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
                <th>IP Address</th>
                <th>Location</th>
                <th>Status</th>
                <th>Recording</th>
                <th>Last Seen</th>
                {isOperator && <th className="text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={isOperator ? 7 : 6} className="py-12 text-center text-slate-500">
                    {cameras.length === 0 ? 'No cameras added yet' : 'No cameras match your search'}
                  </td>
                </tr>
              ) : filtered.map(cam => (
                <tr key={cam.id}>
                  <td>
                    <div className="flex items-center gap-2">
                      <Camera size={15} className="text-slate-500 flex-shrink-0" />
                      <div>
                        <div className="font-medium text-slate-200">{cam.name}</div>
                        <div className="text-xs text-slate-500">{cam.manufacturer} {cam.model}</div>
                      </div>
                    </div>
                  </td>
                  <td className="font-mono text-xs text-slate-400">{cam.ip_address}:{cam.port}</td>
                  <td className="text-slate-400">{cam.location || <span className="text-slate-600">—</span>}</td>
                  <td><StatusBadge status={cam.status} /></td>
                  <td>
                    {cam.recording_enabled ? (
                      <span className="badge bg-accent/20 text-accent">
                        <Circle size={6} className="mr-1 fill-current animate-pulse" />Recording
                      </span>
                    ) : (
                      <span className="badge bg-surface-500 text-slate-500">Off</span>
                    )}
                  </td>
                  <td className="text-xs text-slate-500">
                    {cam.last_seen
                      ? formatDistanceToNow(new Date(cam.last_seen), { addSuffix: true })
                      : 'Never'}
                  </td>
                  {isOperator && (
                    <td>
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => testRtsp(cam)}
                          disabled={!!processing[`test-${cam.id}`]}
                          className="btn-ghost p-1.5 text-accent hover:text-blue-300"
                          title="Verify RTSP"
                        >
                          {processing[`test-${cam.id}`]
                            ? <Loader2 size={15} className="animate-spin" />
                            : <Search size={15} />}
                        </button>
                        <button
                          onClick={() => toggleStream(cam)}
                          disabled={!!processing[`stream-${cam.id}`]}
                          className={`btn-ghost p-1.5 text-xs ${cam.status === 'online' ? 'text-warning hover:text-yellow-300' : 'text-info hover:text-blue-300'}`}
                          title={cam.status === 'online' ? 'Stop Stream' : 'Start Stream'}
                        >
                          {cam.status === 'online' ? <WifiOff size={15} /> : <Wifi size={15} />}
                        </button>
                        <button
                          onClick={() => toggleRecording(cam)}
                          disabled={!!processing[`rec-${cam.id}`]}
                          className={`btn-ghost p-1.5 text-xs ${cam.recording_enabled ? 'text-danger hover:text-red-300' : 'text-success hover:text-green-300'}`}
                          title={cam.recording_enabled ? 'Stop Recording' : 'Start Recording'}
                        >
                          {cam.recording_enabled ? <StopCircle size={15} /> : <Radio size={15} />}
                        </button>
                        <button
                          onClick={() => takeSnapshot(cam)}
                          disabled={!!processing[`snap-${cam.id}`]}
                          className="btn-ghost p-1.5 text-info hover:text-blue-300"
                          title="Capture Snapshot"
                        >
                          <Image size={15} />
                        </button>
                        <button
                          onClick={() => rotateCamera(cam)}
                          disabled={!!processing[`rotate-${cam.id}`]}
                          className="btn-ghost p-1.5 text-warning hover:text-yellow-300"
                          title={`Rotate (${Number(cam.rotation) || 0} deg)`}
                        >
                          <RotateCw size={15} />
                        </button>
                        <button
                          onClick={() => { setEditCamera(cam); setModal('edit') }}
                          className="btn-ghost p-1.5"
                          title="Edit"
                        >
                          <Edit3 size={15} />
                        </button>
                        {isAdmin && (
                          <button
                            onClick={() => deleteCamera(cam)}
                            className="btn-ghost p-1.5 text-danger hover:text-red-300"
                            title="Delete"
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals */}
      {(modal === 'add' || modal === 'edit') && (
        <AddEditModal
          camera={editCamera}
          onClose={() => setModal(null)}
          onSave={fetchCameras}
        />
      )}
      {modal === 'discover' && (
        <DiscoverModal
          onAdd={(device, creds = {}) => {
            setEditCamera({
              name: device.display_name || `${device.manufacturer} ${device.model}`,
              ip_address: device.ip,
              rtsp_url: creds.rtsp_url || device.suggested_rtsp || buildDefaultRtspUrl({
                ip_address: device.ip,
                port: device.port || 554,
                manufacturer: device.manufacturer,
              }),
              port: device.port,
              username: creds.username || '',
              password: creds.password || '',
              manufacturer: device.manufacturer,
              model: device.model,
              onvif_port: device.onvif_port,
              rotation: 0,
            })
            setModal('add')
          }}
          onAddBatch={handleAddBatch}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}
