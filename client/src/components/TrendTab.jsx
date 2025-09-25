import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js'
import { fetchStunden } from '../lib/api'
import { exportGenericCsv } from '../lib/export'
import { exportTrendCsv } from '../lib/export'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend)

function ymStr(d) { return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}` }
function monthStart(y, m) { return new Date(Date.UTC(y, m, 1, 0, 0, 0)) }
function monthEnd(y, m) { return new Date(Date.UTC(y, m+1, 0, 23, 59, 59)) }
function toIso(d) { return d.toISOString().slice(0,19)+'Z' }

function parseMonthInput(v) {
  // v format: YYYY-MM
  if (!v) return null
  const [y,m] = v.split('-').map(Number)
  if (!y || !m) return null
  return { y, m: m-1 }
}

function isInternal(item) {
  const code = String(item?.projektcode || '').toUpperCase()
  const name = String(item?.projektname || '').toUpperCase()
  return code.startsWith('INT') || name.startsWith('INT')
}

export default function TrendTab({ params }) {
  const [fromMonth, setFromMonth] = useState('')
  const [toMonth, setToMonth] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [series, setSeries] = useState([]) // [{ ym, data }]
  const [showMA, setShowMA] = useState(false)
  const [modal, setModal] = useState({ open: false, ym: null })
  const reportRef = useRef(null)

  // Default range: previous 6 months up to current filter month end
  useEffect(() => {
    const base = params?.datum_von ? new Date(params.datum_von) : new Date()
    const by = base.getUTCFullYear(); const bm = base.getUTCMonth()
    const start = new Date(Date.UTC(by, bm-5, 1, 0, 0, 0))
    const end = new Date(Date.UTC(by, bm, 1, 0, 0, 0))
    setFromMonth(ymStr(start))
    setToMonth(ymStr(end))
  }, [params?.datum_von])

  const months = useMemo(() => {
    const a = parseMonthInput(fromMonth)
    const b = parseMonthInput(toMonth)
    if (!a || !b) return []
    const res = []
    let y = a.y, m = a.m
    while (y < b.y || (y === b.y && m <= b.m)) {
      const s = monthStart(y, m)
      const e = monthEnd(y, m)
      res.push({ ym: ymStr(s), datum_von: toIso(s), datum_bis: toIso(e) })
      m += 1
      if (m > 11) { m = 0; y += 1 }
    }
    return res
  }, [fromMonth, toMonth])

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!months.length) { setSeries([]); return }
      setLoading(true)
      setError(null)
      try {
        const results = await Promise.all(
          months.map(r => fetchStunden({ datum_von: r.datum_von, datum_bis: r.datum_bis, unit: params?.unit }))
        )
        if (!cancelled) setSeries(results.map((data, idx) => ({ ym: months[idx].ym, data })))
      } catch (e) {
        if (!cancelled) setError(e?.response?.data?.message || e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [months.map(m=>m.datum_von).join(','), months.map(m=>m.datum_bis).join(','), params?.unit])

  const trend = useMemo(() => {
    const labels = series.map(s => s.ym)
    const fakt = []; const gel = []; const internal = []
    for (const s of series) {
      const items = Array.isArray(s.data?.items) ? s.data.items : Array.isArray(s.data) ? s.data : []
      let sf=0, sg=0, si=0
      for (const x of items) {
        const f = parseFloat(x?.stunden_fakt); const g = parseFloat(x?.stunden_gel)
        if (!Number.isNaN(f)) sf += f
        if (!Number.isNaN(g)) sg += g
        if (isInternal(x)) {
          if (!Number.isNaN(g)) si += g
        }
      }
      fakt.push(sf); gel.push(sg); internal.push(si)
    }
    return { labels, fakt, gel, internal }
  }, [series])

  function ma3(arr){
    const out=[]
    for(let i=0;i<arr.length;i++){
      const a = Number(arr[i-2]||0), b = Number(arr[i-1]||0), c = Number(arr[i]||0)
      const n = i>=2 ? 3 : (i===1 ? 2 : 1)
      out.push((a+b+c)/n)
    }
    return out
  }

  const data = useMemo(() => ({
    labels: trend.labels,
    datasets: [
      { label: 'Stunden fakturiert', data: trend.fakt, borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.15)', fill: true, pointRadius: 3, pointHoverRadius: 5, tension: 0.25 },
      { label: 'Stunden geleistet', data: trend.gel, borderColor: '#60a5fa', backgroundColor: 'rgba(96,165,250,0.15)', fill: true, pointRadius: 3, pointHoverRadius: 5, tension: 0.25 },
      { label: 'Interne Projekte (geleistet)', data: trend.internal, borderColor: '#eab308', backgroundColor: 'rgba(234,179,8,0.15)', fill: true, pointRadius: 3, pointHoverRadius: 5, tension: 0.25 },
      ...(showMA ? [
        { label: 'Fakt. · 3M MA', data: ma3(trend.fakt), borderColor: 'rgba(34,197,94,0.5)', borderDash: [6,4], pointRadius: 0, tension: 0.2 },
        { label: 'Gel. · 3M MA', data: ma3(trend.gel), borderColor: 'rgba(96,165,250,0.5)', borderDash: [6,4], pointRadius: 0, tension: 0.2 },
        { label: 'Intern · 3M MA', data: ma3(trend.internal), borderColor: 'rgba(234,179,8,0.5)', borderDash: [6,4], pointRadius: 0, tension: 0.2 },
      ] : [])
    ]
  }), [trend, showMA])

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top', labels: { color: '#c9d1ff' } },
      title: { display: true, text: 'Trends pro Unit', color: '#e5e7ff' },
      tooltip: { mode: 'index', intersect: false, callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmt(ctx.parsed.y)} h` } }
    },
    interaction: { mode: 'nearest', intersect: false },
    scales: {
      x: { ticks: { color: '#aab2c5' }, grid: { color: 'rgba(255,255,255,0.05)' } },
      y: { beginAtZero: true, ticks: { color: '#aab2c5' }, grid: { color: 'rgba(255,255,255,0.05)' } }
    },
    onClick: (evt, elements, chart) => {
      if (!elements?.length) return
      const idx = elements[0].index
      const ym = chart.data.labels[idx]
      setModal({ open: true, ym })
    }
  }

  return (
    <div ref={reportRef}>
      <div className="panel" style={{ padding: 12 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
          <label style={{ color: 'var(--muted)', fontSize: 12 }}>Von (Monat)</label>
          <input className="input" type="month" value={fromMonth} onChange={(e)=>setFromMonth(e.target.value)} />
          <label style={{ color: 'var(--muted)', fontSize: 12 }}>Bis (Monat)</label>
          <input className="input" type="month" value={toMonth} onChange={(e)=>setToMonth(e.target.value)} />
          <div style={{ color: 'var(--muted)' }}>Unit: <b>{params?.unit}</b> (über Filter oben ändern)</div>
          <label style={{ color: 'var(--muted)', fontSize: 12 }}>
            <input type="checkbox" checked={showMA} onChange={(e)=>setShowMA(e.target.checked)} style={{ marginRight: 6 }} /> 3M gleitender Durchschnitt
          </label>
        </div>
        {loading && <div>Loading…</div>}
        {error && <div style={{ color: 'crimson' }}>Fehler: {String(error)}</div>}
        <div className="chart-lg">
          <Line data={data} options={options} />
        </div>
        {/* Table with month-over-month deltas */}
        {trend.labels.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <button className="btn" onClick={() => exportTrendCsv(buildRows(trend))}>Export Trends (CSV)</button>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Monat</th>
                    <th className="right">Fakt.</th>
                    <th className="right">Δ Fakt.</th>
                    <th className="right">Δ Fakt. %</th>
                    <th className="right">Gel.</th>
                    <th className="right">Δ Gel.</th>
                    <th className="right">Δ Gel. %</th>
                    <th className="right">Intern</th>
                    <th className="right">Δ Intern</th>
                    <th className="right">Δ Intern %</th>
                  </tr>
                </thead>
                <tbody>
                  {buildRows(trend).map((r) => (
                    <tr key={r.ym}>
                      <td>{r.ym}</td>
                      <td className="right">{fmt(r.fakt)}</td>
                      <td className="right">{fmt(r.dFakt)}</td>
                      <td className="right">{pct(r.pFakt)}</td>
                      <td className="right">{fmt(r.gel)}</td>
                      <td className="right">{fmt(r.dGel)}</td>
                      <td className="right">{pct(r.pGel)}</td>
                      <td className="right">{fmt(r.internal)}</td>
                      <td className="right">{fmt(r.dInternal)}</td>
                      <td className="right">{pct(r.pInternal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
      <div style={{ display:'flex', gap:8, marginTop:8 }}>
        <button className="btn" onClick={() => window.print()}>PDF Report</button>
      </div>

      {modal.open && (
        <DrilldownModal onClose={()=>setModal({ open:false, ym:null })} ym={modal.ym} months={months} series={series} />
      )}
    </div>
  )
}

function buildRows(trend) {
  const rows = []
  for (let i=0;i<trend.labels.length;i++) {
    const ym = trend.labels[i]
    const fakt = Number(trend.fakt[i]||0)
    const gel = Number(trend.gel[i]||0)
    const internal = Number(trend.internal[i]||0)
    const prev = i>0 ? { fakt: Number(trend.fakt[i-1]||0), gel: Number(trend.gel[i-1]||0), internal: Number(trend.internal[i-1]||0) } : { fakt: 0, gel: 0, internal: 0 }
    rows.push({
      ym,
      fakt,
      gel,
      internal,
      dFakt: i>0 ? fakt - prev.fakt : 0,
      dGel: i>0 ? gel - prev.gel : 0,
      dInternal: i>0 ? internal - prev.internal : 0,
      pFakt: i>0 && prev.fakt>0 ? ((fakt - prev.fakt)/prev.fakt)*100 : null,
      pGel: i>0 && prev.gel>0 ? ((gel - prev.gel)/prev.gel)*100 : null,
      pInternal: i>0 && prev.internal>0 ? ((internal - prev.internal)/prev.internal)*100 : null,
    })
  }
  return rows
}

function fmt(n){ return (Number(n||0)).toLocaleString('de-DE', { maximumFractionDigits: 2 }) }
function pct(n){ return (n===null || Number.isNaN(n)) ? '—' : `${Number(n).toFixed(1)}%` }

function DrilldownModal({ onClose, ym, months, series }) {
  const monthIdx = series.findIndex(s => s.ym === ym)
  const items = useMemo(() => {
    const raw = series[monthIdx]?.data
    return Array.isArray(raw?.items) ? raw.items : Array.isArray(raw) ? raw : []
  }, [series, monthIdx])

  const topCustomers = useMemo(() => {
    const map = new Map()
    for (const x of items) {
      const key = x?.kunde || 'Unbekannt'
      const f = parseFloat(x?.stunden_fakt)||0
      const g = parseFloat(x?.stunden_gel)||0
      const cur = map.get(key) || { kunde: key, fakt:0, gel:0 }
      cur.fakt += f; cur.gel += g
      map.set(key, cur)
    }
    return Array.from(map.values()).sort((a,b)=>b.gel-a.gel).slice(0,15)
  }, [items])

  const topProjects = useMemo(() => {
    const map = new Map()
    for (const x of items) {
      const key = x?.projektcode || 'Unbekannt'
      const f = parseFloat(x?.stunden_fakt)||0
      const g = parseFloat(x?.stunden_gel)||0
      const cur = map.get(key) || { projekt: key, fakt:0, gel:0 }
      cur.fakt += f; cur.gel += g
      map.set(key, cur)
    }
    return Array.from(map.values()).sort((a,b)=>b.gel-a.gel).slice(0,15)
  }, [items])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <h3 style={{ margin:0 }}>Drilldown {ym}</h3>
          <div style={{ flex:1 }} />
          <button className="btn" onClick={onClose}>Schließen</button>
        </div>
        <div className="grid" style={{ marginTop:12 }}>
          <div>
            <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:8 }}>
              <button className="btn" onClick={() => exportGenericCsv([
                { key:'kunde', label:'Kunde' }, { key:'fakt', label:'Fakt' }, { key:'gel', label:'Gel' }
              ], topCustomers, `drilldown_kunden_${ym}`)}>Export Kunden (CSV)</button>
            </div>
            <div className="table-wrap">
              <table className="table"><thead><tr><th>Kunde</th><th className="right">Fakt.</th><th className="right">Gel.</th></tr></thead>
                <tbody>
                  {topCustomers.map(r => (<tr key={r.kunde}><td>{r.kunde}</td><td className="right">{fmt(r.fakt)}</td><td className="right">{fmt(r.gel)}</td></tr>))}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:8 }}>
              <button className="btn" onClick={() => exportGenericCsv([
                { key:'projekt', label:'Projekt' }, { key:'fakt', label:'Fakt' }, { key:'gel', label:'Gel' }
              ], topProjects, `drilldown_projekte_${ym}`)}>Export Projekte (CSV)</button>
            </div>
            <div className="table-wrap">
              <table className="table"><thead><tr><th>Projekt</th><th className="right">Fakt.</th><th className="right">Gel.</th></tr></thead>
                <tbody>
                  {topProjects.map(r => (<tr key={r.projekt}><td>{r.projekt}</td><td className="right">{fmt(r.fakt)}</td><td className="right">{fmt(r.gel)}</td></tr>))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
