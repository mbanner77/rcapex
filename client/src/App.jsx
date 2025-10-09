import React, { useEffect, useMemo, useState } from 'react'
import { de } from 'date-fns/locale'
import { format, parseISO } from 'date-fns'
import { fetchStunden, fetchUmsatzliste, me, logout } from './lib/api'
import { aggregateKundenFromStunden } from './lib/transform'
import Filters from './components/Filters.jsx'
import UmsatzTab from './components/UmsatzTab.jsx'
import CustomerTable from './components/CustomerTable.jsx'
import HoursByCustomerChart from './components/HoursByCustomerChart.jsx'
import AnalyticsTab from './components/AnalyticsTab.jsx'
import WatchdogTab from './components/WatchdogTab.jsx'
import ComparisonTab from './components/ComparisonTab.jsx'
import TrendTab from './components/TrendTab.jsx'
import EmployeeTab from './components/EmployeeTab.jsx'
import TimesheetsTab from './components/TimesheetsTab.jsx'
import TopMitarbeiterTab from './components/TopMitarbeiterTab.jsx'
import { exportCustomersCsv, exportProjectsCsv } from './lib/export'
import Login from './components/Login.jsx'
import PasswordGate from './components/PasswordGate.jsx'
import SettingsDialog from './components/SettingsDialog.jsx'
import ReportSchedules from './components/ReportSchedules.jsx'
import { LOGO_URL } from './lib/constants'

function getPrevMonthRange() {
  const now = new Date()
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 0, 0, 0))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59))
  const iso = (d) => d.toISOString().slice(0,19) + 'Z'
  return { datum_von: iso(start), datum_bis: iso(end) }
}

const DEFAULTS = {
  ...getPrevMonthRange(),
  unit: 'h0zDeGnQIgfY3px',
}

