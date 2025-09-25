import React, { useMemo, useState } from 'react'
import { Bar, Line, Doughnut } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js'
import {
  groupByEmployeeMonthly,
  extractMonths,
} from '../lib/transform'

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, ArcElement, Title, Tooltip, Legend)

export default function EmployeeTab({ stundenRaw, params }) {
  const items = useMemo(() => stundenRaw?.items || stundenRaw || [], [stundenRaw])
  const [metric, setMetric] = useState('stunden_fakt') // 'stunden_fakt' | 'stunden_gel'
  const [employee, setEmployee] = useState('')
  const [stacked, setStacked] = useState(false)
  const [expectedPerDay, setExpectedPerDay] = useState(8)
  const [underWarn, setUnderWarn] = useState(8) // hours
  const [underBad, setUnderBad] = useState(16)
  const [unbilledWarnPct, setUnbilledWarnPct] = useState(20) // percent
  const [unbilledBadPct, setUnbilledBadPct] = useState(40)

  const employees = useMemo(() => {
    const set = new Set()
    for (const x of items) if (x?.mitarbeiter) set.add(x.mitarbeiter)
    return Array.from(set).sort()
  }, [items])

  // Filter items by selected employee (if selected)
  const empItems = useMemo(() => employee ? items.filter((x) => x?.mitarbeiter === employee) : items, [items, employee])

  const kpis = useMemo(() => {
    let sf = 0, sg = 0
    for (const x of empItems) {
      const a = parseFloat(x?.stunden_fakt); const b = parseFloat(x?.stunden_gel)
      sf += Number.isNaN(a) ? 0 : a
      sg += Number.isNaN(b) ? 0 : b
    }
    return { sf, sg }
  }, [empItems])

  
function isInternal(x) {
  const code = String(x?.projektcode || '').toUpperCase()
  const name = String(x?.projektname || '').toUpperCase()
  return code.startsWith('INT') || name.startsWith('INT')
}

function InternalVsBilled({ items }) {
  // Für jeden Mitarbeiter: Interne geleistete Stunden (Projekt enthält 'INT') vs. gesamte fakturierte Stunden
  const rows = useMemo(() => {
    const mapInternal = new Map()
    const mapBilled = new Map()
    for (const x of items || []) {
      const emp = x?.mitarbeiter || 'Unbekannt'
      const g = parseFloat(x?.stunden_gel)
      const f = parseFloat(x?.stunden_fakt)
      if (isInternal(x)) {
        mapInternal.set(emp, (mapInternal.get(emp) || 0) + (Number.isNaN(g)?0:g))
      }
      mapBilled.set(emp, (mapBilled.get(emp) || 0) + (Number.isNaN(f)?0:f))
    }
    const out = Array.from(new Set([...mapInternal.keys(), ...mapBilled.keys()])).map((emp) => {
      const internal = Number(mapInternal.get(emp) || 0)
      const billed = Number(mapBilled.get(emp) || 0)
      return { mitarbeiter: emp, internal, billed, diff: internal - billed }
    })
    out.sort((a,b)=> (b.diff||0) - (a.diff||0))
    return out
  }, [items])

  const top = rows.slice(0, 15)
  const chart = useMemo(() => ({
    labels: top.map(r=>r.mitarbeiter),
    datasets: [
      { label: 'Intern (geleistet)', data: top.map(r=>r.internal), backgroundColor: 'rgba(234,179,8,0.7)', borderRadius: 6 },
      { label: 'Fakturiert (gesamt)', data: top.map(r=>r.billed), backgroundColor: 'rgba(34,197,94,0.7)', borderRadius: 6 },
      { label: 'Differenz (Intern − Fakturiert)', data: top.map(r=>r.diff), backgroundColor: 'rgba(248,113,113,0.7)', borderRadius: 6 },
    ]
  }), [rows])

  return (
    <div>
      <h4 style={{ margin: '12px 0 8px' }}>Interne Leistungen vs. Fakturierung (Top 15 nach Differenz)</h4>
      <div style={{ height: 320 }}>
        <Bar data={chart} options={{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'top' } }, scales:{ y:{ beginAtZero:true } } }} />
      </div>
      <div className="table-wrap" style={{ marginTop: 8 }}>
        <table className="table">
          <thead><tr><th>Mitarbeiter</th><th className="right">Intern (h)</th><th className="right">Fakturiert (h)</th><th className="right">Differenz (h)</th></tr></thead>
          <tbody>
            {top.map((r)=> (
              <tr key={r.mitarbeiter}>
                <td>{r.mitarbeiter}</td>
                <td className="right">{fmt(r.internal)}</td>
                <td className="right">{fmt(r.billed)}</td>
                <td className="right">{fmt(r.diff)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <small style={{ color: 'var(--muted)' }}>Definition „intern“: Projektcode/-name enthält „INT“.</small>
    </div>
  )
}

  // Monthly series for the selected employee (or all if none selected)
  const monthly = useMemo(() => groupByEmployeeMonthly(items, metric, null, null), [items, metric])
  const months = monthly.months
  const chosenSeries = useMemo(() => {
    if (!employee) {
      // aggregate all employees into one series for overview
      const totals = new Map(months.map((m)=>[m,0]))
      for (const m of monthly.perEmployee.values()) {
        for (const [key, val] of m.entries()) totals.set(key, (totals.get(key) || 0) + Number(val||0))
      }
      return [{ label: 'Alle Mitarbeiter', data: months.map((m)=>Number(totals.get(m)||0)) }]
    }
    const map = monthly.perEmployee.get(employee) || new Map(months.map((m)=>[m,0]))
    return [{ label: employee, data: months.map((m)=>Number(map.get(m)||0)) }]
  }, [monthly, months, employee])

  const lineData = useMemo(() => {
    const color = '#60a5fa'
    return {
      labels: months,
      datasets: chosenSeries.map((s) => ({
        label: s.label,
        data: s.data,
        borderColor: color,
        backgroundColor: color,
        tension: 0.2,
      }))
    }
  }, [months, chosenSeries])

  const lineOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'top' }, title: { display: true, text: `Zeitverlauf – ${metric === 'stunden_fakt' ? 'fakturiert' : 'geleistet'}${employee ? ` · ${employee}` : ''}` } },
    interaction: { mode: 'nearest', intersect: false },
    scales: { x: { stacked }, y: { beginAtZero: true, stacked } },
  }

  // Top Kunden und Projekte für ausgewählten Mitarbeiter
  const topCustomers = useMemo(() => {
    const map = new Map()
    for (const x of empItems) {
      const key = x?.kunde || 'Unbekannt'
      const v = parseFloat(x?.[metric])
      map.set(key, (map.get(key) || 0) + (Number.isNaN(v)?0:v))
    }
    const arr = Array.from(map.entries()).map(([label, value]) => ({ label, value }))
    arr.sort((a,b)=>b.value-a.value)
    return arr.slice(0, 15)
  }, [empItems, metric])

  const topProjects = useMemo(() => {
    const map = new Map()
    for (const x of empItems) {
      const key = x?.projektcode || 'Unbekannt'
      const v = parseFloat(x?.[metric])
      map.set(key, (map.get(key) || 0) + (Number.isNaN(v)?0:v))
    }
    const arr = Array.from(map.entries()).map(([label, value]) => ({ label, value }))
    arr.sort((a,b)=>b.value-a.value)
    return arr.slice(0, 15)
  }, [empItems, metric])

  const customersBar = useMemo(() => ({
    labels: topCustomers.map(c=>c.label),
    datasets: [{ label: metric==='stunden_fakt'?'Fakturiert':'Geleistet', data: topCustomers.map(c=>c.value), backgroundColor: 'rgba(34,197,94,0.7)', borderRadius: 6 }]
  }), [topCustomers, metric])

  const projectsBar = useMemo(() => ({
    labels: topProjects.map(c=>c.label),
    datasets: [{ label: metric==='stunden_fakt'?'Fakturiert':'Geleistet', data: topProjects.map(c=>c.value), backgroundColor: 'rgba(99,102,241,0.7)', borderRadius: 6 }]
  }), [topProjects, metric])

  // Verteilung Kunde (Top 10 + Andere)
  const custTop10 = topCustomers.slice(0,10)
  const custOthers = topCustomers.slice(10).reduce((a,x)=>a+x.value,0)
  const customerDonut = useMemo(() => ({
    labels: [...custTop10.map(x=>x.label), 'Andere'],
    datasets: [{ data: [...custTop10.map(x=>x.value), custOthers], backgroundColor: ['#60a5fa','#34d399','#fbbf24','#f472b6','#a78bfa','#4ade80','#f87171','#22d3ee','#c084fc','#facc15','#64748b'] }]
  }), [custTop10, custOthers])

  return (
    <div className="grid">
      <div className="panel" style={{ padding: 12 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
          <label style={{ color: 'var(--muted)', fontSize: 12 }}>Mitarbeiter</label>
          <select className="input" value={employee} onChange={(e)=>setEmployee(e.target.value)}>
            <option value="">Alle</option>
            {employees.map((m)=>(<option key={m} value={m}>{m}</option>))}
          </select>
          <label style={{ color: 'var(--muted)', fontSize: 12 }}>Metrik</label>
          <select className="input" value={metric} onChange={(e)=>setMetric(e.target.value)}>
            <option value="stunden_fakt">Stunden fakturiert</option>
            <option value="stunden_gel">Stunden geleistet</option>
          </select>
          <label style={{ color: 'var(--muted)', fontSize: 12 }}>
            <input type="checkbox" checked={stacked} onChange={(e)=>setStacked(e.target.checked)} style={{ marginRight: 6 }} /> gestapelt
          </label>
          <label style={{ color: 'var(--muted)', fontSize: 12 }}>Soll (h/Arbeitstag)</label>
          <input className="input" type="number" min="0" max="12" value={expectedPerDay} onChange={(e)=>setExpectedPerDay(Number(e.target.value))} style={{ width: 100 }} />
        </div>

        <div className="kpi-grid">
          <div className="panel kpi-card"><div className="kpi-title">Summe fakturiert</div><div className="kpi-value">{`${fmt(kpis.sf)} h`}</div></div>
          <div className="panel kpi-card"><div className="kpi-title">Summe geleistet</div><div className="kpi-value">{`${fmt(kpis.sg)} h`}</div></div>
          <div className="panel kpi-card"><div className="kpi-title">Quote Fakt/Gel</div><div className="kpi-value">{kpis.sg>0? `${((kpis.sf/kpis.sg)*100).toFixed(1)}%` : '—'}</div></div>
          <div className="panel kpi-card"><div className="kpi-title">Interner Anteil</div><div className="kpi-value">{(() => {
            let gi=0, g=0; for (const x of empItems){ const val=parseFloat(x?.stunden_gel)||0; g+=val; if(isInternal(x)) gi+=val } return g>0? `${((gi/g)*100).toFixed(1)}%`:'—' })()}</div></div>
        </div>

        <div className="chart-lg">
          <Line data={lineData} options={lineOptions} />
        </div>
      </div>

      <div className="panel" style={{ padding: 12 }}>
        <div className="chart">
          <Bar data={customersBar} options={{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'top' }, title:{ display:true, text:'Top 15 Kunden' } }, scales:{ y:{ beginAtZero:true } } }} />
        </div>
        <div style={{ height: 12 }} />
        <div className="chart">
          <Bar data={projectsBar} options={{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'top' }, title:{ display:true, text:'Top 15 Projekte' } }, scales:{ y:{ beginAtZero:true } } }} />
        </div>
        <div style={{ height: 12 }} />
        <div className="chart-sm">
          <Doughnut data={customerDonut} options={{ plugins:{ legend:{ position:'right' }, title:{ display:true, text:'Kundenverteilung (Top 10 + Andere)' } }, maintainAspectRatio:false }} />
        </div>
      </div>

      <div className="panel" style={{ padding: 12 }}>
        <h3 style={{ marginTop: 0 }}>Soll/Ist & Unbilled-Analyse</h3>
        <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', marginBottom:8 }}>
          <label style={{ color:'var(--muted)', fontSize:12 }}>Untererfassung Warn (h)</label>
          <input className="input" type="number" min="0" value={underWarn} onChange={(e)=>setUnderWarn(Number(e.target.value))} style={{ width:90 }} />
          <label style={{ color:'var(--muted)', fontSize:12 }}>Untererfassung Schlecht (h)</label>
          <input className="input" type="number" min="0" value={underBad} onChange={(e)=>setUnderBad(Number(e.target.value))} style={{ width:90 }} />
          <label style={{ color:'var(--muted)', fontSize:12 }}>Unbilled Warn (%)</label>
          <input className="input" type="number" min="0" max="100" value={unbilledWarnPct} onChange={(e)=>setUnbilledWarnPct(Number(e.target.value))} style={{ width:90 }} />
          <label style={{ color:'var(--muted)', fontSize:12 }}>Unbilled Schlecht (%)</label>
          <input className="input" type="number" min="0" max="100" value={unbilledBadPct} onChange={(e)=>setUnbilledBadPct(Number(e.target.value))} style={{ width:90 }} />
        </div>
        <UnderRecorded items={items} expectedPerDay={expectedPerDay} range={{ from: params?.datum_von, to: params?.datum_bis }} thresholds={{ warn: underWarn, bad: underBad }} />
        <div style={{ height: 12 }} />
        <UnbilledRanking items={items} thresholds={{ warnPct: unbilledWarnPct, badPct: unbilledBadPct }} />
        <div style={{ height: 12 }} />
        <InternalVsBilled items={items} />
      </div>
    </div>
  )
}

