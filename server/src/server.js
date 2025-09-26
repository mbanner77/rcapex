import express from 'express';
import morgan from 'morgan';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import session from 'express-session';
import nodemailer from 'nodemailer';
import PDFDocument from 'pdfkit';
// Shared internal-project logic (single source of truth)
import { extractMeta as sharedExtractMeta, detectInternalDetail as sharedDetectInternalDetail, isInternalProject as sharedIsInternalProject, isExcludedByLeistungsart as sharedIsExcludedByLeistungsart, normalizeMapping as sharedNormalizeMapping } from '../../shared/internal.js'
// Using QuickChart for chart rendering to avoid native dependencies

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5175;

app.use(morgan('dev'));
app.use(cors({
  origin: (origin, cb) => cb(null, true),
  credentials: true,
}));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 8, // 8 hours
  },
}));

const APEX_BASE = (process.env.APEX_BASE || 'https://apex.realcore.group:8443/ords/realcore/controlling').trim();
const APEX_USERNAME = (process.env.APEX_USERNAME || '').trim();
const APEX_PASSWORD = (process.env.APEX_PASSWORD || '').trim();
// In-memory overrides editable via API (will be persisted to disk best-effort)
const APEX_OVERRIDES = { username: '', password: '' };
// Persisted mapping for internal projects (server-wide)
let PERSISTED_MAPPING = { projects: [], tokens: [] }

// Ensure there is always a default scheduled watchdog if none exists yet
function ensureDefaultWatchdogSchedule(){
  try {
    const hasWd = SCHEDULES.some(s => s && s.kind === 'watchdog_internal')
    if (hasWd) return
    const fallbackDefault = 'm.banner@realcore.de, olaf.glebsattel@realcore.de'
    const defaultStr = (String(SMTP_CONFIG.defaultRecipient||'').trim()) || fallbackDefault
    const recipients = defaultStr ? defaultStr.split(',').map(s=>s.trim()).filter(Boolean) : []
    const s = {
      id: 'watchdog-default',
      name: 'Watchdog (Standard)',
      active: true,
      kind: 'watchdog_internal',
      unit: 'ALL',
      threshold: 0.2,
      weeksBack: 1,
      useInternalShare: true,
      useZeroLastWeek: true,
      useMinTotal: false,
      minTotalHours: 0,
      combine: 'or',
      frequency: 'weekly',
      at: '06:00', // UTC
      weekdays: [1], // Monday
      dayOfMonth: 1,
      recipients,
    }
    SCHEDULES.push(s)
    saveSchedules().finally(()=>{})
  } catch (_) { /* ignore */ }
}

function extractMeta(row){
  return sharedExtractMeta(row)
}
function detectInternalDetail(row, mapping){
  return sharedDetectInternalDetail(row, mapping)
}

// Exclusion: rows where Leistungsart starts with 'J' are ignored by the watchdog
function isExcludedByLeistungsart(row){
  return sharedIsExcludedByLeistungsart(row)
}
// Persist helpers
async function loadPersistedApex() {
  try {
    const [{ default: path }, fs] = await Promise.all([import('path'), import('fs/promises')])
    const { fileURLToPath } = await import('url')
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = path.dirname(__filename)
    const configDir = path.resolve(__dirname, '../data')
    const configPath = path.join(configDir, 'config.json')
    // read file if exists
    let raw
    try { raw = await fs.readFile(configPath, 'utf8') } catch (_) { return }
    const json = JSON.parse(raw || '{}')
    if (json?.apex) {
      if (typeof json.apex.username === 'string') APEX_OVERRIDES.username = json.apex.username
      if (typeof json.apex.password === 'string') APEX_OVERRIDES.password = json.apex.password
    }
    // Load SMTP persisted settings, but only for fields not provided via ENV
    if (json?.smtp) {
      if (typeof json.smtp.host === 'string' && !process.env.SMTP_HOST) SMTP_CONFIG.host = json.smtp.host
      if (typeof json.smtp.port === 'number' && !process.env.SMTP_PORT) SMTP_CONFIG.port = json.smtp.port
      if (typeof json.smtp.secure === 'boolean' && !process.env.SMTP_SECURE) SMTP_CONFIG.secure = json.smtp.secure
      if (typeof json.smtp.user === 'string' && !process.env.SMTP_USER) SMTP_CONFIG.user = json.smtp.user
      if (typeof json.smtp.pass === 'string' && !process.env.SMTP_PASS) SMTP_CONFIG.pass = json.smtp.pass
      if (typeof json.smtp.defaultRecipient === 'string' && !process.env.SMTP_DEFAULT_RECIPIENT) SMTP_CONFIG.defaultRecipient = json.smtp.defaultRecipient
      if (typeof json.smtp.from === 'string' && !process.env.SMTP_FROM) SMTP_CONFIG.from = json.smtp.from
    }
    // Load persisted internal mapping (server-wide)
    if (json?.internalMapping) {
      const mp = json.internalMapping
      const projects = Array.isArray(mp?.projects) ? mp.projects : []
      const tokens = Array.isArray(mp?.tokens) ? mp.tokens : []
      PERSISTED_MAPPING = normalizeMapping({ projects, tokens })
    }
  } catch (_) { /* ignore */ }
}

// ---------------- Utilities: time and project helpers ----------------
function startOfIsoWeek(d) {
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = dt.getUTCDay() || 7 // 1..7 Mon..Sun
  dt.setUTCDate(dt.getUTCDate() - (day - 1)) // back to Monday
  dt.setUTCHours(0,0,0,0)
  return dt
}
function endOfIsoWeek(d) {
  const s = startOfIsoWeek(d)
  const e = new Date(s)
  e.setUTCDate(e.getUTCDate() + 6)
  e.setUTCHours(23,59,59,999)
  return e
}
function toIsoStringUTC(d){
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds())).toISOString().slice(0,19)+'Z'
}
function isoWeekId(d){
  const s = startOfIsoWeek(d)
  const year = s.getUTCFullYear()
  // week number: count weeks since first Thursday
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const weekStart = startOfIsoWeek(jan4)
  const diffDays = Math.floor((s - weekStart) / 86400000)
  const week = Math.floor(diffDays / 7) + 1
  const w = String(week).padStart(2, '0')
  return `${year}-W${w}`
}
function normalizeMapping(mapping){
  return sharedNormalizeMapping(mapping)
}
function parseMappingFromReq(req){
  try{
    const src = req?.method === 'POST' ? (req.body||{}) : (req.query||{})
    const rawP = src.mappingProjects
    const rawT = src.mappingTokens
    const toArr = (v)=> Array.isArray(v) ? v : (typeof v === 'string' ? v.split(',') : [])
    const m = normalizeMapping({ projects: toArr(rawP), tokens: toArr(rawT) })
    if ((m.projects.length + m.tokens.length) === 0) return PERSISTED_MAPPING
    return m
  }catch(_){ return PERSISTED_MAPPING }
}
function isInternalProject(row, mapping){
  return sharedIsInternalProject(row, mapping)
}

// Compute weekly internal share per employee for a given date range (inclusive)
async function computeWeeklyInternalShares({ unit = 'ALL', datum_von, datum_bis, mapping = {} }){
  const type = 'zeiten'
  // Always compute totals from ALL units
  const itemsAll = await getAggregatedItems({ type, unit: 'ALL', datum_von, datum_bis })

// DEBUG: return original, unmodified API payloads per unit (no field mapping or annotation)
app.get('/api/watchdogs/internal/debug-original', async (req, res) => {
  try {
    const unit = req.query.unit || 'ALL'
    const weeksBack = Math.max(1, Math.min(12, Number(req.query.weeksBack || 1)))
    const limit = Math.max(1, Math.min(20000, Number(req.query.limit || 2000)))
    // same range calc as watchdog
    const now = new Date()
    const day = now.getUTCDay() || 7
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day, 23, 59, 59))
    const start = new Date(end)
    start.setUTCDate(start.getUTCDate() - ((weeksBack * 7) - 6))
    const range = { datum_von: toIsoStringUTC(start), datum_bis: toIsoStringUTC(end) }

    const baseHeaders = buildHeaders({}, { datum_von: range.datum_von, datum_bis: range.datum_bis })
    const path = 'zeiten/'
    const fetchUnit = async (u) => {
      const sp = new URLSearchParams({ datum_von: range.datum_von, datum_bis: range.datum_bis, unit: u })
      const url = `${APEX_BASE}/${path}${sp.toString() ? `?${sp.toString()}` : ''}`
      const r = await axios.get(url, { headers: { ...baseHeaders, unit: u } })
      // return raw payload as-is
      const payload = r.data
      const arr = Array.isArray(payload?.items) ? payload.items : (Array.isArray(payload) ? payload : [])
      return { unit: u, count: arr.length, items: arr.slice(0, limit), payload }
    }

    let units = []
    if (!unit || unit === 'ALL') {
      units = await Promise.all(resolveUnitExtIds().map(u => fetchUnit(u)))
    } else {
      units = [await fetchUnit(unit)]
    }
    const totalCount = units.reduce((a,u)=>a+u.count,0)
    res.json({ ok: true, range, totalCount, units })
  } catch (e) {
    const status = e.response?.status || 500;
    res.status(status).json({ error: true, status, message: errMessage(e) });
  }
})

