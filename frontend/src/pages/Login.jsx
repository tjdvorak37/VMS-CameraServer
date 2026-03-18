import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Shield, Eye, EyeOff, Camera, ServerCog, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { setupApi } from '../services/api'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ username: '', password: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [setupLoading, setSetupLoading] = useState(true)
  const [setupCompleted, setSetupCompleted] = useState(true)

  useEffect(() => {
    let isMounted = true

    setupApi.status()
      .then(res => {
        if (!isMounted) return
        setSetupCompleted(Boolean(res.data?.setupCompleted))
      })
      .catch(() => {
        if (!isMounted) return
        toast.error('Unable to verify setup status')
      })
      .finally(() => {
        if (isMounted) setSetupLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.username || !form.password) {
      toast.error('Please enter your username and password')
      return
    }
    setLoading(true)
    try {
      await login(form.username, form.password)
      navigate('/dashboard')
    } catch (err) {
      const msg = err.response?.data?.error || 'Login failed. Please check your credentials.'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface-900 flex items-center justify-center p-4">
      {/* Background grid pattern */}
      <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg width=%2260%22 height=%2260%22 viewBox=%220 0 60 60%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cg fill=%22none%22 fill-rule=%22evenodd%22%3E%3Cg fill=%22%23ffffff%22 fill-opacity=%220.02%22%3E%3Cpath d=%22M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z%22/%3E%3C/g%3E%3C/g%3E%3C/svg%3E')] opacity-40" />

      <div className="relative w-full max-w-md animate-fade-in">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-accent/20 border border-accent/30 mb-4">
            <Shield size={32} className="text-accent" />
          </div>
          <h1 className="text-3xl font-bold text-slate-100">VMS Pro</h1>
          <p className="text-slate-400 mt-1">Video Management System</p>
        </div>

        {/* Login/setup card */}
        <div className="bg-surface-700 border border-surface-500 rounded-2xl p-8 shadow-2xl">
          {setupLoading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-8 text-slate-300">
              <Loader2 size={24} className="animate-spin text-accent" />
              <span>Checking server setup...</span>
            </div>
          ) : !setupCompleted ? (
            <div className="space-y-5">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-warning/20 border border-warning/30">
                <ServerCog size={22} className="text-warning" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-100">Initial Setup Required</h2>
                <p className="text-slate-400 mt-1 text-sm">
                  This server has not been configured yet. Complete setup to create the first admin account.
                </p>
              </div>
              <button
                type="button"
                className="btn-primary w-full py-2.5 text-base"
                onClick={() => navigate('/setup')}
              >
                Launch Setup Wizard
              </button>
              <div className="pt-4 border-t border-surface-500 text-xs text-slate-500 flex items-center gap-2">
                <Camera size={12} />
                <span>Setup can only be completed once for this server instance.</span>
              </div>
            </div>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-slate-100 mb-6">Sign In</h2>

              <form onSubmit={handleSubmit} className="space-y-5" autoComplete="on">
                <div>
                  <label className="label">Username or Email</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="admin"
                    autoComplete="username"
                    value={form.username}
                    onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                    disabled={loading}
                  />
                </div>

                <div>
                  <label className="label">Password</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      className="input pr-10"
                      placeholder="••••••••"
                      autoComplete="current-password"
                      value={form.password}
                      onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                      disabled={loading}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="btn-primary w-full py-2.5 text-base mt-2"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Signing in...
                    </span>
                  ) : 'Sign In'}
                </button>
              </form>

              <div className="mt-6 pt-5 border-t border-surface-500">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Camera size={12} />
                  <span>Use the admin credentials configured during initial setup.</span>
                </div>
              </div>
            </>
          )}
        </div>

        <p className="text-center text-xs text-slate-600 mt-6">
          VMS Pro — Professional Video Management System © 2026
        </p>
      </div>
    </div>
  )
}
