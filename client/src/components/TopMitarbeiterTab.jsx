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

function toNumberDe(v){
  if (v == null) return 0
  if (typeof v === 'number') return v
  const s = String(v).trim()
  if (!s) return 0
  const n = Number(s.replace(/\./g,'').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

export default function TopMitarbeiterTab({ stundenRaw, umsatzRaw, params }){
  const allItems = useMemo(() => Array.isArray(stundenRaw?.items) ? stundenRaw.items : (Array.isArray(stundenRaw) ? stundenRaw : []), [stundenRaw])
  const umsatzItemsRaw = useMemo(() => Array.isArray(umsatzRaw?.items) ? umsatzRaw.items : (Array.isArray(umsatzRaw) ? umsatzRaw : []), [umsatzRaw])

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

  // Umsätze: normalisieren, Zeitraum filtern, interne Projekte ausschließen
  const umsatzItems = useMemo(() => {
    const norm = (umsatzItemsRaw||[]).map((it)=>{
      const out = {}
      for (const [k,v] of Object.entries(it||{})) out[String(k).toLowerCase()] = v
      if (out.projekt == null && out.projektcode != null) out.projekt = out.projektcode
      if (out.projektcode == null && out.projekt != null) out.projektcode = out.projekt
      if (out.umsatz == null && out.umsatz_tatsaechlich != null) out.umsatz = out.umsatz_tatsaechlich
      if (out.umsatz_tatsaechlich == null && out.umsatz != null) out.umsatz_tatsaechlich = out.umsatz
      return out
    })
    return norm.filter((x)=>{
      const d = x?.datum || x?.datum_bis || x?.datum_von || x?.date
      if (!d || !inRange(d)) return false
      if (isInternal(x, mapping)) return false
      return true
    })
  }, [umsatzItemsRaw, mapping, useYtd, params?.datum_von, params?.datum_bis])

  // Umsatz-Metrik wählen
  const umsatzMetric = useMemo(() => {
    const hasT = umsatzItems.some(x => x?.umsatz_tatsaechlich != null)
    const hasK = umsatzItems.some(x => Object.prototype.hasOwnProperty.call(x,'umsatz_kalk'))
    if (hasT) return 'umsatz_tatsaechlich'
    if (hasK) return 'umsatz_kalk'
    return 'umsatz'
  }, [umsatzItems])

  // Aggregation nach Mitarbeiter (Stunden fakturiert/geleistet)
  const hoursByEmp = useMemo(() => {
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

  // Umsatz auf Mitarbeiter verteilen: auf Projektebene proportional zur fakturierten Stundenverteilung
  const revenueByEmp = useMemo(() => {
    // Vorbereitung: Stunden je Projekt und je (Emp,Projekt)
    const projTotalF = new Map() // projektcode -> total fakt Stunden
    const empProjF = new Map()   // `${emp}@@${proj}` -> fakt Stunden
    for (const x of items) {
      const emp = x?.mitarbeiter || 'Unbekannt'
      const proj = x?.projektcode || 'Unbekannt'
      const f = parseFloat(x?.stunden_fakt)
      const fv = Number.isNaN(f) ? 0 : f
      projTotalF.set(proj, (projTotalF.get(proj)||0) + fv)
      const key = `${emp}@@${proj}`
      empProjF.set(key, (empProjF.get(key)||0) + fv)
    }

    // Umsätze je Projekt
    const projRevenue = new Map() // projektcode -> revenue
    for (const u of umsatzItems) {
      const proj = u?.projektcode || u?.projekt || 'Unbekannt'
      const val = toNumberDe(u?.[umsatzMetric])
      projRevenue.set(proj, (projRevenue.get(proj)||0) + val)
    }

    // Allokation auf Mitarbeiter
    const empMap = new Map() // mitarbeiter -> revenue
    let sumRevenue = 0
    for (const [proj, rev] of projRevenue.entries()) {
      const totalF = projTotalF.get(proj) || 0
      if (totalF <= 0) continue
      // finde alle Mitarbeiter auf dem Projekt
      const keys = Array.from(empProjF.keys()).filter(k => k.endsWith(`@@${proj}`))
      for (const key of keys) {
        const emp = key.split('@@')[0]
        const empF = empProjF.get(key) || 0
        const share = empF / totalF
        const allocated = rev * share
        empMap.set(emp, (empMap.get(emp)||0) + allocated)
        sumRevenue += allocated
      }
    }
    const arr = Array.from(empMap.entries()).map(([mitarbeiter, umsatz]) => ({ mitarbeiter, umsatz }))
    arr.sort((a,b)=> (b.umsatz||0) - (a.umsatz||0))
    return { arr, sumRevenue }
  }, [items, umsatzItems, umsatzMetric])

  const [mode, setMode] = useState('hours') // 'hours' | 'revenue'
  const topN = 15
  const topHours = hoursByEmp.arr.slice(0, topN)
  const topRevenue = revenueByEmp.arr.slice(0, topN)

  // Lookup-Maps für schnelle Tabellen-Zugriffe
  const revenueLookup = useMemo(() => {
    const m = new Map()
    for (const r of revenueByEmp.arr) m.set(r.mitarbeiter, r.umsatz)
    return m
  }, [revenueByEmp.arr])
  const hoursLookup = useMemo(() => {
    const m = new Map()
    for (const r of hoursByEmp.arr) m.set(r.mitarbeiter, r)
    return m
  }, [hoursByEmp.arr])

  const barData = useMemo(() => {
    if (mode === 'revenue') {
      return {
        labels: topRevenue.map(r=>r.mitarbeiter),
        datasets: [
          { label: `Umsatz (${umsatzMetric})`, data: topRevenue.map(r=>r.umsatz), backgroundColor: 'rgba(34,197,94,0.8)', borderRadius: 6 },
        ]
      }
    }
    return {
      labels: topHours.map(r=>r.mitarbeiter),
      datasets: [
        { label: 'Stunden fakturiert', data: topHours.map(r=>r.fakt), backgroundColor: 'rgba(34,197,94,0.8)', borderRadius: 6 },
        { label: 'Stunden geleistet', data: topHours.map(r=>r.gel), backgroundColor: 'rgba(99,102,241,0.35)', borderRadius: 6 },
      ]
    }
  }, [mode, topHours, topRevenue, umsatzMetric])

  // Optional: Anteil Top vs Rest (fakturiert)
  const donutData = useMemo(() => {
    if (mode === 'revenue') {
      const topSum = topRevenue.reduce((a,x)=>a+Number(x.umsatz||0),0)
      const rest = Math.max(0, (revenueByEmp.sumRevenue||0) - topSum)
      return { labels: ['Top '+topRevenue.length, 'Rest'], datasets: [{ data:[topSum,rest], backgroundColor:['#22c55e','#e5e7eb'] }] }
    }
    const topSum = topHours.reduce((a,x)=>a+Number(x.fakt||0),0)
    const rest = Math.max(0, (hoursByEmp.sumF||0) - topSum)
    return { labels: ['Top '+topHours.length, 'Rest'], datasets: [{ data:[topSum,rest], backgroundColor:['#22c55e','#e5e7eb'] }] }
  }, [mode, topHours, topRevenue, revenueByEmp.sumRevenue, hoursByEmp.sumF])

  return (
    <div>
      <div className="panel" style={{ padding: 12 }}>
        <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', marginBottom:8 }}>
          <h3 style={{ margin: 0 }}>Top-Mitarbeiter</h3>
          <div style={{ flex:1 }} />
          <label style={{ color:'var(--muted)', fontSize:12 }}>Anzeige</label>
          <select className="input" value={mode} onChange={(e)=>setMode(e.target.value)}>
            <option value="hours">Stunden</option>
            <option value="revenue">Umsatz</option>
          </select>
          {mode==='revenue' && (
            <>
              <label style={{ color:'var(--muted)', fontSize:12 }}>Metrik</label>
              <select className="input" value={umsatzMetric} onChange={()=>{ /* metric is derived from data; keep immutable for now */ }} disabled>
                <option value={umsatzMetric}>{umsatzMetric}</option>
              </select>
            </>
          )}
          <label style={{ color:'var(--muted)', fontSize:12 }}>
            <input type="checkbox" checked={useYtd} onChange={(e)=>setUseYtd(e.target.checked)} style={{ marginRight: 6 }} /> Laufendes Jahr (YTD)
          </label>
          <button className="btn" onClick={() => exportGenericCsv(
            [
              { key:'mitarbeiter', label:'Mitarbeiter' },
              ...(mode==='revenue' ? [ { key:'umsatz', label:`${umsatzMetric}` } ] : [ { key:'fakt', label:'Stunden_fakt' }, { key:'gel', label:'Stunden_gel' } ]),
            ],
            mode==='revenue' ? revenueByEmp.arr : hoursByEmp.arr,
            'top_mitarbeiter'
          )}>Export CSV</button>
        </div>

        <div className="kpi-grid">
          {mode==='revenue' ? (
            <>
              <div className="panel kpi-card"><div className="kpi-title">Summe Umsatz</div><div className="kpi-value">{`${fmt(revenueByEmp.sumRevenue)} €`}</div></div>
              <div className="panel kpi-card"><div className="kpi-title">Top 1</div><div className="kpi-value">{topRevenue[0]? `${topRevenue[0].mitarbeiter} · ${fmt(topRevenue[0].umsatz)} €` : '—'}</div></div>
              <div className="panel kpi-card"><div className="kpi-title">Anzahl Mitarbeiter</div><div className="kpi-value">{fmt(revenueByEmp.arr.length)}</div></div>
              <div className="panel kpi-card"><div className="kpi-title">Metrik</div><div className="kpi-value">{umsatzMetric}</div></div>
            </>
          ) : (
            <>
              <div className="panel kpi-card"><div className="kpi-title">Summe fakturiert</div><div className="kpi-value">{`${fmt(hoursByEmp.sumF)} h`}</div></div>
              <div className="panel kpi-card"><div className="kpi-title">Summe geleistet</div><div className="kpi-value">{`${fmt(hoursByEmp.sumG)} h`}</div></div>
              <div className="panel kpi-card"><div className="kpi-title">Top 1</div><div className="kpi-value">{topHours[0]? `${topHours[0].mitarbeiter} · ${fmt(topHours[0].fakt)} h` : '—'}</div></div>
              <div className="panel kpi-card"><div className="kpi-title">Anzahl Mitarbeiter</div><div className="kpi-value">{fmt(hoursByEmp.arr.length)}</div></div>
            </>
          )}
        </div>

        <div className="grid">
          <div>
            <div className="chart-lg">
              <Bar data={barData} options={{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'top' }, title:{ display:true, text: mode==='revenue' ? `Top ${topN} nach Umsatz (${umsatzMetric})` : `Top ${topN} nach fakturierten Stunden` } }, scales:{ y:{ beginAtZero:true } } }} />
            </div>
          </div>
          <div>
            <div className="chart">
              <Doughnut data={donutData} options={{ maintainAspectRatio:false, plugins:{ legend:{ position:'right' }, title:{ display:true, text: mode==='revenue' ? 'Top vs. Rest (Umsatz)' : 'Top vs. Rest (Fakt)' } } }} />
            </div>
          </div>
        </div>

        <div style={{ height:12 }} />
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Mitarbeiter</th>
                <th className="right">Umsatz ({umsatzMetric})</th>
                <th className="right">Stunden fakturiert</th>
                <th className="right">Stunden geleistet</th>
                <th className="right">Quote F/G</th>
              </tr>
            </thead>
            <tbody>
              {(mode==='revenue' ? revenueByEmp.arr : hoursByEmp.arr).map((r)=> {
                const emp = r.mitarbeiter
                const umsatz = mode==='revenue' ? (r.umsatz||0) : (revenueLookup.get(emp)||0)
                const h = mode==='revenue' ? (hoursLookup.get(emp) || { fakt:0, gel:0 }) : r
                const quote = h.gel>0 ? ((h.fakt/h.gel)*100).toFixed(1)+"%" : '—'
                return (
                  <tr key={emp}>
                    <td>{emp}</td>
                    <td className="right">{fmt(umsatz)}</td>
                    <td className="right">{fmt(h.fakt||0)}</td>
                    <td className="right">{fmt(h.gel||0)}</td>
                    <td className="right">{quote}</td>
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