// Persisted server-wide mapping endpoints
app.get('/api/watchdogs/internal/mapping', async (req, res) => {
  res.json({ ok: true, mapping: PERSISTED_MAPPING })
})
app.post('/api/watchdogs/internal/mapping', async (req, res) => {
  try{
    const projects = Array.isArray(req.body?.projects) ? req.body.projects : []
    const tokens = Array.isArray(req.body?.tokens) ? req.body.tokens : []
    PERSISTED_MAPPING = normalizeMapping({ projects, tokens })
    await savePersistedApex()
    res.json({ ok: true, mapping: PERSISTED_MAPPING })
  }catch(e){
    const status = e.response?.status || 500;
    res.status(status).json({ error:true, status, message: errMessage(e) })
  }
})

 
  // If a specific unit is selected, we use it only to filter the employee set
  let empSetFilter = null
  if (unit && unit !== 'ALL') {
    const itemsUnit = await getAggregatedItems({ type, unit, datum_von, datum_bis })
    empSetFilter = new Set(itemsUnit.map(r => (r?.MITARBEITER ?? r?.mitarbeiter ?? '—').toString()))
  }
  // Map: weekId -> emp -> { total, internal }
  const weekEmp = new Map()
  const toNumber = (n)=>{ if(n==null)return 0; if(typeof n==='number')return n; if(typeof n==='string'){const s=n.replace(/\./g,'').replace(',', '.'); const v=Number(s); return isNaN(v)?0:v} return Number(n||0) }
  for (const r of itemsAll) {
    // Skip excluded Leistungsart (starts with 'J')
    if (isExcludedByLeistungsart(r)) continue
    const meta = extractMeta(r)
    // find a date for this entry – prefer DATUM fields
    const dstr = r?.DATUM || r?.datum || r?.DATE || r?.date || r?.BUCHUNGSDATUM || r?.buchungsdatum
    let d = undefined
    try { if (dstr) d = new Date(dstr) } catch {}
    if (!d || isNaN(d.getTime())) continue
    const wid = isoWeekId(d)
    const emp = (r?.MITARBEITER ?? r?.mitarbeiter ?? '—').toString()
    if (empSetFilter && !empSetFilter.has(emp)) continue
    const val = toNumber(r?.stunden_gel ?? r?.STD_GELEISTET ?? r?.STUNDEN ?? r?.stunden ?? r?.ZEIT ?? r?.zeit ?? 0)
    if (!val) continue
    if (!weekEmp.has(wid)) weekEmp.set(wid, new Map())
    const em = weekEmp.get(wid)
    if (!em.has(emp)) em.set(emp, { total: 0, internal: 0, kunde: '', leistungsart: '', projektcode: '' })
    const obj = em.get(emp)
    obj.total += val
    const isInt = isInternalProject(r, mapping)
    if (isInt) {
      obj.internal += val
      // Prefer internal meta when available
      obj.kunde = meta.kunde || obj.kunde
      obj.leistungsart = meta.leistungsart || obj.leistungsart
      obj.projektcode = meta.code || obj.projektcode
    } else {
      // Set defaults if not set yet
      if (!obj.kunde && meta.kunde) obj.kunde = meta.kunde
      if (!obj.leistungsart && meta.leistungsart) obj.leistungsart = meta.leistungsart
      if (!obj.projektcode && meta.code) obj.projektcode = meta.code
    }
  }
  // Flatten rows
  const rows = []
  for (const [wid, em] of weekEmp) {
    for (const [emp, { total, internal }] of em) {
      const pct = total > 0 ? (internal / total) : 0
      rows.push({ week: wid, mitarbeiter: emp, total, internal, pct, kunde: (em.get(emp)?.kunde||''), leistungsart: (em.get(emp)?.leistungsart||''), projektcode: (em.get(emp)?.projektcode||'') })
    }
  }
  // sort by week then pct desc
  rows.sort((a,b)=> a.week===b.week ? (b.pct - a.pct) : (a.week < b.week ? 1 : -1))
  return rows
}

// ---------------- Internal time watchdog ----------------
async function runInternalWatchdog({ unit = 'ALL', recipients = [], threshold = 0.2, weeksBack = 1, useInternalShare = true, useZeroLastWeek = true, useMinTotal = false, minTotalHours = 0, combine = 'or', mapping = {} }){
  // build range for last calendar week; allow weeksBack>1 by expanding range
  const now = new Date()
  // end at last week's Sunday 23:59:59
  const day = now.getUTCDay() || 7
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day, 23, 59, 59))
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - ((weeksBack * 7) - 6)) // go back weeksBack weeks to Monday
  const range = { datum_von: toIsoStringUTC(start), datum_bis: toIsoStringUTC(end) }
  const rows = await computeWeeklyInternalShares({ unit, datum_von: range.datum_von, datum_bis: range.datum_bis, mapping })
  // Index data for additional rules
  const byWeek = new Map()
  const byEmpTotals = new Map()
  const byEmpWeek = new Map()
  for (const r of rows) {
    if (!byWeek.has(r.week)) byWeek.set(r.week, [])
    byWeek.get(r.week).push(r)
    const ekey = r.mitarbeiter
    byEmpTotals.set(ekey, (byEmpTotals.get(ekey)||0) + Number(r.total||0))
    const wk = `${ekey}||${r.week}`
    byEmpWeek.set(wk, r)
  }
  // Determine last week id from range end
  const endDate = new Date(range.datum_bis)
  const lastWeekId = isoWeekId(endDate)

  // Build per-employee evaluation
  const empSet = new Set(rows.map(r=>r.mitarbeiter))
  const evalRows = []
  for (const e of empSet) {
    const reasons = []
    // internal share rule (any week in range exceeding threshold)
    if (useInternalShare) {
      const exceeded = rows.filter(r => r.mitarbeiter===e && r.pct >= Number(threshold||0.2))
      if (exceeded.length>0) reasons.push({ type:'internal_share', weeks: exceeded.map(x=>x.week), value: Math.max(...exceeded.map(x=>x.pct||0)) })
    }
    // zero last week rule
    if (useZeroLastWeek) {
      const rw = byEmpWeek.get(`${e}||${lastWeekId}`)
      const total = Number(rw?.total||0)
      if (!rw || total <= 0) reasons.push({ type:'zero_last_week', week: lastWeekId, value: 0 })
    }
    // min total hours across range
    if (useMinTotal && Number(minTotalHours||0) > 0) {
      const sum = Number(byEmpTotals.get(e)||0)
      if (sum < Number(minTotalHours)) reasons.push({ type:'min_total', value: sum, min: Number(minTotalHours) })
    }
    // Combine logic
    const triggered = reasons.length > 0 && (combine==='or' ? true : (
      (useInternalShare?1:0) + (useZeroLastWeek?1:0) + (useMinTotal?1:0) === reasons.length
    ))
    if (triggered) {
      // choose a representative row: prefer lastWeek if present, else highest internal pct
      const base = byEmpWeek.get(`${e}||${lastWeekId}`) || rows.filter(r=>r.mitarbeiter===e).sort((a,b)=> (b.pct||0)-(a.pct||0))[0] || { week:lastWeekId, mitarbeiter:e, total:0, internal:0, pct:0 }
      evalRows.push({ ...base, reasons })
    }
  }
  const offenders = evalRows
  // Prepare email
  const pctFmt = (p)=> `${(p*100).toFixed(1)}%`
  const hoursFmt = (n)=> new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n||0))
  let html = `<p>Watchdog (Unit ${unit||'ALL'}): letzte ${weeksBack} Woche(n)</p>`
  html += `<ul>`
  if (useInternalShare) html += `<li>Interner Anteil > ${pctFmt(threshold||0.2)}</li>`
  if (useZeroLastWeek) html += `<li>Keine Zeiten letzte Woche (${lastWeekId})</li>`
  if (useMinTotal) html += `<li>Summe Stunden < ${hoursFmt(minTotalHours||0)}</li>`
  html += `<li>Kombination: ${combine==='and'?'UND':'ODER'}</li>`
  html += `</ul>`
  if (offenders.length === 0) {
    html += '<p><strong>Keine Verstöße gefunden.</strong></p>'
  } else {
    html += `<p><strong>${offenders.length}</strong> Einträge:</p>`
    html += '<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse"><thead><tr><th>Woche</th><th>Mitarbeiter</th><th>Intern (h)</th><th>Gesamt (h)</th><th>Quote intern</th><th>Gründe</th></tr></thead><tbody>'
    for (const r of offenders) {
      const reasonsTxt = (r.reasons||[]).map(x=> x.type==='internal_share' ? `Interner Anteil > ${pctFmt(threshold||0.2)} (${(x.weeks||[]).join(',')})` : (x.type==='zero_last_week' ? `Keine Zeiten (${x.week})` : `Summe < ${hoursFmt(minTotalHours)}`)).join(', ')
      html += `<tr><td>${r.week}</td><td>${r.mitarbeiter}</td><td style="text-align:right">${hoursFmt(r.internal)}</td><td style="text-align:right">${hoursFmt(r.total)}</td><td style="text-align:right">${pctFmt(r.pct)}</td><td>${reasonsTxt}</td></tr>`
    }
    html += '</tbody></table>'
  }
  const csvLines = ['week;mitarbeiter;internal;total;pct;reasons']
    .concat(offenders.map(r => [r.week, r.mitarbeiter.replaceAll(';',','), r.internal, r.total, (r.pct*100).toFixed(1), (r.reasons||[]).map(x=>x.type).join('|')].join(';')))
  const attachments = [{ filename: 'watchdog_internal.csv', content: Buffer.from(csvLines.join('\n'), 'utf8') }]
  const subject = `Watchdog · ${unit||'ALL'} · ${range.datum_von.slice(0,10)}–${range.datum_bis.slice(0,10)}`
  if ((Array.isArray(recipients) ? recipients : [recipients]).filter(Boolean).length > 0) {
    await sendSmtpMail({ to: recipients, subject, html, text: html.replace(/<[^>]+>/g,' '), attachments })
  }
  return { range, rows, offenders }
}

