import React, { useMemo, useState } from 'react'
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

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Title, Tooltip, Legend)

function fmt(n){ return (Number(n||0)).toLocaleString('de-DE', { maximumFractionDigits: 2 }) }

export default function UmsatzTab({ umsatzRaw, params }) {
  const items = useMemo(() => Array.isArray(umsatzRaw?.items) ? umsatzRaw.items : (Array.isArray(umsatzRaw) ? umsatzRaw : []), [umsatzRaw])

  // Heuristik: numerische Felder automatisch erkennen
  const numericFields = useMemo(() => {
    const HIDE = new Set(['kunde_id','status','projekttyp','projektart','leiart_id'])
    const sample = items.slice(0, 50)
    const counters = {}
    for (const it of sample) {
      for (const [k,v] of Object.entries(it||{})) {
        if (HIDE.has(k)) continue
        const n = parseFloat(v)
        if (!Number.isNaN(n)) counters[k] = (counters[k]||0) + 1
      }
    }
    const arr = Object.keys(counters).filter(k => counters[k] >= Math.max(1, Math.floor(sample.length*0.5)))
    // Force-include prioritized fields if present in data
    const hasUmsatzT = items.some(it => it && Object.prototype.hasOwnProperty.call(it,'umsatz_tatsaechlich'))
    const hasUmsatzK = items.some(it => it && Object.prototype.hasOwnProperty.call(it,'umsatz_kalk'))
    if (hasUmsatzT && !arr.includes('umsatz_tatsaechlich')) arr.push('umsatz_tatsaechlich')
    if (hasUmsatzK && !arr.includes('umsatz_kalk')) arr.push('umsatz_kalk')
    // Prioritize: umsatz_tatsaechlich, then umsatz_kalk, then rest
    arr.sort((a,b)=> {
      const pri = (x)=> x==='umsatz_tatsaechlich'?0 : x==='umsatz_kalk'?1 : 2
      return pri(a)-pri(b)
    })
    return arr
  }, [items])

  // Dimensionen, die wir erwarten
  const dimKunde = 'kunde'
  const dimProjekt = 'projektcode'

  // Aggregation nach Kunde
  const byCustomer = useMemo(() => {
    const map = new Map()
    for (const it of items) {
      const key = it?.[dimKunde] || 'Unbekannt'
      const cur = map.get(key) || { kunde: key }
      for (const f of numericFields) {
        const v = parseFloat(it?.[f])
        cur[f] = (cur[f]||0) + (Number.isNaN(v) ? 0 : v)
      }
      map.set(key, cur)
    }
    return Array.from(map.values())
  }, [items, numericFields])

  // Metrik wählen
  const [metric, setMetric] = useState(() => (numericFields.includes('umsatz_tatsaechlich') ? 'umsatz_tatsaechlich' : (numericFields[0] || null)))
  const topN = 15

  const topCustomers = useMemo(() => {
    if (!metric) return []
    return byCustomer.slice().sort((a,b)=> Number(b[metric]||0) - Number(a[metric]||0)).slice(0, topN)
  }, [byCustomer, metric])

  const barData = useMemo(() => ({
    labels: topCustomers.map(x => x.kunde),
    datasets: [{ label: metric || 'Wert', data: topCustomers.map(x => Number(x[metric]||0)), backgroundColor: 'rgba(34,197,94,0.7)', borderRadius: 6 }]
  }), [topCustomers, metric])

  // Doughnut: vergleiche gel_std mit fakt_std (falls vorhanden), sonst fallback: erste 2 numerische Felder
  const doughnutData = useMemo(() => {
    const hasGel = items.some(it => it && it.hasOwnProperty('gel_std'))
    const hasFakt = items.some(it => it && it.hasOwnProperty('fakt_std'))
    if (hasGel || hasFakt) {
      let sumGel = 0, sumFakt = 0
      for (const it of items) {
        const g = parseFloat(it?.gel_std); if(!Number.isNaN(g)) sumGel += g
        const f = parseFloat(it?.fakt_std); if(!Number.isNaN(f)) sumFakt += f
      }
      return {
        labels: ['Std. geleistet (gel_std)', 'Std. fakturiert (fakt_std)'],
        datasets: [{ data: [sumGel, sumFakt], backgroundColor: ['#60a5fa', '#22c55e'] }]
      }
    }
    // fallback
    const fields = numericFields.slice(0,2)
    const sums = fields.map(() => 0)
    for (const it of items) fields.forEach((f,idx) => { const v=parseFloat(it?.[f]); if(!Number.isNaN(v)) sums[idx]+=v })
    return { labels: fields, datasets: [{ data: sums, backgroundColor: ['#22c55e','#60a5fa','#eab308'] }] }
  }, [items, numericFields])

  // KPIs: Summe je Feld
  const kpis = useMemo(() => {
    const out = {}
    for (const f of numericFields) out[f] = 0
    for (const it of items) for (const f of numericFields) { const v=parseFloat(it?.[f]); if(!Number.isNaN(v)) out[f]+=v }
    return out
  }, [items, numericFields])

  // Tabellenansicht
  const tableRows = useMemo(() => byCustomer.slice().sort((a,b)=> (Number(b[metric]||0) - Number(a[metric]||0))), [byCustomer, metric])

  return (
    <div>
      <div className="panel" style={{ padding: 12 }}>
        <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', marginBottom:8 }}>
          <label style={{ color:'var(--muted)', fontSize:12 }}>Metrik</label>
          <select className="input" value={metric || ''} onChange={(e)=>setMetric(e.target.value)}>
            {numericFields.map(f => (<option key={f} value={f}>{f}</option>))}
          </select>
          <div style={{ flex:1 }} />
          <button className="btn" onClick={() => exportGenericCsv(
            [{key:'kunde',label:'Kunde'}, ...numericFields.map(f=>({key:f,label:f}))],
            byCustomer,
            'umsatzliste_kunden'
          )}>Export Kunden (CSV)</button>
        </div>

        <div className="kpi-grid">
          {/* Pinned KPIs for Umsatz */}
          {numericFields.includes('umsatz_tatsaechlich') && (
            <div className="panel kpi-card"><div className="kpi-title">umsatz_tatsaechlich</div><div className="kpi-value">{fmt(kpis['umsatz_tatsaechlich'])}</div></div>
          )}
          {numericFields.includes('umsatz_kalk') && (
            <div className="panel kpi-card"><div className="kpi-title">umsatz_kalk</div><div className="kpi-value">{fmt(kpis['umsatz_kalk'])}</div></div>
          )}
          {numericFields.filter(f=> f!=='umsatz_tatsaechlich' && f!=='umsatz_kalk').slice(0, 4 - (numericFields.includes('umsatz_tatsaechlich')?1:0) - (numericFields.includes('umsatz_kalk')?1:0)).map((f)=> (
            <div key={f} className="panel kpi-card">
              <div className="kpi-title">{f}</div>
              <div className="kpi-value">{fmt(kpis[f])}</div>
            </div>
          ))}
        </div>

        <div className="grid">
          <div>
            <div className="chart-lg">
              <Bar data={barData} options={{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'top' }, title:{ display:true, text:`Top ${topN} Kunden – ${metric}` } }, scales:{ y:{ beginAtZero:true } } }} />
            </div>
          </div>
          <div>
            <div className="chart">
              <Doughnut data={doughnutData} options={{ maintainAspectRatio:false, plugins:{ legend:{ position:'right' }, title:{ display:true, text:'Summen Verhältnis' } } }} />
            </div>
          </div>
        </div>

        <div style={{ height: 12 }} />
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Kunde</th>
                {numericFields.map((f)=> (<th key={f} className="right">{f}</th>))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((r)=> (
                <tr key={r.kunde}>
                  <td>{r.kunde}</td>
                  {numericFields.map((f)=> (<td key={f} className="right">{fmt(r[f])}</td>))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