export default function App() {
  const [gate, setGate] = useState(false)
  const [auth, setAuth] = useState({ checked: false, loggedIn: false, username: null })
  const [tab, setTab] = useState('overview') // 'overview' | 'analytics' | 'employee' | 'top_employees' | 'compare' | 'trends' | 'umsatzliste' | 'watchdog' | 'timesheets'
  const [params, setParams] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('rc_params') || 'null')
      return saved ? { ...DEFAULTS, ...saved } : DEFAULTS
    } catch { return DEFAULTS }
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const [stundenRaw, setStundenRaw] = useState(null)
  const [umsatzRaw, setUmsatzRaw] = useState(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showSchedules, setShowSchedules] = useState(false)

  // Check session on load
  useEffect(() => {
    let cancelled = false
    me().then((r) => {
      if (!cancelled) setAuth({ checked: true, loggedIn: !!r.loggedIn, username: r.username || null })
    }).catch(() => {
      if (!cancelled) setAuth({ checked: true, loggedIn: false, username: null })
    })
    return () => { cancelled = true }
  }, [])

  // Load Stunden for all tabs (base dataset)
  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!auth.loggedIn) return
      // Skip base fetch when Watchdog tab is active to avoid blocking that tab
      if (tab === 'watchdog') return
      setLoading(true)
      setError(null)
      try {
        const data = await fetchStunden(params)
        if (!cancelled) setStundenRaw(data)
      } catch (e) {
        if (!cancelled) setError(e?.response?.data?.message || e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [auth.loggedIn, tab, params.datum_von, params.datum_bis, params.unit])

  // Persist params to localStorage (only essential fields)
  useEffect(() => {
    try {
      const toSave = { datum_von: params.datum_von, datum_bis: params.datum_bis, unit: params.unit }
      localStorage.setItem('rc_params', JSON.stringify(toSave))
    } catch {}
  }, [params.datum_von, params.datum_bis, params.unit])

  // Lazy-load Umsatzliste when Umsatzliste tab is active or params change
  useEffect(() => {
    let cancelled = false
    async function loadUmsatz() {
      if (!auth.loggedIn) return
      if (tab !== 'umsatzliste') return
      setLoading(true)
      setError(null)
      try {
        const data = await fetchUmsatzliste(params)
        if (!cancelled) setUmsatzRaw(data)
      } catch (e) {
        if (!cancelled) setError(e?.response?.data?.message || e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadUmsatz()
    return () => { cancelled = true }
  }, [auth.loggedIn, tab, params.datum_von, params.datum_bis, params.unit])

  const kundenAgg = useMemo(() => {
    if (!stundenRaw) return null
    try {
      return aggregateKundenFromStunden(stundenRaw)
    } catch (e) {
      console.error(e)
      return null
    }
  }, [stundenRaw])

  if (!gate) {
    return <PasswordGate onUnlock={() => setGate(true)} />
  }

  if (!auth.checked) {
    return <div style={{ padding: 16 }}>Lade…</div>
  }

  if (!auth.loggedIn) {
    return (
      <div className="container">
        <h1 style={{ marginBottom: 8 }}>Realcore Controlling Dashboard</h1>
        <p style={{ color: 'var(--muted)', marginBottom: 16 }}>Bitte anmelden mit APEX Zugangsdaten.</p>
        <Login onSuccess={() => setAuth({ checked: true, loggedIn: true, username: null })} />
      </div>
    )
  }

  return (
    <div className="container" style={{ fontFamily: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif' }}>
      <div className="header">
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <img src={LOGO_URL} alt="Realcore" style={{ height: 28 }} />
          <h1 style={{ margin: 0 }}>Realcore Controlling Dashboard</h1>
        </div>
        <div className="spacer" />
        <div className="userinfo">Angemeldet{auth.username ? `: ${auth.username}` : ''}</div>
        <button className="btn" style={{ marginRight: 8 }} onClick={() => setShowSchedules(true)}>Report-Zeitpläne</button>
        <button className="btn" style={{ marginRight: 8 }} onClick={() => setShowSettings(true)}>Einstellungen</button>
        <button className="btn" onClick={async () => { await logout(); setAuth({ checked: true, loggedIn: false, username: null }) }}>Logout</button>
      </div>
      <div style={{ color: 'var(--muted)', marginBottom: 12 }}>
        Zeitraum: {format(parseISO(params.datum_von), 'dd.MM.yyyy', { locale: de })} – {format(parseISO(params.datum_bis), 'dd.MM.yyyy', { locale: de })}
      </div>

      <div className="panel">
        <Filters params={params} onParamsChange={setParams} />

        <div className="content">
          {loading && <div>Loading…</div>}
          {error && <div style={{ color: 'crimson' }}>Fehler: {String(error)}</div>}

          {/* Small-screen tab selector */}
          <div className="show-sm" style={{ marginBottom: 8 }}>
            <select className="input" value={tab} onChange={(e) => setTab(e.target.value)}>
              <option value="overview">Übersicht</option>
              <option value="analytics">Analytik</option>
              <option value="employee">Mitarbeiter</option>
              <option value="top_employees">Top-Mitarbeiter</option>
              <option value="compare">Vergleich</option>
              <option value="trends">Trends</option>
              <option value="umsatzliste">Umsatzliste</option>
              <option value="watchdog">Watchdog</option>
              <option value="timesheets">Erfassung</option>
            </select>
          </div>

          <div className="tabs hide-sm">
            <div className={`tab ${tab==='overview' ? 'active' : ''}`} onClick={() => setTab('overview')}>Übersicht</div>
            <div className={`tab ${tab==='analytics' ? 'active' : ''}`} onClick={() => setTab('analytics')}>Analytik</div>
            <div className={`tab ${tab==='employee' ? 'active' : ''}`} onClick={() => setTab('employee')}>Mitarbeiter</div>
            <div className={`tab ${tab==='top_employees' ? 'active' : ''}`} onClick={() => setTab('top_employees')}>Top-Mitarbeiter</div>
            <div className={`tab ${tab==='compare' ? 'active' : ''}`} onClick={() => setTab('compare')}>Vergleich</div>
            <div className={`tab ${tab==='trends' ? 'active' : ''}`} onClick={() => setTab('trends')}>Trends</div>
            <div className={`tab ${tab==='umsatzliste' ? 'active' : ''}`} onClick={() => setTab('umsatzliste')}>Umsatzliste</div>
            <div className={`tab ${tab==='watchdog' ? 'active' : ''}`} onClick={() => setTab('watchdog')}>Watchdog</div>
            <div className={`tab ${tab==='timesheets' ? 'active' : ''}`} onClick={() => setTab('timesheets')}>Erfassung</div>
          </div>

          {kundenAgg && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <button className="btn" onClick={() => exportCustomersCsv(kundenAgg.kunden)}>Export Kunden (CSV)</button>
              <button className="btn" onClick={() => exportProjectsCsv(kundenAgg.kunden)}>Export Projekte (CSV)</button>
            </div>
          )}

          {tab === 'overview' && !loading && kundenAgg && (
            <div className="grid">
              <div>
                <CustomerTable kunden={kundenAgg.kunden} totals={kundenAgg.totals} />
              </div>
              <div>
                <HoursByCustomerChart kunden={kundenAgg.kunden} />
              </div>
            </div>
          )}

          {tab === 'analytics' && !loading && kundenAgg && (
            <AnalyticsTab kundenAgg={kundenAgg} stundenRaw={stundenRaw} />
          )}

          {tab === 'employee' && !loading && kundenAgg && (
            <EmployeeTab stundenRaw={stundenRaw} params={params} />
          )}

          {tab === 'top_employees' && !loading && kundenAgg && (
            <TopMitarbeiterTab stundenRaw={stundenRaw} params={params} />
          )}

          {tab === 'compare' && !loading && kundenAgg && (
            <ComparisonTab currentRaw={stundenRaw} params={params} />
          )}

          {tab === 'trends' && !loading && (
            <TrendTab params={params} />
          )}

          {tab === 'umsatzliste' && !loading && (
            <UmsatzTab umsatzRaw={umsatzRaw} params={params} />
          )}

          {tab === 'watchdog' && (
            <WatchdogTab />
          )}

          {tab === 'timesheets' && (
            <TimesheetsTab />
          )}
        </div>
      </div>
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
      {showSchedules && <ReportSchedules onClose={() => setShowSchedules(false)} />}
    </div>
  )
}