// GET: watchdog internal report JSON
app.get('/api/watchdogs/internal/report', async (req, res) => {
  try {
    const unit = req.query.unit || 'ALL'
    const threshold = Number(req.query.threshold || 0.2)
    const weeksBack = Math.max(1, Math.min(12, Number(req.query.weeksBack || 1)))
    const useInternalShare = String(req.query.useInternalShare ?? 'true') !== 'false'
    const useZeroLastWeek = String(req.query.useZeroLastWeek ?? 'true') !== 'false'
    const useMinTotal = String(req.query.useMinTotal ?? 'false') === 'true'
    const minTotalHours = Number(req.query.minTotalHours || 0)
    const combine = (req.query.combine === 'and') ? 'and' : 'or'
    const mapping = parseMappingFromReq(req)
    const result = await runInternalWatchdog({ unit, recipients: [], threshold, weeksBack, useInternalShare, useZeroLastWeek, useMinTotal, minTotalHours, combine, mapping })
    res.json({ ok: true, ...result })
  } catch (e) {
    const status = e.response?.status || 500;
    res.status(status).json({ error: true, status, message: errMessage(e) });
  }
})

// POST: run watchdog and send email
app.post('/api/watchdogs/internal/run', async (req, res) => {
  try {
    const { unit = 'ALL', to, threshold = 0.2, weeksBack = 1, useInternalShare = true, useZeroLastWeek = true, useMinTotal = false, minTotalHours = 0, combine = 'or' } = req.body || {}
    const recipients = Array.isArray(to) ? to : (to ? [to] : [])
    if (recipients.length === 0) return res.status(400).json({ error: true, message: 'to required' })
    const mapping = parseMappingFromReq(req)
    const result = await runInternalWatchdog({ unit, recipients, threshold, weeksBack, useInternalShare, useZeroLastWeek, useMinTotal, minTotalHours, combine, mapping })
    res.json({ ok: true, ...result })
  } catch (e) {
    const status = e.response?.status || 500;
    res.status(status).json({ error: true, status, message: errMessage(e) });
  }
})

