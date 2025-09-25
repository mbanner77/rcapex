import React, { useEffect, useMemo, useState } from 'react'
import { listReportSchedules, upsertReportSchedule, deleteReportSchedule, runReportNow, getMailSettings, previewReportPdf, runInternalWatchdog } from '../lib/api'
import { getUnits } from '../lib/constants'

const DEFAULT = {
  id: '',
  name: '',
  active: true,
  kind: 'report', // 'report' | 'watchdog_internal'
  report: 'stunden', // used when kind==='report' -> 'stunden' | 'umsatzliste'
  unit: 'ALL',
  rangePreset: 'last_month', // 'last_month' | 'last_week'
  frequency: 'monthly', // 'daily' | 'weekly' | 'monthly'
  at: '06:00',
  weekdays: [1], // 1..7 (Mon..Sun)
  dayOfMonth: 1,
  recipients: [],
  // Watchdog params
  threshold: 0.2, // 20%
  weeksBack: 1,
}

export default function ReportSchedules({ onClose }){
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState(DEFAULT)
  const [mailDefaults, setMailDefaults] = useState({ defaultRecipient: '' })
  const [previewUrl, setPreviewUrl] = useState('')
  const [units, setUnits] = useState(() => getUnits())

  useEffect(() => {
    let cancelled = false
    async function load(){
      setLoading(true); setError('')
      try {
        const [r, m] = await Promise.all([listReportSchedules(), getMailSettings().catch(()=>({}))])
        if (!cancelled) {
          setItems(Array.isArray(r?.items) ? r.items : [])
          setMailDefaults({ defaultRecipient: m?.defaultRecipient || '' })
        }
      } catch (e) {
        if (!cancelled) setError(e?.response?.data?.message || e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load();
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const onUnits = () => setUnits(getUnits())
    window.addEventListener('units_changed', onUnits)
    return () => window.removeEventListener('units_changed', onUnits)
  }, [])

  function edit(item){
    setForm({
      id: item?.id || '',
      name: item?.name || '',
      active: !!item?.active,
      kind: item?.kind || 'report',
      report: item?.report || 'stunden',
      unit: item?.unit || 'ALL',
      rangePreset: item?.rangePreset || 'last_month',
      frequency: item?.frequency || 'monthly',
      at: item?.at || '06:00',
      weekdays: Array.isArray(item?.weekdays) ? item.weekdays : [1],
      dayOfMonth: Number(item?.dayOfMonth || 1),
      recipients: Array.isArray(item?.recipients) ? item.recipients : [],
      threshold: typeof item?.threshold === 'number' ? item.threshold : 0.2,
      weeksBack: Number(item?.weeksBack || 1),
      useInternalShare: (item?.useInternalShare ?? true) !== false,
      useZeroLastWeek: (item?.useZeroLastWeek ?? true) !== false,
      useMinTotal: (item?.useMinTotal ?? false) === true,
      minTotalHours: Number(item?.minTotalHours || 0),
      combine: item?.combine === 'and' ? 'and' : 'or',
    })
  }

  function newItem(){ setForm(DEFAULT) }
  function update(k, v){ setForm(f => ({ ...f, [k]: v })) }

  const nextRunPreview = useMemo(() => {
    try {
      const at = (form.at || '06:00').split(':').map(n=>parseInt(n,10));
      const hour = at[0]||6, minute = at[1]||0
      const now = new Date()
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute, 0))
      if (form.frequency === 'daily') {
        if (d <= now) d.setUTCDate(d.getUTCDate()+1)
      } else if (form.frequency === 'weekly') {
        const wd = (now.getUTCDay() || 7)
        const list = (form.weekdays||[1]).slice().sort((a,b)=>a-b)
        let offset = 0
        for (let i=0;i<14;i++){
          const cand = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()+i, hour, minute, 0))
          const cWd = cand.getUTCDay() || 7
          if (list.includes(cWd) && cand>now){ d.setTime(cand.getTime()); break }
          offset++
        }
      } else if (form.frequency === 'monthly') {
        const day = Math.max(1, Math.min(28, Number(form.dayOfMonth||1)))
        const cand = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day, hour, minute, 0))
        if (cand <= now) cand.setUTCMonth(cand.getUTCMonth()+1)
        d.setTime(cand.getTime())
      }
      return d.toISOString().replace('T',' ').slice(0,16) + ' UTC'
    } catch { return '' }
  }, [form.at, form.frequency, form.weekdays, form.dayOfMonth])

  function validate(){
    if (!form.name.trim()) return 'Name fehlt'
    if (form.kind === 'report' && !form.report) return 'Report-Typ fehlt'
    if (!form.at || !/^\d{2}:\d{2}$/.test(form.at)) return 'Uhrzeit im Format HH:MM'
    const rec = (form.recipients||[]).filter(Boolean)
    if (rec.length===0 && !mailDefaults.defaultRecipient) return 'Empfänger erforderlich (oder Standard-Empfänger im Mail-Setup setzen)'
    if (form.kind === 'watchdog_internal') {
      const th = Number(form.threshold)
      if (!(th >= 0 && th <= 1)) return 'Schwellwert (threshold) muss zwischen 0 und 1 liegen (z.B. 0.2)'
      const wb = Number(form.weeksBack)
      if (!(wb >= 1 && wb <= 12)) return 'Wochen zurück (1-12)'
      if (form.useMinTotal) {
        const mt = Number(form.minTotalHours)
        if (!(mt >= 0)) return 'Min. Gesamtstunden muss >= 0 sein'
      }
    }
    return ''
  }

  async function save(){
    setSaving(true); setError('')
    try{
      const validation = validate(); if (validation){ throw new Error(validation) }
      const payload = { ...form, recipients: (form.recipients||[]).filter(Boolean) }
      if (payload.recipients.length===0 && mailDefaults.defaultRecipient) payload.recipients = [mailDefaults.defaultRecipient]
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
      if (item?.kind === 'watchdog_internal') {
        const to = (Array.isArray(item?.recipients) ? item.recipients : []).join(',')
        await runInternalWatchdog({ unit: item?.unit || 'ALL', to, threshold: item?.threshold ?? 0.2, weeksBack: item?.weeksBack || 1 })
        alert('Watchdog wurde angestoßen.')
      } else {
        await runReportNow({ scheduleId: item?.id })
        alert('Report wurde angestoßen.')
      }
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

  async function previewPdf(){
    try{
      const params = new URLSearchParams({ report: form.report || 'stunden', unit: form.unit || 'ALL', rangePreset: form.rangePreset || 'last_month' })
      const url = `/api/reports/preview-page?${params.toString()}`
      // In-App Vorschau
      setPreviewUrl(url)
    }catch(e){ alert('Fehler bei PDF-Vorschau: ' + (e?.response?.data?.message || e.message)) }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e)=>e.stopPropagation()} style={{ width:'90vw', maxWidth: 1200 }}>
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
                  <div style={{ overflowX:'auto' }}>
                    <table className="table" style={{ width:'100%', minWidth: 1100, fontSize:13 }}>
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Aktiv</th>
                          <th>Typ</th>
                          <th>Unit</th>
                          <th>Range/Regeln</th>
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
                            <td>{it.kind === 'watchdog_internal' ? 'Watchdog' : `Report: ${it.report}`}</td>
                            <td>{it.unit || 'ALL'}</td>
                            <td>
                              {it.kind === 'watchdog_internal' ? (
                                <>
                                  <div>Weeks: {it.weeksBack||1} • Thresh: {(Number(it.threshold||0)*100).toFixed(0)}% • Comb: {it.combine||'or'}</div>
                                  <div style={{ color:'var(--muted)' }}>
                                    {it.useInternalShare!==false ? 'INT-Share ' : ''}
                                    {it.useZeroLastWeek!==false ? 'Zero-LastWeek ' : ''}
                                    {it.useMinTotal ? `MinTotal ${it.minTotalHours||0}h` : ''}
                                  </div>
                                </>
                              ) : (
                                it.rangePreset
                              )}
                            </td>
                            <td>{it.frequency}</td>
                            <td>{it.at || '06:00'}</td>
                            <td>{Array.isArray(it.recipients) ? it.recipients.join(', ') : ''}</td>
                            <td style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                              <button className="btn" onClick={()=>edit(it)}>Bearbeiten</button>
                              <button className="btn" onClick={()=>runNow(it)}>Jetzt senden</button>
                              {it.kind === 'watchdog_internal' ? (
                                <button className="btn" onClick={async ()=>{
                                  try{
                                    const params = new URLSearchParams({
                                      unit: it.unit || 'ALL',
                                      threshold: String(it.threshold ?? 0.2),
                                      weeksBack: String(it.weeksBack || 1),
                                      useInternalShare: String((it.useInternalShare ?? true) !== false),
                                      useZeroLastWeek: String((it.useZeroLastWeek ?? true) !== false),
                                      useMinTotal: String((it.useMinTotal ?? false) === true),
                                      minTotalHours: String(it.minTotalHours || 0),
                                      combine: it.combine === 'and' ? 'and' : 'or'
                                    })
                                    const url = `/api/watchdogs/internal/preview-page?${params.toString()}`
                                    window.open(url, '_blank', 'noreferrer')
                                  }catch(e){ alert('Fehler: '+(e?.response?.data?.message || e.message)) }
                                }}>Watchdog ansehen</button>
                              ) : (
                                <button className="btn" onClick={async ()=>{
                                  try{
                                    const params = new URLSearchParams({ report: it.report || 'stunden', unit: it.unit || 'ALL', rangePreset: it.rangePreset || 'last_month' })
                                    const url = `/api/reports/preview-page?${params.toString()}`
                                    window.open(url, '_blank', 'noreferrer')
                                  }catch(e){ alert('Fehler: '+(e?.response?.data?.message || e.message)) }
                                }}>Vorschau</button>
                              )}
                              <button className="btn" onClick={()=>{ const c={...it, id:'' , name:(it.name||'')+' (Kopie)'}; edit(c) }}>Duplizieren</button>
                              <button className="btn" onClick={()=>{ const toggled={...it, active: !it.active}; upsertReportSchedule(toggled).then(()=>listReportSchedules().then(r=>setItems(r.items||[]))) }}>Aktiv {it.active? 'aus' : 'an'}</button>
                              <button className="btn" onClick={()=>remove(it.id)}>Löschen</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            <div className="panel" style={{ padding:12 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <strong>Eintrag {form.id ? '(Bearbeiten)' : '(Neu)'} </strong>
                <div style={{ flex:1 }} />
                <button className="btn" onClick={save} disabled={saving}>{saving? 'Speichere…' : 'Speichern'}</button>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(4, minmax(0, 1fr))', gap:12, marginTop:8 }}>
                <Labeled label="Name">
                  <input className="input" value={form.name} onChange={(e)=>update('name', e.target.value)} placeholder="Monatsreport" />
                </Labeled>
                <Labeled label="Aktiv">
                  <select className="input" value={form.active? 'true':'false'} onChange={(e)=>update('active', e.target.value==='true')}>
                    <option value="true">Ja</option>
                    <option value="false">Nein</option>
                  </select>
                </Labeled>
                <Labeled label="Aufgabe">
                  <select className="input" value={form.kind} onChange={(e)=>update('kind', e.target.value)}>
                    <option value="report">Report</option>
                    <option value="watchdog_internal">Watchdog: interner Anteil</option>
                  </select>
                </Labeled>
                {form.kind === 'report' && (
                  <Labeled label="Report-Typ">
                    <select className="input" value={form.report} onChange={(e)=>update('report', e.target.value)}>
                      <option value="stunden">Stunden</option>
                      <option value="umsatzliste">Umsatzliste</option>
                    </select>
                  </Labeled>
                )}
                <Labeled label="Unit">
                  <select className="input" value={form.unit} onChange={(e)=>update('unit', e.target.value)}>
                    <option value="ALL">ALL</option>
                    {units.map(u => (
                      <option key={u.ext_id} value={u.ext_id}>{u.name} ({u.ext_id})</option>
                    ))}
                  </select>
                </Labeled>
                {form.kind === 'report' && (
                  <Labeled label="Zeitraum">
                    <select className="input" value={form.rangePreset} onChange={(e)=>update('rangePreset', e.target.value)}>
                      <option value="last_month">Letzter Monat</option>
                      <option value="last_week">Letzte Woche</option>
                    </select>
                  </Labeled>
                )}
                {form.kind === 'watchdog_internal' && (
                  <>
                    <Labeled label="Schwellwert intern (0-1)">
                      <input className="input" type="number" step="0.05" min={0} max={1} value={form.threshold} onChange={(e)=>update('threshold', Math.max(0, Math.min(1, Number(e.target.value))))} />
                    </Labeled>
                    <Labeled label="Wochen zurück (1-12)">
                      <input className="input" type="number" min={1} max={12} value={form.weeksBack} onChange={(e)=>update('weeksBack', Math.max(1, Math.min(12, Number(e.target.value))))} />
                    </Labeled>
                    <Labeled label="Regeln">
                      <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                        <label style={{ color:'var(--muted)', fontSize:12 }}><input type="checkbox" checked={form.useInternalShare!==false} onChange={(e)=>update('useInternalShare', e.target.checked)} style={{ marginRight:6 }} />Interner Anteil</label>
                        <label style={{ color:'var(--muted)', fontSize:12 }}><input type="checkbox" checked={form.useZeroLastWeek!==false} onChange={(e)=>update('useZeroLastWeek', e.target.checked)} style={{ marginRight:6 }} />0h letzte Woche</label>
                        <label style={{ color:'var(--muted)', fontSize:12 }}><input type="checkbox" checked={!!form.useMinTotal} onChange={(e)=>update('useMinTotal', e.target.checked)} style={{ marginRight:6 }} />Min. Gesamt (h)</label>
                        <input className="input" type="number" min={0} step={0.5} value={form.minTotalHours||0} onChange={(e)=>update('minTotalHours', Math.max(0, Number(e.target.value)))} style={{ width:130 }} disabled={!form.useMinTotal} />
                        <label style={{ color:'var(--muted)', fontSize:12 }}>Kombination</label>
                        <select className="input" value={form.combine||'or'} onChange={(e)=>update('combine', e.target.value)}>
                          <option value="or">ODER</option>
                          <option value="and">UND</option>
                        </select>
                      </div>
                    </Labeled>
                  </>
                )}
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
                  <Labeled label="Wochentage (UTC)">
                    <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                      {['Mo','Di','Mi','Do','Fr','Sa','So'].map((lbl, idx) => {
                        const val = idx+1 // 1..7
                        const active = (form.weekdays||[]).includes(val)
                        return (
                          <button key={val} type="button" className="btn" style={{ padding:'6px 10px', background: active? 'var(--fg)' : 'transparent', color: active? 'var(--bg)' : 'var(--fg)', border:'1px solid var(--border)' }} onClick={()=>{
                            const set = new Set(form.weekdays||[]); if (active) set.delete(val); else set.add(val); update('weekdays', Array.from(set).sort((a,b)=>a-b))
                          }}>{lbl}</button>
                        )
                      })}
                    </div>
                  </Labeled>
                )}
                {form.frequency==='monthly' && (
                  <Labeled label="Tag im Monat (1-28)">
                    <input className="input" type="number" min={1} max={28} value={form.dayOfMonth} onChange={(e)=>update('dayOfMonth', Number(e.target.value))} />
                  </Labeled>
                )}
                <Labeled label="Empfänger (Kommagetrennt)">
                  <div style={{ display:'flex', gap:8 }}>
                    <input className="input" value={(form.recipients||[]).join(',')} onChange={(e)=>update('recipients', e.target.value.split(',').map(s=>s.trim()).filter(Boolean))} placeholder="a@b.de,c@d.de" />
                    {!!mailDefaults.defaultRecipient && <button type="button" className="btn" onClick={()=>{
                      const r = new Set(form.recipients||[]); r.add(mailDefaults.defaultRecipient); update('recipients', Array.from(r))
                    }}>+ Standard</button>}
                  </div>
                </Labeled>
              </div>
              <div style={{ display:'flex', gap:8, marginTop:12, flexWrap:'wrap' }}>
                <button className="btn" onClick={save} disabled={saving}>{saving? 'Speichere…' : 'Speichern'}</button>
                {form.kind === 'report' && <button className="btn" onClick={runAdhoc}>Ad-hoc senden…</button>}
                {form.kind === 'report' && <button className="btn" onClick={previewPdf}>PDF ansehen</button>}
              </div>
              {previewUrl && (
                <div className="panel" style={{ marginTop:12, padding:0, border:'1px solid var(--border)' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 10px', borderBottom:'1px solid var(--border)' }}>
                    <strong style={{ flex:1 }}>Vorschau</strong>
                    <a className="btn" href={previewUrl} target="_blank" rel="noreferrer">Im neuen Tab öffnen</a>
                    <a className="btn" href={previewUrl + (previewUrl.includes('?') ? '&' : '?') + 'download=1'} target="_blank" rel="noreferrer">Download</a>
                    <button className="btn" onClick={()=>setPreviewUrl('')}>Schließen</button>
                  </div>
                  <iframe title="Report Vorschau" src={previewUrl} style={{ width:'100%', height:'70vh', border:0 }} />
                </div>
              )}
              <div style={{ display:'flex', gap:12, marginTop:8, alignItems:'center', flexWrap:'wrap' }}>
                {error && <div style={{ color:'crimson', whiteSpace:'pre-wrap' }}>Fehler: {String(error)}</div>}
                {!error && nextRunPreview && <div style={{ color:'var(--muted)' }}>Nächster Lauf (UTC): {nextRunPreview}</div>}
                {!error && !nextRunPreview && <div style={{ color:'var(--muted)' }}>Nächster Lauf (UTC): n/a</div>}
                {form.unit==='ALL' && <div style={{ color:'var(--muted)' }}>Hinweis: Bei "ALL" werden die Daten über alle Units aggregiert.</div>}
              </div>
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
