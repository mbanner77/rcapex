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
import { exportCustomersCsv, exportProjectsCsv } from './lib/export'
import Login from './components/Login.jsx'
import PasswordGate from './components/PasswordGate.jsx'
import SettingsDialog from './components/SettingsDialog.jsx'
import ReportSchedules from './components/ReportSchedules.jsx'
import { LOGO_URL } from './lib/constants'

const TAB_OPTIONS = [
  { value: 'overview', label: 'Übersicht' },
  { value: 'analytics', label: 'Analytik' },
  { value: 'employee', label: 'Mitarbeiter' },
  { value: 'compare', label: 'Vergleich' },
  { value: 'trends', label: 'Trends' },
  { value: 'umsatzliste', label: 'Umsatzliste' },
  { value: 'watchdog', label: 'Watchdog' },
  { value: 'timesheets', label: 'Erfassung' },
]

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
  const [tab, setTab] = useState(() => {
    try {
      const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('rc_activeTab') : null
      return saved || 'overview'
    } catch (_) {
      return 'overview'
    }
  }) // 'overview' | 'analytics' | 'employee' | 'compare' | 'trends' | 'umsatzliste' | 'watchdog' | 'timesheets'
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

  useEffect(() => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('rc_activeTab', tab)
      }
    } catch (_) {}
  }, [tab])

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
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <img src={LOGO_URL} alt="Realcore" className="brand-logo" />
          <div>
            <h1>Realcore Controlling Dashboard</h1>
            <p className="brand-sub">KI-gestützte Projekt- und Ressourcensteuerung</p>
          </div>
        </div>
        <div className="header-actions">
          <span className="userinfo">Angemeldet{auth.username ? `: ${auth.username}` : ''}</span>
          <div className="header-buttons">
            <button className="btn" onClick={() => setShowSchedules(true)}>Report-Zeitpläne</button>
            <button className="btn" onClick={() => setShowSettings(true)}>Einstellungen</button>
            <button className="btn" onClick={async () => { await logout(); setAuth({ checked: true, loggedIn: false, username: null }) }}>Logout</button>
          </div>
        </div>
      </header>

      <main className="app-main">
        <section className="panel filters-panel">
          <div className="panel-header">
            <div>
              <span className="panel-kicker">Zeitraum</span>
              <div className="panel-title">{format(parseISO(params.datum_von), 'dd.MM.yyyy', { locale: de })} – {format(parseISO(params.datum_bis), 'dd.MM.yyyy', { locale: de })}</div>
            </div>
            <div className="panel-meta">Unit: {params.unit || '–'}</div>
          </div>

          <Filters params={params} onParamsChange={setParams} defaults={DEFAULTS} />

          <div className="panel-body">
            {loading && <div className="status status-loading">Lade aktuelle Daten …</div>}
            {error && <div className="status status-error">Fehler: {String(error)}</div>}

            <div className="show-sm" style={{ marginBottom: 12 }}>
              <label className="visually-hidden" htmlFor="tab-select">Bereich wählen</label>
              <select id="tab-select" className="input" value={tab} onChange={(e) => setTab(e.target.value)}>
                {TAB_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>

            <nav className="tabs hide-sm" aria-label="Hauptnavigation">
              {TAB_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`tab ${tab === option.value ? 'active' : ''}`}
                  onClick={() => setTab(option.value)}
                  aria-pressed={tab === option.value}
                >
                  {option.label}
                </button>
              ))}
            </nav>

            {kundenAgg && (
              <div className="panel-toolbar">
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
              <AnalyticsTab kundenAgg={kundenAgg} stundenRaw={stundenRaw} params={params} />
            )}

            {tab === 'employee' && !loading && kundenAgg && (
              <EmployeeTab stundenRaw={stundenRaw} params={params} />
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
        </section>
      </main>

      <footer className="app-footer">
        <span>Stand: {new Date().toLocaleString('de-DE')}</span>
        <span>© {new Date().getFullYear()} Realcore GmbH</span>
      </footer>

      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
      {showSchedules && <ReportSchedules onClose={() => setShowSchedules(false)} />}
    </div>
  )
}