// HTML preview for watchdog results (for in-app iframe)
app.get('/api/watchdogs/internal/preview-page', async (req, res) => {
  function esc(s){ return String(s||'').replace(/[&<>]/g, c=> ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])) }
  try {
    const unit = req.query.unit || 'ALL'
    const threshold = Number(req.query.threshold || 0.2)
    const weeksBack = Math.max(1, Math.min(12, Number(req.query.weeksBack || 1)))
    const useInternalShare = String(req.query.useInternalShare ?? 'true') !== 'false'
    const useZeroLastWeek = String(req.query.useZeroLastWeek ?? 'true') !== 'false'
    const useMinTotal = String(req.query.useMinTotal ?? 'false') === 'true'
    const minTotalHours = Number(req.query.minTotalHours || 0)
    const combine = (req.query.combine === 'and') ? 'and' : 'or'
    const mapping = parseMappingFromReq(req)
    const result = await runInternalWatchdog({ unit, recipients: [], threshold, weeksBack, useInternalShare, useZeroLastWeek, useMinTotal, minTotalHours, combine, mapping })
    const rows = Array.isArray(result?.offenders) ? result.offenders : []
    const reasonsTxt = (r)=> (Array.isArray(r?.reasons)? r.reasons.map(x=> x.type==='internal_share' ? `internal_share (${(x.weeks||[]).join(',')})` : x.type).join(', ') : '')
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Watchdog Preview</title>
      <style>
        :root{ color-scheme: light; }
        body{ background:#ffffff; color:#111; font-family: -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif; padding:10px; }
        table{ border-collapse:collapse; width:100%; }
        th,td{ border:1px solid #ddd; padding:6px 8px; font-size:14px }
        th{ background:#f5f5f5; text-align:left }
        .right{text-align:right}
        .muted{color:#666}
        .note{ margin:10px 0; padding:8px; background:#f9fafb; border:1px solid #e5e7eb; border-radius:8px }
      </style></head><body>
      <div class="muted">Zeitraum: ${esc((result.range?.datum_von||'').slice(0,10))} – ${esc((result.range?.datum_bis||'').slice(0,10))} · Unit: ${esc(unit)}</div>
      <div class="note">Mapping aktiv: Codes=[${(mapping.projects||[]).join(', ')}], Tokens=[${(mapping.tokens||[]).join(', ')}]</div>
      <h3>Watchdog Ergebnisse (${rows.length})</h3>
      ${rows.length===0 ? `<div class="note">Keine Einträge für die gewählten Parameter. Bitte Schwellen/Zeitraum prüfen.</div>` : ''}
      <table><thead><tr><th>Woche</th><th>Mitarbeiter</th><th class="right">Intern (h)</th><th class="right">Gesamt (h)</th><th class="right">Anteil Intern</th><th>Gründe</th></tr></thead>
      <tbody>
      ${rows.map(r => `<tr><td>${esc(r.week)}</td><td>${esc(r.mitarbeiter)}</td><td class="right">${Number(r.internal||0).toFixed(2)}</td><td class="right">${Number(r.total||0).toFixed(2)}</td><td class="right">${((r.pct||0)*100).toFixed(1)}%</td><td>${esc(reasonsTxt(r))}</td></tr>`).join('')}
      </tbody></table>
      </body></html>`
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(html)
  } catch (e) {
    const status = e.response?.status || 500;
    res.status(status).send(`<pre>${esc(errMessage(e))}</pre>`)
  }
})

// DEBUG: return a sample of aggregated items and detection stats
app.get('/api/watchdogs/internal/debug', async (req, res) => {
  try {
    const unit = req.query.unit || 'ALL'
    const weeksBack = Math.max(1, Math.min(12, Number(req.query.weeksBack || 1)))
    const limit = Math.max(1, Math.min(5000, Number(req.query.limit || 500)))
    // same range calc as watchdog
    const now = new Date()
    const day = now.getUTCDay() || 7
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day, 23, 59, 59))
    const start = new Date(end)
    start.setUTCDate(start.getUTCDate() - ((weeksBack * 7) - 6))
    const range = { datum_von: toIsoStringUTC(start), datum_bis: toIsoStringUTC(end) }
    const items = await getAggregatedItems({ type: 'zeiten', unit, datum_von: range.datum_von, datum_bis: range.datum_bis })
    const mapping = parseMappingFromReq(req)
    // Stats
    let internalCnt = 0
    const byCode = new Map()
    const byToken = new Map()
    let legacyPrefix = 0
    let legacyToken = 0
    const weeks = new Set()
    const fields = {}
    const sample = []
    const sampleFull = items.slice(0, limit)
    for (const r of items.slice(0, limit)) {
      // Apply same exclusion as the watchdog logic
      if (isExcludedByLeistungsart(r)) continue
      const det = detectInternalDetail(r, mapping)
      sample.push({
        MITARBEITER: r?.MITARBEITER ?? r?.mitarbeiter,
        PROJEKT: r?.PROJEKT ?? r?.projekt ?? r?.projektcode,
        NAME: r?.projektname ?? r?.PROJEKTNAME ?? r?.projekt,
        DATUM: r?.DATUM ?? r?.datum ?? r?.DATE ?? r?.date ?? r?.BUCHUNGSDATUM ?? r?.buchungsdatum,
        STUNDEN: r?.STUNDEN ?? r?.stunden ?? r?.STD_GELEISTET ?? r?.stunden_gel,
        INT: det.matched,
        MATCHED_BY: det.by || '',
        MATCH_VALUE: det.value || ''
      })
    }
    for (const r of items) {
      // Apply same exclusion as the watchdog logic
      if (isExcludedByLeistungsart(r)) continue
      const det = detectInternalDetail(r, mapping)
      if (det.matched){
        internalCnt++
        if (det.by === 'code') byCode.set(det.value, (byCode.get(det.value)||0)+1)
        else if (det.by === 'token') byToken.set(det.value, (byToken.get(det.value)||0)+1)
        else if (det.by === 'legacy_prefix') legacyPrefix++
        else if (det.by === 'legacy_token') legacyToken++
      }
      try {
        const dstr = r?.DATUM || r?.datum || r?.DATE || r?.date || r?.BUCHUNGSDATUM || r?.buchungsdatum
        if (dstr) weeks.add(isoWeekId(new Date(dstr)))
      } catch {}
      for (const k of Object.keys(r||{})) fields[k] = true
    }
    const stats = {
      matchedTotal: internalCnt,
      by: {
        code: Object.fromEntries(Array.from(byCode.entries()).sort((a,b)=>b[1]-a[1])),
        token: Object.fromEntries(Array.from(byToken.entries()).sort((a,b)=>b[1]-a[1])),
        legacy_prefix: legacyPrefix,
        legacy_token: legacyToken,
      }
    }
    res.json({ ok: true, range, count: items.length, internalDetected: internalCnt, weeks: Array.from(weeks), fields: Object.keys(fields), sample, sampleFull, stats, mappingUsed: mapping })
  } catch (e) {
    const status = e.response?.status || 500;
    res.status(status).json({ error: true, status, message: errMessage(e) });
  }
})

// GET preview (easier for window.open)
app.get('/api/reports/preview', async (req, res) => {
  try {
    const report = req.query.report || 'stunden'
    const unit = req.query.unit || 'ALL'
    const rangePreset = req.query.rangePreset || 'last_month'
    const download = String(req.query.download||'').toLowerCase()==='1'
    const range = computeRange(rangePreset)
    const type = report === 'umsatzliste' ? 'umsatzliste' : 'zeiten'
    const pdf = await generateReportPdf({ type, unit, datum_von: range.datum_von, datum_bis: range.datum_bis })
    const fname = `report_${report}_${unit}_${range.datum_von.slice(0,10)}_${range.datum_bis.slice(0,10)}.pdf`.replace(/[^a-zA-Z0-9._-]+/g,'_')
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `${download? 'attachment' : 'inline'}; filename="${fname}"`)
    res.send(pdf)
  } catch (e) {
    const status = e.response?.status || 500;
    res.status(status).json({ error: true, status, message: errMessage(e) });
  }
})

// GET preview by schedule id
app.get('/api/reports/preview/:scheduleId', async (req, res) => {
  try {
    const id = req.params.scheduleId
    const s = SCHEDULES.find(x => x.id === id)
    if (!s) return res.status(404).json({ error: true, message: 'schedule not found' })
    const { rangePreset = 'last_month', unit = 'ALL', report = 'stunden' } = s || {}
    const download = String(req.query.download||'').toLowerCase()==='1'
    const range = computeRange(rangePreset)
    const type = report === 'umsatzliste' ? 'umsatzliste' : 'zeiten'
    const pdf = await generateReportPdf({ type, unit, datum_von: range.datum_von, datum_bis: range.datum_bis })
    const fname = `report_${report}_${unit}_${range.datum_von.slice(0,10)}_${range.datum_bis.slice(0,10)}.pdf`.replace(/[^a-zA-Z0-9._-]+/g,'_')
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `${download? 'attachment' : 'inline'}; filename="${fname}"`)
    res.send(pdf)
  } catch (e) {
    const status = e.response?.status || 500;
    res.status(status).json({ error: true, status, message: errMessage(e) });
  }
})

// HTML wrapper page to embed the PDF (for Safari constraints)
app.get('/api/reports/preview-page', (req, res) => {
  const report = encodeURIComponent(req.query.report || 'stunden')
  const unit = encodeURIComponent(req.query.unit || 'ALL')
  const rangePreset = encodeURIComponent(req.query.rangePreset || 'last_month')
  const download = encodeURIComponent(req.query.download || '')
  const apiUrl = `/api/reports/preview?report=${report}&unit=${unit}&rangePreset=${rangePreset}${download?`&download=${download}`:''}`
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Report Vorschau</title><style>html,body{height:100%;margin:0} .toolbar{padding:8px;border-bottom:1px solid #ddd;display:flex;gap:8;align-items:center} iframe{border:0;width:100%;height:calc(100% - 42px)}</style></head><body><div class=\"toolbar\"><a href=\"${apiUrl}&download=1\">Download</a></div><iframe src=\"${apiUrl}\" title=\"Report\"></iframe></body></html>`
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.send(html)
})

// Generate CSV attachment (UTF-8)
async function generateCsv({ type, unit, datum_von, datum_bis }){
  const baseHeaders = buildHeaders({}, { datum_von, datum_bis })
  const isAll = !unit || unit === 'ALL'
  let items = []
  if (isAll) {
    const units = resolveUnitExtIds()
    const results = []
    for (const u of units) {
      const sp = new URLSearchParams({ datum_von, datum_bis, unit: u })
      const path = type === 'umsatzliste' ? 'umsatzliste' : 'zeiten/'
      const url = `${APEX_BASE}/${path}${sp.toString() ? `?${sp.toString()}` : ''}`
      const perHeaders = { ...baseHeaders, unit: u }
      const r = await axios.get(url, { headers: perHeaders })
      results.push(r.data)
    }
    for (const r of results) {
      const arr = Array.isArray(r?.items) ? r.items : (Array.isArray(r) ? r : [])
      items.push(...arr)
    }
  } else {
    const sp = new URLSearchParams({ datum_von, datum_bis, unit })
    const path = type === 'umsatzliste' ? 'umsatzliste' : 'zeiten/'
    const url = `${APEX_BASE}/${path}${sp.toString() ? `?${sp.toString()}` : ''}`
    const r = await axios.get(url, { headers: { ...baseHeaders, unit } })
    items = Array.isArray(r.data?.items) ? r.data.items : (Array.isArray(r.data) ? r.data : [])
  }
  const headers = type === 'umsatzliste'
    ? ['KUNDE','PROJEKT','UMSATZ']
    : ['MITARBEITER','KUNDE','STUNDEN']
  const lines = []
  lines.push(headers.join(';'))
  for (const r of items) {
    if (type === 'umsatzliste') {
      lines.push([safe(r?.KUNDE||r?.kunde), safe(r?.PROJEKT||r?.projekt), num(r?.UMSATZ||r?.umsatz)].join(';'))
    } else {
      lines.push([safe(r?.MITARBEITER||r?.mitarbeiter), safe(r?.KUNDE||r?.kunde), num(r?.STUNDEN||r?.stunden)].join(';'))
    }
  }
  function safe(s){ return (String(s??'')).replaceAll(';', ',') }
  function num(n){
    if (typeof n === 'string') return (n.replace(/\./g,'').replace(',', '.'))
    return String(n ?? 0)
  }
  return Buffer.from(lines.join('\n'), 'utf8')
}

// Helper: fetch aggregated raw items (handles unit=ALL)
async function getAggregatedItems({ type, unit, datum_von, datum_bis }){
  const baseHeaders = buildHeaders({}, { datum_von, datum_bis })
  const isAll = !unit || unit === 'ALL'
  let items = []
  if (isAll) {
    const units = resolveUnitExtIds()
    const results = []
    for (const u of units) {
      const sp = new URLSearchParams({ datum_von, datum_bis, unit: u })
      const path = type === 'umsatzliste' ? 'umsatzliste' : 'zeiten/'
      const url = `${APEX_BASE}/${path}${sp.toString() ? `?${sp.toString()}` : ''}`
      const perHeaders = { ...baseHeaders, unit: u }
      const r = await axios.get(url, { headers: perHeaders })
      results.push(r.data)
    }
    for (const r of results) {
      const arr = Array.isArray(r?.items) ? r.items : (Array.isArray(r) ? r : [])
      items.push(...arr)
    }
  } else {
    const sp = new URLSearchParams({ datum_von, datum_bis, unit })
    const path = type === 'umsatzliste' ? 'umsatzliste' : 'zeiten/'
    const url = `${APEX_BASE}/${path}${sp.toString() ? `?${sp.toString()}` : ''}`
    const r = await axios.get(url, { headers: { ...baseHeaders, unit } })
    items = Array.isArray(r.data?.items) ? r.data.items : (Array.isArray(r.data) ? r.data : [])
  }
  return items
}
async function savePersistedApex() {
  try {
    const [{ default: path }, fs, fsn] = await Promise.all([import('path'), import('fs'), import('fs/promises')])
    const { fileURLToPath } = await import('url')
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = path.dirname(__filename)
    const configDir = path.resolve(__dirname, '../data')
    const configPath = path.join(configDir, 'config.json')
    if (!fs.existsSync(configDir)) await fsn.mkdir(configDir, { recursive: true })
    // write merged config (APEX + SMTP) to disk
    let existing = {}
    try { existing = JSON.parse(await fsn.readFile(configPath, 'utf8')) } catch (_) { existing = {} }
    existing.apex = { username: APEX_OVERRIDES.username || '', password: APEX_OVERRIDES.password || '' }
    existing.smtp = {
      host: SMTP_CONFIG.host,
      port: SMTP_CONFIG.port,
      secure: SMTP_CONFIG.secure,
      user: SMTP_CONFIG.user,
      pass: SMTP_CONFIG.pass || '',
      defaultRecipient: SMTP_CONFIG.defaultRecipient || '',
      from: SMTP_CONFIG.from || ''
    }
    existing.internalMapping = PERSISTED_MAPPING
    await fsn.writeFile(configPath, JSON.stringify(existing, null, 2), 'utf8')
  } catch (_) { /* ignore */ }
}

// ---------------- Reports / Scheduling ----------------

// In-memory schedules with persistence in server/data/config.json under key 'schedules'
const SCHEDULES = []

async function loadSchedules() {
  try {
    const [{ default: path }, fs] = await Promise.all([import('path'), import('fs/promises')])
    const { fileURLToPath } = await import('url')
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = path.dirname(__filename)
    const configPath = path.resolve(__dirname, '../data/config.json')
    let raw
    try { raw = await fs.readFile(configPath, 'utf8') } catch (_) { return }
    const json = JSON.parse(raw || '{}')
    const arr = Array.isArray(json?.schedules) ? json.schedules : []
    SCHEDULES.splice(0, SCHEDULES.length, ...arr)
  } catch (_) { /* ignore */ }
}

async function saveSchedules() {
  try {
    const [{ default: path }, fs, fsn] = await Promise.all([import('path'), import('fs'), import('fs/promises')])
    const { fileURLToPath } = await import('url')
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = path.dirname(__filename)
    const configDir = path.resolve(__dirname, '../data')
    const configPath = path.join(configDir, 'config.json')
    if (!fs.existsSync(configDir)) await fsn.mkdir(configDir, { recursive: true })
    let existing = {}
    try { existing = JSON.parse(await fsn.readFile(configPath, 'utf8')) } catch (_) { existing = {} }
    existing.schedules = SCHEDULES
    await fsn.writeFile(configPath, JSON.stringify(existing, null, 2), 'utf8')
  } catch (_) { /* ignore */ }
}

// Helper: compute date range by preset
function computeRange(preset) {
  const now = new Date()
  const toIso = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds())).toISOString().slice(0,19)+'Z'
  if (preset === 'last_week') {
    // last calendar week Mon-Sun relative to UTC
    const day = now.getUTCDay() || 7
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day, 23, 59, 59))
    const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - 6, 0, 0, 0))
    return { datum_von: toIso(start), datum_bis: toIso(end) }
  }
  // default last month
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 0, 0, 0))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59))
  return { datum_von: toIso(start), datum_bis: toIso(end) }
}

