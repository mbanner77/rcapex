import React, { useMemo, useState } from 'react'
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
    </div>
  )
}
