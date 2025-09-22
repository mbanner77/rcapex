import express from 'express';
import morgan from 'morgan';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import session from 'express-session';
import nodemailer from 'nodemailer';
import PDFDocument from 'pdfkit';

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
  } catch (_) { /* ignore */ }
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
  const headers = buildHeaders({}, { datum_von, datum_bis, unit })
  const sp = new URLSearchParams({ datum_von, datum_bis })
  if (unit && unit !== 'ALL') sp.set('unit', unit)
  const url = `${APEX_BASE}/${type === 'umsatzliste' ? 'umsatzliste' : 'zeiten'}${sp.toString() ? `?${sp.toString()}` : ''}`
  const r = await axios.get(url, { headers })
  const items = Array.isArray(r.data?.items) ? r.data.items : (Array.isArray(r.data) ? r.data : [])
  // Build simple PDF
  const doc = new PDFDocument({ margin: 32 })
  const chunks = []
  doc.on('data', c => chunks.push(c))
  const title = type === 'umsatzliste' ? 'Umsatzliste' : 'Stunden'
  doc.fontSize(18).text(`Report: ${title}`, { continued: false })
  doc.moveDown(0.5)
  doc.fontSize(12).text(`Zeitraum: ${datum_von} – ${datum_bis}`)
  doc.text(`Unit: ${unit || 'ALL'}`)
  doc.moveDown()
  doc.fontSize(12).text(`Anzahl Datensätze: ${items.length}`)
  doc.moveDown()
  // print first rows
  const maxRows = Math.min(items.length, 30)
  for (let i=0; i<maxRows; i++) {
    const row = items[i]
    const line = type === 'umsatzliste'
      ? `${i+1}. Kunde: ${row?.KUNDE || row?.kunde || '-'} | Projekt: ${row?.PROJEKT || row?.projekt || '-'} | Umsatz: ${row?.UMSATZ || row?.umsatz || '-'}`
      : `${i+1}. Mitarbeiter: ${row?.MITARBEITER || row?.mitarbeiter || '-'} | Kunde: ${row?.KUNDE || row?.kunde || '-'} | Std: ${row?.STUNDEN || row?.stunden || '-'}`
    doc.fontSize(10).text(line)
  }
  if (items.length > maxRows) {
    doc.moveDown().fontSize(10).text(`… (${items.length - maxRows} weitere Zeilen)`)
  }
  doc.end()
  await new Promise(res => doc.on('end', res))
  return Buffer.concat(chunks)
}

// Run a schedule once
async function runSchedule(s) {
  const { rangePreset = 'last_month', unit = 'ALL', report = 'stunden', recipients = [] } = s || {}
  const range = computeRange(rangePreset)
  const pdf = await generateReportPdf({ type: report === 'umsatzliste' ? 'umsatzliste' : 'zeiten', unit, datum_von: range.datum_von, datum_bis: range.datum_bis })
  const subject = `Report ${report} · ${unit || 'ALL'} · ${range.datum_von.slice(0,10)} – ${range.datum_bis.slice(0,10)}`
  await sendSmtpMail({ to: recipients, subject, text: 'Siehe Anhang.', attachments: [{ filename: `report_${report}.pdf`, content: pdf }] })
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
    const subject = `Report ${report || 'stunden'} · ${unit || 'ALL'} · ${range.datum_von.slice(0,10)} – ${range.datum_bis.slice(0,10)}`
    await sendSmtpMail({ to: recipients, subject, text: 'Siehe Anhang.', attachments: [{ filename: `report_${report||'stunden'}.pdf`, content: pdf }] })
    res.json({ ok: true })
  } catch (e) {
    const status = e.response?.status || 500;
    res.status(status).json({ error: true, status, message: errMessage(e) });
  }
})

// kick off load (best-effort); merge with env defaults
loadPersistedApex();
loadSchedules();

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
  defaultRecipient: (process.env.SMTP_DEFAULT_RECIPIENT || '').trim(),
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