// Generate PDF buffer for a report
async function generateReportPdf({ type, unit, datum_von, datum_bis }) {
  const baseHeaders = buildHeaders({}, { datum_von, datum_bis })
  const isAll = !unit || unit === 'ALL'
  let items = []
  if (isAll) {
    const units = resolveUnitExtIds()
    const results = []
    for (const u of units) {
      const sp = new URLSearchParams({ datum_von, datum_bis, unit: u })
      const path = type === 'umsatzliste' ? 'umsatzliste' : 'zeiten/'
      const url = `${APEX_BASE}/${path}${sp.toString() ? `?${sp.toString()}` : ''}`
      const perHeaders = { ...baseHeaders, unit: u }
      const r = await axios.get(url, { headers: perHeaders })
      results.push(r.data)
    }
    for (const r of results) {
      const arr = Array.isArray(r?.items) ? r.items : (Array.isArray(r) ? r : [])
      items.push(...arr)
    }
  } else {
    const sp = new URLSearchParams({ datum_von, datum_bis, unit })
    const path = type === 'umsatzliste' ? 'umsatzliste' : 'zeiten/'
    const url = `${APEX_BASE}/${path}${sp.toString() ? `?${sp.toString()}` : ''}`
    const r = await axios.get(url, { headers: { ...baseHeaders, unit } })
    items = Array.isArray(r.data?.items) ? r.data.items : (Array.isArray(r.data) ? r.data : [])
  }
  // Build polished PDF
  const doc = new PDFDocument({ margin: 36 })
  const chunks = []
  doc.on('data', c => chunks.push(c))

  // Header (optional logo)
  const title = type === 'umsatzliste' ? 'Umsatzliste' : 'Stunden'
  try {
    const logoUrl = (process.env.PDF_LOGO_URL || 'https://realcore.info/bilder/rc-logo.png').trim()
    if (logoUrl) {
      const lr = await axios.get(logoUrl, { responseType: 'arraybuffer' })
      const lb = Buffer.from(lr.data)
      // draw logo at current cursor and then advance y by fixed height to avoid overlap
      const logoH = 40
      doc.image(lb, { fit: [140, logoH] })
      doc.y = (doc.y || 36) + logoH + 12
    }
  } catch (_) { /* ignore logo errors */ }
  // Title below logo
  doc.fillColor('#111').fontSize(20).text(`${title}`, { align: 'left' })
  doc.moveDown(0.3)
  const fmt = (s)=>{ try { const d=new Date(s); return new Intl.DateTimeFormat('de-DE').format(d) } catch { return s } }

  // Compute display value per row and filter out zeros consistently
  function toNumber(n){ if (n==null) return 0; if (typeof n==='number') return n; if (typeof n==='string'){ const s=n.replace(/\./g,'').replace(',', '.'); const v=Number(s); return isNaN(v)?0:v } return Number(n||0) }
  function rowValue(r){
    if (type === 'umsatzliste') {
      return toNumber(r?.UMSATZ ?? r?.umsatz ?? r?.BETRAG ?? r?.betrag ?? r?.SUMME ?? r?.summe ?? r?.NETTO ?? r?.netto ?? r?.WERT ?? r?.wert ?? 0)
    }
    return toNumber(r?.stunden_gel ?? r?.stunden_fakt ?? r?.STD_GELEISTET ?? r?.STD_FAKTURIERT ?? r?.std_geleistet ?? r?.std_fakturiert ?? r?.STUNDEN ?? r?.stunden ?? r?.ZEIT ?? r?.zeit ?? r?.HOURS ?? r?.hours ?? 0)
  }
  const dataRows = items.map(r => ({ ...r, __val: rowValue(r) })).filter(r => r.__val > 0)

  doc.fillColor('#555').fontSize(11).text(`Zeitraum: ${fmt(datum_von)} – ${fmt(datum_bis)}`)
  doc.fillColor('#555').fontSize(11).text(`Unit: ${unit || 'ALL'}  •  Datensätze: ${dataRows.length}`)
  doc.moveDown(0.8)

  // Footer with page numbers
  const baseY = doc.y
  const footer = () => {
    const range = doc.bufferedPageRange()
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i)
      const pageNo = i + 1
      doc.fontSize(9).fillColor('#888')
      doc.text(`Seite ${pageNo}`, 36, doc.page.height - 28, { width: doc.page.width - 72, align: 'right' })
    }
  }

  // Table renderer
  function drawTable(columns, rows) {
    const startX = 36
    let y = doc.y
    const rowH = 18
    const headerBg = '#f1f3f5'
    const zebra = ['#ffffff', '#fafafa']
    const border = '#e5e7eb'

    // compute widths
    const totalWeight = columns.reduce((a,c)=>a+(c.w||1),0)
    const usableW = doc.page.width - 72
    const colWidths = columns.map(c => Math.floor(usableW * (c.w||1) / totalWeight))

    // Header
    doc.save().rect(startX, y, usableW, rowH).fill(headerBg).restore()
    doc.fontSize(10).fillColor('#111')
    let x = startX
    columns.forEach((c, idx) => {
      doc.text(c.label, x+6, y+5, { width: colWidths[idx]-12, align: c.align||'left' })
      x += colWidths[idx]
    })
    y += rowH
    // underline
    doc.moveTo(startX, y).lineTo(startX+usableW, y).strokeColor(border).lineWidth(0.5).stroke()

    // Rows
    doc.fontSize(10).fillColor('#111')
    rows.forEach((r, i) => {
      // page break
      if (y + rowH > doc.page.height - 54) {
        doc.addPage(); y = 36
        // re-draw header on new page
        doc.save().rect(startX, y, usableW, rowH).fill(headerBg).restore()
        doc.fontSize(10).fillColor('#111')
        let hx = startX
        columns.forEach((c, idx) => { doc.text(c.label, hx+6, y+5, { width: colWidths[idx]-12, align: c.align||'left' }); hx += colWidths[idx] })
        y += rowH
        doc.moveTo(startX, y).lineTo(startX+usableW, y).strokeColor(border).lineWidth(0.5).stroke()
      }
      // zebra
      const bg = zebra[i % 2]
      doc.save().rect(startX, y, usableW, rowH).fill(bg).restore()
      // cells
      let cx = startX
      columns.forEach((c, idx) => {
        const v = (typeof c.value === 'function') ? c.value(r, (r && typeof r.__index === 'number') ? r.__index : i) : r[c.key]
        doc.fillColor('#111').text(String(v ?? ''), cx+6, y+4, { width: colWidths[idx]-12, align: c.align||'left' })
        cx += colWidths[idx]
      })
      y += rowH
    })

    doc.moveDown(0.5)
    doc.y = y
  }

  // Group by Kunde (optional subtotals)
  function groupByKunde(rows) {
    const map = new Map()
    for (const r of rows) {
      const k = r?.KUNDE ?? r?.kunde ?? '—'
      if (!map.has(k)) map.set(k, [])
      map.get(k).push(r)
    }
    return map
  }

  // helpers to extract numeric values across different field names
  function pickNumber(row, keys) {
    for (const k of keys) {
      if (row && row[k] != null) return parseNumber(row[k])
    }
    return 0
  }
  function pickText(row, keys) {
    for (const k of keys) {
      if (row && row[k] != null && String(row[k]).trim() !== '') return String(row[k])
    }
    return ''
  }

  // Define columns per report
  if (type === 'umsatzliste') {
    const cols = [
      { label: '#', w: 0.6, value: (_, i) => (typeof i === 'number' ? i+1 : '') },
      { label: 'Kunde', w: 2, value: (r) => pickText(r, ['KUNDE','kunde','kunde_name']) },
      { label: 'Projekt', w: 2, value: (r) => pickText(r, ['PROJEKT','projekt','projekt_name']) },
      { label: 'Umsatz', w: 1, align: 'right', value: (r) => formatNumber(r.__val) },
    ]
    // grouped table with subtotals per Kunde
    const groups = groupByKunde(dataRows)
    let running = 0
    for (const [kunde, rows] of groups) {
      doc.fontSize(12).fillColor('#222').text(kunde, { continued:false })
      drawTable(cols, rows.map((r,i)=>({ ...r, __index: i })))
      const gsum = rows.reduce((a,r)=> a + toNumber(r.__val), 0)
      running += gsum
      doc.fontSize(10).fillColor('#111').text(`Zwischensumme ${kunde}: ${formatNumber(gsum)}`, { align: 'right' })
      doc.moveDown(0.4)
    }
    // totals
    const sum = running
    doc.moveDown(0.3)
    doc.fontSize(11).fillColor('#111').text(`Summe Umsatz: ${formatNumber(sum)}`, { align: 'right' })
  } else {
    const cols = [
      { label: '#', w: 0.6, value: (_, i) => (typeof i === 'number' ? i+1 : '') },
      { label: 'Mitarbeiter', w: 2, value: (r) => pickText(r, ['MITARBEITER','mitarbeiter','name']) },
      { label: 'Kunde', w: 2, value: (r) => pickText(r, ['KUNDE','kunde']) },
      { label: 'Stunden', w: 1, align: 'right', value: (r) => formatNumber(r.__val) },
    ]
    const groups = groupByKunde(dataRows)
    let running = 0
    for (const [kunde, rows] of groups) {
      doc.fontSize(12).fillColor('#222').text(kunde, { continued:false })
      drawTable(cols, rows.map((r,i)=>({ ...r, __index: i })))
      const gsum = rows.reduce((a,r)=> a + toNumber(r.__val), 0)
      running += gsum
      doc.fontSize(10).fillColor('#111').text(`Zwischensumme ${kunde}: ${formatNumber(gsum)}`, { align: 'right' })
      doc.moveDown(0.4)
    }
    const sum = running
    doc.moveDown(0.3)
    doc.fontSize(11).fillColor('#111').text(`Summe Stunden: ${formatNumber(sum)}`, { align: 'right' })
  }

  // helpers
  function formatNumber(n){
    let num
    if (n == null) {
      num = 0
    } else if (typeof n === 'string') {
      // normalize: remove thousands '.' and convert decimal ',' to '.'
      const s = n.replace(/\./g, '').replace(',', '.')
      const parsed = Number(s)
      num = isNaN(parsed) ? 0 : parsed
    } else {
      num = Number(n||0)
    }
    return new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num)
  }

  function parseNumber(n){
    if (n == null) return 0
    if (typeof n === 'number') return n
    if (typeof n === 'string') {
      const s = n.replace(/\./g, '').replace(',', '.')
      const parsed = Number(s)
      return isNaN(parsed) ? 0 : parsed
    }
    return Number(n||0)
  }

  // Chart page (Top 10 nach Summe)
  try {
    const groups = new Map()
    for (const r of dataRows) {
      const k = r?.KUNDE ?? r?.kunde ?? '—'
      const v = toNumber(r.__val)
      groups.set(k, (groups.get(k)||0) + v)
    }
    const arr = Array.from(groups.entries()).sort((a,b)=>b[1]-a[1]).slice(0,10)
    if (arr.length > 0) {
      const cfg = {
        type: 'bar',
        data: { labels: arr.map(a=>a[0]), datasets: [{ label: type==='umsatzliste'?'Umsatz':'Stunden', data: arr.map(a=>a[1]), backgroundColor: 'rgba(37,99,235,0.6)' }] },
        options: { indexAxis: 'y', plugins: { legend: { display: false }, title: { display: true, text: 'Top 10 nach Kunde' } } }
      }
      const url = 'https://quickchart.io/chart?c=' + encodeURIComponent(JSON.stringify(cfg))
      const qr = await axios.get(url, { responseType: 'arraybuffer' })
      const img = Buffer.from(qr.data)
      doc.addPage()
      doc.fontSize(16).fillColor('#111').text('Diagramm', { align: 'left' })
      doc.moveDown(0.2)
      doc.image(img, { fit: [doc.page.width - 72, doc.page.height - 120] })
    }
  } catch (_) { /* chart optional */ }
  // Per-employee workload by project (stacked bars per unit)
  try {
    if (type === 'zeiten' && dataRows.length > 0) {
      const units = Array.from(new Set(dataRows.map(r => r.__unit || unit || 'ALL')))
      for (const u of units) {
        const rowsU = dataRows.filter(r => (r.__unit || unit || 'ALL') === u)
        if (rowsU.length === 0) continue
        // Build map: employee -> project -> sum(__val)
        const empMap = new Map()
        for (const r of rowsU) {
          const emp = (r?.MITARBEITER ?? r?.mitarbeiter ?? '—').toString()
          const proj = (r?.PROJEKT ?? r?.projekt ?? r?.projektcode ?? '—').toString()
          const val = toNumber(r.__val)
          if (!empMap.has(emp)) empMap.set(emp, new Map())
          const pm = empMap.get(emp)
          pm.set(proj, (pm.get(proj) || 0) + val)
        }
        // Rank employees by total, keep top 15
        const empTotals = Array.from(empMap.entries()).map(([e, pm]) => [e, Array.from(pm.values()).reduce((a,b)=>a+b,0)])
        empTotals.sort((a,b)=>b[1]-a[1])
        const labels = empTotals.slice(0,15).map(e=>e[0])
        if (labels.length === 0) continue
        // Determine top projects (across kept employees), keep top 5
        const projTotals = new Map()
        for (const e of labels) {
          const pm = empMap.get(e) || new Map()
          for (const [p,v] of pm) projTotals.set(p, (projTotals.get(p)||0)+v)
        }
        const topProjects = Array.from(projTotals.entries()).sort((a,b)=>b[1]-a[1]).slice(0,5).map(x=>x[0])
        // Build stacked datasets
        const datasets = []
        for (const p of topProjects) {
          const data = labels.map(e => (empMap.get(e)?.get(p)) ? Number(empMap.get(e).get(p)) : 0)
          datasets.push({ label: p, data })
        }
        // Aggregate other projects into 'Andere'
        const other = labels.map(e => {
          const pm = empMap.get(e) || new Map()
          let sum = 0
          for (const [p,v] of pm) { if (!topProjects.includes(p)) sum += Number(v||0) }
          return sum
        })
        if (other.some(v=>v>0)) datasets.push({ label: 'Andere', data: other })

        const cfg = {
          type: 'bar',
          data: { labels, datasets },
          options: {
            indexAxis: 'y',
            plugins: { legend: { position: 'bottom' }, title: { display: true, text: `Auslastung je Mitarbeiter (Unit ${u})` } },
            scales: { x: { stacked: true }, y: { stacked: true } }
          }
        }
        const url = 'https://quickchart.io/chart?c=' + encodeURIComponent(JSON.stringify(cfg))
        const qr = await axios.get(url, { responseType: 'arraybuffer' })
        const img = Buffer.from(qr.data)
        doc.addPage()
        doc.fontSize(16).fillColor('#111').text(`Auslastung je Mitarbeiter – Unit ${unitName(u)}`, { align: 'left' })
        doc.moveDown(0.2)
        doc.image(img, { fit: [doc.page.width - 72, doc.page.height - 120] })
      }
    }
  } catch (_) { /* optional */ }

  doc.end()
  await new Promise(res => doc.on('end', res))
  return Buffer.concat(chunks)
}

