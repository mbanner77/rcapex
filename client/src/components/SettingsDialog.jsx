import React, { useEffect, useMemo, useState } from 'react'
import { getMailSettings, updateMailSettings, sendMailTest, getApexSettings, updateApexSettings, testApex } from '../lib/api'

const USER_DEFAULTS = {
  senderUpn: 'techhub@realcore.de',
  defaultRecipient: 'techhub@realcore.de',
}

export default function SettingsDialog({ onClose }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [savingApex, setSavingApex] = useState(false)
  const [testingApex, setTestingApex] = useState(false)
  const [error, setError] = useState('')
  const [okMsg, setOkMsg] = useState('')
  const [apexMsg, setApexMsg] = useState('')

  const [form, setForm] = useState({
    // APEX
    apexUsername: '',
    apexPassword: '',
    apexSource: '',
    // Mail
    tenantId: '',
    clientId: '',
    clientSecret: '',
    senderUpn: '',
    defaultRecipient: '',
    testTo: '',
  })

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError('')
      try {
        const [mail, apex] = await Promise.all([getMailSettings(), getApexSettings()])
        if (!cancelled) setForm((prev) => ({
          // APEX
          apexUsername: apex?.username || '',
          apexPassword: '', // never prefill
          apexSource: apex?.source || '',
          // Mail
          tenantId: mail?.tenantId || '',
          clientId: mail?.clientId || '',
          clientSecret: '', // never prefill; user must type to change
          senderUpn: mail?.senderUpn || USER_DEFAULTS.senderUpn,
          defaultRecipient: mail?.defaultRecipient || USER_DEFAULTS.defaultRecipient,
          testTo: mail?.defaultRecipient || USER_DEFAULTS.defaultRecipient,
        }))
      } catch (e) {
        if (!cancelled) setError(e?.response?.data?.message || e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  function update(key, value){ setForm((f)=>({ ...f, [key]: value })) }

  async function save() {
    setSaving(true)
    setError('')
    setOkMsg('')
    try {
      const payload = {
        tenantId: form.tenantId,
        clientId: form.clientId,
        senderUpn: form.senderUpn,
        defaultRecipient: form.defaultRecipient,
      }
      if ((form.clientSecret || '').trim()) payload.clientSecret = form.clientSecret
      await updateMailSettings(payload)
      setOkMsg('Gespeichert')
    } catch (e) {
      setError(e?.response?.data?.message || e.message)
    } finally {
      setSaving(false)
    }
  }

  async function saveApex() {
    setSavingApex(true)
    setError('')
    setApexMsg('')
    try {
      const payload = { username: form.apexUsername }
      if ((form.apexPassword || '').trim()) payload.password = form.apexPassword
      await updateApexSettings(payload)
      setApexMsg('APEX Zugang gespeichert')
      // clear password field after save
      setForm(f => ({ ...f, apexPassword: '' }))
    } catch (e) {
      setError(e?.response?.data?.message || e.message)
    } finally {
      setSavingApex(false)
    }
  }

  async function testApexConn() {
    setTestingApex(true)
    setError('')
    setApexMsg('')
    try {
      const r = await testApex()
      setApexMsg(`APEX Test OK (Status ${r?.status || '200'})`)
    } catch (e) {
      setError(e?.response?.data?.message || e.message)
    } finally {
      setTestingApex(false)
    }
  }

  async function test() {
    setTesting(true)
    setError('')
    setOkMsg('')
    try {
      await sendMailTest(form.testTo || form.defaultRecipient || form.senderUpn)
      setOkMsg('Testmail gesendet')
    } catch (e) {
      setError(e?.response?.data?.message || e.message)
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e)=>e.stopPropagation()} style={{ maxWidth: 700 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <h3 style={{ margin:0 }}>Einstellungen · E-Mail (O365)</h3>
          <div style={{ flex:1 }} />
          <button className="btn" onClick={onClose}>Schließen</button>
        </div>
        {loading ? (
          <div style={{ padding: 12 }}>Lade…</div>
        ) : (
          <div style={{ marginTop: 12, display:'grid', gap:12 }}>
            {/* APEX Credentials */}
            <div className="panel" style={{ padding: 12 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                <h4 style={{ margin:0 }}>APEX Zugang</h4>
                <small style={{ color:'var(--muted)' }}>Quelle: {form.apexSource || 'unset'}</small>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                <Labeled label="Benutzername">
                  <input className="input" value={form.apexUsername} onChange={(e)=>update('apexUsername', e.target.value)} placeholder="APEX User" />
                </Labeled>
                <Labeled label="Passwort (neu setzen)">
                  <input className="input" type="password" value={form.apexPassword} onChange={(e)=>update('apexPassword', e.target.value)} placeholder="••••••••" />
                </Labeled>
              </div>
              <div style={{ display:'flex', gap:8, marginTop:12 }}>
                <button className="btn" onClick={saveApex} disabled={savingApex}>{savingApex? 'Speichere…' : 'APEX speichern'}</button>
                <div style={{ flex:1 }} />
                <button className="btn" onClick={testApexConn} disabled={testingApex}>{testingApex? 'Teste…' : 'APEX Test'}</button>
              </div>
              {apexMsg && <div style={{ color:'var(--muted)', marginTop:8 }}>{apexMsg}</div>}
            </div>

            <div className="panel" style={{ padding: 12 }}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                <Labeled label="Tenant ID">
                  <input className="input" value={form.tenantId} onChange={(e)=>update('tenantId', e.target.value)} placeholder="z.B. 99c7d5a2-..." />
                </Labeled>
                <Labeled label="Client ID">
                  <input className="input" value={form.clientId} onChange={(e)=>update('clientId', e.target.value)} placeholder="z.B. 35c00140-..." />
                </Labeled>
                <Labeled label="Client Secret">
                  <input className="input" type="text" value={form.clientSecret} onChange={(e)=>update('clientSecret', e.target.value)} placeholder="geheim" />
                </Labeled>
                <div />
                <Labeled label="Sender (UPN)">
                  <input className="input" value={form.senderUpn} onChange={(e)=>update('senderUpn', e.target.value)} placeholder="techhub@realcore.de" />
                </Labeled>
                <Labeled label="Standard-Empfänger">
                  <input className="input" value={form.defaultRecipient} onChange={(e)=>update('defaultRecipient', e.target.value)} placeholder="test@beispiel.de" />
                </Labeled>
              </div>
              <div style={{ display:'flex', gap:8, marginTop:12 }}>
                <button className="btn" onClick={save} disabled={saving}>{saving? 'Speichere…' : 'Konfiguration speichern'}</button>
                <div style={{ flex:1 }} />
                <input className="input" style={{ maxWidth: 280 }} placeholder="Test an…" value={form.testTo} onChange={(e)=>update('testTo', e.target.value)} />
                <button className="btn" onClick={test} disabled={testing}>{testing? 'Sende…' : 'Test senden'}</button>
              </div>
              {error && <div style={{ color:'crimson', marginTop:8, whiteSpace:'pre-wrap' }}>Fehler: {String(error)}</div>}
              {okMsg && <div style={{ color:'var(--muted)', marginTop:8 }}>{okMsg}</div>}
            </div>
            <small style={{ color:'var(--muted)' }}>Hinweis: Diese Einstellungen werden zur Laufzeit im Server aktualisiert. Lege sie zusätzlich in <code>server/.env</code> ab, um sie dauerhaft zu machen.</small>
          </div>
        )}
      </div>
    </div>
  )
}

function Labeled({ label, children }){
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
      <label style={{ fontSize:12, color:'var(--muted)' }}>{label}</label>
      {children}
    </div>
  )
}
