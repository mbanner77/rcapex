import axios from 'axios'
import { getUnits } from './constants'

axios.defaults.withCredentials = true

export async function fetchStunden({ datum_von, datum_bis, unit }) {
  const params = { datum_von, datum_bis }
  if (unit && unit !== 'ALL') params.unit = unit
  // If ALL (or omitted), try server aggregation first
  if (!unit || unit === 'ALL') {
    const res = await axios.get('/api/stunden', { params })
    const items = Array.isArray(res.data?.items) ? res.data.items : (Array.isArray(res.data) ? res.data : [])
    if (items.length > 0) return res.data
    // Fallback: client-side union across known units
    const units = (getUnits() || []).map(u => u.ext_id)
    const results = await Promise.all(units.map(ext_id => axios.get('/api/stunden', { params: { datum_von, datum_bis, unit: ext_id } }).then(r => ({ unit: ext_id, data: r.data }))))
    const merged = []
    for (const r of results) {
      const arr = Array.isArray(r?.data?.items) ? r.data.items : (Array.isArray(r?.data) ? r.data : [])
      merged.push(...arr.map(x => ({ ...x, __unit: r.unit })))
    }
    return { items: merged }
  }
  const res = await axios.get('/api/stunden', { params })
  return res.data
}

export async function fetchUmsatzliste({ datum_von, datum_bis, unit }) {
  const params = { datum_von, datum_bis }
  if (unit && unit !== 'ALL') params.unit = unit
  if (!unit || unit === 'ALL') {
    const res = await axios.get('/api/umsatzliste', { params })
    const items = Array.isArray(res.data?.items) ? res.data.items : (Array.isArray(res.data) ? res.data : [])
    if (items.length > 0) return res.data
    const units = (getUnits() || []).map(u => u.ext_id)
    const results = await Promise.all(units.map(ext_id => axios.get('/api/umsatzliste', { params: { datum_von, datum_bis, unit: ext_id } }).then(r => ({ unit: ext_id, data: r.data }))))
    const merged = []
    for (const r of results) {
      const arr = Array.isArray(r?.data?.items) ? r.data.items : (Array.isArray(r?.data) ? r.data : [])
      merged.push(...arr.map(x => ({ ...x, __unit: r.unit })))
    }
    return { items: merged }
  }
  const res = await axios.get('/api/umsatzliste', { params })
  return res.data
}

export async function login(username, password) {
  const res = await axios.post('/api/login', { username, password })
  return res.data
}

export async function logout() {
  const res = await axios.post('/api/logout')
  return res.data
}

export async function me() {
  const res = await axios.get('/api/me')
  return res.data
}

// --- Mail settings API ---
export async function getMailSettings() {
  const res = await axios.get('/api/mail/settings')
  return res.data
}

export async function updateMailSettings(payload) {
  const res = await axios.post('/api/mail/settings', payload)
  return res.data
}

export async function sendMailTest(to) {
  const res = await axios.post('/api/mail/test', { to })
  return res.data
}

// --- APEX settings API ---
export async function getApexSettings() {
  const res = await axios.get('/api/apex/settings')
  return res.data
}

export async function updateApexSettings(payload) {
  const res = await axios.post('/api/apex/settings', payload)
  return res.data
}

export async function testApex() {
  const res = await axios.post('/api/apex/test')
  return res.data
}

// --- Report Schedules API ---
export async function listReportSchedules() {
  const res = await axios.get('/api/reports/schedules')
  return res.data
}

export async function upsertReportSchedule(payload) {
  const res = await axios.post('/api/reports/schedules', payload)
  return res.data
}

export async function deleteReportSchedule(id) {
  const res = await axios.delete(`/api/reports/schedules/${encodeURIComponent(id)}`)
  return res.data
}

export async function runReportNow(payload) {
  const res = await axios.post('/api/reports/run', payload)
  return res.data
}

export async function previewReportPdf(payload) {
  const res = await axios.post('/api/reports/preview', payload, { responseType: 'blob' })
  return res
}

// --- Watchdogs ---
export async function fetchInternalWatchdogReport(params) {
  const res = await axios.get('/api/watchdogs/internal/report', { params })
  return res.data
}

export async function runInternalWatchdog(payload) {
  const res = await axios.post('/api/watchdogs/internal/run', payload)
  return res.data
}

// --- Internal mapping (server-persisted) ---
export async function getInternalMappingServer() {
  const res = await axios.get('/api/watchdogs/internal/mapping')
  return res.data?.mapping || { projects: [], tokens: [], rules: [] }
}

export async function updateInternalMappingServer(mapping) {
  const payload = {
    projects: Array.isArray(mapping?.projects) ? mapping.projects : [],
    tokens: Array.isArray(mapping?.tokens) ? mapping.tokens : [],
    rules: Array.isArray(mapping?.rules) ? mapping.rules : [],
  }
  const res = await axios.post('/api/watchdogs/internal/mapping', payload)
  return res.data?.mapping || payload
}

// --- Timesheets watchdog ---
export async function fetchTimesheetsReport(params) {
  const res = await axios.get('/api/watchdogs/timesheets/report', { params })
  return res.data
}

export async function runTimesheetsWatchdog(payload) {
  const res = await axios.post('/api/watchdogs/timesheets/run', payload)
  return res.data
}
