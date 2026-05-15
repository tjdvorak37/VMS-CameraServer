import axios from 'axios'

const API_BASE = import.meta.env.VITE_API_BASE || '/api'

const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
})

// Attach JWT to every request
api.interceptors.request.use(config => {
  const token = localStorage.getItem('vms_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Handle 401 globally
api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('vms_token')
      localStorage.removeItem('vms_user')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export const authApi = {
  login: (credentials) => api.post('/auth/login', credentials),
  me: () => api.get('/auth/me'),
  changePassword: (data) => api.post('/auth/change-password', data),
}

export const setupApi = {
  status: () => api.get('/setup/status'),
  complete: (data) => api.post('/setup/complete', data),
  serverConfig: () => api.get('/setup/server-config'),
  updateServerConfig: (data) => api.put('/setup/server-config', data),
}

export const cameraApi = {
  list: () => api.get('/cameras'),
  get: (id) => api.get(`/cameras/${id}`),
  create: (data) => api.post('/cameras', data),
  update: (id, data) => api.put(`/cameras/${id}`, data),
  delete: (id) => api.delete(`/cameras/${id}`),
  discover: (data) => api.post('/cameras/discover', data),
  snapshot: (id) => api.post(`/cameras/${id}/snapshot`),
  startStream: (id) => api.post(`/cameras/${id}/stream/start`),
  stopStream: (id) => api.post(`/cameras/${id}/stream/stop`),
  startRecording: (id) => api.post(`/cameras/${id}/recording/start`),
  stopRecording: (id) => api.post(`/cameras/${id}/recording/stop`),
}

export const recordingApi = {
  list: (params) => api.get('/recordings', { params }),
  get: (id) => api.get(`/recordings/${id}`),
  playUrl: (id) => {
    const token = localStorage.getItem('vms_token')
    const qs = token ? `?token=${encodeURIComponent(token)}` : ''
    return `${API_BASE}/recordings/${id}/play${qs}`
  },
  delete: (id) => api.delete(`/recordings/${id}`),
  timeline: (cameraId, params) => api.get(`/recordings/timeline/${cameraId}`, { params }),
}

export const eventApi = {
  list: (params) => api.get('/events', { params }),
  acknowledge: (id) => api.put(`/events/${id}/acknowledge`),
  acknowledgeAll: () => api.put('/events/acknowledge-all'),
  delete: (id) => api.delete(`/events/${id}`),
}

export const userApi = {
  list: () => api.get('/users'),
  create: (data) => api.post('/users', data),
  update: (id, data) => api.put(`/users/${id}`, data),
  delete: (id) => api.delete(`/users/${id}`),
}

export const dashboardApi = {
  summary: () => api.get('/dashboard'),
  settings: () => api.get('/dashboard/settings'),
  updateSettings: (data) => api.put('/dashboard/settings', data),
}

export default api
