import { useState, useEffect } from 'react'
import {
  Save, Loader2, Shield, HardDrive, Bell,
  Clock, RefreshCw, KeyRound
} from 'lucide-react'
import { dashboardApi, authApi } from '../services/api'
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
    snapshot_interval: '60',
    email_alerts: 'false',
    smtp_host: '',
    smtp_port: '587',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [pwSaving, setPwSaving] = useState(false)

  useEffect(() => {
    dashboardApi.settings()
      .then(res => setSettings(s => ({ ...s, ...res.data })))
      .catch(console.error)
      .finally(() => setLoading(false))
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

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 size={32} className="animate-spin text-accent" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-6 animate-fade-in">
      {/* Recording retention settings */}
      <form onSubmit={saveSettings}>
        <SettingSection title="Recording & Retention" icon={HardDrive}>
          <div className="grid grid-cols-2 gap-4">
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
