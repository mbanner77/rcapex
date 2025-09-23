import React, { useMemo, useState } from 'react'
import { UNITS } from '../lib/constants'
import { exportGenericCsv } from '../lib/export'
import { Bar, Doughnut, Line } from 'react-chartjs-2'
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
  projectTotalsFromKunden,
  groupByCustomerMonthly,
  topCustomersByTotal,
  listProjectsFromKunden,
  groupByProjectMonthly,
  topProjectsByTotal,
  groupByEmployeeMonthly,
  topEmployeesByTotal,
  listCustomersFromItems,
  employeeTotalsFromItems,
} from '../lib/transform'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, PointElement, LineElement, Title, Tooltip, Legend)

export default function AnalyticsTab({ kundenAgg, stundenRaw }) {
  const { kunden, totals } = kundenAgg
  const projectsList = useMemo(() => listProjectsFromKunden(kunden), [kunden])
  const items = useMemo(() => stundenRaw?.items || stundenRaw || [], [stundenRaw])
  const customersList = useMemo(() => listCustomersFromItems(items), [items])

  // Controls
  const [metric, setMetric] = useState('stunden_fakt') // 'stunden_fakt' | 'stunden_gel'
  const [topN, setTopN] = useState(10)
  const [project, setProject] = useState('') // filter by projectcode in TS
  const [dimension, setDimension] = useState('customer') // 'customer' | 'project' | 'employee'
  const [stacked, setStacked] = useState(false)
  const [unitSel, setUnitSel] = useState('ALL') // for per-employee stacked view
  const [query, setQuery] = useState('') // filter employees/projects

  const topProjects = useMemo(() => projectTotalsFromKunden(kunden).slice(0, 15), [kunden])

  const projectsBar = useMemo(() => ({
    labels: topProjects.map((p) => p.projektcode),
    datasets: [
      {
        label: 'Std. fakturiert',
        data: topProjects.map((p) => p.stunden_fakt || 0),
        backgroundColor: 'rgba(34, 197, 94, 0.7)', // green-500
        borderRadius: 6,
      },
      {
        label: 'Std. geleistet',
        data: topProjects.map((p) => p.stunden_gel || 0),
        backgroundColor: 'rgba(234, 179, 8, 0.6)', // amber-500
        borderRadius: 6,
      },
    ],
  }), [topProjects])

  const ratioDoughnut = useMemo(() => ({
    labels: ['Fakturiert', 'Geleistet'],
    datasets: [
      {
        label: 'Stunden',
        data: [totals.stunden_fakt || 0, totals.stunden_gel || 0],
        backgroundColor: ['#22c55e', '#eab308'],
        borderColor: ['#14532d', '#854d0e'],
        borderWidth: 1,
      },
    ],
  }), [totals])

  const barOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'top' }, title: { display: true, text: 'Top 15 Projekte' } },
    interaction: { mode: 'nearest', intersect: false },
    scales: { x: { stacked: false }, y: { beginAtZero: true } },
  }

  const doughnutOptions = {
    plugins: { legend: { position: 'right' }, title: { display: true, text: 'Verhältnis Fakt/Geleistet (gesamt)' } },
    maintainAspectRatio: false,
  }

  // Monthly time series by selected dimension
  const monthlyCustomer = useMemo(() => groupByCustomerMonthly(items, metric, project || null), [items, metric, project])
  const monthlyProject = useMemo(() => groupByProjectMonthly(items, metric, null), [items, metric])
  const monthlyEmployee = useMemo(() => groupByEmployeeMonthly(items, metric, null, project || null), [items, metric, project])

  const topKeys = useMemo(() => {
    if (dimension === 'customer') return topCustomersByTotal(monthlyCustomer.perCustomer, Number(topN) || 10)
    if (dimension === 'project') return topProjectsByTotal(monthlyProject.perProject, Number(topN) || 10)
    return topEmployeesByTotal(monthlyEmployee.perEmployee, Number(topN) || 10)
  }, [dimension, monthlyCustomer, monthlyProject, monthlyEmployee, topN])

  const tsLine = useMemo(() => {
    const colors = ['#60a5fa','#34d399','#fbbf24','#f472b6','#a78bfa','#4ade80','#f87171','#22d3ee','#c084fc','#facc15']
    const labels = dimension === 'customer' ? monthlyCustomer.months : (dimension === 'project' ? monthlyProject.months : monthlyEmployee.months)
    const seriesMap = dimension === 'customer' ? monthlyCustomer.perCustomer : (dimension === 'project' ? monthlyProject.perProject : monthlyEmployee.perEmployee)
    const datasets = topKeys.map((key, idx) => {
      const series = seriesMap.get(key) || new Map()
      return {
        label: key,
        data: labels.map((m) => Number(series.get(m) || 0)),
        borderColor: colors[idx % colors.length],
        backgroundColor: colors[idx % colors.length],
        tension: 0.2,
      }
    })
    return { labels, datasets }
  }, [dimension, monthlyCustomer, monthlyProject, monthlyEmployee, topKeys])

  const lineOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'top' }, title: { display: true, text: `Zeitverlauf (Top ${topN}) – ${metric === 'stunden_fakt' ? 'fakturiert' : 'geleistet'} · ${dimension}${project ? ` · Projekt ${project}` : ''}` } },
    interaction: { mode: 'nearest', intersect: false },
    scales: { x: { stacked }, y: { beginAtZero: true, stacked } },
  }

  // Employees bar and Customer distribution donut
  const employeesTop = useMemo(() => employeeTotalsFromItems(items, metric).slice(0, 15), [items, metric])
  const employeesBar = useMemo(() => ({
    labels: employeesTop.map((e) => e.mitarbeiter),
    datasets: [{ label: metric === 'stunden_fakt' ? 'Fakturiert' : 'Geleistet', data: employeesTop.map((e) => e.sum), backgroundColor: 'rgba(99, 102, 241, 0.7)', borderRadius: 6 }]
  }), [employeesTop, metric])

  // --- New: Per-employee stacked bars per unit (workload share per project) ---
  const unitName = (id) => {
    const m = new Map(UNITS.map(u => [u.ext_id, u.name]))
    return m.get(id) || id || 'ALL'
  }

  const itemsForUnit = useMemo(() => {
    const items0 = items
    if (!unitSel || unitSel === 'ALL') return items0
    return items0.filter(r => (r.__unit || unitSel) === unitSel)
  }, [items, unitSel])

  const empStacked = useMemo(() => {
    // Build emp -> project -> sum(metric)
    const getVal = (r) => Number(r?.[metric] ?? 0)
    const empMap = new Map()
    for (const r of itemsForUnit) {
      const emp = (r?.MITARBEITER ?? r?.mitarbeiter ?? '—').toString()
      const proj = (r?.PROJEKT ?? r?.projekt ?? r?.projektcode ?? '—').toString()
      const val = getVal(r)
      if (!val) continue
      if (!empMap.has(emp)) empMap.set(emp, new Map())
      const pm = empMap.get(emp)
      pm.set(proj, (pm.get(proj) || 0) + val)
    }
    const empTotals = Array.from(empMap.entries()).map(([e, pm]) => [e, Array.from(pm.values()).reduce((a,b)=>a+b,0)])
    empTotals.sort((a,b)=>b[1]-a[1])
    const labels = empTotals.slice(0, 15).map(e=>e[0])
    const projTotals = new Map()
    for (const e of labels) {
      const pm = empMap.get(e) || new Map()
      for (const [p,v] of pm) projTotals.set(p, (projTotals.get(p)||0)+v)
    }
    const topProjects = Array.from(projTotals.entries()).sort((a,b)=>b[1]-a[1]).slice(0,5).map(x=>x[0])
    const datasets = []
    const colors = ['#60a5fa','#34d399','#fbbf24','#f472b6','#a78bfa','#4ade80','#f87171','#22d3ee']
    topProjects.forEach((p, idx) => {
      const data = labels.map(e => (empMap.get(e)?.get(p)) ? Number(empMap.get(e).get(p)) : 0)
      datasets.push({ label: p, data, backgroundColor: colors[idx % colors.length] })
    })
    const other = labels.map(e => {
      const pm = empMap.get(e) || new Map()
      let sum = 0
      for (const [p,v] of pm) if (!topProjects.includes(p)) sum += Number(v||0)
      return sum
    })
    if (other.some(v=>v>0)) datasets.push({ label: 'Andere', data: other, backgroundColor: '#9ca3af' })
    return { labels, datasets }
  }, [itemsForUnit, metric])

  // Aggregation per Mitarbeiter+Projekt (no per-day rows)
  const aggEmpProj = useMemo(() => {
    const map = new Map()
    for (const r of itemsForUnit) {
      const emp = (r?.MITARBEITER ?? r?.mitarbeiter ?? '—').toString()
      const proj = (r?.PROJEKT ?? r?.projekt ?? r?.projektcode ?? '—').toString()
      const key = emp + '||' + proj
      const gel = Number(r?.stunden_gel || 0)
      const fakt = Number(r?.stunden_fakt || 0)
      if (!map.has(key)) map.set(key, { mitarbeiter: emp, projekt: proj, stunden_gel: 0, stunden_fakt: 0 })
      const obj = map.get(key)
      obj.stunden_gel += gel || 0
      obj.stunden_fakt += fakt || 0
    }
    const arr = Array.from(map.values())
    arr.sort((a,b)=> (b.stunden_fakt + b.stunden_gel) - (a.stunden_fakt + a.stunden_gel))
    return arr
  }, [itemsForUnit])

  // --- New: Employee segmented bars (percent share per project) ---
  const empSegments = useMemo(() => {
    const getVal = (r) => Number(r?.[metric] ?? 0)
    // Build emp -> project -> sum(metric)
    const empMap = new Map()
    for (const r of itemsForUnit) {
      const emp = (r?.MITARBEITER ?? r?.mitarbeiter ?? '—').toString()
      const proj = (r?.PROJEKT ?? r?.projekt ?? r?.projektcode ?? '—').toString()
      const v = getVal(r)
      if (!v) continue
      if (!empMap.has(emp)) empMap.set(emp, new Map())
      const pm = empMap.get(emp)
      pm.set(proj, (pm.get(proj) || 0) + v)
    }
    const rows = []
    // Rank employees by total, include all (descending)
    const order = Array.from(empMap.entries()).map(([e, pm]) => [e, Array.from(pm.values()).reduce((a,b)=>a+b,0)])
    order.sort((a,b)=>b[1]-a[1])
    const allEmps = order.map(x=>x[0])
    for (const emp of allEmps) {
      const pm = empMap.get(emp) || new Map()
      const total = Array.from(pm.values()).reduce((a,b)=>a+b,0)
      if (!total) continue
      // Top 5 projects per employee; rest -> Andere
      const plist = Array.from(pm.entries()).sort((a,b)=>b[1]-a[1])
      const top = plist.slice(0,5)
      const rest = plist.slice(5)
      let segments = top.map(([name, val]) => ({ name, val, pct: val / total }))
      const restSum = rest.reduce((a,[,v])=>a+v,0)
      if (restSum > 0) segments.push({ name: 'Andere', val: restSum, pct: restSum/total })
      rows.push({ employee: emp, total, segments })
    }
    return rows
  }, [itemsForUnit, metric])

  // Filter by query (matches employee or any segment name)
  const filteredEmpSegments = useMemo(() => {
    const q = (query||'').trim().toLowerCase()
    if (!q) return empSegments
    return empSegments.filter(r => r.employee.toLowerCase().includes(q) || r.segments.some(s => (s.name||'').toLowerCase().includes(q)))
  }, [empSegments, query])

  const filteredAggEmpProj = useMemo(() => {
    const q = (query||'').trim().toLowerCase()
    if (!q) return aggEmpProj
    return aggEmpProj.filter(r => r.mitarbeiter.toLowerCase().includes(q) || r.projekt.toLowerCase().includes(q))
  }, [aggEmpProj, query])

  // Stable color per project name
  function colorForProject(name){
    const palette = ['#60a5fa','#34d399','#fbbf24','#f472b6','#a78bfa','#4ade80','#f87171','#22d3ee','#22c55e','#eab308','#ef4444','#06b6d4','#10b981','#6366f1','#9ca3af']
    let h=0; for (let i=0;i<name.length;i++){ h = (h*31 + name.charCodeAt(i)) & 0xffffffff }
    return palette[Math.abs(h)%palette.length]
  }

  return (
    <div className="grid">
      <div className="panel" style={{ padding: 12, height: 520 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <label style={{ color: 'var(--muted)', fontSize: 12 }}>Metrik</label>
          <select className="input" value={metric} onChange={(e)=>setMetric(e.target.value)}>
            <option value="stunden_fakt">Stunden fakturiert</option>
            <option value="stunden_gel">Stunden geleistet</option>
          </select>
          <label style={{ color: 'var(--muted)', fontSize: 12 }}>Dimension</label>
          <select className="input" value={dimension} onChange={(e)=>setDimension(e.target.value)}>
            <option value="customer">Kunde</option>
            <option value="project">Projekt</option>
            <option value="employee">Mitarbeiter</option>
          </select>
          <label style={{ color: 'var(--muted)', fontSize: 12 }}>Top N</label>
          <input className="input" type="number" min="1" max="30" value={topN} onChange={(e)=>setTopN(e.target.value)} style={{ width: 90 }} />
          <label style={{ color: 'var(--muted)', fontSize: 12 }}>Projekt</label>
          <select className="input" value={project} onChange={(e)=>setProject(e.target.value)}>
            <option value="">Alle</option>
            {projectsList.map((p)=> (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <label style={{ color: 'var(--muted)', fontSize: 12 }}>
            <input type="checkbox" checked={stacked} onChange={(e)=>setStacked(e.target.checked)} style={{ marginRight: 6 }} /> gestapelt
          </label>
        </div>
        <Line data={tsLine} options={lineOptions} />
        <div style={{ height: 12 }} />
        <Bar data={employeesBar} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' }, title: { display: true, text: 'Top 15 Mitarbeiter' } }, scales: { y: { beginAtZero: true } } }} />
      </div>
      <div className="panel" style={{ padding: 12, height: 520 }}>
        <Bar data={projectsBar} options={barOptions} />
        <div style={{ height: 12 }} />
        <Doughnut data={ratioDoughnut} options={doughnutOptions} />
      </div>
      <div className="panel" style={{ padding: 12, height: 520 }}>
        <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:8 }}>
          <strong>Auslastung je Mitarbeiter (gestapelt)</strong>
          <div style={{ flex:1 }} />
          <label style={{ color:'var(--muted)', fontSize:12 }}>Unit</label>
          <select className="input" value={unitSel} onChange={(e)=>setUnitSel(e.target.value)}>
            <option value="ALL">Alle</option>
            {UNITS.map(u => (
              <option key={u.ext_id} value={u.ext_id}>{u.name}</option>
            ))}
          </select>
          <label style={{ color:'var(--muted)', fontSize:12 }}>Metrik</label>
          <select className="input" value={metric} onChange={(e)=>setMetric(e.target.value)}>
            <option value="stunden_fakt">Stunden fakturiert</option>
            <option value="stunden_gel">Stunden geleistet</option>
          </select>
        </div>
        <Bar data={empStacked} options={{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'bottom' }, title:{ display:true, text:`Auslastung je Mitarbeiter – ${unitSel==='ALL'?'Alle Units':unitName(unitSel)}` } }, scales:{ x:{ stacked:true }, y:{ stacked:true, beginAtZero:true } } }} />
      </div>
      <div className="panel" style={{ padding: 12 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
          <strong>Summen je Mitarbeiter · Projekt</strong>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <input className="input" placeholder="Suchen (Mitarbeiter/Projekt)" value={query} onChange={(e)=>setQuery(e.target.value)} style={{ width: 260 }} />
            <button className="btn" onClick={()=>{
              exportGenericCsv([
                { key:'mitarbeiter', label:'Mitarbeiter' },
                { key:'projekt', label:'Projekt' },
                { key:'stunden_gel', label:'Std_geleistet' },
                { key:'stunden_fakt', label:'Std_fakturiert' },
                { key:'summe', label:'Summe' },
              ], filteredAggEmpProj.map(r=>({ ...r, summe: (r.stunden_gel||0)+(r.stunden_fakt||0) })), 'emp_projekt')
            }}>CSV Export</button>
            <span style={{ color:'var(--muted)' }}>Einträge: {filteredAggEmpProj.length}</span>
          </div>
        </div>
        <div style={{ overflowX:'auto' }}>
          <table className="table" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th>Mitarbeiter</th>
                <th>Projekt</th>
                <th style={{ textAlign:'right' }}>Std. geleistet</th>
                <th style={{ textAlign:'right' }}>Std. fakturiert</th>
                <th style={{ textAlign:'right' }}>Summe</th>
              </tr>
            </thead>
            <tbody>
              {filteredAggEmpProj.slice(0, 1000).map((r, idx) => (
                <tr key={idx}>
                  <td>{r.mitarbeiter}</td>
                  <td>{r.projekt}</td>
                  <td style={{ textAlign:'right' }}>{(r.stunden_gel || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td style={{ textAlign:'right' }}>{(r.stunden_fakt || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td style={{ textAlign:'right' }}>{((r.stunden_fakt || 0) + (r.stunden_gel || 0)).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filteredAggEmpProj.length > 1000 && <div style={{ color:'var(--muted)', marginTop:6 }}>Nur Top 1000 angezeigt. Filtere/Suche zum Eingrenzen.</div>}
      </div>
      <div className="panel" style={{ padding: 12 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
          <strong>Auslastung (pro Mitarbeiter · pro Projekt) – Prozentuale Verteilung</strong>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <label style={{ color:'var(--muted)', fontSize:12 }}>Unit</label>
            <select className="input" value={unitSel} onChange={(e)=>setUnitSel(e.target.value)}>
              <option value="ALL">Alle</option>
              {UNITS.map(u => (
                <option key={u.ext_id} value={u.ext_id}>{u.name}</option>
              ))}
            </select>
            <label style={{ color:'var(--muted)', fontSize:12 }}>Metrik</label>
            <select className="input" value={metric} onChange={(e)=>setMetric(e.target.value)}>
              <option value="stunden_fakt">Stunden fakturiert</option>
              <option value="stunden_gel">Stunden geleistet</option>
            </select>
          </div>
        </div>
        <div style={{ display:'grid', gap:14 }}>
          {filteredEmpSegments.map((row, idx) => (
            <div key={idx} style={{ display:'grid', gridTemplateColumns:'220px 1fr', gap:10, alignItems:'center' }}>
              <div style={{ color:'var(--fg)' }}>{row.employee}</div>
              <div style={{ display:'flex', gap:8, border:'2px solid var(--border)', padding:6, borderRadius:8, overflow:'hidden', background:'var(--bg)' }}>
                {row.segments.map((seg, sidx) => {
                  const pct = Math.round(seg.pct * 100)
                  const hours = seg.val.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                  const showText = pct >= 6
                  return (
                    <div key={sidx} title={`${pct}% ${seg.name} · ${hours} h`} style={{ width:(seg.pct*100)+'%', minWidth: seg.pct>0? '3%':'0', background: colorForProject(seg.name), color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', borderRadius:4, padding:'6px 4px' }}>
                      {showText && (
                        <span style={{ fontSize:12, fontWeight:600, textShadow:'0 1px 2px rgba(0,0,0,0.35)', textAlign:'center' }}>{`${pct}% ${seg.name} · ${hours} h`}</span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