function KPI({ title, value }) {
  return (
    <div className="panel" style={{ padding: 12 }}>
      <div style={{ color: 'var(--muted)', fontSize: 12 }}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 600 }}>{value}</div>
    </div>
  )
}

function fmt(n){ return (Number(n||0)).toLocaleString('de-DE', { maximumFractionDigits: 2 }) }

function workingDaysBetween(isoFrom, isoTo) {
  try {
    const from = new Date(isoFrom)
    const to = new Date(isoTo)
    if (isNaN(from) || isNaN(to)) return 0
    let count = 0
    for (let d = new Date(from); d <= to; d.setUTCDate(d.getUTCDate()+1)) {
      const wd = d.getUTCDay() // 0 Sun .. 6 Sat
      if (wd !== 0 && wd !== 6) count++
    }
    return count
  } catch { return 0 }
}

function UnderRecorded({ items, expectedPerDay, range, thresholds }) {
  const days = useMemo(() => workingDaysBetween(range?.from, range?.to), [range?.from, range?.to])
  const byEmp = useMemo(() => {
    const map = new Map()
    for (const x of items || []) {
      const emp = x?.mitarbeiter || 'Unbekannt'
      const v = parseFloat(x?.stunden_gel)
      map.set(emp, (map.get(emp) || 0) + (Number.isNaN(v)?0:v))
    }
    const expected = days * (Number(expectedPerDay)||0)
    const arr = Array.from(map.entries()).map(([mitarbeiter, ist]) => ({ mitarbeiter, ist, soll: expected, diff: expected - ist }))
    arr.sort((a,b)=> (b.diff||0) - (a.diff||0))
    return arr
  }, [items, days, expectedPerDay])

  const top = byEmp.slice(0, 15)
  const data = useMemo(() => ({
    labels: top.map(x=>x.mitarbeiter),
    datasets: [
      { label: 'Soll', data: top.map(x=>x.soll), backgroundColor: 'rgba(148,163,184,0.5)', borderRadius: 6 },
      { label: 'Ist (geleistet)', data: top.map(x=>x.ist), backgroundColor: 'rgba(34,197,94,0.7)', borderRadius: 6 },
      { label: 'Soll-Ist', data: top.map(x=>x.diff), backgroundColor: 'rgba(248,113,113,0.7)', borderRadius: 6 },
    ]
  }), [byEmp])

  return (
    <div>
      <h4 style={{ margin: '8px 0' }}>Untererfassung (Soll vs. Ist)</h4>
      <div className="chart-lg">
        <Bar data={data} options={{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'top' }, title:{ display:false } }, scales:{ y:{ beginAtZero:true } } }} />
      </div>
      <div className="table-wrap" style={{ marginTop: 8 }}>
        <table className="table">
          <thead><tr><th>Mitarbeiter</th><th className="right">Soll (h)</th><th className="right">Ist (h)</th><th className="right">Soll−Ist (h)</th></tr></thead>
          <tbody>
            {top.map((r)=> {
              const diff = Number(r.diff||0)
              const cls = diff >= (thresholds?.bad||Infinity) ? 'row-bad' : diff >= (thresholds?.warn||Infinity) ? 'row-warn' : ''
              return (
              <tr key={r.mitarbeiter} className={cls}>
                <td>{r.mitarbeiter}</td>
                <td className="right">{fmt(r.soll)}</td>
                <td className="right">{fmt(r.ist)}</td>
                <td className="right">{fmt(r.diff)}</td>
              </tr>)
            })}
          </tbody>
        </table>
      </div>
      <small style={{ color: 'var(--muted)' }}>Hinweis: Soll = Arbeitstage im Zeitraum × Sollstunden/Tag (ohne Feiertage).</small>
    </div>
  )
}

