import React, { useEffect, useMemo, useState } from 'react'
import { getUnits } from '../lib/constants'
import { fetchTimesheetsReport, runTimesheetsWatchdog, getMailSettings } from '../lib/api'

function fmt(n){
  return new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n||0))
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

  useEffect(() => {
    const onUnits = () => setUnits(getUnits())
    window.addEventListener('units_changed', onUnits)
    return () => window.removeEventListener('units_changed', onUnits)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load(){
      setLoading(true); setError('')
      try{
        const r = await fetchTimesheetsReport({ unit, mode, hoursPerDay })
        if (!cancelled) setData({ rows: r.rows||[], offenders: r.offenders||[], range: r.range||{} })
      }catch(e){ if(!cancelled) setError(e?.response?.data?.message || e.message) }
      finally{ if(!cancelled) setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [unit, mode, hoursPerDay])

  useEffect(() => { localStorage.setItem('ts_unit', unit) }, [unit])
  useEffect(() => { localStorage.setItem('ts_mode', mode) }, [mode])
  useEffect(() => { localStorage.setItem('ts_hoursPerDay', String(hoursPerDay)) }, [hoursPerDay])
  useEffect(() => { localStorage.setItem('ts_mailTo', mailTo) }, [mailTo])
  useEffect(() => { localStorage.setItem('ts_onlyOffenders', String(!!onlyOffenders)) }, [onlyOffenders])
  useEffect(() => { localStorage.setItem('ts_ratioThreshold', String(ratioThreshold)) }, [ratioThreshold])

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
      await runTimesheetsWatchdog({ unit, mode, hoursPerDay, to })
      alert('Report-Mail wurde gesendet.')
    }catch(e){ alert('Fehler: ' + (e?.response?.data?.message || e.message)) }
  }

  function preview(){
    const params = new URLSearchParams({ unit, mode, hoursPerDay: String(hoursPerDay) })
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
    </div>
  )
}
