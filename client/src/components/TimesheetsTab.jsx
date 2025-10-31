import React, { useEffect, useMemo, useState } from 'react'
import { getUnits } from '../lib/constants'
import { fetchTimesheetsReport, runTimesheetsWatchdog, getMailSettings, getTimesheetExceptions, updateTimesheetExceptions } from '../lib/api'
import Modal from './Modal'

function fmt(n){
  return new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n||0))
}

// Helper function to get ISO week number and year
function getISOWeek(date) {
  const target = new Date(date.valueOf())
  const dayNr = (date.getDay() + 6) % 7
  target.setDate(target.getDate() - dayNr + 3)
  const firstThursday = target.valueOf()
  target.setMonth(0, 1)
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7)
  }
  const weekNumber = 1 + Math.ceil((firstThursday - target) / 604800000)
  return { week: weekNumber, year: target.getFullYear() }
}

// Get last week's ISO week number (current week - 1)
function getLastWeek() {
  const now = new Date()
  const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  return getISOWeek(lastWeek)
}

// Get last month (month and year)
function getLastMonth() {
  const now = new Date()
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  return { month: lastMonth.getMonth() + 1, year: lastMonth.getFullYear() }
}

export default function TimesheetsTab(){
  const [units, setUnits] = useState(() => getUnits())
  const [unit, setUnit] = useState(() => localStorage.getItem('ts_unit') || 'ALL')
  const [mode, setMode] = useState(() => localStorage.getItem('ts_mode') || 'weekly') // 'weekly' | 'monthly'
  const [hoursPerDay, setHoursPerDay] = useState(() => Number(localStorage.getItem('ts_hoursPerDay') || 8))
  const [data, setData] = useState({ rows: [], offenders: [], range: {} })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState('status') // status | ratio | total | expected | mitarbeiter
  const [sortDir, setSortDir] = useState('asc') // asc | desc (ignored for status because we force severity)
  const [mailDefaults, setMailDefaults] = useState({ defaultRecipient: '' })
  const [mailTo, setMailTo] = useState(() => localStorage.getItem('ts_mailTo') || '')
  const [onlyOffenders, setOnlyOffenders] = useState(() => localStorage.getItem('ts_onlyOffenders') === 'true')
  const [ratioThreshold, setRatioThreshold] = useState(() => Number(localStorage.getItem('ts_ratioThreshold') || 90)) // monthly threshold in %
  const [rangeMode, setRangeMode] = useState(() => localStorage.getItem('ts_rangeMode') || 'auto') // 'auto' | 'custom' | 'week' | 'month'
  const [customFrom, setCustomFrom] = useState(() => localStorage.getItem('ts_customFrom') || '')
  const [customTo, setCustomTo] = useState(() => localStorage.getItem('ts_customTo') || '')
  const [isoWeek, setIsoWeek] = useState(() => {
    const stored = localStorage.getItem('ts_isoWeek')
    if (stored) return stored
    const lastWeek = getLastWeek()
    return lastWeek.week.toString()
  })
  const [isoYear, setIsoYear] = useState(() => {
    const stored = localStorage.getItem('ts_isoYear')
    if (stored) return stored
    const lastWeek = getLastWeek()
    return lastWeek.year.toString()
  })
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const stored = localStorage.getItem('ts_selectedMonth')
    if (stored) return stored
    const lastMonth = getLastMonth()
    return lastMonth.month.toString()
  })
  const [selectedMonthYear, setSelectedMonthYear] = useState(() => {
    const stored = localStorage.getItem('ts_selectedMonthYear')
    if (stored) return stored
    const lastMonth = getLastMonth()
    return lastMonth.year.toString()
  })
  const [showExceptionsDialog, setShowExceptionsDialog] = useState(false)
  const [exceptions, setExceptions] = useState([])
  const [exceptionsLoading, setExceptionsLoading] = useState(false)

  useEffect(() => {
    const onUnits = () => setUnits(getUnits())
    window.addEventListener('units_changed', onUnits)
    return () => window.removeEventListener('units_changed', onUnits)
  }, [])

  useEffect(() => {
    let cancelled = false
    getTimesheetExceptions().then(ex => { if (!cancelled) setExceptions(ex) }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load(){
      setLoading(true); setError('')
      try{
        const params = { unit, mode, hoursPerDay }
        if (rangeMode === 'custom' && customFrom && customTo) {
          params.datum_von = customFrom
          params.datum_bis = customTo
        } else if (rangeMode === 'week' && isoWeek) {
          params.isoWeek = isoWeek
          params.isoYear = isoYear
        } else if (rangeMode === 'month' && selectedMonth && selectedMonthYear) {
          params.month = selectedMonth
          params.monthYear = selectedMonthYear
        }
        const r = await fetchTimesheetsReport(params)
        if (!cancelled) setData({ rows: r.rows||[], offenders: r.offenders||[], range: r.range||{} })
      }catch(e){ if(!cancelled) setError(e?.response?.data?.message || e.message) }
      finally{ if(!cancelled) setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [unit, mode, hoursPerDay, rangeMode, customFrom, customTo, isoWeek, isoYear, selectedMonth, selectedMonthYear])

  useEffect(() => { localStorage.setItem('ts_unit', unit) }, [unit])
  useEffect(() => { localStorage.setItem('ts_mode', mode) }, [mode])
  useEffect(() => { localStorage.setItem('ts_hoursPerDay', String(hoursPerDay)) }, [hoursPerDay])
  useEffect(() => { localStorage.setItem('ts_mailTo', mailTo) }, [mailTo])
  useEffect(() => { localStorage.setItem('ts_onlyOffenders', String(!!onlyOffenders)) }, [onlyOffenders])
  useEffect(() => { localStorage.setItem('ts_ratioThreshold', String(ratioThreshold)) }, [ratioThreshold])
  useEffect(() => { localStorage.setItem('ts_rangeMode', rangeMode) }, [rangeMode])
  useEffect(() => { localStorage.setItem('ts_customFrom', customFrom) }, [customFrom])
  useEffect(() => { localStorage.setItem('ts_customTo', customTo) }, [customTo])
  useEffect(() => { localStorage.setItem('ts_isoWeek', isoWeek) }, [isoWeek])
  useEffect(() => { localStorage.setItem('ts_isoYear', isoYear) }, [isoYear])
  useEffect(() => { localStorage.setItem('ts_selectedMonth', selectedMonth) }, [selectedMonth])
  useEffect(() => { localStorage.setItem('ts_selectedMonthYear', selectedMonthYear) }, [selectedMonthYear])

  useEffect(() => {
    let cancelled = false
    getMailSettings().then(m=>{ if(!cancelled) setMailDefaults({ defaultRecipient: m?.defaultRecipient || '' }) }).catch(()=>{})
    return () => { cancelled = true }
  }, [])

  function getStatus(r){
    const total = Number(r.total) || 0
    const expected = Number(r.expected) || 0
    // Red: no time booked at all
    if (total <= 0) return 'bad'
    // Yellow: some time but below expected
    if (expected > 0 && total < expected) return 'warn'
    // Green: meets or exceeds expected (or no expectation provided)
    return 'good'
  }
  const isOffender = (r) => {
    const s = getStatus(r)
    return s === 'bad' || s === 'warn'
  }

  const rows = useMemo(() => {
    const base = data.rows || []
    const q = (query||'').toLowerCase().trim()
    let filtered = q ? base.filter(r => String(r.mitarbeiter||'').toLowerCase().includes(q)) : base
    if (onlyOffenders) filtered = filtered.filter(r => isOffender(r))
    const severity = (r)=>{ const s=getStatus(r); return s==='bad'?0:(s==='warn'?1:2) }
    const arr = filtered.slice().sort((a,b)=>{
      if (sortBy==='status'){
        const sv = severity(a) - severity(b)
        if (sv !== 0) return sv
        // tie-breaker: lower ratio first, then by total ascending, then name
        const ra=(Number(a.ratio)||0), rb=(Number(b.ratio)||0)
        if (ra!==rb) return ra-rb
        const ta=(Number(a.total)||0), tb=(Number(b.total)||0)
        if (ta!==tb) return ta-tb
        return String(a.mitarbeiter||'').localeCompare(String(b.mitarbeiter||''))
      }
      let v=0
      if (sortBy==='ratio') v=(Number(a.ratio)||0)-(Number(b.ratio)||0)
      else if (sortBy==='total') v=(Number(a.total)||0)-(Number(b.total)||0)
      else if (sortBy==='expected') v=(Number(a.expected)||0)-(Number(b.expected)||0)
      else if (sortBy==='mitarbeiter') v=String(a.mitarbeiter||'').localeCompare(String(b.mitarbeiter||''))
      return sortDir==='asc' ? v : -v
    })
    return arr
  }, [data, query, sortBy, sortDir])

  async function sendMail(){
    const to = (mailTo || mailDefaults.defaultRecipient || '').trim()
    if (!to){ alert('Bitte Empfänger angeben.'); return }
    try{
      const payload = { unit, mode, hoursPerDay, to }
      if (rangeMode === 'custom' && customFrom && customTo) {
        payload.datum_von = customFrom
        payload.datum_bis = customTo
      } else if (rangeMode === 'week' && isoWeek) {
        payload.isoWeek = isoWeek
        payload.isoYear = isoYear
      } else if (rangeMode === 'month' && selectedMonth && selectedMonthYear) {
        payload.month = selectedMonth
        payload.monthYear = selectedMonthYear
      }
      await runTimesheetsWatchdog(payload)
      alert('Report-Mail wurde gesendet.')
    }catch(e){ alert('Fehler: ' + (e?.response?.data?.message || e.message)) }
  }

  function preview(){
    const params = new URLSearchParams({ unit, mode, hoursPerDay: String(hoursPerDay) })
    if (rangeMode === 'custom' && customFrom && customTo) {
      params.set('datum_von', customFrom)
      params.set('datum_bis', customTo)
    } else if (rangeMode === 'week' && isoWeek) {
      params.set('isoWeek', isoWeek)
      params.set('isoYear', isoYear)
    } else if (rangeMode === 'month' && selectedMonth && selectedMonthYear) {
      params.set('month', selectedMonth)
      params.set('monthYear', selectedMonthYear)
    }
    const url = `/api/watchdogs/timesheets/preview-page?${params.toString()}`
    window.open(url, '_blank', 'noreferrer')
  }

  const kpi = useMemo(() => {
    const all = data.rows||[]
    const off = data.offenders||[]
    return { total: all.length, offenders: off.length }
  }, [data])

  function exportCsv(){
    const header = ['mitarbeiter','total','expected','ratio']
    const lines = [header.join(';')]
    rows.forEach(r => {
      lines.push([
        String(r.mitarbeiter||'').replaceAll(';', ','),
        String(r.total||0),
        String(r.expected||0),
        String(((r.ratio||0)*100).toFixed(0)+'%'),
      ].join(';'))
    })
    const blob = new Blob([lines.join('\n')], { type:'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const from = (data?.range?.datum_von||'').slice(0,10)
    const to = (data?.range?.datum_bis||'').slice(0,10)
    a.href = url
    a.download = `timesheets_${mode}_${from}_${to}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function saveExceptions() {
    setExceptionsLoading(true)
    try {
      const saved = await updateTimesheetExceptions(exceptions)
      setExceptions(saved)
      alert('Ausnahmen gespeichert.')
      setShowExceptionsDialog(false)
      // Reload data to reflect changes
      const params = { unit, mode, hoursPerDay }
      if (rangeMode === 'custom' && customFrom && customTo) {
        params.datum_von = customFrom
        params.datum_bis = customTo
      } else if (rangeMode === 'week' && isoWeek) {
        params.isoWeek = isoWeek
        params.isoYear = isoYear
      } else if (rangeMode === 'month' && selectedMonth && selectedMonthYear) {
        params.month = selectedMonth
        params.monthYear = selectedMonthYear
      }
      const r = await fetchTimesheetsReport(params)
      setData({ rows: r.rows||[], offenders: r.offenders||[], range: r.range||{} })
    } catch (e) {
      alert('Fehler: ' + (e?.response?.data?.message || e.message))
    } finally {
      setExceptionsLoading(false)
    }
  }

  function addException() {
    setExceptions([...exceptions, { name: '', exclude: false, partTimeHours: null }])
  }

  function removeException(idx) {
    setExceptions(exceptions.filter((_, i) => i !== idx))
  }

  function updateException(idx, field, value) {
    const updated = [...exceptions]
    updated[idx] = { ...updated[idx], [field]: value }
    setExceptions(updated)
  }

  return (
    <div className="grid">
      <div className="panel" style={{ padding:12 }}>
        <div className="kpi-grid">
          <div className="panel kpi-card"><div className="kpi-title">Mitarbeiter</div><div className="kpi-value">{kpi.total}</div></div>
          <div className="panel kpi-card"><div className="kpi-title">Verstöße</div><div className="kpi-value">{kpi.offenders}</div></div>
        </div>
        <div className="toolbar" style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', marginBottom:8 }}>
          <strong>Erfassungs-Kontrolle</strong>
          <div style={{ flex:1 }} />
          <label style={{ color:'var(--muted)', fontSize:12 }}>Unit</label>
          <select className="input" value={unit} onChange={(e)=>setUnit(e.target.value)}>
            <option value="ALL">ALL</option>
            {units.map(u => (<option key={u.ext_id} value={u.ext_id}>{u.name} ({u.ext_id})</option>))}
          </select>
          <label style={{ color:'var(--muted)', fontSize:12 }}>Modus</label>
          <select className="input" value={mode} onChange={(e)=>setMode(e.target.value)}>
            <option value="weekly">Wöchentlich</option>
            <option value="monthly">Monatlich</option>
          </select>
          <label style={{ color:'var(--muted)', fontSize:12 }}>h/Tag</label>
          <input className="input" type="number" min={1} max={12} value={hoursPerDay} onChange={(e)=>setHoursPerDay(Math.max(1, Math.min(12, Number(e.target.value))))} style={{ width:100 }} />
        </div>
        <div className="toolbar" style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', marginBottom:8 }}>
          <label style={{ color:'var(--muted)', fontSize:12 }}>Zeitraum</label>
          <select className="input" value={rangeMode} onChange={(e)=>setRangeMode(e.target.value)} style={{ width:140 }}>
            <option value="auto">Automatisch</option>
            <option value="custom">Benutzerdefiniert</option>
            <option value="week">KW</option>
            <option value="month">Monat</option>
          </select>
          {rangeMode === 'custom' && (
            <>
              <label style={{ color:'var(--muted)', fontSize:12 }}>Von</label>
              <input className="input" type="date" value={customFrom} onChange={(e)=>setCustomFrom(e.target.value)} style={{ width:160 }} />
              <label style={{ color:'var(--muted)', fontSize:12 }}>Bis</label>
              <input className="input" type="date" value={customTo} onChange={(e)=>setCustomTo(e.target.value)} style={{ width:160 }} />
            </>
          )}
          {rangeMode === 'week' && (
            <>
              <label style={{ color:'var(--muted)', fontSize:12 }}>KW</label>
              <input className="input" type="number" min={1} max={53} value={isoWeek} onChange={(e)=>setIsoWeek(e.target.value)} style={{ width:80 }} placeholder="KW" />
              <label style={{ color:'var(--muted)', fontSize:12 }}>Jahr</label>
              <input className="input" type="number" min={2020} max={2030} value={isoYear} onChange={(e)=>setIsoYear(e.target.value)} style={{ width:100 }} placeholder="Jahr" />
            </>
          )}
          {rangeMode === 'month' && (
            <>
              <label style={{ color:'var(--muted)', fontSize:12 }}>Monat</label>
              <select className="input" value={selectedMonth} onChange={(e)=>setSelectedMonth(e.target.value)} style={{ width:120 }}>
                <option value="1">Januar</option>
                <option value="2">Februar</option>
                <option value="3">März</option>
                <option value="4">April</option>
                <option value="5">Mai</option>
                <option value="6">Juni</option>
                <option value="7">Juli</option>
                <option value="8">August</option>
                <option value="9">September</option>
                <option value="10">Oktober</option>
                <option value="11">November</option>
                <option value="12">Dezember</option>
              </select>
              <label style={{ color:'var(--muted)', fontSize:12 }}>Jahr</label>
              <input className="input" type="number" min={2020} max={2030} value={selectedMonthYear} onChange={(e)=>setSelectedMonthYear(e.target.value)} style={{ width:100 }} placeholder="Jahr" />
            </>
          )}
          <div style={{ flex:1 }} />
          <input className="input" placeholder="Suche Mitarbeiter" value={query} onChange={(e)=>setQuery(e.target.value)} style={{ width:240 }} />
          <label style={{ display:'flex', alignItems:'center', gap:6 }}>
            <input type="checkbox" checked={onlyOffenders} onChange={(e)=>setOnlyOffenders(e.target.checked)} />
            <span style={{ color:'var(--muted)', fontSize:12 }}>Nur Verstöße</span>
          </label>
          {mode==='monthly' && (
            <>
              <label style={{ color:'var(--muted)', fontSize:12 }}>Schwelle (%)</label>
              <input className="input" type="number" min={50} max={100} value={ratioThreshold} onChange={(e)=>setRatioThreshold(Math.max(50, Math.min(100, Number(e.target.value)||0)))} style={{ width:90 }} />
            </>
          )}
          <button className="btn" onClick={exportCsv}>Export CSV</button>
          <button className="btn" onClick={preview}>Vorschau</button>
          <button className="btn" onClick={() => setShowExceptionsDialog(true)}>Ausnahmen…</button>
          <input className="input" placeholder="E-Mail Empfänger (Komma)" value={mailTo} onChange={(e)=>setMailTo(e.target.value)} style={{ width:240 }} />
          <button className="btn" onClick={sendMail}>Per Mail senden…</button>
        </div>
        {loading && <div>Lade…</div>}
        {!!error && <div style={{ color:'crimson' }}>Fehler: {String(error)}</div>}
        <div style={{ color:'var(--muted)', marginBottom:6 }}>Zeitraum: {(data?.range?.datum_von||'').slice(0,10)} – {(data?.range?.datum_bis||'').slice(0,10)}</div>
        <div className="hide-sm" style={{ overflowX:'auto' }}>
          <table className="table" style={{ minWidth: 900 }}>
            <thead>
              <tr>
                <th style={{cursor:'pointer'}} onClick={()=>{ setSortBy('status'); setSortDir('asc') }}>Ampel</th>
                <th style={{cursor:'pointer'}} onClick={()=>{ setSortBy('mitarbeiter'); setSortDir(sortBy==='mitarbeiter' && sortDir==='asc' ? 'desc' : 'asc') }}>Mitarbeiter</th>
                <th className="right" style={{cursor:'pointer'}} onClick={()=>{ setSortBy('total'); setSortDir(sortBy==='total' && sortDir==='asc' ? 'desc' : 'asc') }}>Summe (h)</th>
                <th className="right" style={{cursor:'pointer'}} onClick={()=>{ setSortBy('expected'); setSortDir(sortBy==='expected' && sortDir==='asc' ? 'desc' : 'asc') }}>Soll (h)</th>
                <th className="right" style={{cursor:'pointer'}} onClick={()=>{ setSortBy('ratio'); setSortDir(sortBy==='ratio' && sortDir==='asc' ? 'desc' : 'asc') }}>Erfüllung</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => {
                const s = getStatus(r)
                const rowCls = s==='bad' ? 'row-bad' : (s==='warn' ? 'row-warn' : 'row-good')
                return (
                <tr key={idx} className={rowCls}>
                  <td><span className={`dot ${s==='bad' ? 'dot-bad' : (s==='warn' ? 'dot-warn' : 'dot-good')}`}></span></td>
                  <td>{r.mitarbeiter}</td>
                  <td className="right">{fmt(r.total)}</td>
                  <td className="right">{fmt(r.expected)}</td>
                  <td className="right">{((r.ratio||0)*100).toFixed(0)}%</td>
                </tr>
              )})}
            </tbody>
          </table>
        </div>
        <div className="show-sm">
          <div className="card-list">
            {rows.map((r, idx) => {
              const s = getStatus(r)
              const bCls = s==='bad' ? 'badge-bad' : (s==='warn' ? 'badge-warn' : 'badge-good')
              return (
              <div className="card" key={idx}>
                <div className="row"><strong><span className={`dot ${s==='bad' ? 'dot-bad' : (s==='warn' ? 'dot-warn' : 'dot-good')}`}></span>{r.mitarbeiter}</strong><div className={`badge ${bCls}`}>{((r.ratio||0)*100).toFixed(0)}%</div></div>
                <div className="row"><span>Summe</span><span>{fmt(r.total)} h</span></div>
                <div className="row"><span>Soll</span><span>{fmt(r.expected)} h</span></div>
              </div>
            )})}
          </div>
        </div>
      </div>

      {/* Exceptions Dialog */}
      {showExceptionsDialog && (
        <Modal
          title="Ausnahmen verwalten"
          subtitle="Ausschlüsse und individuelle Teilzeit pro Mitarbeiter definieren"
          onClose={() => setShowExceptionsDialog(false)}
          size="lg"
          bodyClassName="modal-body-scroll"
          footer={
            <div className="dialog-footer">
              <button className="btn" onClick={() => setShowExceptionsDialog(false)}>Abbrechen</button>
              <button className="btn" onClick={saveExceptions} disabled={exceptionsLoading}>
                {exceptionsLoading ? 'Speichern…' : 'Speichern'}
              </button>
            </div>
          }
        >
          <div className="dialog-stack">
            <div className="panel dialog-section">
              <div className="dialog-section-header">
                <div className="dialog-section-heading">
                  <h3 className="dialog-section-title">Regeln</h3>
                  <p className="dialog-section-subtitle">Ausschlüsse entfernen Mitarbeitende komplett, Teilzeit legt Sollstunden/Tag fest.</p>
                </div>
                <div className="dialog-section-actions">
                  <button className="btn" onClick={addException}>+ Ausnahme hinzufügen</button>
                </div>
              </div>
              <div className="dialog-scroll-x">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Mitarbeiter-Name</th>
                      <th className="th-right">Ausschluss</th>
                      <th>Teilzeit (h/Tag)</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {exceptions.map((ex, idx) => (
                      <tr key={idx}>
                        <td>
                          <input
                            className="input"
                            value={ex.name}
                            onChange={(e) => updateException(idx, 'name', e.target.value)}
                            placeholder="Name eingeben"
                            style={{ width:'100%' }}
                          />
                        </td>
                        <td style={{ textAlign:'center' }}>
                          <input
                            type="checkbox"
                            checked={ex.exclude}
                            onChange={(e) => updateException(idx, 'exclude', e.target.checked)}
                          />
                        </td>
                        <td>
                          <input
                            className="input"
                            type="number"
                            min={0}
                            max={12}
                            step={0.5}
                            value={ex.partTimeHours ?? ''}
                            onChange={(e) => updateException(idx, 'partTimeHours', e.target.value ? Number(e.target.value) : null)}
                            placeholder="Standard"
                            style={{ width:120 }}
                            disabled={ex.exclude}
                          />
                        </td>
                        <td style={{ width:80 }}>
                          <button className="btn" onClick={() => removeException(idx)} title="Entfernen">🗑️</button>
                        </td>
                      </tr>
                    ))}
                    {exceptions.length === 0 && (
                      <tr>
                        <td colSpan={4} className="dialog-empty">Keine Ausnahmen definiert</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
