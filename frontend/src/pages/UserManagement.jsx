import { useState, useEffect, useCallback } from 'react'
import {
  Plus, Loader2, Edit3, Trash2, UserCheck, UserX,
  Shield, Eye, Settings as SettingsIcon
} from 'lucide-react'
import { userApi } from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import { format, parseISO } from 'date-fns'
import toast from 'react-hot-toast'

const ROLE_STYLES = {
  admin:    'bg-accent/20 text-accent',
  operator: 'bg-warning/20 text-warning',
  viewer:   'bg-slate-500/20 text-slate-400',
}

const ROLE_ICONS = {
  admin:    Shield,
  operator: SettingsIcon,
  viewer:   Eye,
}

function UserModal({ user, onClose, onSave }) {
  const [form, setForm] = useState({
    username: user?.username || '',
    email: user?.email || '',
    password: '',
    role: user?.role || 'viewer',
    is_active: user?.is_active !== 0,
  })
  const [saving, setSaving] = useState(false)
  const isEdit = !!user

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    const payload = { ...form }
    if (isEdit && !payload.password) delete payload.password

    try {
      if (isEdit) {
        await userApi.update(user.id, payload)
        toast.success('User updated')
      } else {
        await userApi.create(payload)
        toast.success('User created')
      }
      onSave()
      onClose()
    } catch (err) {
      const msg = err.response?.data?.error
        || err.response?.data?.errors?.[0]?.msg
        || 'Save failed'
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 animate-fade-in">
      <div className="bg-surface-700 border border-surface-500 rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-500">
          <h2 className="text-lg font-semibold text-slate-100">
            {isEdit ? 'Edit User' : 'Add User'}
          </h2>
          <button onClick={onClose} className="btn-ghost p-1.5">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {!isEdit && (
            <div>
              <label className="label">Username *</label>
              <input
                className="input"
                value={form.username}
                onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                required
                minLength={3}
              />
            </div>
          )}
          <div>
            <label className="label">Email *</label>
            <input
              type="email"
              className="input"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              required
            />
          </div>
          <div>
            <label className="label">{isEdit ? 'New Password (leave blank to keep)' : 'Password *'}</label>
            <input
              type="password"
              className="input"
              value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              minLength={8}
              required={!isEdit}
              autoComplete="new-password"
            />
          </div>
          <div>
            <label className="label">Role *</label>
            <select
              className="input"
              value={form.role}
              onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
            >
              <option value="viewer">Viewer — View cameras only</option>
              <option value="operator">Operator — Manage cameras & recordings</option>
              <option value="admin">Admin — Full access</option>
            </select>
          </div>
          {isEdit && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="w-4 h-4 rounded accent-blue-500"
                checked={form.is_active}
                onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
              />
              <span className="text-sm text-slate-300">Account active</span>
            </label>
          )}
          <div className="flex gap-3 pt-2 border-t border-surface-500">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1">
              {saving && <Loader2 size={14} className="animate-spin inline mr-2" />}
              {isEdit ? 'Save Changes' : 'Create User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function UserManagement() {
  const { user: currentUser } = useAuth()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [editUser, setEditUser] = useState(null)

  const fetchUsers = useCallback(() => {
    userApi.list()
      .then(res => setUsers(res.data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  const deleteUser = async (u) => {
    if (!confirm(`Delete user "${u.username}"?`)) return
    try {
      await userApi.delete(u.id)
      toast.success('User deleted')
      fetchUsers()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Delete failed')
    }
  }

  const toggleActive = async (u) => {
    try {
      await userApi.update(u.id, { is_active: !u.is_active })
      toast.success(`User ${u.is_active ? 'deactivated' : 'activated'}`)
      fetchUsers()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Update failed')
    }
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-400">{users.length} user{users.length !== 1 ? 's' : ''}</div>
        <button
          onClick={() => { setEditUser(null); setModal('add') }}
          className="btn-primary"
        >
          <Plus size={14} className="mr-1.5" />Add User
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={32} className="animate-spin text-accent" />
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <table className="table-base">
            <thead>
              <tr>
                <th>User</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last Login</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => {
                const RoleIcon = ROLE_ICONS[u.role] || Eye
                const isCurrentUser = u.id === currentUser?.id
                return (
                  <tr key={u.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-accent/20 border border-accent/30 
                                        flex items-center justify-center text-xs font-bold text-accent">
                          {u.username[0].toUpperCase()}
                        </div>
                        <div>
                          <div className="font-medium text-slate-200">
                            {u.username}
                            {isCurrentUser && <span className="ml-2 text-xs text-accent">(you)</span>}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="text-slate-400">{u.email}</td>
                    <td>
                      <span className={`badge ${ROLE_STYLES[u.role]}`}>
                        <RoleIcon size={10} className="mr-1" />
                        {u.role}
                      </span>
                    </td>
                    <td>
                      {u.is_active
                        ? <span className="badge-online">Active</span>
                        : <span className="badge-offline">Deactivated</span>
                      }
                    </td>
                    <td className="text-xs text-slate-500">
                      {u.last_login ? format(parseISO(u.last_login), 'MMM d, yyyy HH:mm') : 'Never'}
                    </td>
                    <td>
                      <div className="flex items-center justify-end gap-1">
                        {!isCurrentUser && (
                          <button
                            onClick={() => toggleActive(u)}
                            className={`btn-ghost p-1.5 ${u.is_active ? 'text-warning' : 'text-success'}`}
                            title={u.is_active ? 'Deactivate' : 'Activate'}
                          >
                            {u.is_active ? <UserX size={15} /> : <UserCheck size={15} />}
                          </button>
                        )}
                        <button
                          onClick={() => { setEditUser(u); setModal('edit') }}
                          className="btn-ghost p-1.5"
                          title="Edit"
                        >
                          <Edit3 size={15} />
                        </button>
                        {!isCurrentUser && (
                          <button
                            onClick={() => deleteUser(u)}
                            className="btn-ghost p-1.5 text-danger"
                            title="Delete"
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <UserModal
          user={editUser}
          onClose={() => setModal(null)}
          onSave={fetchUsers}
        />
      )}
    </div>
  )
}
