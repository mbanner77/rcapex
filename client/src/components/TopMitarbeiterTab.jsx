import React, { useEffect, useMemo, useState } from 'react'
import { Bar, Doughnut } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js'
import { exportGenericCsv } from '../lib/export'
import { getInternalMapping } from '../lib/mapping'
import { isInternalProject, isExcludedByLeistungsart } from '../shared/internal.js'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Title, Tooltip, Legend)

function fmt(n){ return (Number(n||0)).toLocaleString('de-DE', { maximumFractionDigits: 2 }) }

function isInternal(x, mapping){
  if (isExcludedByLeistungsart(x)) return false
  return isInternalProject(x, mapping)
}

export default function TopMitarbeiterTab({ stundenRaw, params }){
  const allItems = useMemo(() => Array.isArray(stundenRaw?.items) ? stundenRaw.items : (Array.isArray(stundenRaw) ? stundenRaw : []), [stundenRaw])

  const [mapping, setMapping] = useState(() => getInternalMapping())
  useEffect(() => {
    const onMap = () => setMapping(getInternalMapping())
    window.addEventListener('internal_mapping_changed', onMap)
    return () => window.removeEventListener('internal_mapping_changed', onMap)
  }, [])

  // Zeitraum: laufendes Jahr (YTD)
  const [useYtd, setUseYtd] = useState(true)
  const ytdRange = useMemo(() => {
    const now = new Date()
    const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1, 0, 0, 0))
    const end = now
    return { from: start, to: end }
  }, [])

  function inRange(d){
    const dt = new Date(d)
    if (isNaN(dt)) return false
    if (useYtd) return dt >= ytdRange.from && dt <= ytdRange.to
    // Use current filters from params
    const from = params?.datum_von ? new Date(params.datum_von) : null
    const to = params?.datum_bis ? new Date(params.datum_bis) : null
    if (from && dt < from) return false
    if (to && dt > to) return false
    return true
  }

  // Filter: exclude interne Projekte gemäß Mapping; Zeitraum = YTD (default)
  const items = useMemo(() => {
    return (allItems||[]).filter(x => {
      const d = x?.datum || x?.datum_bis || x?.datum_von || x?.date
      if (!d || !inRange(d)) return false
      // exclude internal
      if (isInternal(x, mapping)) return false
      return true
    })
  }, [allItems, mapping, useYtd, params?.datum_von, params?.datum_bis])

  // Aggregation nach Mitarbeiter (fakturiert)
  const empTotals = useMemo(() => {
    const map = new Map()
    let sumF = 0, sumG = 0
    for (const x of items) {
      const emp = x?.mitarbeiter || 'Unbekannt'
      const f = parseFloat(x?.stunden_fakt)
      const g = parseFloat(x?.stunden_gel)
      const cur = map.get(emp) || { mitarbeiter: emp, fakt: 0, gel: 0 }
      cur.fakt += Number.isNaN(f) ? 0 : f
      cur.gel += Number.isNaN(g) ? 0 : g
      map.set(emp, cur)
      sumF += Number.isNaN(f) ? 0 : f
      sumG += Number.isNaN(g) ? 0 : g
    }
    const arr = Array.from(map.values())
    arr.sort((a,b)=> (b.fakt||0) - (a.fakt||0))
    return { arr, sumF, sumG }
  }, [items])

  const topN = 15
  const top = empTotals.arr.slice(0, topN)

  const barData = useMemo(() => ({
    labels: top.map(r=>r.mitarbeiter),
    datasets: [
      { label: 'Stunden fakturiert', data: top.map(r=>r.fakt), backgroundColor: 'rgba(34,197,94,0.8)', borderRadius: 6 },
      { label: 'Stunden geleistet', data: top.map(r=>r.gel), backgroundColor: 'rgba(99,102,241,0.35)', borderRadius: 6 },
    ]
  }), [top])

  // Optional: Anteil Top vs Rest (fakturiert)
  const donutData = useMemo(() => {
    const topSum = top.reduce((a,x)=>a+Number(x.fakt||0),0)
    const rest = Math.max(0, (empTotals.sumF||0) - topSum)
    return {
      labels: ['Top '+top.length, 'Rest'],
      datasets: [{ data: [topSum, rest], backgroundColor: ['#22c55e', '#e5e7eb'] }]
    }
  }, [top, empTotals.sumF])

  return (
    <div>
      <div className="panel" style={{ padding: 12 }}>
        <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', marginBottom:8 }}>
          <h3 style={{ margin: 0 }}>Top-Mitarbeiter</h3>
          <div style={{ flex:1 }} />
          <label style={{ color:'var(--muted)', fontSize:12 }}>
            <input type="checkbox" checked={useYtd} onChange={(e)=>setUseYtd(e.target.checked)} style={{ marginRight: 6 }} /> Laufendes Jahr (YTD)
          </label>
          <button className="btn" onClick={() => exportGenericCsv(
            [
              { key:'mitarbeiter', label:'Mitarbeiter' },
              { key:'fakt', label:'Stunden_fakt' },
              { key:'gel', label:'Stunden_gel' },
            ],
            empTotals.arr,
            'top_mitarbeiter'
          )}>Export CSV</button>
        </div>

        <div className="kpi-grid">
          <div className="panel kpi-card"><div className="kpi-title">Summe fakturiert</div><div className="kpi-value">{`${fmt(empTotals.sumF)} h`}</div></div>
          <div className="panel kpi-card"><div className="kpi-title">Summe geleistet</div><div className="kpi-value">{`${fmt(empTotals.sumG)} h`}</div></div>
          <div className="panel kpi-card"><div className="kpi-title">Top 1</div><div className="kpi-value">{top[0]? `${top[0].mitarbeiter} · ${fmt(top[0].fakt)} h` : '—'}</div></div>
          <div className="panel kpi-card"><div className="kpi-title">Anzahl Mitarbeiter</div><div className="kpi-value">{fmt(empTotals.arr.length)}</div></div>
        </div>

        <div className="grid">
          <div>
            <div className="chart-lg">
              <Bar data={barData} options={{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'top' }, title:{ display:true, text:`Top ${topN} nach fakturierten Stunden` } }, scales:{ y:{ beginAtZero:true } } }} />
            </div>
          </div>
          <div>
            <div className="chart">
              <Doughnut data={donutData} options={{ maintainAspectRatio:false, plugins:{ legend:{ position:'right' }, title:{ display:true, text:'Top vs. Rest (Fakt)' } } }} />
            </div>
          </div>
        </div>

        <div style={{ height:12 }} />
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Mitarbeiter</th>
                <th className="right">Stunden fakturiert</th>
                <th className="right">Stunden geleistet</th>
                <th className="right">Quote F/G</th>
              </tr>
            </thead>
            <tbody>
              {empTotals.arr.map((r)=> (
                <tr key={r.mitarbeiter}>
                  <td>{r.mitarbeiter}</td>
                  <td className="right">{fmt(r.fakt)}</td>
                  <td className="right">{fmt(r.gel)}</td>
                  <td className="right">{r.gel>0? `${((r.fakt/r.gel)*100).toFixed(1)}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
