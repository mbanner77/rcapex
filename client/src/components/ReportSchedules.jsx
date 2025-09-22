import React, { useEffect, useState } from 'react'
import { listReportSchedules, upsertReportSchedule, deleteReportSchedule, runReportNow } from '../lib/api'

const DEFAULT = {
  id: '',
  name: '',
  active: true,
  report: 'stunden', // 'stunden' | 'umsatzliste'
  unit: 'ALL',
  rangePreset: 'last_month', // 'last_month' | 'last_week'
  frequency: 'monthly', // 'daily' | 'weekly' | 'monthly'
  at: '06:00',
  weekdays: [1], // 1..7 (Mon..Sun)
  dayOfMonth: 1,
  recipients: [],
}

export default function ReportSchedules({ onClose }){
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState(DEFAULT)

  useEffect(() => {
    let cancelled = false
    async function load(){
      setLoading(true); setError('')
      try {
        const r = await listReportSchedules()
        if (!cancelled) setItems(Array.isArray(r?.items) ? r.items : [])
      } catch (e) {
        if (!cancelled) setError(e?.response?.data?.message || e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load();
    return () => { cancelled = true }
  }, [])

  function edit(item){
    setForm({
      id: item?.id || '',
      name: item?.name || '',
      active: !!item?.active,
      report: item?.report || 'stunden',
      unit: item?.unit || 'ALL',
      rangePreset: item?.rangePreset || 'last_month',
      frequency: item?.frequency || 'monthly',
      at: item?.at || '06:00',
      weekdays: Array.isArray(item?.weekdays) ? item.weekdays : [1],
      dayOfMonth: Number(item?.dayOfMonth || 1),
      recipients: Array.isArray(item?.recipients) ? item.recipients : [],
    })
  }

  function newItem(){ setForm(DEFAULT) }
  function update(k, v){ setForm(f => ({ ...f, [k]: v })) }

  async function save(){
    setSaving(true); setError('')
    try{
      const payload = { ...form, recipients: (form.recipients||[]).filter(Boolean) }
      if (!payload.recipients.length) throw new Error('Mindestens ein Empfänger erforderlich')
      const r = await upsertReportSchedule(payload)
      // reload
      const list = await listReportSchedules(); setItems(list?.items || [])
      // reset form
      setForm(DEFAULT)
    }catch(e){ setError(e?.response?.data?.message || e.message) }
    finally{ setSaving(false) }
  }

  async function remove(id){
    if (!id) return
    await deleteReportSchedule(id)
    const list = await listReportSchedules(); setItems(list?.items || [])
    if (form.id === id) setForm(DEFAULT)
  }

  async function runNow(item){
    try{
      await runReportNow({ scheduleId: item?.id })
      alert('Report wurde angestoßen.')
    }catch(e){ alert('Fehler: ' + (e?.response?.data?.message || e.message)) }
  }

  async function runAdhoc(){
    try{
      const to = prompt('Empfänger (E-Mail) für Ad-hoc Versand?')
      if (!to) return
      await runReportNow({ report: form.report || 'stunden', unit: form.unit || 'ALL', rangePreset: form.rangePreset || 'last_month', to })
      alert('Ad-hoc Report gesendet.')
    }catch(e){ alert('Fehler: ' + (e?.response?.data?.message || e.message)) }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e)=>e.stopPropagation()} style={{ maxWidth: 900 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <h3 style={{ margin:0 }}>Report-Zeitpläne</h3>
          <div style={{ flex:1 }} />
          <button className="btn" onClick={onClose}>Schließen</button>
        </div>
        {loading ? (
          <div style={{ padding:12 }}>Lade…</div>
        ) : (
          <div style={{ marginTop: 12, display:'grid', gap:12 }}>
            <div className="panel" style={{ padding:12 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <strong>Geplante Reports</strong>
                <button className="btn" onClick={newItem}>Neu</button>
              </div>
              <div style={{ marginTop:8 }}>
                {items.length === 0 ? (
                  <div style={{ color:'var(--muted)' }}>Keine Einträge</div>
                ) : (
                  <table className="table" style={{ width:'100%', fontSize:13 }}>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Aktiv</th>
                        <th>Typ</th>
                        <th>Unit</th>
                        <th>Range</th>
                        <th>Häufigkeit</th>
                        <th>Uhrzeit (UTC)</th>
                        <th>Empfänger</th>
                        <th>Aktion</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(it => (
                        <tr key={it.id}>
                          <td>{it.name || '-'}</td>
                          <td>{it.active ? 'Ja' : 'Nein'}</td>
                          <td>{it.report}</td>
                          <td>{it.unit || 'ALL'}</td>
                          <td>{it.rangePreset}</td>
                          <td>{it.frequency}</td>
                          <td>{it.at || '06:00'}</td>
                          <td>{Array.isArray(it.recipients) ? it.recipients.join(', ') : ''}</td>
                          <td style={{ display:'flex', gap:6 }}>
                            <button className="btn" onClick={()=>edit(it)}>Bearbeiten</button>
                            <button className="btn" onClick={()=>runNow(it)}>Jetzt senden</button>
                            <button className="btn" onClick={()=>remove(it.id)}>Löschen</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            <div className="panel" style={{ padding:12 }}>
              <strong>Eintrag {form.id ? '(Bearbeiten)' : '(Neu)'} </strong>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:12, marginTop:8 }}>
                <Labeled label="Name">
                  <input className="input" value={form.name} onChange={(e)=>update('name', e.target.value)} placeholder="Monatsreport" />
                </Labeled>
                <Labeled label="Aktiv">
                  <select className="input" value={form.active? 'true':'false'} onChange={(e)=>update('active', e.target.value==='true')}>
                    <option value="true">Ja</option>
                    <option value="false">Nein</option>
                  </select>
                </Labeled>
                <Labeled label="Report-Typ">
                  <select className="input" value={form.report} onChange={(e)=>update('report', e.target.value)}>
                    <option value="stunden">Stunden</option>
                    <option value="umsatzliste">Umsatzliste</option>
                  </select>
                </Labeled>
                <Labeled label="Unit">
                  <input className="input" value={form.unit} onChange={(e)=>update('unit', e.target.value)} placeholder="ALL oder ext_id" />
                </Labeled>
                <Labeled label="Zeitraum">
                  <select className="input" value={form.rangePreset} onChange={(e)=>update('rangePreset', e.target.value)}>
                    <option value="last_month">Letzter Monat</option>
                    <option value="last_week">Letzte Woche</option>
                  </select>
                </Labeled>
                <Labeled label="Häufigkeit">
                  <select className="input" value={form.frequency} onChange={(e)=>update('frequency', e.target.value)}>
                    <option value="daily">Täglich</option>
                    <option value="weekly">Wöchentlich</option>
                    <option value="monthly">Monatlich</option>
                  </select>
                </Labeled>
                <Labeled label="Uhrzeit (UTC)">
                  <input className="input" value={form.at} onChange={(e)=>update('at', e.target.value)} placeholder="06:00" />
                </Labeled>
                {form.frequency==='weekly' && (
                  <Labeled label="Wochentage (1=Mo..7=So, Kommagetrennt)">
                    <input className="input" value={(form.weekdays||[]).join(',')} onChange={(e)=>update('weekdays', e.target.value.split(',').map(v=>parseInt(v.trim(),10)).filter(n=>!isNaN(n)))} placeholder="1,3,5" />
                  </Labeled>
                )}
                {form.frequency==='monthly' && (
                  <Labeled label="Tag im Monat (1-28)">
                    <input className="input" type="number" min={1} max={28} value={form.dayOfMonth} onChange={(e)=>update('dayOfMonth', Number(e.target.value))} />
                  </Labeled>
                )}
                <Labeled label="Empfänger (Kommagetrennt)">
                  <input className="input" value={(form.recipients||[]).join(',')} onChange={(e)=>update('recipients', e.target.value.split(',').map(s=>s.trim()).filter(Boolean))} placeholder="a@b.de,c@d.de" />
                </Labeled>
              </div>
              <div style={{ display:'flex', gap:8, marginTop:12 }}>
                <button className="btn" onClick={save} disabled={saving}>{saving? 'Speichere…' : 'Speichern'}</button>
                <button className="btn" onClick={runAdhoc}>Ad-hoc senden…</button>
              </div>
              {error && <div style={{ color:'crimson', marginTop:8, whiteSpace:'pre-wrap' }}>Fehler: {String(error)}</div>}
            </div>
            <small style={{ color:'var(--muted)' }}>Zeitpläne werden in <code>server/data/config.json</code> gespeichert und von der Instanz per Minutentakt (UTC) geprüft. Versand erfolgt per SMTP.</small>
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