function UnbilledRanking({ items, thresholds }) {
  const ranking = useMemo(() => {
    const mapF = new Map(), mapG = new Map()
    for (const x of items || []) {
      const emp = x?.mitarbeiter || 'Unbekannt'
      const f = parseFloat(x?.stunden_fakt)
      const g = parseFloat(x?.stunden_gel)
      mapF.set(emp, (mapF.get(emp) || 0) + (Number.isNaN(f)?0:f))
      mapG.set(emp, (mapG.get(emp) || 0) + (Number.isNaN(g)?0:g))
    }
    const arr = Array.from(mapG.keys()).map(emp => {
      const gel = Number(mapG.get(emp)||0)
      const fakt = Number(mapF.get(emp)||0)
      return { mitarbeiter: emp, geleistet: gel, fakturiert: fakt, unbilled: gel - fakt, quote: gel>0 ? (fakt/gel) : 0 }
    })
    arr.sort((a,b)=> (b.unbilled||0) - (a.unbilled||0))
    return arr
  }, [items])

  const top = ranking.slice(0, 15)
  const data = useMemo(() => ({
    labels: top.map(x=>x.mitarbeiter),
    datasets: [
      { label: 'Geleistet', data: top.map(x=>x.geleistet), backgroundColor: 'rgba(99,102,241,0.35)', borderRadius: 6 },
      { label: 'Fakturiert', data: top.map(x=>x.fakturiert), backgroundColor: 'rgba(34,197,94,0.7)', borderRadius: 6 },
      { label: 'Unbilled (G−F)', data: top.map(x=>x.unbilled), backgroundColor: 'rgba(248,113,113,0.7)', borderRadius: 6 },
    ]
  }), [ranking])

  return (
    <div>
      <h4 style={{ margin: '12px 0 8px' }}>Unbilled vs. Fakturiert (Top 15 nach Unbilled)</h4>
      <div className="chart-lg">
        <Bar data={data} options={{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'top' } }, scales:{ y:{ beginAtZero:true } } }} />
      </div>
      <div className="table-wrap" style={{ marginTop: 8 }}>
        <table className="table">
          <thead><tr><th>Mitarbeiter</th><th className="right">Geleistet (h)</th><th className="right">Fakturiert (h)</th><th className="right">Unbilled (h)</th><th className="right">Quote F/G</th></tr></thead>
          <tbody>
            {top.map((r)=> {
              const pct = r.geleistet>0 ? (1 - (r.fakturiert/r.geleistet))*100 : 0
              const cls = pct*1 >= (thresholds?.badPct||Infinity) ? 'row-bad' : pct*1 >= (thresholds?.warnPct||Infinity) ? 'row-warn' : ''
              return (
              <tr key={r.mitarbeiter} className={cls}>
                <td>{r.mitarbeiter}</td>
                <td className="right">{fmt(r.geleistet)}</td>
                <td className="right">{fmt(r.fakturiert)}</td>
                <td className="right">{fmt(r.unbilled)}</td>
                <td className="right">{r.geleistet>0? `${((r.fakturiert/r.geleistet)*100).toFixed(1)}%` : '—'}</td>
              </tr>)
            })}
          </tbody>
        </table>
      </div>
      <small style={{ color: 'var(--muted)' }}>Hinweis: „Unbilled“ = Geleistet − Fakturiert im ausgewählten Zeitraum.</small>
    </div>
  )
}
