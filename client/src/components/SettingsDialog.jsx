import React, { useEffect, useMemo, useState } from 'react'
import { getMailSettings, updateMailSettings, sendMailTest, getApexSettings, updateApexSettings, testApex, getHolidays, updateHolidays } from '../lib/api'
import { getUnits, DEFAULT_UNITS } from '../lib/constants'
import InternalMappingDialog from './InternalMappingDialog'

const SMTP_DEFAULTS = {
  host: 'smtp.strato.de',
  port: 465,
  secure: true,
  user: 'm.banner@futurestore.shop',
  from: 'm.banner@futurestore.shop',
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
  const [unitsMsg, setUnitsMsg] = useState('')
  const [showMapping, setShowMapping] = useState(false)

  const [form, setForm] = useState({
    // APEX
    apexUsername: '',
    apexPassword: '',
    apexSource: '',
    // Mail (SMTP)
    host: SMTP_DEFAULTS.host,
    port: SMTP_DEFAULTS.port,
    secure: SMTP_DEFAULTS.secure,
    user: SMTP_DEFAULTS.user,
    pass: '',
    from: SMTP_DEFAULTS.from,
    defaultRecipient: '',
    testTo: '',
  })

  // Units editor state
  const [unitsForm, setUnitsForm] = useState(() => getUnits())
  // Holidays editor state
  const [holidaysForm, setHolidaysForm] = useState([])
  const [holidaysMsg, setHolidaysMsg] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError('')
      try {
        const [mail, apex, holidays] = await Promise.all([getMailSettings(), getApexSettings(), getHolidays().catch(()=>[])])
        if (!cancelled) setForm((prev) => ({
          // APEX
          apexUsername: apex?.username || '',
          apexPassword: '', // never prefill
          apexSource: apex?.source || '',
          // Mail (SMTP)
          host: mail?.host || SMTP_DEFAULTS.host,
          port: Number(mail?.port ?? SMTP_DEFAULTS.port),
          secure: typeof mail?.secure === 'boolean' ? mail.secure : SMTP_DEFAULTS.secure,
          user: mail?.user || SMTP_DEFAULTS.user,
          pass: '',
          from: mail?.from || SMTP_DEFAULTS.from,
          defaultRecipient: mail?.defaultRecipient || '',
          testTo: mail?.defaultRecipient || '',
        }))
        if (!cancelled) setHolidaysForm(Array.isArray(holidays) ? holidays : [])
      } catch (e) {
        if (!cancelled) setError(e?.response?.data?.message || e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }

  // --- Holidays helpers ---
  function addHoliday(){
    setHolidaysMsg('')
    setHolidaysForm(arr => ([...arr, '']))
  }
  function removeHoliday(idx){
    setHolidaysMsg('')
    setHolidaysForm(arr => arr.filter((_,i)=>i!==idx))
  }
  function updateHoliday(idx, value){
    setHolidaysMsg('')
    setHolidaysForm(arr => arr.map((d,i)=> i===idx ? value : d))
  }
  async function saveHolidays(){
    setHolidaysMsg('')
    // normalize and validate YYYY-MM-DD
    const cleaned = holidaysForm.map(s => String(s||'').slice(0,10))
    const invalid = cleaned.filter(s => !/^\d{4}-\d{2}-\d{2}$/.test(s))
    if (invalid.length>0){ setHolidaysMsg(`Ungültige Datumswerte: ${invalid.join(', ')}`); return }
    try{
      const items = await updateHolidays(cleaned)
      setHolidaysForm(items)
      setHolidaysMsg('Feiertage gespeichert')
    }catch(e){ setHolidaysMsg('Fehler: '+(e?.response?.data?.message || e.message)) }
  }
    }
    load()
    return () => { cancelled = true }
  }, [])

  function update(key, value){ setForm((f)=>({ ...f, [key]: value })) }

  // --- Units helpers ---
  function addUnit(){ setUnitsForm((arr)=>[...arr, { id: Date.now(), ext_id: '', name: '' }]) }
  function removeUnit(idx){ setUnitsForm((arr)=> arr.filter((_,i)=> i!==idx)) }
  function updateUnit(idx, key, value){ setUnitsForm((arr)=> arr.map((u,i)=> i===idx ? { ...u, [key]: value } : u )) }
  function resetUnits(){
    setUnitsForm(DEFAULT_UNITS)
    try{
      localStorage.removeItem('units_override')
      window.dispatchEvent(new Event('units_changed'))
      setUnitsMsg('Units auf Standard zurückgesetzt')
    }catch(e){ setUnitsMsg('Fehler beim Zurücksetzen: '+(e?.message||e)) }
  }
  function saveUnits(){
    setUnitsMsg('')
    // validate
    const cleaned = (unitsForm||[]).map((u,idx)=>({ id: u.id || (idx+1), ext_id: String(u.ext_id||'').trim(), name: String(u.name||'').trim() }))
    const valid = cleaned.filter(u => u.ext_id && u.name)
    if (valid.length === 0) { setUnitsMsg('Bitte mindestens eine Unit mit Name und ext_id angeben.'); return }
    try{
      localStorage.setItem('units_override', JSON.stringify(valid))
      window.dispatchEvent(new Event('units_changed'))
      setUnitsMsg('Units gespeichert')
    }catch(e){ setUnitsMsg('Fehler beim Speichern: '+(e?.message||e)) }
  }

  async function save() {
    setSaving(true)
    setError('')
    setOkMsg('')
    try {
      const payload = {
        host: form.host,
        port: Number(form.port) || SMTP_DEFAULTS.port,
        secure: !!form.secure,
        user: form.user,
        defaultRecipient: form.defaultRecipient,
        from: form.from,
      }
      if ((form.pass || '').trim()) payload.pass = form.pass
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

  async function useEnvApex() {
    setSavingApex(true)
    setError('')
    setApexMsg('')
    try {
      await updateApexSettings({ useEnv: true })
      const s = await getApexSettings()
      setForm(f => ({
        ...f,
        apexUsername: s?.username || '',
        apexPassword: '',
        apexSource: s?.source || 'env',
      }))
      setApexMsg('Umgebungswerte aktiv')
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
          <h3 style={{ margin:0 }}>Einstellungen</h3>
          <div style={{ flex:1 }} />
          <button className="btn" onClick={onClose}>Schließen</button>
        </div>
        {loading ? (
          <div style={{ padding: 12 }}>Lade…</div>
        ) : (
          <div style={{ marginTop: 12, display:'grid', gap:12 }}>
            {/* Internal Mapping Management */}
            <div className="panel" style={{ padding: 12 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                <h4 style={{ margin:0 }}>Interne Projekte – Mapping</h4>
                <small style={{ color:'var(--muted)' }}>Pflege der internen Projektcodes und Token</small>
                <div style={{ flex:1 }} />
                <button className="btn" onClick={()=>setShowMapping(true)}>Mapping öffnen…</button>
              </div>

            {/* Holidays Maintenance */}
            <div className="panel" style={{ padding: 12 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                <h4 style={{ margin:0 }}>Feiertage pflegen</h4>
                <small style={{ color:'var(--muted)' }}>Format: YYYY-MM-DD (UTC). Wird beim Monatslauf (1. Werktag) berücksichtigt.</small>
                <div style={{ flex:1 }} />
                <button className="btn" onClick={addHoliday}>+ Datum</button>
              </div>
              <div style={{ display:'grid', gap:8 }}>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 80px', gap:8, color:'var(--muted)', fontSize:12 }}>
                  <div>Datum</div>
                  <div>Aktion</div>
                </div>
                {holidaysForm.map((d, idx) => (
                  <div key={idx} style={{ display:'grid', gridTemplateColumns:'1fr 80px', gap:8 }}>
                    <input className="input" placeholder="YYYY-MM-DD" value={d} onChange={(e)=>updateHoliday(idx, e.target.value)} />
                    <button className="btn" onClick={()=>removeHoliday(idx)}>Löschen</button>
                  </div>
                ))}
              </div>
              <div style={{ display:'flex', gap:8, marginTop:12 }}>
                <button className="btn" onClick={saveHolidays}>Feiertage speichern</button>
                {holidaysMsg && <div style={{ color: holidaysMsg.startsWith('Fehler') ? 'crimson' : 'var(--muted)' }}>{holidaysMsg}</div>}
              </div>
            </div>
              <div style={{ color:'var(--muted)' }}>Das Mapping kann auch direkt im Watchdog geöffnet werden.</div>
            </div>
            {/* APEX Credentials */}
            <div className="panel" style={{ padding: 12 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                <h4 style={{ margin:0 }}>APEX Zugang</h4>
                <small style={{ color:'var(--muted)' }}>Quelle: {form.apexSource || 'unset'}</small>
              </div>

            {/* Units Management */}
            <div className="panel" style={{ padding: 12 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                <h4 style={{ margin:0 }}>Units verwalten</h4>
                <small style={{ color:'var(--muted)' }}>Individuelle Liste für UI und Client-Aggregation</small>
                <div style={{ flex:1 }} />
                <button className="btn" onClick={addUnit}>+ Unit</button>
              </div>
              <div style={{ display:'grid', gap:8 }}>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 80px', gap:8, color:'var(--muted)', fontSize:12 }}>
                  <div>Name</div>
                  <div>ext_id</div>
                  <div>Aktion</div>
                </div>
                {unitsForm.map((u, idx) => (
                  <div key={idx} style={{ display:'grid', gridTemplateColumns:'1fr 1fr 80px', gap:8 }}>
                    <input className="input" placeholder="z. B. SAP ABAP" value={u.name} onChange={(e)=>updateUnit(idx,'name', e.target.value)} />
                    <input className="input" placeholder="ext_id" value={u.ext_id} onChange={(e)=>updateUnit(idx,'ext_id', e.target.value)} />
                    <button className="btn" onClick={()=>removeUnit(idx)}>Löschen</button>
                  </div>
                ))}
              </div>
              <div style={{ display:'flex', gap:8, marginTop:12 }}>
                <button className="btn" onClick={saveUnits}>Units speichern</button>
                <button className="btn" onClick={resetUnits}>Auf Standard zurücksetzen</button>
                {unitsMsg && <div style={{ color:'var(--muted)' }}>{unitsMsg}</div>}
              </div>
            </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                <Labeled label="Benutzername">
                  <input className="input" value={form.apexUsername} onChange={(e)=>update('apexUsername', e.target.value)} placeholder="APEX User" disabled={form.apexSource==='env'} />
                </Labeled>
                <Labeled label="Passwort (neu setzen)">
                  <input className="input" type="password" value={form.apexPassword} onChange={(e)=>update('apexPassword', e.target.value)} placeholder="••••••••" disabled={form.apexSource==='env'} />
                </Labeled>
              </div>
              <div style={{ display:'flex', gap:8, marginTop:12 }}>
                <button className="btn" onClick={saveApex} disabled={savingApex || form.apexSource==='env'}>{savingApex? 'Speichere…' : 'APEX speichern'}</button>
                <div style={{ flex:1 }} />
                <button className="btn" onClick={useEnvApex} disabled={savingApex || form.apexSource==='env'}>Umgebungswerte nutzen</button>
                <button className="btn" onClick={testApexConn} disabled={testingApex}>{testingApex? 'Teste…' : 'APEX Test'}</button>
              </div>
              {apexMsg && <div style={{ color:'var(--muted)', marginTop:8 }}>{apexMsg}</div>}
            </div>

            <div className="panel" style={{ padding: 12 }}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                <Labeled label="SMTP Host">
                  <input className="input" value={form.host} onChange={(e)=>update('host', e.target.value)} placeholder="smtp.strato.de" />
                </Labeled>
                <Labeled label="Port">
                  <input className="input" type="number" value={form.port} onChange={(e)=>update('port', Number(e.target.value))} placeholder="465" />
                </Labeled>
                <Labeled label="TLS/SSL (secure)">
                  <select className="input" value={form.secure? 'true':'false'} onChange={(e)=>update('secure', e.target.value==='true')}>
                    <option value="true">Ja (465)</option>
                    <option value="false">Nein (587 STARTTLS)</option>
                  </select>
                </Labeled>
                <div />
                <Labeled label="Benutzer (E-Mail)">
                  <input className="input" value={form.user} onChange={(e)=>update('user', e.target.value)} placeholder="m.banner@futurestore.shop" />
                </Labeled>
                <Labeled label="Passwort">
                  <input className="input" type="password" value={form.pass} onChange={(e)=>update('pass', e.target.value)} placeholder="••••••••" />
                </Labeled>
                <Labeled label="From">
                  <input className="input" value={form.from} onChange={(e)=>update('from', e.target.value)} placeholder="m.banner@futurestore.shop" />
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
            <small style={{ color:'var(--muted)' }}>Hinweis: Diese Einstellungen werden zur Laufzeit im Server aktualisiert und in <code>server/data/config.json</code> persistiert. Lege sie zusätzlich als Render-ENV (<code>SMTP_*</code>) ab, um sie über Deployments hinweg sicher zu setzen.</small>
          </div>
        )}
      </div>
      {showMapping && (
        <InternalMappingDialog onClose={()=>setShowMapping(false)} />
      )}
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
