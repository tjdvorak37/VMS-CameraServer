import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import Header from './Header'
import { useEffect, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import toast from 'react-hot-toast'

export default function Layout() {
  const { user } = useAuth()
  const wsRef = useRef(null)

  // WebSocket for real-time notifications
  useEffect(() => {
    const token = localStorage.getItem('vms_token')
    if (!token) return

    const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws?token=${token}`

    const connect = () => {
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data)
          if (data.type === 'camera_offline') {
            toast.error(`Camera offline: ${data.cameraName}`, { duration: 5000 })
          } else if (data.type === 'camera_online') {
            toast.success(`Camera online: ${data.cameraName}`, { duration: 3000 })
          } else if (data.type === 'event') {
            if (data.severity === 'critical') {
              toast.error(`⚠ ${data.message}`, { duration: 8000 })
            }
          }
        } catch {}
      }

      ws.onclose = () => {
        setTimeout(connect, 5000)
      }
    }

    connect()
    return () => {
      if (wsRef.current) wsRef.current.close()
    }
  }, [user])

  return (
    <div className="flex h-screen overflow-hidden bg-surface-900">
      <Sidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        <Header />
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
