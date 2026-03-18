import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Loader2,
  LockKeyhole,
  ServerCog,
  ShieldCheck,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { setupApi } from '../services/api'

const STEP_CONFIG = [
  { id: 1, title: 'Admin Account', icon: LockKeyhole },
  { id: 2, title: 'System Limits', icon: ServerCog },
  { id: 3, title: 'Review & Finish', icon: ShieldCheck },
]

export default function SetupWizard() {
  const navigate = useNavigate()
  const [checking, setChecking] = useState(true)
  const [alreadySetup, setAlreadySetup] = useState(false)
  const [saving, setSaving] = useState(false)
  const [step, setStep] = useState(1)
  const [form, setForm] = useState({
    username: 'admin',
    email: 'admin@vms.local',
    password: '',
    confirmPassword: '',
    retention_days: '30',
    max_cameras: '64',
    snapshot_interval: '60',
  })

  const currentStep = useMemo(() => STEP_CONFIG.find(s => s.id === step), [step])

  useEffect(() => {
    let isMounted = true

    setupApi.status()
      .then(res => {
        if (!isMounted) return

        const setupCompleted = Boolean(res.data?.setupCompleted)
        const defaults = res.data?.defaults || {}

        setAlreadySetup(setupCompleted)
        setForm(prev => ({
          ...prev,
          retention_days: String(defaults.retention_days ?? prev.retention_days),
          max_cameras: String(defaults.max_cameras ?? prev.max_cameras),
          snapshot_interval: String(defaults.snapshot_interval ?? prev.snapshot_interval),
        }))
      })
      .catch(() => {
        toast.error('Unable to load setup status')
      })
      .finally(() => {
        if (isMounted) setChecking(false)
      })

    return () => {
      isMounted = false
    }
  }, [])

  const validateAccountStep = () => {
    if (form.username.trim().length < 3) {
      toast.error('Username must be at least 3 characters')
      return false
    }
    if (!form.email.includes('@')) {
      toast.error('Enter a valid email address')
      return false
    }
    if (form.password.length < 8) {
      toast.error('Password must be at least 8 characters')
      return false
    }
    if (form.password !== form.confirmPassword) {
      toast.error('Passwords do not match')
      return false
    }
    return true
  }

  const validateSystemStep = () => {
    const retention = Number.parseInt(form.retention_days, 10)
    const cameras = Number.parseInt(form.max_cameras, 10)
    const snapshot = Number.parseInt(form.snapshot_interval, 10)

    if (!Number.isInteger(retention) || retention < 1 || retention > 3650) {
      toast.error('Retention must be between 1 and 3650 days')
      return false
    }
    if (!Number.isInteger(cameras) || cameras < 1 || cameras > 1024) {
      toast.error('Max cameras must be between 1 and 1024')
      return false
    }
    if (!Number.isInteger(snapshot) || snapshot < 10 || snapshot > 86400) {
      toast.error('Snapshot interval must be between 10 and 86400 seconds')
      return false
    }

    return true
  }

  const nextStep = () => {
    if (step === 1 && !validateAccountStep()) return
    if (step === 2 && !validateSystemStep()) return
    setStep(s => Math.min(3, s + 1))
  }

  const prevStep = () => setStep(s => Math.max(1, s - 1))

  const completeSetup = async () => {
    if (!validateAccountStep() || !validateSystemStep()) return

    setSaving(true)
    try {
      await setupApi.complete({
        username: form.username.trim(),
        email: form.email.trim(),
        password: form.password,
        retention_days: Number.parseInt(form.retention_days, 10),
        max_cameras: Number.parseInt(form.max_cameras, 10),
        snapshot_interval: Number.parseInt(form.snapshot_interval, 10),
      })

      toast.success('Setup complete. You can now sign in.')
      navigate('/login', { replace: true })
    } catch (err) {
      const apiErrors = err.response?.data?.errors
      if (Array.isArray(apiErrors) && apiErrors.length > 0) {
        toast.error(apiErrors[0].msg || 'Setup validation failed')
      } else {
        toast.error(err.response?.data?.error || 'Failed to complete setup')
      }
    } finally {
      setSaving(false)
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen bg-surface-900 flex items-center justify-center p-4">
        <div className="flex items-center gap-3 text-slate-300">
          <Loader2 size={24} className="animate-spin text-accent" />
          <span>Checking setup status...</span>
        </div>
      </div>
    )
  }

  if (alreadySetup) {
    return (
      <div className="min-h-screen bg-surface-900 flex items-center justify-center p-4">
        <div className="w-full max-w-xl card p-8 text-center space-y-4">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-success/20 border border-success/30 mx-auto">
            <CheckCircle2 size={28} className="text-success" />
          </div>
          <h1 className="text-2xl font-bold text-slate-100">Setup Already Completed</h1>
          <p className="text-slate-400">
            This server has already been configured. Sign in with an admin account to continue.
          </p>
          <div className="pt-2">
            <button
              type="button"
              className="btn-primary"
              onClick={() => navigate('/login', { replace: true })}
            >
              Go to Sign In
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-surface-900 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl card p-8 space-y-8 animate-fade-in">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-slate-100">Initial Server Setup</h1>
          <p className="text-slate-400">
            Configure your admin account and core system limits to finish onboarding this VMS instance.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {STEP_CONFIG.map(item => {
            const Icon = item.icon
            const active = item.id === step
            const complete = item.id < step

            return (
              <div
                key={item.id}
                className={`rounded-lg border p-3 flex items-center gap-3 ${
                  active
                    ? 'border-accent bg-accent/10'
                    : complete
                      ? 'border-success/40 bg-success/10'
                      : 'border-surface-500 bg-surface-800'
                }`}
              >
                <Icon
                  size={16}
                  className={active ? 'text-accent' : complete ? 'text-success' : 'text-slate-500'}
                />
                <div>
                  <div className="text-xs text-slate-400">Step {item.id}</div>
                  <div className="text-sm font-medium text-slate-200">{item.title}</div>
                </div>
              </div>
            )
          })}
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <div>
              <label className="label">Admin Username</label>
              <input
                className="input"
                value={form.username}
                onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                placeholder="admin"
                autoComplete="username"
              />
            </div>
            <div>
              <label className="label">Admin Email</label>
              <input
                type="email"
                className="input"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="admin@company.com"
                autoComplete="email"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="label">Admin Password</label>
                <input
                  type="password"
                  className="input"
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  autoComplete="new-password"
                  placeholder="Minimum 8 characters"
                />
              </div>
              <div>
                <label className="label">Confirm Password</label>
                <input
                  type="password"
                  className="input"
                  value={form.confirmPassword}
                  onChange={e => setForm(f => ({ ...f, confirmPassword: e.target.value }))}
                  autoComplete="new-password"
                  placeholder="Re-enter password"
                />
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="label">Retention (days)</label>
              <input
                type="number"
                className="input"
                min={1}
                max={3650}
                value={form.retention_days}
                onChange={e => setForm(f => ({ ...f, retention_days: e.target.value }))}
              />
              <p className="text-xs text-slate-500 mt-1">Auto-delete recordings older than this value.</p>
            </div>
            <div>
              <label className="label">Max Cameras</label>
              <input
                type="number"
                className="input"
                min={1}
                max={1024}
                value={form.max_cameras}
                onChange={e => setForm(f => ({ ...f, max_cameras: e.target.value }))}
              />
              <p className="text-xs text-slate-500 mt-1">Soft planning limit for this server instance.</p>
            </div>
            <div>
              <label className="label">Snapshot Interval (sec)</label>
              <input
                type="number"
                className="input"
                min={10}
                max={86400}
                value={form.snapshot_interval}
                onChange={e => setForm(f => ({ ...f, snapshot_interval: e.target.value }))}
              />
              <p className="text-xs text-slate-500 mt-1">Controls thumbnail refresh cadence.</p>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="rounded-lg border border-surface-500 bg-surface-800 p-4">
              <h3 className="text-sm font-semibold text-slate-200 mb-3">Admin Account</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div className="flex justify-between border-b border-surface-500 pb-2">
                  <span className="text-slate-400">Username</span>
                  <span className="text-slate-200 font-medium">{form.username}</span>
                </div>
                <div className="flex justify-between border-b border-surface-500 pb-2">
                  <span className="text-slate-400">Email</span>
                  <span className="text-slate-200 font-medium">{form.email}</span>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-surface-500 bg-surface-800 p-4">
              <h3 className="text-sm font-semibold text-slate-200 mb-3">System Limits</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                <div className="flex justify-between border-b border-surface-500 pb-2">
                  <span className="text-slate-400">Retention</span>
                  <span className="text-slate-200 font-medium">{form.retention_days} days</span>
                </div>
                <div className="flex justify-between border-b border-surface-500 pb-2">
                  <span className="text-slate-400">Max Cameras</span>
                  <span className="text-slate-200 font-medium">{form.max_cameras}</span>
                </div>
                <div className="flex justify-between border-b border-surface-500 pb-2">
                  <span className="text-slate-400">Snapshot Interval</span>
                  <span className="text-slate-200 font-medium">{form.snapshot_interval}s</span>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            className="btn-secondary inline-flex items-center gap-2"
            disabled={step === 1 || saving}
            onClick={prevStep}
          >
            <ArrowLeft size={14} />
            Back
          </button>

          {step < 3 ? (
            <button
              type="button"
              className="btn-primary inline-flex items-center gap-2"
              onClick={nextStep}
              disabled={saving}
            >
              Next
              <ArrowRight size={14} />
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary inline-flex items-center gap-2"
              onClick={completeSetup}
              disabled={saving}
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              Complete Setup
            </button>
          )}
        </div>

        <div className="text-xs text-slate-500 border-t border-surface-500 pt-4">
          After setup is complete, sign in with the admin credentials you just configured.
        </div>
      </div>

      {currentStep && (
        <span className="sr-only">Current step: {currentStep.title}</span>
      )}
    </div>
  )
}
