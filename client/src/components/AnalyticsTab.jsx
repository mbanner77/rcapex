import React, { useEffect, useMemo, useState } from 'react'
import { parseISO, isValid, isBefore, isAfter, startOfMonth, differenceInCalendarMonths, format } from 'date-fns'
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

const INSIGHT_TYPE_META = {
  Trend: { background: 'rgba(37, 99, 235, 0.08)', color: '#1d4ed8' },
  Risk: { background: 'rgba(239, 68, 68, 0.1)', color: '#b91c1c' },
  Opportunity: { background: 'rgba(16, 185, 129, 0.12)', color: '#047857' },
  Focus: { background: 'rgba(168, 85, 247, 0.12)', color: '#7c3aed' },
  Info: { background: 'rgba(71, 85, 105, 0.12)', color: '#475569' },
}

function InsightChip({ label, value, tone }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:6, background:`${tone}15`, color:tone, padding:'4px 10px', borderRadius:999, fontSize:12, fontWeight:600 }}>
      <span>{label}</span>
      <span style={{ background:tone, color:'#fff', borderRadius:999, padding:'2px 8px', fontSize:11 }}>{value}</span>
    </div>
  )
}

export default function AnalyticsTab({ kundenAgg, stundenRaw, params }) {
  const { kunden, totals } = kundenAgg
  const projectsList = useMemo(() => listProjectsFromKunden(kunden), [kunden])
  const items = useMemo(() => stundenRaw?.items || stundenRaw || [], [stundenRaw])
  const customersList = useMemo(() => listCustomersFromItems(items), [items])
  const [aiInsights, setAiInsights] = useState({ status: 'idle', summary: '', entries: [], generatedAt: null })
  const [insightFilters, setInsightFilters] = useState({ riskOnly: false, minShare: 15 })
  const [copyStatus, setCopyStatus] = useState('idle')

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

  const monthlyTotalsRaw = useMemo(() => computeMonthlyTotals(items, metric), [items, metric])
  const metricLabel = metric === 'stunden_fakt' ? 'fakturierten Stunden' : 'geleisteten Stunden'
  const appliedRange = useMemo(() => {
    if (!params?.datum_von || !params?.datum_bis) return null
    try {
      const start = parseISO(params.datum_von)
      const end = parseISO(params.datum_bis)
      if (!isValid(start) || !isValid(end)) return null
      const months = Math.max(1, differenceInCalendarMonths(end, start) + 1)
      return { start, end, months }
    } catch (_) {
      return null
    }
  }, [params?.datum_von, params?.datum_bis])

  const monthlyTotals = useMemo(() => {
    if (!appliedRange) return monthlyTotalsRaw
    const startMonth = startOfMonth(appliedRange.start)
    const endMonth = startOfMonth(appliedRange.end)
    return monthlyTotalsRaw.filter((row) => {
      try {
        const monthDate = parseISO(`${row.month}-01`)
        if (!isValid(monthDate)) return false
        return !isBefore(monthDate, startMonth) && !isAfter(monthDate, endMonth)
      } catch (_) {
        return false
      }
    })
  }, [monthlyTotalsRaw, appliedRange])

  const monthlyBreakdown = useMemo(() => {
    return monthlyTotals.map((row, idx) => {
      const label = formatMonthLabel(row.month)
      const total = Number(row.total || 0)
      if (idx === 0) {
        return { label, total, delta: null, deltaPct: null }
      }
      const prev = Number(monthlyTotals[idx - 1]?.total || 0)
      const delta = total - prev
      const deltaPct = prev ? (delta / prev) * 100 : null
      return { label, total, delta, deltaPct }
    })
  }, [monthlyTotals])

  const filteredEntries = useMemo(() => {
    return (aiInsights.entries || []).filter((entry) => {
      if (insightFilters.riskOnly && entry.type !== 'Risk') return false
      if (entry.value && typeof entry.value === 'string' && entry.value.endsWith('%')) {
        const val = Number(entry.value.replace('%', ''))
        if (!Number.isNaN(val) && val < insightFilters.minShare) return false
      }
      return true
    })
  }, [aiInsights.entries, insightFilters])

  const insightStats = useMemo(() => {
    const counts = { total: filteredEntries.length, Risk: 0, Opportunity: 0, Focus: 0, Trend: 0, Info: 0 }
    filteredEntries.forEach((entry) => {
      counts[entry.type] = (counts[entry.type] || 0) + 1
    })
    return counts
  }, [filteredEntries])

  useEffect(() => {
    if (copyStatus !== 'copied') return
    const timer = window.setTimeout(() => setCopyStatus('idle'), 1600)
    return () => window.clearTimeout(timer)
  }, [copyStatus])

  async function copyInsightsToClipboard(){
    if (aiInsights.status !== 'ready') return
    const available = typeof navigator !== 'undefined' && navigator?.clipboard?.writeText
    if (!available) {
      setCopyStatus('error')
      return
    }
    try {
      const lines = [aiInsights.summary]
      filteredEntries.forEach((entry) => {
        const badge = entry.value ? ` (${entry.value})` : ''
        lines.push(`- [${entry.type}] ${entry.title}${badge}: ${entry.detail}`)
        if (entry.meta) lines.push(`    Betroffen: ${entry.meta}`)
      })
      await navigator.clipboard.writeText(lines.join('\n'))
      setCopyStatus('copied')
    } catch (err) {
      console.error('copy failed', err)
      setCopyStatus('error')
    }
  }

  function downloadInsightsMarkdown(){
    if (aiInsights.status !== 'ready') return
    const lines = [
      `# Management Insights (${new Date().toLocaleString('de-DE')})`,
      '',
      aiInsights.summary,
      '',
    ]
    filteredEntries.forEach((entry) => {
      lines.push(`## ${entry.title}`)
      lines.push(`- Typ: ${entry.type}${entry.value ? ` (${entry.value})` : ''}`)
      lines.push(`- Beschreibung: ${entry.detail}`)
      if (entry.meta) lines.push(`- Betroffen: ${entry.meta}`)
      lines.push('')
    })
    if (!filteredEntries.length) lines.push('_Keine Einträge mit aktuellem Filter._')
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'analytics_insights.md'
    a.click()
    URL.revokeObjectURL(url)
  }

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

  const summaryStats = useMemo(() => {
    const months = monthlyTotals.length
    const totalHours = monthlyTotals.reduce((acc, row) => acc + Number(row.total || 0), 0)
    const avgPerMonth = months ? totalHours / months : 0
    const customerCount = kunden.length
    const avgPerCustomer = customerCount ? totalHours / customerCount : 0
    const activeProjects = projectsList.length
    const employeeCount = employeeTotals.length
    const medianEmployee = employeeCount ? calcMedian(employeeTotals.map((e) => Number(e.sum || 0))) : 0
    const volatility = calcStdDev(monthlyTotals.map((row) => Number(row.total || 0)))
    const volatilityPct = avgPerMonth ? (volatility / avgPerMonth) * 100 : null
    return {
      totalHours,
      avgPerMonth,
      customerCount,
      avgPerCustomer,
      activeProjects,
      employeeCount,
      medianEmployee,
      volatility,
      volatilityPct,
      activeMonths: months,
    }
  }, [monthlyTotals, kunden, projectsList, employeeTotals])

  const statsCards = useMemo(() => ([
    {
      label: 'Gesamtstunden',
      value: `${formatHours(summaryStats.totalHours, 1)} h`,
      hint: summaryStats.activeMonths ? `${summaryStats.activeMonths} Monate` : null,
    },
    {
      label: 'Ø pro Monat',
      value: `${formatHours(summaryStats.avgPerMonth, 1)} h`,
      hint: summaryStats.activeMonths > 1 ? 'Basis: aktive Monate' : null,
    },
    {
      label: 'Aktive Kunden',
      value: summaryStats.customerCount.toLocaleString('de-DE'),
      hint: summaryStats.avgPerCustomer ? `Ø ${formatHours(summaryStats.avgPerCustomer, 1)} h je Kunde` : null,
    },
    {
      label: 'Aktive Projekte',
      value: summaryStats.activeProjects.toLocaleString('de-DE'),
    },
    {
      label: 'Aktive Mitarbeiter',
      value: summaryStats.employeeCount.toLocaleString('de-DE'),
      hint: summaryStats.employeeCount ? `Median: ${formatHours(summaryStats.medianEmployee, 1)} h` : null,
    },
    {
      label: 'Volatilität',
      value: `${formatHours(summaryStats.volatility, 1)} h`,
      hint: summaryStats.volatilityPct != null ? `${summaryStats.volatilityPct.toFixed(1)}% vom Ø` : null,
    },
  ]), [summaryStats])

  const hasSummaryData = summaryStats.activeMonths > 0 || summaryStats.totalHours > 0

  const customerMomentum = useMemo(() => computeMomentum(monthlyCustomer.months, monthlyCustomer.perCustomer), [monthlyCustomer])

  const projectMomentum = useMemo(() => computeMomentum(monthlyProject.months, monthlyProject.perProject), [monthlyProject])

  const hasMomentumData = Boolean(
    (customerMomentum.positive?.length || 0) +
    (customerMomentum.negative?.length || 0) +
    (projectMomentum.positive?.length || 0) +
    (projectMomentum.negative?.length || 0)
  )

  const renderMomentumList = (entries, tone) => {
    if (!entries.length) {
      return <div style={{ color: 'var(--muted)', fontSize: 12 }}>Keine signifikanten Veränderungen.</div>
    }
    const positive = tone === 'positive'
    return entries.map((entry) => {
      const diffHours = formatHours(Math.abs(entry.diff), 1)
      const diffText = `${entry.diff > 0 ? '+' : '-'}${diffHours} h`
      const pctText = entry.diffPct != null ? ` (${entry.diffPct > 0 ? '+' : ''}${entry.diffPct.toFixed(1)}%)` : ''
      const rangeText = `${formatHours(entry.prev, 1)} h → ${formatHours(entry.current, 1)} h`
      return (
        <div
          key={`${tone}-${entry.key}`}
          style={{
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: 10,
            background: positive ? 'rgba(34, 197, 94, 0.08)' : 'rgba(239, 68, 68, 0.08)',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          <span style={{ fontWeight: 600 }}>{entry.key}</span>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{rangeText}</span>
          <span style={{ fontWeight: 600, color: positive ? '#22c55e' : '#ef4444' }}>{diffText}{pctText}</span>
        </div>
      )
    })
  }

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
      setAiInsights({ status: 'error', summary: 'Keine Datensätze für die Analyse vorhanden.', entries: [], generatedAt: null })
      return
    }
    setAiInsights({ status: 'loading', summary: '', entries: [], generatedAt: null })
    window.setTimeout(() => {
      try {
        const totalHours = monthlyTotals.reduce((acc, cur) => acc + Number(cur.total || 0), 0)
        if (!totalHours) {
          setAiInsights({ status: 'error', summary: 'Die aktuelle Auswahl enthält keine Stundenwerte.', entries: [], generatedAt: null })
          return
        }

        const trendEntries = buildTrendInsights(monthlyTotals, metricLabel)

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

        const riskEntries = []
        if (monthlyTotals.length >= 2) {
          const last = monthlyTotals[monthlyTotals.length - 1]
          const prev = monthlyTotals[monthlyTotals.length - 2]
          const lastLabel = formatMonthLabel(last.month)
          const prevLabel = formatMonthLabel(prev.month)
          const diff = Number(last.total || 0) - Number(prev.total || 0)
          const diffPct = Number(prev.total || 0) ? (diff / Number(prev.total || 0)) * 100 : null
          if (diff < 0 && (diffPct === null || diffPct <= -15)) {
            riskEntries.push({
              id: 'monthly-drop',
              type: 'Risk',
              title: 'Starker Rückgang',
              detail: `Gegenüber ${prevLabel} gingen die ${metricLabel} um ${Math.abs(diff).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} h zurück${diffPct === null ? '' : ` (${diffPct.toFixed(1)}%)`}.`,
              value: diffPct === null ? `${Math.abs(diff).toFixed(1)} h` : `${diffPct.toFixed(1)}%`,
              meta: lastLabel,
            })
          }
        }

        if (topCustomer && customerShare >= 40) {
          riskEntries.push({
            id: 'customer-concentration',
            type: 'Risk',
            title: 'Kundenkonzentration',
            detail: `${topCustomer.kunde} bündelt ${customerShare.toFixed(1)}% der ${metricLabel}. Ein Ausfall hätte große Auswirkungen.`,
            value: `${customerShare.toFixed(1)}%`,
            meta: topCustomer.kunde,
          })
        }

        if (topEmployee && topEmployeeShare >= 35) {
          riskEntries.push({
            id: 'employee-dependency',
            type: 'Risk',
            title: 'Abhängigkeit von Schlüsselperson',
            detail: `${topEmployee.mitarbeiter} verantwortet ${topEmployeeShare.toFixed(1)}% der ${metricLabel}. Plane Know-how-Transfer oder Vertretung.`,
            value: `${topEmployeeShare.toFixed(1)}%`,
            meta: topEmployee.mitarbeiter,
          })
        }

        const entries = [
          appliedRange ? {
            id: 'range-info',
            type: 'Info',
            title: 'Analysezeitraum',
            detail: `${appliedRange.months} Monate · ${format(appliedRange.start, 'dd.MM.yyyy')} bis ${format(appliedRange.end, 'dd.MM.yyyy')}`,
          } : null,
          ...trendEntries,
          ...riskEntries,
          topCustomer ? {
            id: 'top-customer',
            type: 'Opportunity',
            title: 'Top-Kunde',
            detail: `${topCustomer.kunde} hält ${customerShare.toFixed(1)}% der ${metricLabel}.`,
            value: `${customerShare.toFixed(1)}%`,
            meta: topCustomer.kunde,
          } : null,
          topProject ? {
            id: 'top-project',
            type: 'Focus',
            title: 'Schwerpunkt-Projekt',
            detail: `${topProject.projektcode || 'unbekannt'} bündelt ${projectShare.toFixed(1)}% der ${metricLabel}.`,
            value: `${projectShare.toFixed(1)}%`,
            meta: topProject.projektcode,
          } : null,
          topEmployee ? {
            id: 'top-employee',
            type: topEmployeeShare >= 30 ? 'Risk' : 'Opportunity',
            title: 'Schlüssel-Mitarbeiter',
            detail: `${topEmployee.mitarbeiter} verantwortet ${topEmployeeShare.toFixed(1)}% aller ${metricLabel}.`,
            value: `${topEmployeeShare.toFixed(1)}%`,
            meta: topEmployee.mitarbeiter,
          } : null,
          focusEmployees.length ? {
            id: 'focus-emps',
            type: 'Focus',
            title: 'Hohe Projekt-Fokussierung',
            detail: focusEmployees.map((row) => `${row.employee} (${Math.round(row.segments[0].pct*100)}% auf ${row.segments[0].name})`).join(', '),
          } : null,
          lowEmployees.length ? {
            id: 'low-util',
            type: 'Opportunity',
            title: 'Unterauslastung',
            detail: lowEmployees.map((entry) => `${entry.mitarbeiter} (${entry.sum.toFixed(1)} h)`).join(', '),
          } : null,
        ].filter(Boolean)

        const uniqueMonths = new Set(monthlyTotals.map((row) => row.month))
        const expectedMonths = appliedRange ? appliedRange.months : uniqueMonths.size
        const coverage = expectedMonths ? Math.round((uniqueMonths.size / expectedMonths) * 100) : 100
        if (coverage < 60) {
          riskEntries.push({
            id: 'coverage-risk',
            type: 'Risk',
            title: 'Datenbasis lückenhaft',
            detail: `Nur ${coverage}% der Monate sind befüllt. Ergebnisse mit Vorsicht interpretieren.`,
            value: `${coverage}%`,
          })
        }
        const monthsText = expectedMonths ? `${expectedMonths} Monat${expectedMonths === 1 ? '' : 'e'}` : `${uniqueMonths.size} Monat${uniqueMonths.size === 1 ? '' : 'e'}`
        const coverageText = coverage < 100 ? ` (Abdeckung: ${coverage}%)` : ''
        const avgPerMonth = monthlyTotals.length ? totalHours / monthlyTotals.length : totalHours
        const summary = `KI-Analyse der ${metricLabel} über ${monthsText}${coverageText}. Gesamtvolumen: ${totalHours.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} Stunden. Ø pro Monat: ${avgPerMonth.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} Stunden.`
        setAiInsights({ status: 'ready', summary, entries, generatedAt: new Date() })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unbekannter Fehler bei der Analyse.'
        setAiInsights({ status: 'error', summary: message, entries: [], generatedAt: null })
      }
    }, 120)
  }

  return (
    <div className="grid">
      <div className="panel" style={{ padding: 12, gridColumn: '1 / -1' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, flexWrap:'wrap', marginBottom:8 }}>
          <div style={{ display:'flex', flexDirection:'column' }}>
            <strong>KI-Einblicke</strong>
            {aiInsights.status === 'ready' && aiInsights.generatedAt && (
              <span style={{ color:'var(--muted)', fontSize:12 }}>Aktualisiert: {aiInsights.generatedAt.toLocaleString('de-DE')}</span>
            )}
          </div>
          <div style={{ display:'flex', gap:12, alignItems:'center', flexWrap:'wrap' }}>
            <label style={{ display:'flex', alignItems:'center', gap:4, fontSize:12 }}>
              <input type="checkbox" checked={insightFilters.riskOnly} onChange={(e)=>setInsightFilters((prev)=>({ ...prev, riskOnly: e.target.checked }))} />
              Nur Risiken
            </label>
            <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:12 }}>
              Mindestanteil %
              <input className="input" type="number" min="0" max="100" value={insightFilters.minShare} onChange={(e)=>setInsightFilters((prev)=>({ ...prev, minShare: Math.max(0, Math.min(100, Number(e.target.value) || 0)) }))} style={{ width: 70 }} />
            </label>
            <button className="btn" onClick={generateAiInsights} disabled={aiInsights.status === 'loading'}>
              {aiInsights.status === 'loading' ? 'Analysiere…' : 'Analyse starten'}
            </button>
            <button className="btn" onClick={copyInsightsToClipboard} disabled={aiInsights.status !== 'ready' || !filteredEntries.length}>
              {copyStatus === 'copied' ? 'Kopiert!' : copyStatus === 'error' ? 'Kopieren fehlgeschlagen' : 'Insights kopieren'}
            </button>
            <button className="btn" onClick={downloadInsightsMarkdown} disabled={aiInsights.status !== 'ready'}>
              Markdown exportieren
            </button>
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
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              <InsightChip label="Gesamt" value={insightStats.total} tone="#0f172a" />
              <InsightChip label="Risiken" value={insightStats.Risk} tone={INSIGHT_TYPE_META.Risk.color} />
              <InsightChip label="Chancen" value={insightStats.Opportunity} tone={INSIGHT_TYPE_META.Opportunity.color} />
              <InsightChip label="Fokus" value={insightStats.Focus} tone={INSIGHT_TYPE_META.Focus.color} />
              <InsightChip label="Trends" value={insightStats.Trend} tone={INSIGHT_TYPE_META.Trend.color} />
              <InsightChip label="Info" value={insightStats.Info} tone={INSIGHT_TYPE_META.Info.color} />
            </div>
            <div style={{ display:'grid', gap:8 }}>
              {filteredEntries.map((entry) => {
                const meta = INSIGHT_TYPE_META[entry.type] || INSIGHT_TYPE_META.Info || { background:'rgba(71, 85, 105, 0.12)', color:'#475569' }
                return (
                  <div key={entry.id} style={{ padding:12, borderRadius:14, background:meta.background, border:`1px solid ${meta.color}22`, display:'flex', flexDirection:'column', gap:6, boxShadow:'0 4px 10px rgba(15,23,42,0.12)' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:8 }}>
                      <span style={{ fontWeight:700, color:meta.color, letterSpacing:0.2 }}>{entry.type}</span>
                      {entry.value && (
                        <span style={{ fontSize:12, fontWeight:600, color:meta.color, background:`${meta.color}1c`, padding:'2px 10px', borderRadius:999 }}>{entry.value}</span>
                      )}
                    </div>
                    <div style={{ fontWeight:700, fontSize:15 }}>{entry.title}</div>
                    <div style={{ color:'var(--muted)', lineHeight:1.45 }}>{entry.detail}</div>
                    {entry.meta && (
                      <div style={{ fontSize:12, color:meta.color, display:'flex', gap:6, alignItems:'center' }}>
                        <span role="img" aria-hidden="true">🎯</span>
                        <span>Betroffen: {entry.meta}</span>
                      </div>
                    )}
                  </div>
                )
              })}
              {aiInsights.entries.length > 0 && filteredEntries.length === 0 && (
                <div style={{ color:'var(--muted)', fontStyle:'italic' }}>Keine Einblicke passen zu den aktuellen Filtern.</div>
              )}
            </div>
            {monthlyBreakdown.length > 0 && (
              <div className="panel" style={{ padding:12, background:'var(--bg)', borderRadius:14 }}>
                <strong>Monatliche Entwicklung</strong>
                <div style={{ overflowX:'auto', marginTop:8 }}>
                  <table className="table" style={{ minWidth: 520 }}>
                    <thead>
                      <tr>
                        <th>Monat</th>
                        <th style={{ textAlign:'right' }}>Total (h)</th>
                        <th style={{ textAlign:'right' }}>Δ (h)</th>
                        <th style={{ textAlign:'right' }}>Δ %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthlyBreakdown.map((row, idx) => (
                        <tr key={idx}>
                          <td>{row.label}</td>
                          <td style={{ textAlign:'right' }}>{row.total.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
                          <td style={{ textAlign:'right' }}>{row.delta === null ? '–' : row.delta.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
                          <td style={{ textAlign:'right' }}>{row.deltaPct === null ? '–' : `${row.deltaPct.toFixed(1)}%`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
        </div>

      {hasSummaryData && (
        <div className="panel" style={{ padding: 12, gridColumn: '1 / -1' }}>
          <strong>Aggregierte Kennzahlen</strong>
          <div style={{ display: 'grid', gap: 12, marginTop: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
            {statsCards.map((card) => (
              <div key={card.label} className="panel" style={{ padding: 12, background: 'var(--bg)', borderRadius: 12, border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ color: 'var(--muted)', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>{card.label}</span>
                <span style={{ fontSize: 20, fontWeight: 600 }}>{card.value}</span>
                {card.hint ? <span style={{ color: 'var(--muted)', fontSize: 12 }}>{card.hint}</span> : null}
              </div>
            ))}
          </div>
        </div>
      )}

      {hasMomentumData && (
        <div className="panel" style={{ padding: 12, gridColumn: '1 / -1' }}>
          <strong>Momentum-Analyse</strong>
          <div style={{ display: 'grid', gap: 16, marginTop: 12 }}>
            <div style={{ display: 'grid', gap: 10 }}>
              <span style={{ fontWeight: 600 }}>Momentum Kunden</span>
              <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                <div>
                  <span style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase' }}>Aufwärtstrend</span>
                  {renderMomentumList(customerMomentum.positive || [], 'positive')}
                </div>
                <div>
                  <span style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase' }}>Abwärtstrend</span>
                  {renderMomentumList(customerMomentum.negative || [], 'negative')}
                </div>
              </div>
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              <span style={{ fontWeight: 600 }}>Momentum Projekte</span>
              <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                <div>
                  <span style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase' }}>Aufwärtstrend</span>
                  {renderMomentumList(projectMomentum.positive || [], 'positive')}
                </div>
                <div>
                  <span style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase' }}>Abwärtstrend</span>
                  {renderMomentumList(projectMomentum.negative || [], 'negative')}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

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

export function buildTrendInsights(monthlyTotals, metricLabel) {
  if (!monthlyTotals.length) {
    return [{
      id: 'trend-none',
      type: 'Info',
      title: 'Keine Zeitreihen',
      detail: 'Für den aktuellen Zeitraum liegen keine Monatsdaten vor.',
    }]
  }
  if (monthlyTotals.length === 1) {
    const label = formatMonthLabel(monthlyTotals[0].month)
    const value = Number(monthlyTotals[0].total || 0).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    return [{
      id: 'trend-single',
      type: 'Trend',
      title: 'Einzelmonat',
      detail: `Nur ein Monat verfügbar (${label}) mit insgesamt ${value} ${metricLabel}.`,
      value: value + ' h',
    }]
  }
  const entries = []
  const last = monthlyTotals[monthlyTotals.length - 1]
  const prev = monthlyTotals[monthlyTotals.length - 2]
  const diff = Number(last.total || 0) - Number(prev.total || 0)
  const prevTotal = Number(prev.total || 0)
  const diffPct = prevTotal ? (diff / prevTotal) * 100 : null
  entries.push({
    id: 'trend-current',
    type: 'Trend',
    title: diff >= 0 ? 'Aktuelle Steigerung' : 'Aktueller Rückgang',
    detail: `${diff >= 0 ? 'Steigerung' : 'Rückgang'} von ${Math.abs(diff).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} h${diffPct === null ? '' : ` (${diffPct.toFixed(1)}%)`} im Monat ${formatMonthLabel(last.month)} gegenüber ${formatMonthLabel(prev.month)}.`,
    value: diffPct === null ? `${Math.abs(diff).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} h` : `${diffPct.toFixed(1)}%`,
  })

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
    const deltaPct = Number(strongestDelta.prev ? ((strongestDelta.value / Number(strongestDelta.prev)) * 100) : null)
    entries.push({
      id: 'trend-strongest',
      type: 'Trend',
      title: strongestDelta.value >= 0 ? 'Größte Steigerung' : 'Stärkster Rückgang',
      detail: `Historische ${strongestDelta.value >= 0 ? 'größte Steigerung' : 'stärkster Rückgang'}: ${formatMonthLabel(strongestDelta.month)} vs. ${formatMonthLabel(strongestDelta.prev)} mit ${Math.abs(strongestDelta.value).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} h Differenz${Number.isFinite(deltaPct) ? ` (${deltaPct.toFixed(1)}%)` : ''}.`,
      value: Number.isFinite(deltaPct) ? `${deltaPct.toFixed(1)}%` : `${Math.abs(strongestDelta.value).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} h`,
    })
  }
  return entries
}

export function buildTrendBullets(monthlyTotals, metricLabel) {
  return buildTrendInsights(monthlyTotals, metricLabel).map((entry) => entry.detail)
}

export function formatHours(value, fractionDigits = 2) {
  const num = Number(value || 0)
  if (!Number.isFinite(num)) {
    return (0).toLocaleString('de-DE', { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits })
  }
  return num.toLocaleString('de-DE', { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits })
}

export function calcMedian(values) {
  const arr = (values || []).map((v) => Number(v)).filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  if (arr.length === 0) return 0
  const mid = Math.floor(arr.length / 2)
  if (arr.length % 2 === 0) return (arr[mid - 1] + arr[mid]) / 2
  return arr[mid]
}

export function calcStdDev(values) {
  const arr = (values || []).map((v) => Number(v)).filter((v) => Number.isFinite(v))
  if (arr.length === 0) return 0
  const mean = arr.reduce((sum, v) => sum + v, 0) / arr.length
  const variance = arr.reduce((sum, v) => sum + (v - mean) ** 2, 0) / arr.length
  return Math.sqrt(variance)
}

export function computeMomentum(months, seriesMap) {
  if (!Array.isArray(months) || months.length < 2 || !(seriesMap instanceof Map)) {
    return { positive: [], negative: [] }
  }
  const last = months[months.length - 1]
  const prev = months[months.length - 2]
  const positive = []
  const negative = []
  for (const [key, series] of seriesMap.entries()) {
    if (!(series instanceof Map)) continue
    const current = Number(series.get(last) || 0)
    const previous = Number(series.get(prev) || 0)
    const diff = current - previous
    if (!diff) continue
    const diffPct = previous ? (diff / previous) * 100 : (current ? null : 0)
    const entry = { key, current, prev: previous, diff, diffPct }
    if (diff > 0) positive.push(entry)
    else negative.push(entry)
  }
  positive.sort((a, b) => b.diff - a.diff)
  negative.sort((a, b) => a.diff - b.diff)
  return { positive: positive.slice(0, 5), negative: negative.slice(0, 5) }
}
