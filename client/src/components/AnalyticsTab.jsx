import React, { useMemo, useState } from 'react'
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
  const [aiInsights, setAiInsights] = useState({ status: 'idle', summary: '', bullets: [], generatedAt: null })

  // Controls
  const [metric, setMetric] = useState('stunden_fakt') // 'stunden_fakt' | 'stunden_gel'
  const [topN, setTopN] = useState(10)
  const [project, setProject] = useState('') // filter by projectcode in TS
  const [dimension, setDimension] = useState('customer') // 'customer' | 'project' | 'employee'
  const [stacked, setStacked] = useState(false)
  const [query, setQuery] = useState('') // filter employees/projects
  const [displayMode, setDisplayMode] = useState('both') // 'percent' | 'hours' | 'both'
  const [labelThreshold, setLabelThreshold] = useState(6) // min % for inline labels
  const [sortMode, setSortMode] = useState('hours_desc') // 'hours_desc' | 'alpha'
  const [limitCount, setLimitCount] = useState(0) // 0 = all

  const monthlyTotals = useMemo(() => computeMonthlyTotals(items, metric), [items, metric])
  const metricLabel = metric === 'stunden_fakt' ? 'fakturierten Stunden' : 'geleisteten Stunden'

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
    plugins: { legend: { position: 'top', labels: { color: 'var(--fg)' } }, title: { display: true, text: 'Top 15 Projekte', color: 'var(--fg)', font: { weight: '600' } } },
    interaction: { mode: 'nearest', intersect: false },
    scales: { x: { stacked: false, grid: { color: 'rgba(148,163,184,0.25)' }, ticks: { color: 'var(--muted)' } }, y: { beginAtZero: true, grid: { color: 'rgba(148,163,184,0.25)' }, ticks: { color: 'var(--muted)' } } },
  }

  const doughnutOptions = {
    plugins: { legend: { position: 'right', labels: { color: 'var(--fg)' } }, title: { display: true, text: 'Verhältnis Fakt/Geleistet (gesamt)', color: 'var(--fg)', font: { weight: '600' } } },
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
    plugins: { legend: { position: 'top', labels: { color: 'var(--fg)' } }, title: { display: true, text: `Zeitverlauf (Top ${topN}) – ${metric === 'stunden_fakt' ? 'fakturiert' : 'geleistet'} · ${dimension}${project ? ` · Projekt ${project}` : ''}`, color: 'var(--fg)', font: { weight: '600' } } },
    interaction: { mode: 'nearest', intersect: false },
    scales: { x: { stacked, grid: { color: 'rgba(148,163,184,0.25)' }, ticks: { color: 'var(--muted)' } }, y: { beginAtZero: true, stacked, grid: { color: 'rgba(148,163,184,0.25)' }, ticks: { color: 'var(--muted)' } } },
  }

  // Employees bar and Customer distribution donut
  const employeeTotals = useMemo(() => employeeTotalsFromItems(items, metric), [items, metric])
  const employeesTop = useMemo(() => employeeTotals.slice(0, 15), [employeeTotals])
  const employeesBar = useMemo(() => ({
    labels: employeesTop.map((e) => e.mitarbeiter),
    datasets: [{ label: metric === 'stunden_fakt' ? 'Fakturiert' : 'Geleistet', data: employeesTop.map((e) => e.sum), backgroundColor: 'rgba(99, 102, 241, 0.7)', borderRadius: 6 }]
  }), [employeesTop, metric])

  // --- Per-employee stacked bars (workload share per project) ---
  // Unit filter removed; always use all items
  const itemsForUnit = useMemo(() => items, [items])

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
  }, [itemsForUnit, metric, sortMode])

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
    let order = Array.from(empMap.entries()).map(([e, pm]) => [e, Array.from(pm.values()).reduce((a,b)=>a+b,0)])
    if (sortMode === 'alpha') order.sort((a,b)=> String(a[0]).localeCompare(String(b[0])))
    else order.sort((a,b)=>b[1]-a[1])
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

  function generateAiInsights(){
    if (!items.length) {
      setAiInsights({ status: 'error', summary: 'Keine Datensätze für die Analyse vorhanden.', bullets: [], generatedAt: null })
      return
    }
    setAiInsights({ status: 'loading', summary: '', bullets: [], generatedAt: null })
    window.setTimeout(() => {
      try {
        const totalHours = monthlyTotals.reduce((acc, cur) => acc + Number(cur.total || 0), 0)
        if (!totalHours) {
          setAiInsights({ status: 'error', summary: 'Die aktuelle Auswahl enthält keine Stundenwerte.', bullets: [], generatedAt: null })
          return
        }

        const trendBullets = buildTrendBullets(monthlyTotals, metricLabel)

        const sortedCustomers = [...kunden].sort((a, b) => (Number(b?.[metric] || 0) - Number(a?.[metric] || 0)))
        const topCustomer = sortedCustomers[0]
        const customerShare = topCustomer ? (Number(topCustomer?.[metric] || 0) / totalHours) * 100 : 0

        const projectTotals = projectTotalsFromKunden(kunden)
        const sortedProjects = [...projectTotals].sort((a, b) => (Number(b?.[metric] || 0) - Number(a?.[metric] || 0)))
        const topProject = sortedProjects[0]
        const projectShare = topProject ? (Number(topProject?.[metric] || 0) / totalHours) * 100 : 0

        const topEmployee = employeeTotals[0]
        const topEmployeeShare = topEmployee ? (Number(topEmployee?.sum || 0) / totalHours) * 100 : 0

        const focusEmployees = empSegments.filter((row) => row.segments.length && row.segments[0].pct >= 0.7).slice(0, 3)
        const avgPerEmployee = employeeTotals.length ? totalHours / employeeTotals.length : 0
        const lowEmployees = [...employeeTotals].reverse().filter((entry) => entry.sum > 0 && entry.sum < avgPerEmployee * 0.4).slice(0, 3)

        const bullets = [
          ...trendBullets,
          topCustomer ? `Top-Kunde: ${topCustomer.kunde} hält ${customerShare.toFixed(1)}% der ${metricLabel}.` : null,
          topProject ? `Top-Projekt: ${topProject.projektcode || 'unbekannt'} bündelt ${projectShare.toFixed(1)}% der ${metricLabel}.` : null,
          topEmployee ? `Engpass-Risiko: ${topEmployee.mitarbeiter} verantwortet ${topEmployeeShare.toFixed(1)}% aller ${metricLabel}.` : null,
          focusEmployees.length ? `Hohe Projekt-Fokussierung bei ${focusEmployees.map((row) => `${row.employee} (${Math.round(row.segments[0].pct*100)}% auf ${row.segments[0].name})`).join(', ')}.` : null,
          lowEmployees.length ? `Auffällige Unterauslastung bei ${lowEmployees.map((entry) => `${entry.mitarbeiter} (${entry.sum.toFixed(1)} h)`).join(', ')}.` : null,
        ].filter(Boolean)

        const summary = `KI-Analyse der ${metricLabel} über ${monthlyTotals.length} Monate. Gesamtvolumen: ${totalHours.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} Stunden.`
        setAiInsights({ status: 'ready', summary, bullets, generatedAt: new Date() })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unbekannter Fehler bei der Analyse.'
        setAiInsights({ status: 'error', summary: message, bullets: [], generatedAt: null })
      }
    }, 120)
  }

  return (
    <div className="grid">
      <div className="panel" style={{ padding: 12, gridColumn: '1 / -1' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, flexWrap:'wrap', marginBottom:8 }}>
          <strong>KI-Einblicke</strong>
          <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
            <button className="btn" onClick={generateAiInsights} disabled={aiInsights.status === 'loading'}>
              {aiInsights.status === 'loading' ? 'Analysiere…' : 'Analyse starten'}
            </button>
            {aiInsights.status === 'ready' && aiInsights.generatedAt && (
              <span style={{ color:'var(--muted)', fontSize:12 }}>Aktualisiert: {aiInsights.generatedAt.toLocaleString('de-DE')}</span>
            )}
          </div>
        </div>
        {aiInsights.status === 'idle' && (
          <div style={{ color:'var(--muted)' }}>Lasse die KI eine Management-Zusammenfassung erstellen, um Chancen und Risiken schneller zu erkennen.</div>
        )}
        {aiInsights.status === 'loading' && (
          <div style={{ color:'var(--muted)' }}>Die Daten werden ausgewertet…</div>
        )}
        {aiInsights.status === 'error' && (
          <div style={{ color:'crimson' }}>{aiInsights.summary}</div>
        )}
        {aiInsights.status === 'ready' && (
          <div style={{ display:'grid', gap:10 }}>
            <div style={{ lineHeight:1.5 }}>{aiInsights.summary}</div>
            <ul style={{ margin:0, paddingLeft:18, display:'grid', gap:6 }}>
              {aiInsights.bullets.map((line, idx) => (
                <li key={idx} style={{ color:'var(--fg)' }}>{line}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {/* First: Full-width segmented visualization with filter */}
      <div className="panel" style={{ padding: 12, gridColumn: '1 / -1' }}>
        <div style={{ position:'sticky', top:0, zIndex:1, background:'var(--panel)', display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8, paddingBottom:8 }}>
          <strong>Auslastung (pro Mitarbeiter · pro Projekt) – Prozentuale Verteilung</strong>
          <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
            <label style={{ color:'var(--muted)', fontSize:12 }}>Metrik</label>
            <select className="input" value={metric} onChange={(e)=>setMetric(e.target.value)}>
              <option value="stunden_fakt">Stunden fakturiert</option>
              <option value="stunden_gel">Stunden geleistet</option>
            </select>
            <label style={{ color:'var(--muted)', fontSize:12 }}>Label</label>
            <select className="input" value={displayMode} onChange={(e)=>setDisplayMode(e.target.value)}>
              <option value="both">% + Stunden</option>
              <option value="percent">nur %</option>
              <option value="hours">nur Stunden</option>
            </select>
            <label style={{ color:'var(--muted)', fontSize:12 }}>min. %</label>
            <input className="input" type="number" min="0" max="20" value={labelThreshold} onChange={(e)=>setLabelThreshold(Math.max(0, Math.min(20, Number(e.target.value)||0)))} style={{ width:72 }} />
            <input className="input" placeholder="Suchen (Mitarbeiter/Projekt)" value={query} onChange={(e)=>setQuery(e.target.value)} style={{ width: 260 }} />
            <label style={{ color:'var(--muted)', fontSize:12 }}>Sortierung</label>
            <select className="input" value={sortMode} onChange={(e)=>setSortMode(e.target.value)}>
              <option value="hours_desc">Stunden (absteigend)</option>
              <option value="alpha">Mitarbeiter A→Z</option>
            </select>
            <label style={{ color:'var(--muted)', fontSize:12 }}>Limit</label>
            <input className="input" type="number" min="0" max="5000" value={limitCount} onChange={(e)=>setLimitCount(Math.max(0, Math.min(5000, Number(e.target.value)||0)))} style={{ width:90 }} title="0 = alle" />
          </div>
        </div>
        {/* Legend */}
        <div style={{ display:'flex', gap:10, flexWrap:'wrap', margin:'6px 0 10px' }}>
          {Array.from(new Map(filteredEmpSegments.flatMap(r => r.segments.map(s => [s.name, colorForProject(s.name)]) )).entries()).slice(0, 24).map(([name, color]) => (
            <div key={name} style={{ display:'flex', alignItems:'center', gap:6, padding:'2px 8px', borderRadius:999, background:'rgba(148,163,184,0.12)', color:'var(--muted)' }}>
              <span style={{ width:12, height:12, borderRadius:3, background:color, display:'inline-block' }} />
              <span style={{ fontSize:12 }}>{name}</span>
            </div>
          ))}
        </div>
        <div style={{ display:'grid', gap:14 }}>
          {(limitCount>0 ? filteredEmpSegments.slice(0, limitCount) : filteredEmpSegments).map((row, idx) => (
            <div key={idx} style={{ display:'grid', gridTemplateColumns:'220px 1fr', gap:10, alignItems:'center' }}>
              <div style={{ color:'var(--fg)' }}>{row.employee}</div>
              <div style={{ display:'flex', gap:8, border:'2px solid var(--border)', padding:6, borderRadius:12, overflow:'hidden', background:'var(--bg)', boxShadow:'inset 0 0 0 1px rgba(255,255,255,0.04), 0 2px 8px rgba(0,0,0,0.25)' }}>
                {row.segments.map((seg, sidx) => {
                  const pct = Math.round(seg.pct * 100)
                  const hours = seg.val.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                  const showText = pct >= Number(labelThreshold)
                  return (
                    <div key={sidx} title={`${pct}% ${seg.name} · ${hours} h`} style={{ width:(seg.pct*100)+'%', minWidth: seg.pct>0? '3%':'0', background: colorForProject(seg.name), color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', borderRadius:8, padding:'6px 4px' }}>
                      {showText && (
                        <span style={{ fontSize:12, fontWeight:600, textShadow:'0 1px 2px rgba(0,0,0,0.35)', textAlign:'center' }}>
                          {displayMode==='percent' ? `${pct}% ${seg.name}` : displayMode==='hours' ? `${hours} h ${seg.name}` : `${pct}% ${seg.name} · ${hours} h`}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="panel" style={{ padding: 12 }}>
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
        <div className="chart-lg">
          <Line data={tsLine} options={lineOptions} />
        </div>
        <div style={{ height: 12 }} />
        <div className="chart">
          <Bar data={employeesBar} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' }, title: { display: true, text: 'Top 15 Mitarbeiter' } }, scales: { y: { beginAtZero: true } } }} />
        </div>
      </div>
      <div className="panel" style={{ padding: 12 }}>
        <div className="chart">
          <Bar data={projectsBar} options={barOptions} />
        </div>
        <div style={{ height: 12 }} />
        <div className="chart-sm">
          <Doughnut data={ratioDoughnut} options={doughnutOptions} />
        </div>
      </div>
      <div className="panel" style={{ padding: 12 }}>
        <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:8 }}>
          <strong>Auslastung je Mitarbeiter (gestapelt)</strong>
          <div style={{ flex:1 }} />
          <label style={{ color:'var(--muted)', fontSize:12 }}>Metrik</label>
          <select className="input" value={metric} onChange={(e)=>setMetric(e.target.value)}>
            <option value="stunden_fakt">Stunden fakturiert</option>
            <option value="stunden_gel">Stunden geleistet</option>
          </select>
        </div>
        <div className="chart-lg">
          <Bar data={empStacked} options={{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'bottom' }, title:{ display:true, text:`Auslastung je Mitarbeiter` } }, scales:{ x:{ stacked:true }, y:{ stacked:true, beginAtZero:true } } }} />
        </div>
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
    </div>
  )
}

export function computeMonthlyTotals(items, metricKey) {
  const map = new Map()
  for (const entry of items || []) {
    const d = entry?.datum || entry?.datum_bis || entry?.datum_von || entry?.date
    if (!d) continue
    const dt = new Date(d)
    if (Number.isNaN(dt.getTime())) continue
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
    const val = Number(entry?.[metricKey] || 0)
    if (!Number.isFinite(val)) continue
    map.set(key, (map.get(key) || 0) + val)
  }
  const arr = Array.from(map.entries()).map(([month, total]) => ({ month, total }))
  arr.sort((a, b) => a.month.localeCompare(b.month))
  return arr
}

export function formatMonthLabel(month) {
  try {
    const [year, mon] = month.split('-').map(Number)
    const formatter = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' })
    return formatter.format(new Date(year, (mon || 1) - 1, 1))
  } catch (_) {
    return month
  }
}

export function buildTrendBullets(monthlyTotals, metricLabel) {
  if (!monthlyTotals.length) return ['Keine Zeitreihen-Daten gefunden.']
  if (monthlyTotals.length === 1) {
    const label = formatMonthLabel(monthlyTotals[0].month)
    const value = Number(monthlyTotals[0].total || 0).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    return [`Nur ein Monat verfügbar (${label}) mit insgesamt ${value} ${metricLabel}.`]
  }
  const bullets = []
  const last = monthlyTotals[monthlyTotals.length - 1]
  const prev = monthlyTotals[monthlyTotals.length - 2]
  const diff = Number(last.total || 0) - Number(prev.total || 0)
  const diffPct = prev.total ? (diff / prev.total) * 100 : 0
  const trendLabel = diff >= 0 ? 'Steigerung' : 'Rückgang'
  bullets.push(`${trendLabel} von ${Math.abs(diff).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} h (${diffPct.toFixed(1)}%) im Monat ${formatMonthLabel(last.month)} gegenüber ${formatMonthLabel(prev.month)}.`)

  let strongestDelta = { value: 0, month: last.month, prev: prev.month }
  for (let i = 1; i < monthlyTotals.length; i++) {
    const current = monthlyTotals[i]
    const previous = monthlyTotals[i - 1]
    const delta = Number(current.total || 0) - Number(previous.total || 0)
    if (Math.abs(delta) > Math.abs(strongestDelta.value)) {
      strongestDelta = { value: delta, month: current.month, prev: previous.month }
    }
  }
  if (Math.abs(strongestDelta.value) > Math.abs(diff)) {
    const label = strongestDelta.value >= 0 ? 'größte Steigerung' : 'stärkster Rückgang'
    bullets.push(`Historische ${label}: ${formatMonthLabel(strongestDelta.month)} vs. ${formatMonthLabel(strongestDelta.prev)} mit ${Math.abs(strongestDelta.value).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} h Differenz.`)
  }
  return bullets
}
