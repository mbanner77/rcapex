import express from 'express';
import morgan from 'morgan';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import session from 'express-session';

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

const APEX_BASE = process.env.APEX_BASE || 'https://apex.realcore.group:8443/ords/realcore/controlling';
const APEX_USERNAME = process.env.APEX_USERNAME || '';
const APEX_PASSWORD = process.env.APEX_PASSWORD || '';
// In-memory overrides editable via API
const APEX_OVERRIDES = { username: '', password: '' };

const DEFAULT_UNIT = process.env.DEFAULT_UNIT || 'h0zDeGnQIgfY3px';
const DEFAULT_DATUM_VON = process.env.DEFAULT_DATUM_VON || '2024-10-01T00:00:00Z';
const DEFAULT_DATUM_BIS = process.env.DEFAULT_DATUM_BIS || '2025-05-30T00:00:00Z';

// O365 / Microsoft Graph mail config (set in server/.env)
const O365 = {
  tenantId: process.env.O365_TENANT_ID || '',
  clientId: process.env.O365_CLIENT_ID || '',
  clientSecret: process.env.O365_CLIENT_SECRET || '',
  senderUpn: process.env.O365_SENDER_UPN || '', // e.g. techhub@realcore.de
  defaultRecipient: process.env.O365_DEFAULT_RECIPIENT || '',
};

// Simple in-memory token cache
const graphTokenCache = { accessToken: null, expiresAt: 0 };

// Normalize error payloads to a readable string
function errMessage(e) {
  const raw = e?.response?.data || e?.message || e
  if (typeof raw === 'string') return raw
  try { return JSON.stringify(raw) } catch { return String(raw) }
}

// Debug logging control
const DEBUG_MAIL = (process.env.DEBUG_MAIL || '').toLowerCase() === '1' || (process.env.DEBUG_MAIL || '').toLowerCase() === 'true'
function logMail(...args){ if (DEBUG_MAIL) console.log('[MAIL]', ...args) }

async function getGraphToken() {
  const now = Math.floor(Date.now() / 1000);
  if (graphTokenCache.accessToken && graphTokenCache.expiresAt - 60 > now) {
    logMail('Using cached token, expiresAt=', graphTokenCache.expiresAt)
    return graphTokenCache.accessToken;
  }
  if (!O365.tenantId || !O365.clientId || !O365.clientSecret) {
    throw new Error('O365 env vars missing: set O365_TENANT_ID, O365_CLIENT_ID, O365_CLIENT_SECRET');
  }
  logMail('Fetching new token for tenant=', O365.tenantId, 'clientId=', O365.clientId)
  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(O365.tenantId)}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: O365.clientId,
    client_secret: O365.clientSecret,
    grant_type: 'client_credentials',
    scope: 'https://graph.microsoft.com/.default',
  });
  const resp = await axios.post(tokenUrl, body.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  const { access_token, expires_in } = resp.data || {};
  if (!access_token) throw new Error('Failed to obtain Graph access token');
  graphTokenCache.accessToken = access_token;
  graphTokenCache.expiresAt = now + Number(expires_in || 3600);
  logMail('Token acquired, ttl(s)=', expires_in)
  return access_token;
}

async function sendGraphMail({ to, subject, html, text }) {
  if (!O365.senderUpn) throw new Error('O365_SENDER_UPN is not configured');
  const token = await getGraphToken();
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(O365.senderUpn)}/sendMail`;
  const content = html ? { contentType: 'HTML', content: html } : { contentType: 'Text', content: text || '' };
  const toList = (Array.isArray(to) ? to : [to]).filter(Boolean)
  const payload = {
    message: {
      subject: subject || 'No subject',
      body: content,
      toRecipients: toList.map((addr) => ({ emailAddress: { address: addr } })),
      from: { emailAddress: { address: O365.senderUpn } },
      sender: { emailAddress: { address: O365.senderUpn } },
    },
    saveToSentItems: true,
  };
  logMail('Sending mail', { from: O365.senderUpn, to: toList, subject: subject || 'No subject' })
  const resp = await axios.post(url, payload, { headers: { Authorization: `Bearer ${token}` } });
  logMail('Graph sendMail status=', resp.status)
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
  // Prefer API overrides, then session credentials, then env
  const u = (APEX_OVERRIDES.username || req?.session?.apexUser || APEX_USERNAME);
  const p = (APEX_OVERRIDES.password || req?.session?.apexPass || APEX_PASSWORD);
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
    tenantId: O365.tenantId || '',
    clientId: O365.clientId || '',
    clientSecret: O365.clientSecret ? '********' : '',
    senderUpn: O365.senderUpn || '',
    defaultRecipient: O365.defaultRecipient || '',
  })
})

app.post('/api/mail/settings', (req, res) => {
  const { tenantId, clientId, clientSecret, senderUpn, defaultRecipient } = req.body || {}
  if (typeof tenantId === 'string') O365.tenantId = tenantId
  if (typeof clientId === 'string') O365.clientId = clientId
  if (typeof senderUpn === 'string') O365.senderUpn = senderUpn
  if (typeof defaultRecipient === 'string') O365.defaultRecipient = defaultRecipient
  if (typeof clientSecret === 'string' && clientSecret.trim()) O365.clientSecret = clientSecret
  // invalidate token cache
  graphTokenCache.accessToken = null; graphTokenCache.expiresAt = 0
  logMail('Mail settings updated', { tenantId: O365.tenantId, clientId: O365.clientId, senderUpn: O365.senderUpn, defaultRecipient: O365.defaultRecipient, clientSecret: O365.clientSecret ? '***' : '' })
  res.json({ ok: true })
})

app.post('/api/mail/send', async (req, res) => {
  try {
    const { to, subject, html, text } = req.body || {};
    const recipient = to || O365.defaultRecipient;
    if (!recipient) return res.status(400).json({ error: true, message: 'Recipient missing. Provide `to` or set O365_DEFAULT_RECIPIENT.' });
    await sendGraphMail({ to: recipient, subject, html, text });
    res.json({ ok: true });
  } catch (e) {
    const status = e.response?.status || 500;
    res.status(status).json({ error: true, status, message: errMessage(e) });
  }
});

app.post('/api/mail/test', async (req, res) => {
  try {
    const { to } = req.body || {};
    const recipient = to || O365.defaultRecipient;
    if (!recipient) return res.status(400).json({ error: true, message: 'Recipient missing. Provide `to` or set O365_DEFAULT_RECIPIENT.' });
    const now = new Date().toISOString();
    await sendGraphMail({
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
  res.json({
    username: APEX_OVERRIDES.username || APEX_USERNAME || '',
    password: (APEX_OVERRIDES.password || APEX_PASSWORD) ? '********' : '',
    source: APEX_OVERRIDES.username ? 'override' : (APEX_USERNAME ? 'env' : 'unset'),
  })
})

app.post('/api/apex/settings', (req, res) => {
  const { username, password } = req.body || {}
  if (typeof username === 'string') APEX_OVERRIDES.username = username
  if (typeof password === 'string' && password.trim()) APEX_OVERRIDES.password = password
  // Clear session creds to avoid confusion
  if (req.session) { req.session.apexUser = undefined; req.session.apexPass = undefined }
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