// Run a schedule once
async function runSchedule(s) {
  if (s?.kind === 'watchdog_internal') {
    // Ensure scheduled watchdog uses the server-persisted internal mapping
    await runInternalWatchdog({ ...s, mapping: PERSISTED_MAPPING })
    return
  }
  const { rangePreset = 'last_month', unit = 'ALL', report = 'stunden', recipients = [] } = s || {}
  const range = computeRange(rangePreset)
  const rtype = report === 'umsatzliste' ? 'umsatzliste' : 'zeiten'
  const pdf = await generateReportPdf({ type: rtype, unit, datum_von: range.datum_von, datum_bis: range.datum_bis })
  const csv = await generateCsv({ type: rtype, unit, datum_von: range.datum_von, datum_bis: range.datum_bis })
  const subject = `Report ${report} · ${unit || 'ALL'} · ${range.datum_von.slice(0,10)} – ${range.datum_bis.slice(0,10)}`
  await sendSmtpMail({ to: recipients, subject, text: 'Siehe Anhang.', attachments: [
    { filename: `report_${report}.pdf`, content: pdf },
    { filename: `report_${report}.csv`, content: csv }
  ] })
}

// Simple ticker: check every 60s
let tickerStarted = false
function startTicker(){
  if (tickerStarted) return; tickerStarted = true
  setInterval(() => {
    const now = new Date()
    for (const s of SCHEDULES) {
      if (!s?.active) continue
      try {
        const at = (s.at || '06:00').split(':').map(n => parseInt(n,10))
        const hour = at[0]||6, minute = at[1]||0
        if (s.frequency === 'daily') {
          if (now.getUTCHours() === hour && now.getUTCMinutes() === minute) runSchedule(s).catch(()=>{})
        } else if (s.frequency === 'weekly') {
          // weekdays: [1..7] (Mon..Sun), compare UTC day (0..6, Sunday=0)
          const wd = now.getUTCDay() || 7
          const list = Array.isArray(s.weekdays) ? s.weekdays : [1]
          if (list.includes(wd) && now.getUTCHours() === hour && now.getUTCMinutes() === minute) runSchedule(s).catch(()=>{})
        } else if (s.frequency === 'monthly') {
          const day = Math.max(1, Math.min(28, Number(s.dayOfMonth||1)))
          if (now.getUTCDate() === day && now.getUTCHours() === hour && now.getUTCMinutes() === minute) runSchedule(s).catch(()=>{})
        }
      } catch (_) { /* ignore one schedule */ }
    }
  }, 60000)
}

// API: schedules CRUD and run
app.get('/api/reports/schedules', (req, res) => {
  res.json({ items: SCHEDULES })
})

app.post('/api/reports/schedules', (req, res) => {
  const s = req.body || {}
  if (!Array.isArray(s.recipients) || s.recipients.length === 0) return res.status(400).json({ error: true, message: 'recipients required' })
  s.id = s.id || Math.random().toString(36).slice(2)
  const idx = SCHEDULES.findIndex(x => x.id === s.id)
  if (idx >= 0) SCHEDULES[idx] = s; else SCHEDULES.push(s)
  saveSchedules().finally(()=>{})
  res.json({ ok: true, id: s.id })
})

app.delete('/api/reports/schedules/:id', (req, res) => {
  const id = req.params.id
  const idx = SCHEDULES.findIndex(x => x.id === id)
  if (idx >= 0) SCHEDULES.splice(idx,1)
  saveSchedules().finally(()=>{})
  res.json({ ok: true })
})

