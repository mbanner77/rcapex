import React, { useState } from 'react'
import { login } from '../lib/api'

export default function Login({ onSuccess }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await login(username, password)
      onSuccess?.()
    } catch (e) {
      setError(e?.response?.data?.message || e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 420, display: 'grid', gap: 12 }}>
      <div style={{ display: 'grid', gap: 6 }}>
        <label style={{ fontSize: 12, color: '#555' }}>APEX User</label>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="z.B. realcore_ctrl_user"
          style={{ padding: 10, border: '1px solid #ddd', borderRadius: 6 }}
          autoComplete="username"
          required
        />
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        <label style={{ fontSize: 12, color: '#555' }}>APEX Passwort</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ padding: 10, border: '1px solid #ddd', borderRadius: 6 }}
          autoComplete="current-password"
          required
        />
      </div>
      {error && <div style={{ color: 'crimson' }}>Fehler: {String(error)}</div>}
      <button type="submit" disabled={loading} style={{ padding: '10px 12px' }}>
        {loading ? 'Anmelden…' : 'Anmelden'}
      </button>
    </form>
  )
}
