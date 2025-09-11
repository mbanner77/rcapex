import React, { useEffect, useState } from 'react'

const PASSWORD = 'RealCore2025!'
const STORAGE_KEY = 'rc_gate_unlocked'

export default function PasswordGate({ onUnlock }) {
  const [pw, setPw] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const ok = sessionStorage.getItem(STORAGE_KEY) === '1'
    if (ok) onUnlock?.()
  }, [onUnlock])

  function submit(e){
    e.preventDefault()
    if (pw === PASSWORD) {
      sessionStorage.setItem(STORAGE_KEY, '1')
      onUnlock?.()
    } else {
      setError('Falsches Passwort')
    }
  }

  return (
    <div className="container" style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div className="panel" style={{ padding: 20, maxWidth: 400, width: '100%' }}>
        <h2 style={{ marginTop: 0, marginBottom: 8 }}>Zugriff</h2>
        <p style={{ color: 'var(--muted)', marginTop: 0 }}>Bitte Passwort eingeben, um das Dashboard zu öffnen.</p>
        <form onSubmit={submit} style={{ display:'grid', gap:10 }}>
          <input
            className="input"
            type="password"
            value={pw}
            onChange={(e)=>{ setPw(e.target.value); setError('') }}
            placeholder="Passwort"
            autoFocus
          />
          {error && <div style={{ color:'crimson', fontSize: 13 }}>{error}</div>}
          <button className="btn" type="submit">Öffnen</button>
        </form>
      </div>
    </div>
  )
}
