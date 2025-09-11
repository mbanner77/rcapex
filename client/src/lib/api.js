import axios from 'axios'
import { UNITS } from './constants'

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
    const units = (UNITS || []).map(u => u.ext_id)
    const results = await Promise.all(units.map(ext_id => axios.get('/api/stunden', { params: { datum_von, datum_bis, unit: ext_id } }).then(r => r.data)))
    const merged = []
    for (const r of results) {
      const arr = Array.isArray(r?.items) ? r.items : (Array.isArray(r) ? r : [])
      merged.push(...arr)
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
    const units = (UNITS || []).map(u => u.ext_id)
    const results = await Promise.all(units.map(ext_id => axios.get('/api/umsatzliste', { params: { datum_von, datum_bis, unit: ext_id } }).then(r => r.data)))
    const merged = []
    for (const r of results) {
      const arr = Array.isArray(r?.items) ? r.items : (Array.isArray(r) ? r : [])
      merged.push(...arr)
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