app.post('/api/reports/run', async (req, res) => {
  try {
    const { scheduleId, report, unit, rangePreset, to } = req.body || {}
    if (scheduleId) {
      const s = SCHEDULES.find(x => x.id === scheduleId)
      if (!s) return res.status(404).json({ error: true, message: 'schedule not found' })
      await runSchedule(s)
      return res.json({ ok: true })
    }
    // ad-hoc
    const recipients = Array.isArray(to) ? to : (to ? [to] : [])
    if (recipients.length === 0) return res.status(400).json({ error: true, message: 'to required' })
    const preset = rangePreset || 'last_month'
    const range = computeRange(preset)
    const pdf = await generateReportPdf({ type: report === 'umsatzliste' ? 'umsatzliste' : 'zeiten', unit, datum_von: range.datum_von, datum_bis: range.datum_bis })
    const csv = await generateCsv({ type: report === 'umsatzliste' ? 'umsatzliste' : 'zeiten', unit, datum_von: range.datum_von, datum_bis: range.datum_bis })
    const subject = `Report ${report || 'stunden'} · ${unit || 'ALL'} · ${range.datum_von.slice(0,10)} – ${range.datum_bis.slice(0,10)}`
    await sendSmtpMail({ to: recipients, subject, text: 'Siehe Anhang.', attachments: [
      { filename: `report_${report||'stunden'}.pdf`, content: pdf },
      { filename: `report_${report||'stunden'}.csv`, content: csv },
    ] })
    res.json({ ok: true })
  } catch (e) {
    const status = e.response?.status || 500;
    res.status(status).json({ error: true, status, message: errMessage(e) });
  }
})

