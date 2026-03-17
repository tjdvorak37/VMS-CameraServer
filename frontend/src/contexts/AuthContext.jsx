import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { authApi } from '../services/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const stored = localStorage.getItem('vms_user')
      return stored ? JSON.parse(stored) : null
    } catch {
      return null
    }
  })
  const [loading, setLoading] = useState(true)

  // Verify token on mount
  useEffect(() => {
    const token = localStorage.getItem('vms_token')
    if (!token) {
      setLoading(false)
      return
    }
    authApi.me()
      .then(res => {
        setUser(res.data.user)
        localStorage.setItem('vms_user', JSON.stringify(res.data.user))
      })
      .catch(() => {
        localStorage.removeItem('vms_token')
        localStorage.removeItem('vms_user')
        setUser(null)
      })
      .finally(() => setLoading(false))
  }, [])

  const login = useCallback(async (username, password) => {
    const res = await authApi.login({ username, password })
    const { token, user } = res.data
    localStorage.setItem('vms_token', token)
    localStorage.setItem('vms_user', JSON.stringify(user))
    setUser(user)
    return user
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem('vms_token')
    localStorage.removeItem('vms_user')
    setUser(null)
  }, [])

  const isAdmin    = user?.role === 'admin'
  const isOperator = user?.role === 'admin' || user?.role === 'operator'

  return (
    <AuthContext.Provider value={{ user, login, logout, loading, isAdmin, isOperator }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
