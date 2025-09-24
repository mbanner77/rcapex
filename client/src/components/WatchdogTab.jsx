import React, { useEffect, useMemo, useState } from 'react'
import { fetchInternalWatchdogReport, runInternalWatchdog, getMailSettings } from '../lib/api'
import { getUnits } from '../lib/constants'

function fmt(n){
  return new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n||0))
}

export default function WatchdogTab(){
  const [units, setUnits] = useState(() => getUnits())
  const [unit, setUnit] = useState(() => localStorage.getItem('wd_unit') || 'ALL')
  const [threshold, setThreshold] = useState(() => Number(localStorage.getItem('wd_threshold') || 0.2))
  const [weeksBack, setWeeksBack] = useState(() => Number(localStorage.getItem('wd_weeksBack') || 1))
  const [offendersOnly, setOffendersOnly] = useState(true)
  const [useInternalShare, setUseInternalShare] = useState(() => (localStorage.getItem('wd_useInternalShare') ?? 'true') !== 'false')
  const [useZeroLastWeek, setUseZeroLastWeek] = useState(() => (localStorage.getItem('wd_useZeroLastWeek') ?? 'true') !== 'false')
  const [useMinTotal, setUseMinTotal] = useState(() => (localStorage.getItem('wd_useMinTotal') ?? 'false') === 'true')
  const [minTotalHours, setMinTotalHours] = useState(() => Number(localStorage.getItem('wd_minTotalHours') || 0))
  const [combine, setCombine] = useState(() => localStorage.getItem('wd_combine') || 'or') // 'or' | 'and'
  const [sortBy, setSortBy] = useState('pct') // 'pct' | 'total' | 'internal' | 'mitarbeiter' | 'week'
  const [sortDir, setSortDir] = useState('desc') // 'asc' | 'desc'
  const [query, setQuery] = useState('')
  const [data, setData] = useState({ rows: [], offenders: [], range: {} })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [mailDefaults, setMailDefaults] = useState({ defaultRecipient: '' })

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
        const r = await fetchInternalWatchdogReport({ unit, threshold, weeksBack, useInternalShare, useZeroLastWeek, useMinTotal, minTotalHours, combine })
        if (!cancelled) setData({ rows: r.rows||[], offenders: r.offenders||[], range: r.range||{} })
      }catch(e){ if(!cancelled) setError(e?.response?.data?.message || e.message) }
      finally{ if(!cancelled) setLoading(false) }
    }

  // KPIs
  const kpi = useMemo(() => {
    const all = data.rows||[]
    const off = data.offenders||[]
    const offZero = off.filter(r => Array.isArray(r.reasons) && r.reasons.some(x=>x.type==='zero_last_week')).length
    const offInt = off.filter(r => Array.isArray(r.reasons) && r.reasons.some(x=>x.type==='internal_share')).length
    const lastWeek = (()=>{
      try { return (data.range?.datum_bis||'').slice(0,10) } catch { return '' }
    })()
    return { total: all.length, offenders: off.length, offZero, offInt, lastWeek }
  }, [data])

  function setPreset(p){
    if (p==='strict'){
      setThreshold(0.2); setWeeksBack(1); setUseInternalShare(true); setUseZeroLastWeek(true); setUseMinTotal(true); setMinTotalHours(10); setCombine('or')
    } else if (p==='lenient'){
      setThreshold(0.35); setWeeksBack(1); setUseInternalShare(true); setUseZeroLastWeek(false); setUseMinTotal(false); setMinTotalHours(0); setCombine('and')
    }
  }
    load()
    return () => { cancelled = true }
  }, [unit, threshold, weeksBack, useInternalShare, useZeroLastWeek, useMinTotal, minTotalHours, combine])

  // persist settings
  useEffect(() => { localStorage.setItem('wd_unit', unit) }, [unit])
  useEffect(() => { localStorage.setItem('wd_threshold', String(threshold)) }, [threshold])
  useEffect(() => { localStorage.setItem('wd_weeksBack', String(weeksBack)) }, [weeksBack])
  useEffect(() => { localStorage.setItem('wd_useInternalShare', String(useInternalShare)) }, [useInternalShare])
  useEffect(() => { localStorage.setItem('wd_useZeroLastWeek', String(useZeroLastWeek)) }, [useZeroLastWeek])
  useEffect(() => { localStorage.setItem('wd_useMinTotal', String(useMinTotal)) }, [useMinTotal])
  useEffect(() => { localStorage.setItem('wd_minTotalHours', String(minTotalHours)) }, [minTotalHours])
  useEffect(() => { localStorage.setItem('wd_combine', combine) }, [combine])

  useEffect(() => {
    let cancelled = false
    getMailSettings().then((m)=>{ if(!cancelled) setMailDefaults({ defaultRecipient: m?.defaultRecipient || '' }) }).catch(()=>{})
    return () => { cancelled = true }
  }, [])

  const rows = useMemo(() => {
    const base = offendersOnly ? (data.offenders||[]) : (data.rows||[])
    const q = (query||'').toLowerCase().trim()
    let arr = base
    if (q) arr = arr.filter(r => String(r.week||'').toLowerCase().includes(q) || String(r.mitarbeiter||'').toLowerCase().includes(q) || (Array.isArray(r.reasons) && r.reasons.some(x=> (x.type||'').toLowerCase().includes(q))))
    const cmpNum = (a,b)=> (Number(a)||0) - (Number(b)||0)
    const cmpStr = (a,b)=> String(a||'').localeCompare(String(b||''))
    arr = arr.slice().sort((a,b)=>{
      let v = 0
      if (sortBy==='pct') v = (a.pct||0) - (b.pct||0)
      else if (sortBy==='total') v = (a.total||0) - (b.total||0)
      else if (sortBy==='internal') v = (a.internal||0) - (b.internal||0)
      else if (sortBy==='mitarbeiter') v = cmpStr(a.mitarbeiter, b.mitarbeiter)
      else if (sortBy==='week') v = cmpStr(a.week, b.week)
      return sortDir==='asc' ? v : -v
    })
    return arr
  }, [data, offendersOnly, query, sortBy, sortDir])

  function exportCsv(){
    const lines = ['week;mitarbeiter;internal;total;pct']
    for (const r of rows) lines.push([r.week, String(r.mitarbeiter||'').replaceAll(';',','), r.internal, r.total, ((r.pct||0)*100).toFixed(1)].join(';'))
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'watchdog_internal.csv'
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
  }

  async function sendMail(){
    let to = prompt('Empfänger E-Mail (Kommagetrennt):', mailDefaults.defaultRecipient || '')
    if (!to) return
    try{
      await runInternalWatchdog({ unit, to, threshold, weeksBack, useInternalShare, useZeroLastWeek, useMinTotal, minTotalHours, combine })
      alert('Watchdog-Mail wurde gesendet.')
    }catch(e){ alert('Fehler: ' + (e?.response?.data?.message || e.message)) }
  }

  return (
    <div className="grid">
      <div className="panel" style={{ padding:12 }}>
        <div className="kpi-grid">
          <div className="panel kpi-card"><div className="kpi-title">Zeilen gesamt</div><div className="kpi-value">{kpi.total}</div></div>
          <div className="panel kpi-card"><div className="kpi-title">Verstöße</div><div className="kpi-value">{kpi.offenders}</div></div>
          <div className="panel kpi-card"><div className="kpi-title">0h letzte Woche</div><div className="kpi-value">{kpi.offZero}</div></div>
          <div className="panel kpi-card"><div className="kpi-title">Interner Anteil ≥</div><div className="kpi-value">{(threshold*100).toFixed(0)}%</div></div>
        </div>
        <div className="toolbar" style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', marginBottom:8 }}>
          <strong>Watchdog: Interner Anteil je Mitarbeiter/Woche</strong>
          <div style={{ flex:1 }} />
          <label style={{ color:'var(--muted)', fontSize:12 }}>Unit</label>
          <select className="input" value={unit} onChange={(e)=>setUnit(e.target.value)}>
            <option value="ALL">ALL</option>
            {units.map(u => (<option key={u.ext_id} value={u.ext_id}>{u.name} ({u.ext_id})</option>))}
          </select>
          <label style={{ color:'var(--muted)', fontSize:12 }}>Schwellwert</label>
          <input className="input" type="number" step="0.05" min={0} max={1} value={threshold} onChange={(e)=>setThreshold(Math.max(0, Math.min(1, Number(e.target.value))))} style={{ width:90 }} />
          <label style={{ color:'var(--muted)', fontSize:12 }}>Wochen zurück</label>
          <input className="input" type="number" min={1} max={12} value={weeksBack} onChange={(e)=>setWeeksBack(Math.max(1, Math.min(12, Number(e.target.value))))} style={{ width:90 }} />
          <label style={{ color:'var(--muted)', fontSize:12 }}><input type="checkbox" checked={useInternalShare} onChange={(e)=>setUseInternalShare(e.target.checked)} style={{ marginRight:6 }} />Interner Anteil</label>
          <label style={{ color:'var(--muted)', fontSize:12 }}><input type="checkbox" checked={useZeroLastWeek} onChange={(e)=>setUseZeroLastWeek(e.target.checked)} style={{ marginRight:6 }} />0h letzte Woche</label>
          <label style={{ color:'var(--muted)', fontSize:12 }}><input type="checkbox" checked={useMinTotal} onChange={(e)=>setUseMinTotal(e.target.checked)} style={{ marginRight:6 }} />Min. Gesamt (h)</label>
          <input className="input" type="number" min={0} step="0.5" value={minTotalHours} onChange={(e)=>setMinTotalHours(Math.max(0, Number(e.target.value)))} style={{ width:110 }} disabled={!useMinTotal} />
          <label style={{ color:'var(--muted)', fontSize:12 }}>Kombination</label>
          <select className="input" value={combine} onChange={(e)=>setCombine(e.target.value)}>
            <option value="or">ODER</option>
            <option value="and">UND</option>
          </select>
          <label style={{ color:'var(--muted)', fontSize:12 }}><input type="checkbox" checked={offendersOnly} onChange={(e)=>setOffendersOnly(e.target.checked)} style={{ marginRight:6 }} />nur Verstöße</label>
          <input className="input" placeholder="Suche (Woche/Mitarbeiter)" value={query} onChange={(e)=>setQuery(e.target.value)} style={{ width:260 }} />
          <button className="btn" onClick={exportCsv}>CSV Export</button>
          <button className="btn" onClick={sendMail}>Warnmail senden…</button>
          <div style={{ width:8 }} />
          <button className="btn" title="Preset: Streng" onClick={()=>setPreset('strict')}>Preset: Streng</button>
          <button className="btn" title="Preset: Locker" onClick={()=>setPreset('lenient')}>Preset: Locker</button>
        </div>
        {loading && <div>Lade…</div>}
        {!!error && <div style={{ color:'crimson' }}>Fehler: {String(error)}</div>}
        <div style={{ color:'var(--muted)', marginBottom:6 }}>Zeitraum: {(data?.range?.datum_von||'').slice(0,10)} – {(data?.range?.datum_bis||'').slice(0,10)}</div>
        <div style={{ overflowX:'auto' }}>
          <table className="table" style={{ minWidth: 860 }}>
            <thead>
              <tr>
                <th style={{cursor:'pointer'}} onClick={()=>{ setSortBy('week'); setSortDir(sortBy==='week' && sortDir==='asc' ? 'desc' : 'asc') }}>Woche</th>
                <th style={{cursor:'pointer'}} onClick={()=>{ setSortBy('mitarbeiter'); setSortDir(sortBy==='mitarbeiter' && sortDir==='asc' ? 'desc' : 'asc') }}>Mitarbeiter</th>
                <th className="right" style={{cursor:'pointer'}} onClick={()=>{ setSortBy('internal'); setSortDir(sortBy==='internal' && sortDir==='asc' ? 'desc' : 'asc') }}>Intern (h)</th>
                <th className="right" style={{cursor:'pointer'}} onClick={()=>{ setSortBy('total'); setSortDir(sortBy==='total' && sortDir==='asc' ? 'desc' : 'asc') }}>Gesamt (h)</th>
                <th className="right" style={{cursor:'pointer'}} onClick={()=>{ setSortBy('pct'); setSortDir(sortBy==='pct' && sortDir==='asc' ? 'desc' : 'asc') }}>Anteil Intern</th>
                <th>Gründe</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => {
                const hasZero = Array.isArray(r.reasons) && r.reasons.some(x=>x.type==='zero_last_week')
                const hasInt = Array.isArray(r.reasons) && r.reasons.some(x=>x.type==='internal_share')
                const cls = hasInt ? 'row-bad' : (hasZero ? 'row-warn' : '')
                const intReason = (r.reasons||[]).find(x=>x.type==='internal_share')
                const weeksTxt = intReason && Array.isArray(intReason.weeks) ? ` (${intReason.weeks.join(',')})` : ''
                return (
                  <tr key={idx} className={cls}>
                  <td>{r.week}</td>
                  <td>{r.mitarbeiter}</td>
                  <td className="right">{fmt(r.internal)}</td>
                  <td className="right">{fmt(r.total)}</td>
                  <td className="right">{((r.pct||0)*100).toFixed(1)}%</td>
                  <td>{Array.isArray(r.reasons)? r.reasons.map(x=> x.type==='internal_share' ? `internal_share${weeksTxt}` : x.type).join(', ') : ''}</td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