// Preview PDF (no email) – returns application/pdf
app.post('/api/reports/preview', async (req, res) => {
  try {
    const { report, unit, rangePreset } = req.body || {}
    const preset = rangePreset || 'last_month'
    const range = computeRange(preset)
    const type = report === 'umsatzliste' ? 'umsatzliste' : 'zeiten'
    const pdf = await generateReportPdf({ type, unit, datum_von: range.datum_von, datum_bis: range.datum_bis })
    const fname = `report_${report||'stunden'}_${(unit||'ALL')}_${range.datum_von.slice(0,10)}_${range.datum_bis.slice(0,10)}.pdf`.replace(/[^a-zA-Z0-9._-]+/g,'_')
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="${fname}"`)
    res.send(pdf)
  } catch (e) {
    const status = e.response?.status || 500;
    res.status(status).json({ error: true, status, message: errMessage(e) });
  }
})

// Debug endpoint: returns raw items and quick totals (no PDF/email)
app.post('/api/reports/debug', async (req, res) => {
  try {
    const { report, unit, rangePreset } = req.body || {}
    const preset = rangePreset || 'last_month'
    const range = computeRange(preset)
    const type = report === 'umsatzliste' ? 'umsatzliste' : 'zeiten'
    const items = await getAggregatedItems({ type, unit, datum_von: range.datum_von, datum_bis: range.datum_bis })
    const toNumber = (n)=>{ if(n==null)return 0; if(typeof n==='number')return n; if(typeof n==='string'){const s=n.replace(/\./g,'').replace(',', '.'); const v=Number(s); return isNaN(v)?0:v} return Number(n||0) }
    const rowValue = (r)=> type==='umsatzliste'
      ? toNumber(r?.UMSATZ ?? r?.umsatz ?? r?.BETRAG ?? r?.betrag ?? r?.SUMME ?? r?.summe ?? r?.NETTO ?? r?.netto ?? r?.WERT ?? r?.wert ?? 0)
      : toNumber(r?.stunden_gel ?? r?.stunden_fakt ?? r?.STD_GELEISTET ?? r?.STD_FAKTURIERT ?? r?.std_geleistet ?? r?.std_fakturiert ?? r?.STUNDEN ?? r?.stunden ?? r?.ZEIT ?? r?.zeit ?? r?.HOURS ?? r?.hours ?? 0)
    const mapped = items.map(r => ({ ...r, __val: rowValue(r) }))
    const nonZero = mapped.filter(r => r.__val > 0)
    const total = nonZero.reduce((a,r)=>a + r.__val, 0)
    res.json({ ok: true, count: items.length, countNonZero: nonZero.length, total, sample: mapped.slice(0, 25) })
  } catch (e) {
    const status = e.response?.status || 500;
    res.status(status).json({ error: true, status, message: errMessage(e) });
  }
})

// kick off load (best-effort); merge with env defaults
loadPersistedApex();
loadSchedules();
ensureDefaultWatchdogSchedule();

const DEFAULT_UNIT = process.env.DEFAULT_UNIT || 'h0zDeGnQIgfY3px';
const DEFAULT_DATUM_VON = process.env.DEFAULT_DATUM_VON || '2024-10-01T00:00:00Z';
const DEFAULT_DATUM_BIS = process.env.DEFAULT_DATUM_BIS || '2025-05-30T00:00:00Z';

// SMTP mail config (Strato defaults; can be overridden at runtime and persisted)
const SMTP_CONFIG = {
  host: (process.env.SMTP_HOST || 'smtp.strato.de').trim(),
  port: Number(process.env.SMTP_PORT || 465),
  secure: String(process.env.SMTP_SECURE || 'true').toLowerCase() === 'true',
  user: (process.env.SMTP_USER || 'm.banner@futurestore.shop').trim(),
  pass: (process.env.SMTP_PASS || '').trim(), // never expose via GET
  defaultRecipient: (process.env.SMTP_DEFAULT_RECIPIENT || 'm.banner@realcore.de, olaf.glebsattel@realcore.de').trim(),
  from: (process.env.SMTP_FROM || 'm.banner@futurestore.shop').trim(),
}

// Normalize error payloads to a readable string
function errMessage(e) {
  const raw = e?.response?.data || e?.message || e
  if (typeof raw === 'string') return raw
  try { return JSON.stringify(raw) } catch { return String(raw) }
}

// Debug logging control
const DEBUG_MAIL = (process.env.DEBUG_MAIL || '').toLowerCase() === '1' || (process.env.DEBUG_MAIL || '').toLowerCase() === 'true'
function logMail(...args){ if (DEBUG_MAIL) console.log('[MAIL]', ...args) }

async function sendSmtpMail({ to, subject, html, text, attachments }) {
  const transport = nodemailer.createTransport({
    host: SMTP_CONFIG.host,
    port: SMTP_CONFIG.port,
    secure: SMTP_CONFIG.secure,
    auth: SMTP_CONFIG.user && (SMTP_CONFIG.pass || '').length > 0 ? { user: SMTP_CONFIG.user, pass: SMTP_CONFIG.pass } : undefined,
  })
  const from = SMTP_CONFIG.from || SMTP_CONFIG.user
  const toList = (Array.isArray(to) ? to : [to]).filter(Boolean)
  logMail('SMTP send', { host: SMTP_CONFIG.host, port: SMTP_CONFIG.port, secure: SMTP_CONFIG.secure, from, to: toList, subject })
  const resp = await transport.sendMail({ from, to: toList.join(','), subject: subject || 'No subject', html, text, attachments })
  logMail('SMTP response', resp?.accepted)
}

// Units configuration: comma-separated list of ext_ids in env or fallback defaults
function resolveUnitExtIds() {
  const csv = process.env.UNIT_EXT_IDS;
  if (csv && csv.trim()) return csv.split(',').map(s => s.trim()).filter(Boolean);
  // Fallback defaults synced with client constants
  return [
    'zaE22GlNK6AZfBc', // SAP CWS
    'YytRDIbdYtOVax8', // SAP ABAP
    'VUmfO9SS3wXt2iB', // SAP PI/PO
    'h0zDeGnQIgfY3px', // SAP Basis
    'YtK84kUP26b7bMw', // RCC Transformation
    'eQnsTZhPu8GPFUm', // RCC Architecture
  ];
}

// Map Unit ext_id -> Display name (sync with client/src/lib/constants.js)
function unitName(id) {
  const map = {
    'zaE22GlNK6AZfBc': 'SAP CWS',
    'YytRDIbdYtOVax8': 'SAP ABAP',
    'VUmfO9SS3wXt2iB': 'SAP PI/PO',
    'h0zDeGnQIgfY3px': 'SAP Basis',
    'YtK84kUP26b7bMw': 'RCC Transformation',
    'eQnsTZhPu8GPFUm': 'RCC Architecture',
  }
  return map[id] || id || 'ALL'
}

if (!APEX_USERNAME || !APEX_PASSWORD) {
  console.warn('[WARN] APEX credentials are missing. Set APEX_USERNAME/APEX_PASSWORD in server/.env');
}

function authHeader(req) {
  // Prefer environment credentials first (stable across deploys), then overrides, then session
  const u = (APEX_USERNAME || APEX_OVERRIDES.username || req?.session?.apexUser);
  const p = (APEX_PASSWORD || APEX_OVERRIDES.password || req?.session?.apexPass);
  if (!u || !p) return {};
  const token = Buffer.from(`${u}:${p}`).toString('base64');
  return { Authorization: `Basic ${token}` };
}

function buildHeaders(req, { datum_von, datum_bis, unit }) {
  const headers = {
    ...authHeader(req),
    Accept: 'application/json',
    datum_von: datum_von || DEFAULT_DATUM_VON,
    datum_bis: datum_bis || DEFAULT_DATUM_BIS,
  }
  if (unit && unit !== 'ALL') {
    headers.unit = unit
  }
  return headers
}

function isHtmlPayload(payload) {
  if (!payload) return false;
  const s = typeof payload === 'string' ? payload : (typeof payload === 'object' ? payload?.toString?.() : '');
  return typeof s === 'string' && /<!DOCTYPE html>|<html[\s>]/i.test(s);
}

async function proxyGet(res, url, headers) {
  try {
    const response = await axios.get(url, { headers });
    res.status(response.status).json(response.data);
  } catch (err) {
    const status = err.response?.status || 500;
    // Provide concise, helpful JSON instead of raw HTML error pages
    let message = err.response?.data || err.message;
    if (isHtmlPayload(message)) {
      if (status === 401) {
        message = 'Unauthorized from APEX. Please verify APEX_USERNAME/APEX_PASSWORD and access rights.';
      } else {
        message = `Upstream error (${status}).`;
      }
    }
    res.status(status).json({ error: true, status, message });
  }
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// --- Mail endpoints (O365 / Microsoft Graph) ---
app.get('/api/mail/settings', (req, res) => {
  res.json({
    host: SMTP_CONFIG.host,
    port: SMTP_CONFIG.port,
    secure: SMTP_CONFIG.secure,
    user: SMTP_CONFIG.user,
    pass: SMTP_CONFIG.pass ? '********' : '',
    defaultRecipient: SMTP_CONFIG.defaultRecipient || '',
    from: SMTP_CONFIG.from || '',
  })
})

app.post('/api/mail/settings', (req, res) => {
  const { host, port, secure, user, pass, defaultRecipient, from } = req.body || {}
  // Only allow updates for fields not enforced by ENV
  if (typeof host === 'string' && !process.env.SMTP_HOST) SMTP_CONFIG.host = host
  if (typeof port === 'number' && !process.env.SMTP_PORT) SMTP_CONFIG.port = port
  if (typeof secure === 'boolean' && !process.env.SMTP_SECURE) SMTP_CONFIG.secure = secure
  if (typeof user === 'string' && !process.env.SMTP_USER) SMTP_CONFIG.user = user
  if (typeof defaultRecipient === 'string' && !process.env.SMTP_DEFAULT_RECIPIENT) SMTP_CONFIG.defaultRecipient = defaultRecipient
  if (typeof from === 'string' && !process.env.SMTP_FROM) SMTP_CONFIG.from = from
  if (typeof pass === 'string' && pass.trim() && !process.env.SMTP_PASS) SMTP_CONFIG.pass = pass
  savePersistedApex().finally(() => {})
  logMail('SMTP settings updated', { host: SMTP_CONFIG.host, port: SMTP_CONFIG.port, secure: SMTP_CONFIG.secure, user: SMTP_CONFIG.user, defaultRecipient: SMTP_CONFIG.defaultRecipient, from: SMTP_CONFIG.from, pass: SMTP_CONFIG.pass ? '***' : '' })
  // After mail settings update, ensure a default watchdog schedule exists (will use defaultRecipient if present)
  ensureDefaultWatchdogSchedule()
  res.json({ ok: true })
})

app.post('/api/mail/send', async (req, res) => {
  try {
    const { to, subject, html, text } = req.body || {};
    const recipient = to || SMTP_CONFIG.defaultRecipient;
    if (!recipient) return res.status(400).json({ error: true, message: 'Recipient missing. Provide `to` or configure defaultRecipient.' });
    await sendSmtpMail({ to: recipient, subject, html, text });
    res.json({ ok: true });
  } catch (e) {
    const status = e.response?.status || 500;
    res.status(status).json({ error: true, status, message: errMessage(e) });
  }
});

app.post('/api/mail/test', async (req, res) => {
  try {
    const { to } = req.body || {};
    const recipient = to || SMTP_CONFIG.defaultRecipient;
    if (!recipient) return res.status(400).json({ error: true, message: 'Recipient missing. Provide `to` or configure defaultRecipient.' });
    const now = new Date().toISOString();
    await sendSmtpMail({
      to: recipient,
      subject: `Testmail · Realcore Dashboard · ${now}`,
      html: `<p>Dies ist eine Test-E-Mail aus dem Realcore Dashboard.</p><p>Zeitstempel: <code>${now}</code></p>`,
    });
    logMail('Test mail sent to', recipient)
    res.json({ ok: true });
  } catch (e) {
    const status = e.response?.status || 500;
    res.status(status).json({ error: true, status, message: errMessage(e) });
  }
});

// --- APEX credential settings ---
app.get('/api/apex/settings', (req, res) => {
  const effectiveUser = APEX_USERNAME || APEX_OVERRIDES.username || ''
  const effectivePassSet = !!(APEX_PASSWORD || APEX_OVERRIDES.password)
  const source = APEX_USERNAME ? 'env' : (APEX_OVERRIDES.username ? 'override' : 'unset')
  res.json({ username: effectiveUser, password: effectivePassSet ? '********' : '', source })
})

app.post('/api/apex/settings', (req, res) => {
  const { username, password, useEnv } = req.body || {}
  if (useEnv === true) {
    // Clear overrides to fall back to environment variables
    APEX_OVERRIDES.username = ''
    APEX_OVERRIDES.password = ''
  } else {
    if (typeof username === 'string') APEX_OVERRIDES.username = username
    if (typeof password === 'string' && password.trim()) APEX_OVERRIDES.password = password
  }
  // Clear session creds to avoid confusion
  if (req.session) { req.session.apexUser = undefined; req.session.apexPass = undefined }
  savePersistedApex().finally(() => {})
  res.json({ ok: true })
})

app.post('/api/apex/test', async (req, res) => {
  try {
    const headers = buildHeaders(req, { datum_von: DEFAULT_DATUM_VON, datum_bis: DEFAULT_DATUM_BIS });
    const url = `${APEX_BASE}/zeiten/?limit=1`;
    const r = await axios.get(url, { headers });
    return res.json({ ok: true, status: r.status })
  } catch (e) {
    const status = e.response?.status || 500;
    let message = e.response?.data || e.message;
    if (isHtmlPayload(message)) message = `Upstream error (${status}).`;
    return res.status(status).json({ error: true, status, message })
  }
})

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get('/api/me', (req, res) => {
  if (req.session?.apexUser) {
    return res.json({ loggedIn: true, username: req.session.apexUser, source: 'session' });
  }
  if (APEX_USERNAME && APEX_PASSWORD) {
    return res.json({ loggedIn: true, username: APEX_USERNAME, source: 'env' });
  }
  res.json({ loggedIn: false });
});

app.get('/api/stunden', async (req, res) => {
  const headers = buildHeaders(req, req.query);
  // Pass all query params through as query string as well to mirror Postman behavior
  const sp = new URLSearchParams(req.query || {});
  const keys = Array.from(sp.keys()).map(k => k.toLowerCase());
  const hasPaging = keys.includes('limit') || keys.includes('pagesize') || keys.includes('page') || keys.includes('offset');
  if (!hasPaging) sp.set('limit', '10000');

  const requestedUnit = (req.query?.unit || '').toString();
  const treatAsAll = !requestedUnit || requestedUnit === 'ALL';

  if (treatAsAll) {
    try {
      const unitIds = resolveUnitExtIds();
      const results = [];
      for (const u of unitIds) {
        const perQs = new URLSearchParams(sp.toString());
        perQs.set('unit', u);
        const url = `${APEX_BASE}/zeiten/${perQs.toString() ? `?${perQs.toString()}` : ''}`;
        const perHeaders = { ...headers, unit: u };
        const r = await axios.get(url, { headers: perHeaders });
        results.push(r.data);
      }
      const merged = [];
      for (const r of results) {
        const arr = Array.isArray(r?.items) ? r.items : (Array.isArray(r) ? r : []);
        merged.push(...arr);
      }
      return res.json({ items: merged });
    } catch (err) {
      const status = err.response?.status || 500;
      let message = err.response?.data || err.message;
      if (isHtmlPayload(message)) message = `Upstream error (${status}).`;
      return res.status(status).json({ error: true, status, message });
    }
  }

  const qs = sp.toString();
  const url = `${APEX_BASE}/zeiten/${qs ? `?${qs}` : ''}`;
  await proxyGet(res, url, headers);
});

app.get('/api/umsatzliste', async (req, res) => {
  const headers = buildHeaders(req, req.query);
  const sp = new URLSearchParams(req.query || {});
  const keys = Array.from(sp.keys()).map(k => k.toLowerCase());
  const hasPaging = keys.includes('limit') || keys.includes('pagesize') || keys.includes('page') || keys.includes('offset');
  if (!hasPaging) sp.set('limit', '10000');

  const requestedUnit = (req.query?.unit || '').toString();
  const treatAsAll = !requestedUnit || requestedUnit === 'ALL';

  if (treatAsAll) {
    try {
      const unitIds = resolveUnitExtIds();
      const results = [];
      for (const u of unitIds) {
        const perQs = new URLSearchParams(sp.toString());
        perQs.set('unit', u);
        const url = `${APEX_BASE}/umsatzliste${perQs.toString() ? `?${perQs.toString()}` : ''}`;
        const perHeaders = { ...headers, unit: u };
        const r = await axios.get(url, { headers: perHeaders });
        results.push(r.data);
      }
      const merged = [];
      for (const r of results) {
        const arr = Array.isArray(r?.items) ? r.items : (Array.isArray(r) ? r : []);
        merged.push(...arr);
      }
      return res.json({ items: merged });
    } catch (err) {
      const status = err.response?.status || 500;
      let message = err.response?.data || err.message;
      if (isHtmlPayload(message)) message = `Upstream error (${status}).`;
      return res.status(status).json({ error: true, status, message });
    }
  }

  const qs = sp.toString();
  const url = `${APEX_BASE}/umsatzliste${qs ? `?${qs}` : ''}`;
  await proxyGet(res, url, headers);
});

// In production, serve built client
if (process.env.NODE_ENV === 'production') {
  Promise.all([import('path'), import('url'), import('fs')]).then(([{ default: path }, { fileURLToPath }, fsMod]) => {
    const fs = fsMod.default || fsMod
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const primary = path.resolve(__dirname, '../client-dist');
    const fallback = path.resolve(__dirname, '../../client/dist');
    const serveDir = fs.existsSync(primary) ? primary : fallback;
    console.log('[SERVER] Serving client from:', serveDir);
    app.use(express.static(serveDir));
    app.get('*', (_, res) => {
      res.sendFile(path.join(serveDir, 'index.html'));
    });
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on 0.0.0.0:${PORT} (accessible via local and external IPs)`);
  // start scheduler ticker
  startTicker();
});
