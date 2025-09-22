import express from 'express';
import morgan from 'morgan';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import session from 'express-session';
import nodemailer from 'nodemailer';

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
    let existing = {}
    try { existing = JSON.parse(await fsn.readFile(configPath, 'utf8')) } catch (_) { existing = {} }
    existing.apex = { username: APEX_OVERRIDES.username || '', password: APEX_OVERRIDES.password || '' }
    // persist SMTP as well
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

// kick off load (best-effort); merge with env defaults
loadPersistedApex();

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

async function sendSmtpMail({ to, subject, html, text }) {
  const transport = nodemailer.createTransport({
    host: SMTP_CONFIG.host,
    port: SMTP_CONFIG.port,
    secure: SMTP_CONFIG.secure,
    auth: SMTP_CONFIG.user && (SMTP_CONFIG.pass || '').length > 0 ? { user: SMTP_CONFIG.user, pass: SMTP_CONFIG.pass } : undefined,
  })
  const from = SMTP_CONFIG.from || SMTP_CONFIG.user
  const toList = (Array.isArray(to) ? to : [to]).filter(Boolean)
  logMail('SMTP send', { host: SMTP_CONFIG.host, port: SMTP_CONFIG.port, secure: SMTP_CONFIG.secure, from, to: toList, subject })
  const resp = await transport.sendMail({ from, to: toList.join(','), subject: subject || 'No subject', html, text })
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
});
