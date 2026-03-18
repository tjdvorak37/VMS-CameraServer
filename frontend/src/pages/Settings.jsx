import { useState, useEffect } from 'react'
import {
  Save,
  Loader2,
  Shield,
  HardDrive,
  Bell,
  KeyRound,
  ServerCog,
  AlertTriangle,
  Globe,
} from 'lucide-react'
import { dashboardApi, authApi, setupApi } from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import toast from 'react-hot-toast'

function SettingSection({ title, icon: Icon, children }) {
  return (
    <div className="card space-y-4">
      <div className="flex items-center gap-2 pb-3 border-b border-surface-500">
        <Icon size={16} className="text-accent" />
        <h3 className="font-semibold text-slate-200">{title}</h3>
      </div>
      {children}
    </div>
  )
}

export default function Settings() {
  const { user } = useAuth()
  const [settings, setSettings] = useState({
    retention_days: '30',
    max_cameras: '64',
    snapshot_interval: '60',
    email_alerts: 'false',
    smtp_host: '',
    smtp_port: '587',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [serverConfig, setServerConfig] = useState({
    node_env: 'production',
    port: '3001',
    vms_port: '8080',
    cors_origins: 'http://localhost:5173,http://localhost:3001',
    segment_duration: '600',
    public_base_url: '',
  })
  const [runtimeConfig, setRuntimeConfig] = useState({
    node_env: '',
    port: '',
    cors_origins: '',
    segment_duration: '',
  })
  const [serverMeta, setServerMeta] = useState({
    envExists: true,
    envWritable: true,
    restartRequiredFields: [],
    note: '',
  })
  const [serverSaving, setServerSaving] = useState(false)
  const [serverConfigError, setServerConfigError] = useState('')
  const [restartNotice, setRestartNotice] = useState('')

  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [pwSaving, setPwSaving] = useState(false)

  const refreshServerConfig = async () => {
    const res = await setupApi.serverConfig()
    const data = res.data || {}

    setServerConfig(prev => ({
      ...prev,
      ...(data.values || {}),
    }))

    setRuntimeConfig(prev => ({
      ...prev,
      ...(data.runtime || {}),
    }))

    setServerMeta({
      envExists: Boolean(data.env?.exists),
      envWritable: Boolean(data.env?.writable),
      restartRequiredFields: Array.isArray(data.restartRequiredFields) ? data.restartRequiredFields : [],
      note: data.note || '',
    })
  }

  useEffect(() => {
    let isMounted = true

    Promise.allSettled([
      dashboardApi.settings(),
      setupApi.serverConfig(),
    ])
      .then(results => {
        if (!isMounted) return

        const [settingsResult, serverResult] = results

        if (settingsResult.status === 'fulfilled') {
          setSettings(s => ({ ...s, ...settingsResult.value.data }))
        } else {
          toast.error('Failed to load dashboard settings')
        }

        if (serverResult.status === 'fulfilled') {
          const data = serverResult.value.data || {}
          setServerConfig(prev => ({ ...prev, ...(data.values || {}) }))
          setRuntimeConfig(prev => ({ ...prev, ...(data.runtime || {}) }))
          setServerMeta({
            envExists: Boolean(data.env?.exists),
            envWritable: Boolean(data.env?.writable),
            restartRequiredFields: Array.isArray(data.restartRequiredFields) ? data.restartRequiredFields : [],
            note: data.note || '',
          })
          setServerConfigError('')
        } else {
          setServerConfigError('Unable to load server configuration endpoint. Ensure backend is updated and reachable.')
        }
      })
      .finally(() => {
        if (isMounted) setLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [])

  const saveSettings = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await dashboardApi.updateSettings(settings)
      toast.success('Settings saved')
    } catch {
      toast.error('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const changePassword = async (e) => {
    e.preventDefault()
    if (pwForm.newPassword !== pwForm.confirmPassword) {
      toast.error('New passwords do not match')
      return
    }
    if (pwForm.newPassword.length < 8) {
      toast.error('Password must be at least 8 characters')
      return
    }
    setPwSaving(true)
    try {
      await authApi.changePassword({
        currentPassword: pwForm.currentPassword,
        newPassword: pwForm.newPassword,
      })
      toast.success('Password changed successfully')
      setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to change password')
    } finally {
      setPwSaving(false)
    }
  }

  const saveServerConfig = async (e) => {
    e.preventDefault()

    const port = Number.parseInt(serverConfig.port, 10)
    const publicPort = Number.parseInt(serverConfig.vms_port, 10)
    const segmentDuration = Number.parseInt(serverConfig.segment_duration, 10)

    if (!['development', 'production'].includes(serverConfig.node_env)) {
      toast.error('Node environment must be development or production')
      return
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      toast.error('Backend port must be between 1 and 65535')
      return
    }
    if (!Number.isInteger(publicPort) || publicPort < 1 || publicPort > 65535) {
      toast.error('Public port must be between 1 and 65535')
      return
    }
    if (!Number.isInteger(segmentDuration) || segmentDuration < 10 || segmentDuration > 86400) {
      toast.error('Segment duration must be between 10 and 86400 seconds')
      return
    }

    const origins = serverConfig.cors_origins
      .split(',')
      .map(origin => origin.trim())
      .filter(Boolean)

    if (origins.length === 0) {
      toast.error('At least one CORS origin is required')
      return
    }

    for (const origin of origins) {
      let parsed
      try {
        parsed = new URL(origin)
      } catch {
        toast.error(`Invalid CORS origin: ${origin}`)
        return
      }
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        toast.error(`CORS origin must use http/https: ${origin}`)
        return
      }
    }

    const publicBaseUrl = (serverConfig.public_base_url || '').trim()
    if (publicBaseUrl) {
      let parsed
      try {
        parsed = new URL(publicBaseUrl)
      } catch {
        toast.error('Public base URL must be a valid URL')
        return
      }
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        toast.error('Public base URL must use http/https')
        return
      }
    }

    setServerSaving(true)

    try {
      const res = await setupApi.updateServerConfig({
        node_env: serverConfig.node_env,
        port,
        vms_port: publicPort,
        cors_origins: origins.join(','),
        segment_duration: segmentDuration,
        public_base_url: publicBaseUrl,
      })

      const changedFields = Array.isArray(res.data?.changedFields) ? res.data.changedFields : []
      const restartFields = Array.isArray(res.data?.restartRequiredFieldsChanged)
        ? res.data.restartRequiredFieldsChanged
        : []

      if (changedFields.length === 0) {
        toast.success('No server configuration changes were needed')
      } else if (restartFields.length > 0) {
        toast.success('Server configuration saved. Restart required.')
      } else {
        toast.success('Server configuration saved')
      }

      setRestartNotice(
        restartFields.length > 0
          ? `Restart backend service to apply: ${restartFields.join(', ')}`
          : ''
      )

      await refreshServerConfig()
    } catch (err) {
      const apiErrors = err.response?.data?.errors
      if (Array.isArray(apiErrors) && apiErrors.length > 0) {
        toast.error(apiErrors[0].msg || 'Failed to save server configuration')
      } else {
        toast.error(err.response?.data?.error || 'Failed to save server configuration')
      }
    } finally {
      setServerSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 size={32} className="animate-spin text-accent" />
      </div>
    )
  }

  return (
    <div className="max-w-4xl space-y-6 animate-fade-in">
      {/* Recording retention settings */}
      <form onSubmit={saveSettings}>
        <SettingSection title="Recording & Retention" icon={HardDrive}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="label">Retention Period (days)</label>
              <input
                type="number"
                className="input"
                min={1}
                max={365}
                value={settings.retention_days}
                onChange={e => setSettings(s => ({ ...s, retention_days: e.target.value }))}
              />
              <p className="text-xs text-slate-500 mt-1">
                Recordings older than this will be deleted automatically
              </p>
            </div>
            <div>
              <label className="label">Max Cameras</label>
              <input
                type="number"
                className="input"
                min={1}
                max={512}
                value={settings.max_cameras}
                onChange={e => setSettings(s => ({ ...s, max_cameras: e.target.value }))}
              />
              <p className="text-xs text-slate-500 mt-1">
                System-wide camera capacity target
              </p>
            </div>
            <div>
              <label className="label">Snapshot Interval (seconds)</label>
              <input
                type="number"
                className="input"
                min={10}
                max={3600}
                value={settings.snapshot_interval}
                onChange={e => setSettings(s => ({ ...s, snapshot_interval: e.target.value }))}
              />
            </div>
          </div>
        </SettingSection>

        <div className="mt-4">
          <SettingSection title="Notifications" icon={Bell}>
            <div className="space-y-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded accent-blue-500"
                  checked={settings.email_alerts === 'true'}
                  onChange={e => setSettings(s => ({ ...s, email_alerts: String(e.target.checked) }))}
                />
                <span className="text-sm text-slate-300">Enable email alerts for critical events</span>
              </label>
              {settings.email_alerts === 'true' && (
                <div className="grid grid-cols-2 gap-3 pl-6">
                  <div>
                    <label className="label text-xs">SMTP Host</label>
                    <input
                      className="input"
                      placeholder="smtp.example.com"
                      value={settings.smtp_host}
                      onChange={e => setSettings(s => ({ ...s, smtp_host: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="label text-xs">SMTP Port</label>
                    <input
                      type="number"
                      className="input"
                      value={settings.smtp_port}
                      onChange={e => setSettings(s => ({ ...s, smtp_port: e.target.value }))}
                    />
                  </div>
                </div>
              )}
            </div>
          </SettingSection>
        </div>

        <div className="mt-4 flex justify-end">
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? <Loader2 size={14} className="animate-spin inline mr-2" /> : <Save size={14} className="inline mr-2" />}
            Save Settings
          </button>
        </div>
      </form>

      {/* Server setup */}
      <form onSubmit={saveServerConfig}>
        <SettingSection title="Server Setup (Managed .env)" icon={ServerCog}>
          <div className="rounded-lg border border-warning/40 bg-warning/10 p-3">
            <div className="flex items-start gap-2 text-sm text-warning">
              <AlertTriangle size={16} className="mt-0.5" />
              <div>
                Changes in this section write to <span className="font-mono">.env</span>. Most values here require a backend service restart before they become active.
              </div>
            </div>
          </div>

          {serverConfigError ? (
            <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
              {serverConfigError}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="label">Node Environment</label>
                  <select
                    className="input"
                    value={serverConfig.node_env}
                    onChange={e => setServerConfig(s => ({ ...s, node_env: e.target.value }))}
                  >
                    <option value="production">production</option>
                    <option value="development">development</option>
                  </select>
                </div>
                <div>
                  <label className="label">Backend Port</label>
                  <input
                    type="number"
                    className="input"
                    min={1}
                    max={65535}
                    value={serverConfig.port}
                    onChange={e => setServerConfig(s => ({ ...s, port: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">Public Port</label>
                  <input
                    type="number"
                    className="input"
                    min={1}
                    max={65535}
                    value={serverConfig.vms_port}
                    onChange={e => setServerConfig(s => ({ ...s, vms_port: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">Segment Duration (sec)</label>
                  <input
                    type="number"
                    className="input"
                    min={10}
                    max={86400}
                    value={serverConfig.segment_duration}
                    onChange={e => setServerConfig(s => ({ ...s, segment_duration: e.target.value }))}
                  />
                </div>
              </div>

              <div>
                <label className="label">Public Base URL (for desktop config exports)</label>
                <div className="relative">
                  <Globe size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    className="input pl-9"
                    placeholder="https://vms.example.com"
                    value={serverConfig.public_base_url}
                    onChange={e => setServerConfig(s => ({ ...s, public_base_url: e.target.value }))}
                  />
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Optional. If set, About and desktop export tools use this URL instead of browser auto-detection.
                </p>
              </div>

              <div>
                <label className="label">CORS Allowed Origins (comma-separated)</label>
                <textarea
                  className="input min-h-[92px]"
                  placeholder="http://localhost:5173,https://vms.example.com"
                  value={serverConfig.cors_origins}
                  onChange={e => setServerConfig(s => ({ ...s, cors_origins: e.target.value }))}
                />
              </div>

              <div className="rounded-lg border border-surface-500 bg-surface-800 p-3 space-y-2">
                <div className="text-sm font-medium text-slate-200">Runtime Snapshot</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                  <div className="flex justify-between border-b border-surface-500 pb-1.5">
                    <span className="text-slate-500">Active NODE_ENV</span>
                    <span className="text-slate-200 font-mono">{runtimeConfig.node_env || 'n/a'}</span>
                  </div>
                  <div className="flex justify-between border-b border-surface-500 pb-1.5">
                    <span className="text-slate-500">Active Port</span>
                    <span className="text-slate-200 font-mono">{runtimeConfig.port || 'n/a'}</span>
                  </div>
                  <div className="flex justify-between border-b border-surface-500 pb-1.5">
                    <span className="text-slate-500">Active Segment Duration</span>
                    <span className="text-slate-200 font-mono">{runtimeConfig.segment_duration || 'n/a'}</span>
                  </div>
                  <div className="flex justify-between border-b border-surface-500 pb-1.5">
                    <span className="text-slate-500">.env Status</span>
                    <span className="text-slate-200 font-mono">
                      {serverMeta.envExists ? (serverMeta.envWritable ? 'writable' : 'read-only') : 'missing'}
                    </span>
                  </div>
                </div>

                {serverMeta.note && (
                  <p className="text-xs text-slate-500">{serverMeta.note}</p>
                )}
              </div>
            </>
          )}
        </SettingSection>

        <div className="mt-4 flex items-center justify-between gap-3">
          <p className={`text-xs ${restartNotice ? 'text-warning' : 'text-slate-500'}`}>
            {restartNotice || 'Saved values are persisted to .env. Restart backend service after changing runtime fields.'}
          </p>
          <button
            type="submit"
            disabled={serverSaving || Boolean(serverConfigError) || !serverMeta.envWritable}
            className="btn-primary"
          >
            {serverSaving ? <Loader2 size={14} className="animate-spin inline mr-2" /> : <Save size={14} className="inline mr-2" />}
            Save Server Config
          </button>
        </div>
      </form>

      {/* Change password */}
      <form onSubmit={changePassword}>
        <SettingSection title="Change Password" icon={KeyRound}>
          <div className="space-y-3">
            <div>
              <label className="label">Current Password</label>
              <input
                type="password"
                className="input"
                value={pwForm.currentPassword}
                onChange={e => setPwForm(f => ({ ...f, currentPassword: e.target.value }))}
                autoComplete="current-password"
                required
              />
            </div>
            <div>
              <label className="label">New Password</label>
              <input
                type="password"
                className="input"
                value={pwForm.newPassword}
                onChange={e => setPwForm(f => ({ ...f, newPassword: e.target.value }))}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>
            <div>
              <label className="label">Confirm New Password</label>
              <input
                type="password"
                className="input"
                value={pwForm.confirmPassword}
                onChange={e => setPwForm(f => ({ ...f, confirmPassword: e.target.value }))}
                autoComplete="new-password"
                required
              />
            </div>
          </div>
          <div className="flex justify-end mt-2">
            <button type="submit" disabled={pwSaving} className="btn-primary">
              {pwSaving ? <Loader2 size={14} className="animate-spin inline mr-2" /> : <KeyRound size={14} className="inline mr-2" />}
              Update Password
            </button>
          </div>
        </SettingSection>
      </form>

      {/* System info */}
      <SettingSection title="System Information" icon={Shield}>
        <div className="space-y-2 text-sm">
          {[
            ['VMS Version', '1.0.0'],
            ['Logged In As', `${user?.username} (${user?.role})`],
            ['System Time', new Date().toLocaleString()],
            ['Timezone', Intl.DateTimeFormat().resolvedOptions().timeZone],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between py-1.5 border-b border-surface-500 last:border-0">
              <span className="text-slate-400">{k}</span>
              <span className="text-slate-200 font-mono text-xs bg-surface-800 px-2 py-0.5 rounded">{v}</span>
            </div>
          ))}
        </div>
      </SettingSection>
    </div>
  )
}
