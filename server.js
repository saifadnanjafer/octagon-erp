// Load environment variables from .env file.
// Security hardening 2026-07-05: load from __dirname (not process.cwd()) so
// provider keys resolve no matter which directory the server is launched from.
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const net = require('net');

// Reliability hardening (2026-07-12): this process has no supervisor
// (no PM2/systemd auto-restart) — before this handler, ANY unhandled
// exception in ANY request path (a double res.writeHead from a slow
// static-file read racing a client abort, a bug in a future module, etc.)
// killed the entire Node process, taking the whole app down for every
// user until someone noticed and manually restarted it. Observed live
// during this session: an ERR_HTTP_HEADERS_SENT in the static-file
// fs.readFile callback crashed the server outright. Log and keep serving
// — a single malformed HTTP response is recoverable; a dead process
// serving nobody is strictly worse for a live single-tenant workshop app.
const CRASH_LOG_FILE = path.join(__dirname, 'server-crash.log');
function logUnhandledError(kind, error) {
  const detail = error instanceof Error ? (error.stack || error.message) : String(error);
  console.error(`[${kind}] `, detail);
  try {
    fs.appendFileSync(CRASH_LOG_FILE, JSON.stringify({ at: new Date().toISOString(), kind, detail }) + '\n');
  } catch (_) { /* logging must never itself throw */ }
}
process.on('uncaughtException', error => logUnhandledError('uncaughtException', error));
process.on('unhandledRejection', reason => logUnhandledError('unhandledRejection', reason));
// Security hardening 2026-07-05: server-side Jarvis tool gate + AI key proxy.
const jarvisSecurity = require('./server-jarvis-security');
// T3.1: server-side scheduler (ir.cron equivalent) — read-only notification
// generators only, never posts finance/payroll directly (AI-governance
// philosophy: deterministic-first, approval-gated writes).
const { installOctagonScheduler } = require('./server-scheduler');

let DatabaseSync;
try {
  DatabaseSync = require('node:sqlite').DatabaseSync;
} catch (e) {
  console.warn('node:sqlite not supported in this Node.js version, SQLite mode disabled.');
}

const DEFAULT_PORT = Number(process.env.OCTAGON_DEFAULT_PORT || 8080);
const REQUESTED_PORT = Number(process.env.PORT || DEFAULT_PORT);
const FALLBACK_PORTS = String(process.env.OCTAGON_FALLBACK_PORTS || '8091,8092,8093,8094,8095')
  .split(',')
  .map(value => Number(value.trim()))
  .filter(value => Number.isInteger(value) && value > 0 && value !== REQUESTED_PORT);
let ACTIVE_PORT = REQUESTED_PORT;
let PORT = REQUESTED_PORT;
let FALLBACK_PORT_USED = false;
let PORT_WARNING = '';
let DEFAULT_PORT_PROBE = { checkedAt: '', occupied: null, error: '' };
const DB_FILE = process.env.OCTAGON_DB_FILE ? path.resolve(process.env.OCTAGON_DB_FILE) : path.join(__dirname, 'database.json');
const DB_PREV_FILE = DB_FILE + '.prev';
const SQLITE_DB_FILE = process.env.OCTAGON_SQLITE_DB_FILE ? path.resolve(process.env.OCTAGON_SQLITE_DB_FILE) : path.join(__dirname, 'database.db');
const SQLITE_DISABLED = process.env.USE_SQLITE === 'false';
const USE_SQLITE = !SQLITE_DISABLED && (process.env.USE_SQLITE === 'true' || fs.existsSync(SQLITE_DB_FILE)) && !!DatabaseSync;

let dbSync = null;
let platformAuthority = null;
let platformApiHandler = null;
let governanceStrangler = null;
let governanceCollections = null;
const BACKUP_KEEP = 30;
const AUTO_BACKUP_INTERVAL_MS = 60 * 60 * 1000; // at most one auto-snapshot per hour of activity
let lastAutoBackupMs = 0;
const BACKUP_TAG_RE = /[^a-z0-9_]/gi;
// T1.5: nightly backup cycle keeps the last 14 SCHEDULER-tagged snapshots and
// logs each run to server-backup.log. Kept tag-scoped so it never trims the
// hourly auto-backup set (keep 30) or manual snapshots.
const NIGHTLY_BACKUP_KEEP = 14;
const BACKUP_LOG_FILE = process.env.OCTAGON_BACKUP_LOG ? path.resolve(process.env.OCTAGON_BACKUP_LOG) : path.join(__dirname, 'server-backup.log');
const BACKUP_DIR = process.env.OCTAGON_BACKUP_DIR ? path.resolve(process.env.OCTAGON_BACKUP_DIR) : __dirname;
const REVIEW_REPORT_DIR = process.env.OCTAGON_REVIEW_REPORT_DIR ? path.resolve(process.env.OCTAGON_REVIEW_REPORT_DIR) : path.join(__dirname, 'review-reports');
const AUTH_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
// Phase 02: bounded request bodies on the heavy write routes (fail closed).
const MAX_FULL_SYNC_BODY_BYTES = 32 * 1024 * 1024;
const MAX_UPLOAD_BODY_BYTES = 16 * 1024 * 1024;
// Phase 02: session authority has moved to platform/identity/sessions (identity_sessions table).
// The legacy authSessions Map, auth_sessions table, and ACL.json are retired.
const V5_PRESERVED_TOP_LEVEL_KEYS = [
  '_schema_version',
  '_migrated_at',
  '_release_tag',
  '_release_tagged_at',
  '_lock_date',
  'contacts',
  'departments',
  'users',
  'locations',
  'quants',
  'stock_moves',
  'transfers',
  'journals',
  'journal_entries',
  'account_moves',
  'account_payments',
  'account_partial_reconciles',
  'employee_advances',
  'payroll_periods',
  'employee_payroll_closings',
  'payroll_payments',
  'payroll_adjustments',
  'payments',
  'maintenance_requests',
  'production_orders',
  'work_orders',
  'audit_log',
];

// T1.3 (AGENT_EXECUTION_PLAN.md Phase 1): the SERVER_TENANT_COLLECTIONS
// protection below only runs when getOrgSettings().multiTenant is true
// (tenantEnabledForWrite) — for a single-tenant deployment like this
// workshop, that entire layer is a no-op, so finance/account_moves/
// jobOrders currently have ZERO protection against a partial POST wiping
// them (only employees has a dedicated unconditional check, below). This
// list is intentionally tenant-INDEPENDENT: it always applies, regardless
// of multiTenant mode. `path` is dot-notation resolved via getNestedPath/
// setNestedPath (already defined above).
const HARD_PROTECTED_COLLECTIONS = [
  { path: 'employees', label: 'employees' },
  { path: 'account_moves', label: 'account_moves' },
  { path: 'finance.customers', label: 'finance.customers' },
  { path: 'finance.transactions', label: 'finance.transactions' },
  { path: 'finance.accounts', label: 'finance.accounts' },
  { path: 'omni.jobOrders', label: 'omni.jobOrders' },
];

const WRITE_GUARD_LOG_FILE = path.join(__dirname, 'server-write-guard.log');
function logWriteGuardRejection(reason, detail, req) {
  try {
    const line = JSON.stringify({
      at: new Date().toISOString(),
      reason,
      detail,
      remoteAddress: req?.socket?.remoteAddress || '',
      userAgent: req?.headers?.['user-agent'] || '',
    }) + '\n';
    fs.appendFileSync(WRITE_GUARD_LOG_FILE, line);
  } catch (e) {
    console.warn('[write-guard] failed to write server-write-guard.log:', e.message);
  }
}

// T3.3 (server half): coarse role x collection write enforcement using
// acl.json (client mirror: modules/acl-client.js). Loaded once at startup;
// acl.json is small and hand-edited, not worth hot-reloading.
// Phase 02: the legacy acl.json authority has been retired. The canonical
// permission evaluator lives in platform/authorization/evaluator and is created
// by the platform runtime bridge after migrations are applied.
const SERVER_TENANT_COLLECTIONS = new Set([
  'employees',
  'contacts',
  'users',
  'stock_moves',
  'quants',
  'transfers',
  'account_moves',
  'journal_entries',
  'account_payments',
  'account_partial_reconciles',
  'employee_advances',
  'payroll_periods',
  'employee_payroll_closings',
  'payroll_payments',
  'payroll_adjustments',
  'finance.customers',
  'finance.transactions',
  'finance.receipts',
  'omni.finance.customers',
  'omni.finance.transactions',
  'omni.finance.receipts',
  'omni.materials',
  'omni.suppliers',
  'omni.purchaseOrders',
  'omni.lots',
  'omni.jobOrders',
  'omni.workOrderIssues',
  'omni.approvalHub.requests',
  'omni.helpdesk.tickets',
  'omni.fieldService.visits',
  'omni.projectHub.projects',
  'omni.projectHub.tasks',
  'omni.assetRegister.assets',
  'omni.assetRegister.maintenanceLogs',
  'omni.subscriptionHub.plans',
  'omni.subscriptionHub.subscriptions',
  'omni.subscriptionHub.invoices',
  'omni.rentalHub.items',
  'omni.rentalHub.agreements',
  'omni.fleet.vehicles',
  'omni.fleet.fuelLogs',
  'omni.fleet.trips',
  'omni.documents.docs',
  'omni.marketing.campaigns',
  'omni.budgeting.lines',
  'omni.warrantyHub.warranties',
  'omni.warrantyHub.claims',
  'omni.enterpriseSuite.banking.records',
  'omni.enterpriseSuite.ar_ap.records',
  'omni.enterpriseSuite.contracts.records',
  'omni.enterpriseSuite.logistics.records',
  'omni.enterpriseSuite.supplier_portal.records',
  'omni.enterpriseSuite.integration_hub.records',
  'omni.enterpriseSuite.security_center.records',
  'omni.enterpriseSuite.data_quality.records',
  'omni.enterpriseSuite.training_lms.records',
  'omni.enterpriseSuite.scenario_planner.records',
  'omni.enterpriseSuite.device_center.records',
]);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webp': 'image/webp',
};

const WHATSAPP_BODY_LIMIT = 1024 * 1024 * 5;
const whatsappRateWindowMs = 60 * 1000;
const whatsappRateLimit = 120;
const whatsappRateHits = new Map();

function backupTimestamp(date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function makeId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function sendJson(res, status, payload) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.writeHead(status);
  res.end(JSON.stringify(payload));
}

// T1.4 — unified document numbering (Odoo `ir.sequence`).
// Known codes and their default prefix/padding. Unknown codes are still
// honoured: prefix falls back to code.toUpperCase(), padding to 4. Callers may
// override prefix/padding on first use via the request body; once a row exists
// its stored prefix/padding win (so numbering stays stable).
const SEQUENCE_DEFAULTS = {
  inv:     { prefix: 'INV', padding: 5 },
  bill:    { prefix: 'BILL', padding: 5 },
  job:     { prefix: 'JOB', padding: 4 },
  tkt:     { prefix: 'TKT', padding: 4 },
  sr:      { prefix: 'SR', padding: 4 },
  po:      { prefix: 'PO', padding: 4 },
  so:      { prefix: 'SO', padding: 4 },
  badge:   { prefix: 'BADGE', padding: 4 },
  quote:   { prefix: 'QT', padding: 4 },
  sub:     { prefix: 'SUB', padding: 4 },
};

function normalizeSequenceCode(code) {
  return String(code || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
}

// Issues the next number for `code` atomically. Returns { code, number, prefix,
// padding, sequence, year }. Throws if SQLite is unavailable (caller decides the
// HTTP status / lets the client fall back to its OFFLINE- counter).
function issueNextSequence(code, opts = {}) {
  if (!dbSync) {
    const err = new Error('Sequence store unavailable (SQLite inactive)');
    err.statusCode = 503;
    throw err;
  }
  const normCode = normalizeSequenceCode(code);
  if (!normCode) {
    const err = new Error('Sequence code is required');
    err.statusCode = 400;
    throw err;
  }
  const year = new Date().getFullYear();
  dbSync.exec('BEGIN IMMEDIATE TRANSACTION');
  try {
    const existing = dbSync.prepare('SELECT code, prefix, padding, next_number, year FROM sequences WHERE code = ?').get(normCode);
    const fallback = SEQUENCE_DEFAULTS[normCode] || { prefix: normCode.toUpperCase(), padding: 4 };
    let prefix = existing ? existing.prefix : (opts.prefix != null ? String(opts.prefix) : fallback.prefix);
    let padding = existing ? existing.padding : (Number.isFinite(+opts.padding) && +opts.padding > 0 ? Math.min(12, Math.floor(+opts.padding)) : fallback.padding);
    if (!prefix) prefix = fallback.prefix;
    if (!(padding > 0)) padding = fallback.padding;

    let current;
    if (!existing) {
      current = 1;
      dbSync.prepare('INSERT INTO sequences (code, prefix, padding, next_number, year) VALUES (?, ?, ?, ?, ?)')
        .run(normCode, prefix, padding, current + 1, year);
    } else if (existing.year !== year) {
      // Yearly reset — new year starts back at 1.
      current = 1;
      dbSync.prepare('UPDATE sequences SET next_number = ?, year = ? WHERE code = ?')
        .run(current + 1, year, normCode);
    } else {
      current = existing.next_number;
      dbSync.prepare('UPDATE sequences SET next_number = ? WHERE code = ?')
        .run(current + 1, normCode);
    }
    dbSync.exec('COMMIT');
    const sequence = `${prefix}-${year}-${String(current).padStart(padding, '0')}`;
    return { code: normCode, number: current, prefix, padding, year, sequence };
  } catch (error) {
    try { dbSync.exec('ROLLBACK'); } catch (_) {}
    throw error;
  }
}

function geminiTtsApiKey() {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_TTS_API_KEY || '';
}

async function synthesizeServerTTS(text, lang = 'ar-SA') {
  const key = geminiTtsApiKey();
  if (!key) {
    const error = new Error('Server TTS is not configured');
    error.statusCode = 501;
    throw error;
  }
  if (typeof fetch !== 'function') {
    const error = new Error('Server runtime does not support fetch');
    error.statusCode = 501;
    throw error;
  }
  const cleanText = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 900);
  if (!cleanText) {
    const error = new Error('Missing text');
    error.statusCode = 400;
    throw error;
  }
  const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=' + encodeURIComponent(key);
  const body = {
    contents: [{ parts: [{ text: cleanText }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } }
    }
  };
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    const error = new Error('TTS provider failed');
    error.statusCode = response.status;
    error.providerError = errText.slice(0, 300);
    throw error;
  }
  const data = await response.json();
  const part = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0];
  const inline = part && part.inlineData;
  const audioBase64 = inline && inline.data;
  if (!audioBase64) {
    const error = new Error('TTS provider returned no audio');
    error.statusCode = 502;
    throw error;
  }
  const match = /rate=(\d+)/.exec(inline.mimeType || '') || [];
  return {
    audioBase64,
    sampleRate: Number(match[1]) || 24000,
    mimeType: inline.mimeType || 'audio/pcm',
    lang
  };
}

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  });
  return out;
}

function setAuthCookie(res, token, maxAgeSeconds) {
  const cookie = `octagon_session=${encodeURIComponent(token || '')}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, Number(maxAgeSeconds) || 0)}`;
  res.setHeader('Set-Cookie', cookie);
}

function sanitizeAuthUser(user) {
  if (!user || typeof user !== 'object') return null;
  const copy = { ...user };
  delete copy.passwordHash;
  delete copy.passwordSalt;
  delete copy.passwordAlgo;
  delete copy.passwordSetAt;
  return copy;
}

function readRequestBody(req, limit = WHATSAPP_BODY_LIMIT) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (Buffer.byteLength(body) > limit) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function verifyWhatsAppSignature(rawBody, signatureHeader) {
  const appSecret = process.env.WHATSAPP_APP_SECRET || '';
  if (!appSecret) return { verified: false, enforced: false, reason: 'WHATSAPP_APP_SECRET not configured' };
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return { verified: false, enforced: true, reason: 'Missing X-Hub-Signature-256' };
  }
  const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  const provided = Buffer.from(signatureHeader);
  const expectedBuffer = Buffer.from(expected);
  const verified = provided.length === expectedBuffer.length && crypto.timingSafeEqual(provided, expectedBuffer);
  return { verified, enforced: true, reason: verified ? 'ok' : 'Signature mismatch' };
}

function checkWhatsAppRateLimit(req) {
  const key = req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const hit = whatsappRateHits.get(key) || { start: now, count: 0 };
  if (now - hit.start > whatsappRateWindowMs) {
    hit.start = now;
    hit.count = 0;
  }
  hit.count += 1;
  whatsappRateHits.set(key, hit);
  return hit.count <= whatsappRateLimit;
}

function ensureDbShape(db) {
  if (!db || typeof db !== 'object') db = {};
  if (!db.omni || typeof db.omni !== 'object') db.omni = {};
  if (!Array.isArray(db.omni.whatsappSuggestions)) db.omni.whatsappSuggestions = [];
  if (!Array.isArray(db.omni.whatsappIngestHistory)) db.omni.whatsappIngestHistory = [];
  if (!Array.isArray(db.omni.historyLedger)) db.omni.historyLedger = [];
  if (!Array.isArray(db.omni.migrationsApplied)) db.omni.migrationsApplied = [];
  if (!db.omni.migrationsApplied.includes('server_whatsapp_webhook_v1')) db.omni.migrationsApplied.push('server_whatsapp_webhook_v1');
  return db;
}

// --- Safe local persistence engine -----------------------------------------
// Crash-safe atomic write: write to a temp file, fsync, then rename over the
// target. rename() is atomic on the same volume, so a crash/power-loss mid-write
// can never leave a half-written database.json.
function atomicWriteFileSync(targetPath, data) {
  const tmp = targetPath + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, targetPath);
}

function repairKnownArabicMojibake(value) {
  if (typeof value !== 'string' || !/[\uFFFD\u00D8\u00D9\u00F0\u0178\u00E2\u00C3]/.test(value)) return value;
  return value
    .replace(/\uFFFD\uFFFDمت/g, 'تمت')
    .replace(/الخط\uFFFD\uFFFDة/g, 'الخطوة')
    .replace(/ليوم \uFFFD\uFFFDد/g, 'ليوم غد');
}

function sanitizePersistedArabicText(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, idx) => {
      value[idx] = typeof item === 'string' ? repairKnownArabicMojibake(item) : sanitizePersistedArabicText(item, seen);
    });
    return value;
  }
  Object.keys(value).forEach(key => {
    value[key] = typeof value[key] === 'string' ? repairKnownArabicMojibake(value[key]) : sanitizePersistedArabicText(value[key], seen);
  });
  return value;
}

// --- SQLite helper functions ---
function getNestedPath(obj, pathStr) {
  const parts = pathStr.split('.');
  let current = obj;
  for (const p of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[p];
  }
  return current;
}

function setNestedPath(obj, pathStr, value) {
  const parts = pathStr.split('.');
  let current = obj;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (i === parts.length - 1) {
      current[p] = value;
    } else {
      if (current[p] == null || typeof current[p] !== 'object') {
        current[p] = {};
      }
      current = current[p];
    }
  }
}

function getOrgSettings(db) {
  return db?.omni?.adminSettings?.organization || db?.adminSettings?.organization || {};
}

function getActiveTenantProfile(primaryDb, fallbackDb = null) {
  const org = getOrgSettings(primaryDb);
  const fallbackOrg = getOrgSettings(fallbackDb);
  const companies = Array.isArray(org.companies) ? org.companies : (Array.isArray(fallbackOrg.companies) ? fallbackOrg.companies : []);
  const activeId = org.activeCompanyId || fallbackOrg.activeCompanyId || '';
  const company = companies.find(co => co.id === activeId) || companies.find(co => co.isPrimary) || companies[0] || {};
  return {
    companyId: company.id || activeId || '',
    companyName: company.name || org.name || fallbackOrg.name || '',
    currency: org.currency || fallbackOrg.currency || 'IQD',
    currencySymbol: org.currencySymbol || fallbackOrg.currencySymbol || '',
  };
}

function tenantEnabledForWrite(existingDb, incomingDb = null) {
  return !!(getOrgSettings(existingDb).multiTenant || getOrgSettings(incomingDb).multiTenant);
}

function recordTenantCompanyId(record) {
  if (!record || typeof record !== 'object') return '';
  return record.companyId || record.company_id || record.tenantCompanyId || '';
}

function isServerTenantCollection(collection) {
  return SERVER_TENANT_COLLECTIONS.has(String(collection || ''));
}

function hasTenantMarkers(records) {
  return Array.isArray(records) && records.some(record => recordTenantCompanyId(record));
}

function shouldProtectTenantCollection(existingDb, contextDb, collection, incomingRecords, existingRecords) {
  if (!tenantEnabledForWrite(existingDb, contextDb)) return false;
  return isServerTenantCollection(collection) || hasTenantMarkers(incomingRecords) || hasTenantMarkers(existingRecords);
}

function stampServerTenantRecord(contextDb, record) {
  if (!record || typeof record !== 'object') return record;
  const profile = getActiveTenantProfile(contextDb);
  if (!profile.companyId || recordTenantCompanyId(record)) return record;
  record.companyId = profile.companyId;
  record.companyName = profile.companyName || record.companyName || '';
  if (profile.currency && !record.currency) record.currency = profile.currency;
  if (profile.currencySymbol && !record.currencySymbol) record.currencySymbol = profile.currencySymbol;
  if (!record.tenantStampedAt) record.tenantStampedAt = new Date().toISOString();
  return record;
}

function ensureServerRecordId(collection, record, fallbackId = '') {
  if (!record || typeof record !== 'object') return record;
  if (!record.id) record.id = fallbackId || `${String(collection || 'rec').slice(0, 3)}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return record;
}

function prepareTenantRecordWrite(existingDb, contextDb, collection, id, data, existingRecord) {
  const existingRecords = existingRecord ? [existingRecord] : [];
  if (!shouldProtectTenantCollection(existingDb, contextDb, collection, [data], existingRecords)) {
    return ensureServerRecordId(collection, data, id);
  }
  const activeCompanyId = getActiveTenantProfile(contextDb, existingDb).companyId;
  const record = ensureServerRecordId(collection, { ...data }, id);
  const existingCompanyId = recordTenantCompanyId(existingRecord);
  const incomingCompanyId = recordTenantCompanyId(record);

  if (!activeCompanyId) return record;
  if (existingCompanyId && existingCompanyId !== activeCompanyId) {
    throw new Error(`Tenant isolation blocked ${collection} record ${record.id}: existing record belongs to another company`);
  }
  if (incomingCompanyId && incomingCompanyId !== activeCompanyId) {
    throw new Error(`Tenant isolation blocked ${collection} record ${record.id}: incoming companyId does not match active company`);
  }
  return stampServerTenantRecord(contextDb, record);
}

function mergeTenantCollectionForWrite(existingDb, contextDb, collection, incomingRecords) {
  const existingRecords = getNestedPath(existingDb || {}, collection);
  const existingList = Array.isArray(existingRecords) ? existingRecords : [];
  const incomingList = Array.isArray(incomingRecords) ? incomingRecords : [];

  if (!shouldProtectTenantCollection(existingDb, contextDb, collection, incomingList, existingList)) {
    return { data: incomingList, stamped: 0, preservedForeign: 0 };
  }

  const activeCompanyId = getActiveTenantProfile(contextDb, existingDb).companyId;
  if (!activeCompanyId) return { data: incomingList, stamped: 0, preservedForeign: 0 };

  const existingById = new Map();
  existingList.forEach(record => {
    if (record && typeof record === 'object' && record.id !== undefined) existingById.set(String(record.id), record);
  });

  const incomingIds = new Set();
  const merged = [];
  let stamped = 0;
  let preservedForeign = 0;

  incomingList.forEach(item => {
    if (!item || typeof item !== 'object') {
      merged.push(item);
      return;
    }
    const record = ensureServerRecordId(collection, { ...item });
    incomingIds.add(String(record.id));
    const existingRecord = existingById.get(String(record.id));
    const existingCompanyId = recordTenantCompanyId(existingRecord);
    const incomingCompanyId = recordTenantCompanyId(record);

    if (existingCompanyId && existingCompanyId !== activeCompanyId) {
      merged.push(existingRecord);
      preservedForeign += 1;
      return;
    }
    if (incomingCompanyId && incomingCompanyId !== activeCompanyId) {
      throw new Error(`Tenant isolation blocked ${collection} record ${record.id}: incoming companyId does not match active company`);
    }
    if (!incomingCompanyId) {
      stampServerTenantRecord(contextDb, record);
      stamped += recordTenantCompanyId(record) ? 1 : 0;
    }
    merged.push(record);
  });

  existingList.forEach(existingRecord => {
    if (!existingRecord || typeof existingRecord !== 'object' || existingRecord.id === undefined) return;
    if (incomingIds.has(String(existingRecord.id))) return;
    const existingCompanyId = recordTenantCompanyId(existingRecord);
    if (existingCompanyId && existingCompanyId !== activeCompanyId) {
      merged.push(existingRecord);
      preservedForeign += 1;
    }
  });

  return { data: merged, stamped, preservedForeign };
}

function applyServerTenantProtectionToDatabase(existingDb, parsedDb) {
  if (!existingDb || !tenantEnabledForWrite(existingDb, parsedDb)) {
    return { db: parsedDb, stamped: 0, preservedForeign: 0, preservedMissingCollections: 0 };
  }
  let stamped = 0;
  let preservedForeign = 0;
  let preservedMissingCollections = 0;

  SERVER_TENANT_COLLECTIONS.forEach(collection => {
    const existingRecords = getNestedPath(existingDb, collection);
    const incomingRecords = getNestedPath(parsedDb, collection);
    if (!Array.isArray(existingRecords) && !Array.isArray(incomingRecords)) return;

    if (!Array.isArray(incomingRecords) && Array.isArray(existingRecords)) {
      setNestedPath(parsedDb, collection, existingRecords);
      preservedMissingCollections += 1;
      return;
    }

    const result = mergeTenantCollectionForWrite(existingDb, parsedDb, collection, incomingRecords);
    setNestedPath(parsedDb, collection, result.data);
    stamped += result.stamped;
    preservedForeign += result.preservedForeign;
  });

  return { db: parsedDb, stamped, preservedForeign, preservedMissingCollections };
}

function extractDbCollections(obj, path = '', collections = {}, metadata = {}) {
  if (obj == null) return;
  
  const isKnownCollection = [
    'employees', 'contacts', 'departments', 'users', 'locations', 'quants', 'stock_moves', 
    'transfers', 'journals', 'journal_entries', 'account_moves', 'account_payments', 'account_partial_reconciles',
    'employee_advances', 'payroll_periods', 'employee_payroll_closings', 'payroll_payments', 'payroll_adjustments',
    'payments', 'maintenance_requests', 'production_orders', 'work_orders', 'audit_log'
  ].includes(path) || (path.startsWith('omni.') && Array.isArray(obj));
  
  if (Array.isArray(obj)) {
    const hasIds = obj.length > 0 && obj.every(x => x && typeof x === 'object' && x.id !== undefined);
    if (isKnownCollection || hasIds) {
      collections[path] = obj;
      return;
    }
  }
  
  if (typeof obj === 'object') {
    if (path === '' || path === 'omni' || path === 'finance') {
      for (const k in obj) {
        const nextPath = path ? `${path}.${k}` : k;
        extractDbCollections(obj[k], nextPath, collections, metadata);
      }
      return;
    }
  }
  
  metadata[path] = obj;
}

function saveDbToSqlite(sqliteDb, db, actorCtx = null) {
  sqliteDb.exec("BEGIN TRANSACTION");
  try {
    // Phase 02 governance strangler: governed paths (identity, roles, settings,
    // notifications, approvals, workflow documents, logs, documents, automation)
    // are synced into the canonical platform tables and stripped from the blob
    // INSIDE this transaction, so the legacy tables below are never again an
    // authority for those facts.
    if (governanceStrangler) {
      governanceStrangler.syncWrites(db, actorCtx);
    }
    const collections = {};
    const metadata = {};
    extractDbCollections(db, '', collections, metadata);

    // 1. Delta save metadata
    const existingMetaRows = sqliteDb.prepare("SELECT key, value FROM metadata").all();
    const existingMetaMap = new Map();
    existingMetaRows.forEach(row => {
      existingMetaMap.set(row.key, row.value);
    });

    const insertMeta = sqliteDb.prepare("INSERT INTO metadata (key, value) VALUES (?, ?)");
    const updateMeta = sqliteDb.prepare("UPDATE metadata SET value = ? WHERE key = ?");
    const deleteMeta = sqliteDb.prepare("DELETE FROM metadata WHERE key = ?");

    for (const key in metadata) {
      const valStr = JSON.stringify(metadata[key]);
      if (existingMetaMap.has(key)) {
        if (existingMetaMap.get(key) !== valStr) {
          updateMeta.run(valStr, key);
        }
      } else {
        insertMeta.run(key, valStr);
      }
    }
    for (const key of existingMetaMap.keys()) {
      if (!(key in metadata)) {
        deleteMeta.run(key);
      }
    }

    // 2. Delta save collections
    const existingColRows = sqliteDb.prepare("SELECT collection, id, data FROM collections").all();
    const existingColMap = new Map();
    existingColRows.forEach(row => {
      existingColMap.set(`${row.collection}::${row.id}`, row.data);
    });

    const insertCol = sqliteDb.prepare("INSERT INTO collections (collection, id, data) VALUES (?, ?, ?)");
    const updateCol = sqliteDb.prepare("UPDATE collections SET data = ? WHERE collection = ? AND id = ?");
    const deleteCol = sqliteDb.prepare("DELETE FROM collections WHERE collection = ? AND id = ?");

    const seen = new Set();
    const incomingKeys = new Set();

    for (const colName in collections) {
      const arr = collections[colName];
      for (const rec of arr) {
        let id = rec.id || `${colName.slice(0, 3)}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        let key = `${colName}::${id}`;
        let counter = 1;
        const originalId = id;
        while (seen.has(key)) {
          id = `${originalId}_dup${counter}`;
          key = `${colName}::${id}`;
          counter++;
        }
        seen.add(key);
        if (rec.id !== id) {
          rec.id = id;
        }

        const dataStr = JSON.stringify(rec);
        incomingKeys.add(key);

        if (existingColMap.has(key)) {
          if (existingColMap.get(key) !== dataStr) {
            updateCol.run(dataStr, colName, id);
          }
        } else {
          insertCol.run(colName, id, dataStr);
        }
      }
    }

    for (const key of existingColMap.keys()) {
      if (!incomingKeys.has(key)) {
        const parts = key.split('::');
        const colName = parts[0];
        const id = parts.slice(1).join('::');
        deleteCol.run(colName, id);
      }
    }

    sqliteDb.exec("COMMIT");
  } catch (e) {
    sqliteDb.exec("ROLLBACK");
    throw e;
  }
}

function loadDbFromSqlite(sqliteDb) {
  const db = {};
  
  const metaRows = sqliteDb.prepare("SELECT key, value FROM metadata").all();
  for (const row of metaRows) {
    let parsedVal;
    try {
      parsedVal = JSON.parse(row.value);
    } catch(e) {
      parsedVal = row.value;
    }
    setNestedPath(db, row.key, parsedVal);
  }
  
  const colRows = sqliteDb.prepare("SELECT collection, id, data FROM collections").all();
  for (const row of colRows) {
    const record = JSON.parse(row.data);
    let arr = getNestedPath(db, row.collection);
    if (!Array.isArray(arr)) {
      arr = [];
      setNestedPath(db, row.collection, arr);
    }
    arr.push(record);
  }

  // Phase 02: overlay canonical governance state so legacy readers always see
  // the platform tables as the single source of truth for governed paths.
  if (governanceStrangler) {
    governanceStrangler.projectReads(db);
  }
  return db;
}

// Single safe entry point for every DB write. Validates, keeps a last-good
// snapshot, writes atomically, and throttled-auto-backups.
//
// database.json policy (Production Stabilization Sprint, 2026-07-04):
// SQLite (database.db) is the sole live read/write store whenever dbSync is
// active — database.json is NEVER read by the running app in that mode
// (confirmed: GET/POST /api/db both branch on `dbSync` first). Before this
// fix database.json was a frozen snapshot from whenever SQLite last took
// over, silently missing everything posted since (it was found ~1 payroll
// cycle stale during this audit). It is kept only as (a) a human-readable
// mirror for git/manual inspection and (b) the automatic fallback store IF
// SQLite is ever unavailable — so it must never be allowed to go stale
// again. Every SQLite save now also mirrors the full DB to database.json
// (best-effort: failures here are logged but never abort the real save).
function safeSaveDb(db, actorCtx = null) {
  if (!db || typeof db !== 'object') throw new Error('Refusing to save invalid DB (not an object)');
  sanitizePersistedArabicText(db);

  if (dbSync) {
    saveDbToSqlite(dbSync, db, actorCtx);
    mirrorDbToJsonBestEffort(db);
    return;
  }

  // Degraded non-SQLite mode: no canonical authority exists, so governed
  // paths must never silently re-enter the legacy JSON store (fail closed).
  if (governanceCollections) {
    const stripped = governanceCollections.stripGovernancePaths(db);
    if (stripped.length) {
      console.warn('[safeSaveDb] degraded mode: stripped governed paths from legacy JSON write:', stripped.join(', '));
    }
  }

  const json = JSON.stringify(db, null, 2);
  if (json.length < 2) throw new Error('Refusing to save empty DB payload');
  try {
    if (fs.existsSync(DB_FILE)) fs.copyFileSync(DB_FILE, DB_PREV_FILE);
  } catch (e) {
    console.warn('Could not write .prev snapshot:', e.message);
  }
  atomicWriteFileSync(DB_FILE, json);
  maybeAutoBackup();
}

function mirrorDbToJsonBestEffort(db) {
  try {
    const json = JSON.stringify(db, null, 2);
    if (json.length < 2) return;
    atomicWriteFileSync(DB_FILE, json);
  } catch (e) {
    console.warn('database.json mirror write failed (SQLite save already succeeded, this is non-fatal):', e.message);
  }
}

function maybeAutoBackup() {
  const now = Date.now();
  if (now - lastAutoBackupMs < AUTO_BACKUP_INTERVAL_MS) return;
  lastAutoBackupMs = now;
  try {
    createDatabaseBackup('auto');
    pruneOldBackups(BACKUP_KEEP);
  } catch (e) {
    console.warn('Auto-backup skipped:', e.message);
  }
}

function pruneOldBackups(keep = BACKUP_KEEP) {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => /^database\.backup\..+\.json$/.test(f))
      .map(f => ({ f, t: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    files.slice(keep).forEach(item => {
      try { fs.unlinkSync(path.join(BACKUP_DIR, item.f)); } catch (_) {}
    });
  } catch (e) {
    console.warn('Prune skipped:', e.message);
  }
}

// On boot: if database.json is missing or corrupt, recover from the newest valid
// snapshot (.prev first, then the latest good database.backup.*.json).
function recoverDbIfCorrupt() {
  try {
    if (fs.existsSync(DB_FILE)) {
      JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      return; // healthy
    }
  } catch (e) {
    console.error('⚠ database.json is corrupt:', e.message);
  }
  const candidates = [];
  if (fs.existsSync(DB_PREV_FILE)) candidates.push(DB_PREV_FILE);
  try {
    fs.readdirSync(BACKUP_DIR)
      .filter(f => /^database\.backup\..+\.json$/.test(f))
      .map(f => ({ p: path.join(BACKUP_DIR, f), t: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
      .forEach(item => candidates.push(item.p));
  } catch (_) {}
  for (const c of candidates) {
    try {
      JSON.parse(fs.readFileSync(c, 'utf8'));
      fs.copyFileSync(c, DB_FILE);
      console.log('✅ Recovered database.json from', path.basename(c));
      return;
    } catch (_) {}
  }
  if (!fs.existsSync(DB_FILE)) console.error('❌ No valid snapshot found to recover database.json');
}

function saveDb(db, actorCtx = null) {
  safeSaveDb(db, actorCtx);
}

function loadDbForMutation() {
  if (dbSync) {
    try {
      const db = loadDbFromSqlite(dbSync);
      return ensureDbShape(db);
    } catch (e) {
      console.error('Failed to load DB for mutation from SQLite:', e.message);
    }
  }
  const db = fs.existsSync(DB_FILE) ? readJsonFile(DB_FILE) : { employees: [], config: {}, omni: {} };
  return ensureDbShape(db);
}

function sanitizeLedgerPayload(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 4) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 40).map(item => sanitizeLedgerPayload(item, depth + 1));
  if (typeof value === 'object') {
    const result = {};
    Object.keys(value).slice(0, 80).forEach(key => {
      const lower = key.toLowerCase();
      if (lower.includes('token') || lower.includes('secret') || lower.includes('apikey') || lower.includes('api_key') || lower.includes('password') || lower.includes('authorization')) {
        result[key] = '[redacted]';
      } else if (key === 'base64' || key === 'dataUrl' || key === 'binary' || key === 'fileData') {
        result[key] = '[media omitted]';
      } else {
        result[key] = sanitizeLedgerPayload(value[key], depth + 1);
      }
    });
    return result;
  }
  if (typeof value === 'string' && value.length > 1200) return `${value.slice(0, 1200)}...`;
  return value;
}

function appendHistoryEvent(db, entry) {
  ensureDbShape(db);
  const event = {
    id: entry.id || makeId('hist'),
    eventId: entry.eventId || entry.id || makeId('hist'),
    timestamp: entry.timestamp || new Date().toISOString(),
    module: entry.module || 'whatsapp',
    source: entry.source || 'whatsapp_business_api',
    action: entry.action || 'webhook_message_received',
    title: entry.title || 'WhatsApp webhook event',
    description: entry.description || '',
    actorId: entry.actorId || 'whatsapp_business_api',
    actorName: entry.actorName || 'WhatsApp Business API',
    actorRole: entry.actorRole || 'integration',
    correlationId: entry.correlationId || entry.sourceMessageId || entry.createdRecordId || '',
    sourceMessageId: entry.sourceMessageId || '',
    whatsappSenderId: entry.whatsappSenderId || '',
    mediaId: entry.mediaId || '',
    aiRunId: entry.aiRunId || '',
    approvalRequestId: entry.approvalRequestId || '',
    createdRecordId: entry.createdRecordId || '',
    recordId: entry.recordId || '',
    recordType: entry.recordType || '',
    status: entry.status || 'pending_review',
    risk: entry.risk || '',
    payload: sanitizeLedgerPayload(entry.payload || {}),
    before: null,
    after: null,
  };
  db.omni.historyLedger.unshift(event);
  db.omni.historyLedger = db.omni.historyLedger.slice(0, 2000);
  return event;
}

function classifyWebhookText(text, messageType = 'text') {
  const t = String(text || '').toLowerCase();
  const hasAmount = /[\d,]+/.test(t);
  if (messageType === 'audio' || /voice|audio|صوت|فويس|رسالة صوتية/.test(t)) return { type: 'voice_note', label: 'رسالة صوتية - مراجعة', confidence: 65 };
  if (/خر|عطل|صيانة|machine|cnc|laser|ليزر|ماكينة|router|printer/.test(t)) return { type: 'machine_fault', label: 'عطل / صيانة ماكينة', confidence: 86 };
  if (/فاتورة|وصل|invoice|receipt|pdf|مشتريات/.test(t) && hasAmount) return { type: 'purchase_invoice', label: 'فاتورة / مصروف', confidence: 86 };
  if (/اجازة|إجازة|غياب|حضور|دوام|بصمة|leave|attendance/.test(t)) return { type: 'attendance_event', label: 'دوام / حضور / غياب', confidence: 82 };
  if (/شراء|مواد|مخزون|ناقص|خشب|اكريلك|حبر|material|stock/.test(t)) return { type: 'material_request', label: 'طلب مواد / مخزون', confidence: 78 };
  if (/مهمة|تصميم|طباعة|قص|تركيب|task|tomorrow|tomorow|غدا|غداً|باچر|باجر/.test(t)) return { type: 'task', label: 'مهمة تشغيلية', confidence: 76 };
  if (/مال|فلوس|دفع|قبض|راتب|سلفة|finance|payment/.test(t)) return { type: 'finance_request', label: 'طلب مالي / دفعة', confidence: 74 };
  return { type: 'unknown', label: 'غير مصنف - مراجعة يدوية', confidence: 40 };
}

function routeForWebhookType(type) {
  if (type === 'task') return { outputType: 'task_manager', requestType: 'task', label: 'Task Manager' };
  if (type === 'material_request') return { outputType: 'command_center_request', requestType: 'purchase', label: 'Command Center purchase review' };
  if (type === 'attendance_event') return { outputType: 'command_center_request', requestType: 'employee_request', label: 'Command Center employee review' };
  if (type === 'finance_request' || type === 'purchase_invoice') return { outputType: 'command_center_request', requestType: 'finance_review', label: 'Finance review' };
  if (type === 'machine_fault') return { outputType: 'command_center_request', requestType: 'machine_maintenance', label: 'Maintenance review' };
  return { outputType: 'command_center_request', requestType: 'whatsapp_review', label: 'Manual review' };
}

function attachmentFromMessage(message) {
  const media = message.audio || message.image || message.document || message.video || message.sticker;
  if (!media) return [];
  const type = message.type || 'media';
  return [{
    id: media.id || '',
    type: type === 'document' ? 'invoice' : type,
    label: type === 'audio' ? 'رسالة صوتية من WhatsApp' : type === 'image' ? 'صورة من WhatsApp' : type === 'document' ? 'مستند من WhatsApp' : `مرفق ${type}`,
    fileName: media.filename || `${type}_${media.id || Date.now()}`,
    mimeType: media.mime_type || '',
    sha256: media.sha256 || '',
    status: process.env.WHATSAPP_ACCESS_TOKEN ? 'pending_download' : 'metadata_only',
    sourceMediaId: media.id || '',
  }];
}

function textFromWhatsAppMessage(message) {
  if (message.text?.body) return message.text.body;
  if (message.button?.text) return message.button.text;
  if (message.interactive?.button_reply?.title) return message.interactive.button_reply.title;
  if (message.interactive?.list_reply?.title) return message.interactive.list_reply.title;
  if (message.image?.caption) return message.image.caption;
  if (message.document?.caption) return message.document.caption;
  if (message.video?.caption) return message.video.caption;
  if (message.type === 'audio') return 'رسالة صوتية من WhatsApp بانتظار التفريغ';
  return `WhatsApp ${message.type || 'message'} received`;
}

function extractWhatsAppMessages(payload) {
  const extracted = [];
  (payload.entry || []).forEach(entry => {
    (entry.changes || []).forEach(change => {
      const value = change.value || {};
      const metadata = value.metadata || {};
      const contactsByWaId = {};
      (value.contacts || []).forEach(contact => {
        contactsByWaId[contact.wa_id] = contact.profile?.name || contact.wa_id;
      });
      (value.messages || []).forEach(message => {
        extracted.push({
          entryId: entry.id || '',
          phoneNumberId: metadata.phone_number_id || '',
          displayPhoneNumber: metadata.display_phone_number || '',
          contactName: contactsByWaId[message.from] || message.from || 'WhatsApp',
          message,
        });
      });
    });
  });
  return extracted;
}

function appendWhatsAppWebhookPayload(payload, signatureInfo = {}) {
  const db = loadDbForMutation();
  const messages = extractWhatsAppMessages(payload);
  const created = [];
  messages.forEach(({ message, contactName, phoneNumberId, displayPhoneNumber, entryId }) => {
    const text = textFromWhatsAppMessage(message);
    const cls = classifyWebhookText(text, message.type);
    const route = routeForWebhookType(cls.type);
    const attachments = attachmentFromMessage(message);
    const suggestion = {
      id: makeId('wa'),
      source: 'whatsapp_business_api',
      sourceMessageId: message.id || '',
      senderName: contactName,
      senderPhone: message.from || '',
      phoneNumberId,
      displayPhoneNumber,
      entryId,
      timestamp: message.timestamp ? new Date(Number(message.timestamp) * 1000).toISOString() : new Date().toISOString(),
      type: cls.type,
      label: cls.label,
      requestType: route.requestType,
      text,
      confidence: cls.confidence,
      status: 'pending',
      entityMatches: [],
      attachmentPlaceholders: attachments,
      webhookRawType: message.type || '',
      outputType: '',
      outputId: '',
      reviewedAt: '',
      createdAt: new Date().toISOString(),
    };
    db.omni.whatsappSuggestions.unshift(suggestion);
    appendHistoryEvent(db, {
      module: 'whatsapp',
      source: 'whatsapp_business_api',
      action: 'webhook_message_received',
      title: `WhatsApp webhook: ${contactName}`,
      description: text,
      status: 'pending_review',
      correlationId: suggestion.id,
      sourceMessageId: message.id || suggestion.id,
      whatsappSenderId: message.from || '',
      mediaId: attachments[0]?.sourceMediaId || '',
      payload: { suggestion, signature: signatureInfo, rawType: message.type },
    });
    created.push(suggestion);
  });
  if (created.length) {
    db.omni.whatsappIngestHistory.unshift({
      id: makeId('wa_batch'),
      createdAt: new Date().toISOString(),
      count: created.length,
      source: 'whatsapp_business_api',
      matched: 0,
      attachments: created.reduce((sum, item) => sum + (item.attachmentPlaceholders || []).length, 0),
      signatureVerified: !!signatureInfo.verified,
      signatureEnforced: !!signatureInfo.enforced,
    });
  }
  saveDb(db);
  return created;
}

function topLevelCollections(db) {
  return Object.keys(db || {}).filter(key => Array.isArray(db[key])).sort();
}

function verifyBackupAgainstLive(backupPath) {
  const live = dbSync ? loadDbFromSqlite(dbSync) : readJsonFile(DB_FILE);
  const backup = readJsonFile(backupPath);
  const errors = [];
  const appendOnlyCollections = new Set(['audit_log']);
  if (backup._schema_version !== live._schema_version) {
    errors.push(`schema mismatch: backup=${backup._schema_version} live=${live._schema_version}`);
  }
  const liveCollections = topLevelCollections(live);
  const backupCollections = topLevelCollections(backup);
  liveCollections.forEach(collection => {
    if (!backupCollections.includes(collection)) {
      errors.push(`backup missing collection: ${collection}`);
    } else {
      const backupCount = (backup[collection] || []).length;
      const liveCount = (live[collection] || []).length;
      if (appendOnlyCollections.has(collection) && liveCount >= backupCount) return;
      if (backupCount !== liveCount) {
        errors.push(`count mismatch on ${collection}: backup=${backupCount} live=${liveCount}`);
      }
    }
  });
  return errors;
}

function createDatabaseBackup(tag = 'manual') {
  const safeTag = String(tag || 'manual').replace(BACKUP_TAG_RE, '_');
  const backupName = `database.backup.${safeTag}.${backupTimestamp()}.json`;
  const backupPath = path.join(BACKUP_DIR, backupName);
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  
  if (dbSync) {
    const db = loadDbFromSqlite(dbSync);
    fs.writeFileSync(backupPath, JSON.stringify(db, null, 2), 'utf8');
  } else {
    if (!fs.existsSync(DB_FILE)) throw new Error('database.json does not exist');
    fs.copyFileSync(DB_FILE, backupPath);
  }
  
  const errors = verifyBackupAgainstLive(backupPath);
  if (errors.length) {
    fs.unlinkSync(backupPath);
    throw new Error(errors.join('; '));
  }
  return {
    success: true,
    file: backupName,
    bytes: fs.statSync(backupPath).size,
  };
}

// T1.5 — append a single audit line to server-backup.log. Best-effort; never
// throws (a logging failure must not fail a good backup).
function appendBackupLog(line) {
  try {
    fs.appendFileSync(BACKUP_LOG_FILE, `[${new Date().toISOString()}] ${line}\n`, 'utf8');
  } catch (_) {}
}

// T1.5 — prune only backups carrying `tag`, keeping the newest `keep`. Scoped by
// tag on purpose so the nightly cycle can enforce its own retention without
// touching the hourly auto-backup set (pruneOldBackups(BACKUP_KEEP)) or manual
// snapshots. Returns the number of files removed.
function pruneBackupsByTag(tag, keep) {
  try {
    const safeTag = String(tag || '').replace(BACKUP_TAG_RE, '_');
    const re = new RegExp(`^database\\.backup\\.${safeTag}\\..+\\.json$`);
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => re.test(f))
      .map(f => ({ f, t: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    const removed = files.slice(keep);
    removed.forEach(item => { try { fs.unlinkSync(path.join(BACKUP_DIR, item.f)); } catch (_) {} });
    return removed.length;
  } catch (e) {
    return 0;
  }
}

// T1.5 — nightly create -> verify -> prune(keep 14) -> log cycle.
// createDatabaseBackup() already CREATES and VERIFIES (verifyBackupAgainstLive
// throws + deletes the file on any live-vs-backup mismatch), so this wrapper
// only adds tag-scoped pruning and the server-backup.log audit line. Passed into
// the Phase-3 scheduler's ctx as `createDatabaseBackup`, so the existing
// nightly_backup_verify job runs the full cycle with no scheduler-side change.
// Returns the createDatabaseBackup result augmented with { verified, pruned, kept }.
function runNightlyBackupCycle(tag = 'scheduler') {
  const safeTag = String(tag || 'scheduler').replace(BACKUP_TAG_RE, '_') || 'scheduler';
  try {
    const result = createDatabaseBackup(safeTag);
    const pruned = pruneBackupsByTag(safeTag, NIGHTLY_BACKUP_KEEP);
    appendBackupLog(`OK tag=${safeTag} file=${result.file} bytes=${result.bytes} verified=true pruned=${pruned} keep=${NIGHTLY_BACKUP_KEEP}`);
    return { ...result, verified: true, pruned, kept: NIGHTLY_BACKUP_KEEP };
  } catch (error) {
    appendBackupLog(`FAIL tag=${safeTag} error=${error.message || error}`);
    throw error;
  }
}

function userListFromDb(db) {
  const topUsers = Array.isArray(db.users) ? db.users : [];
  const omniUsers = db.omni && Array.isArray(db.omni.users) ? db.omni.users : [];
  const seen = new Set();
  return [...topUsers, ...omniUsers].filter(user => {
    if (!user || !user.id || seen.has(user.id)) return false;
    seen.add(user.id);
    return user.is_active !== false && user.status !== 'inactive';
  });
}

function roleListFromDb(db) {
  return db.omni && Array.isArray(db.omni.roles) ? db.omni.roles : [];
}

function enrichAuthUser(db, user) {
  if (!user) return null;
  const roles = roleListFromDb(db);
  const role = roles.find(item => item && (item.id === user.roleId || item.id === user.role));
  const groups = Array.from(new Set([...(role?.groups || []), ...(user.groups || [])]));
  return sanitizeAuthUser({
    ...user,
    groups,
    roleId: user.roleId || role?.id || user.role || '',
    role: user.role || role?.id || user.roleId || '',
    name: user.displayName || user.name || user.id,
  });
}

function appendServerAudit(db, event = {}) {
  ensureDbShape(db);
  if (!Array.isArray(db.audit_log)) db.audit_log = [];
  if (!Array.isArray(db.omni.historyLedger)) db.omni.historyLedger = [];
  const now = new Date().toISOString();
  const base = {
    id: makeId('audit'),
    timestamp: now,
    date: now,
    module: event.module || 'auth',
    source: event.source || 'server',
    action: event.action || 'server_event',
    title: event.title || event.action || 'Server event',
    status: event.status || 'logged',
    result: event.result || event.status || 'logged',
    risk: event.risk || 'medium',
    actorId: event.actorId || event.userId || 'unknown',
    actorName: event.actorName || event.userName || event.actorId || 'unknown',
    user_id: event.actorId || event.userId || 'unknown',
    user_name: event.actorName || event.userName || event.actorId || 'unknown',
    payload: sanitizeLedgerPayload(event.payload || {}),
  };
  db.audit_log.unshift({ ...base, event_type: base.action, record_id: base.payload?.userId || '' });
  db.omni.historyLedger.unshift({ ...base, entityType: 'auth_session', entityId: base.payload?.userId || '' });
  if (db.audit_log.length > 5000) db.audit_log.length = 5000;
  if (db.omni.historyLedger.length > 5000) db.omni.historyLedger.length = 5000;
}
function requireSession(req, res, options = {}) {
  if (!platformAuthority) {
    sendJson(res, 503, { success: false, error: 'Platform authority not initialized' });
    return { ok: false };
  }
  const result = platformAuthority.require(req, res, { touch: options.touch !== false });
  if (!result.ok) return result;
  const user = platformAuthority.users.get(result.ctx.actorId);
  return { ok: true, userId: result.ctx.actorId, user: sanitizeAuthUser(user), ctx: result.ctx };
}

function requirePermission(req, res, permission) {
  if (!platformAuthority) {
    sendJson(res, 503, { success: false, error: 'Platform authority not initialized' });
    return { ok: false };
  }
  return platformAuthority.require(req, res, { permission });
}

function requireRoleSession(req, res, groups, options = {}) {
  const session = requireSession(req, res, options);
  if (!session.ok) return session;
  // Legacy group-based guard shim. The platform is permission-based; owners are
  // the seeded administrator role and are treated as having the legacy admin/manager
  // groups. Non-owners are denied. This preserves the shape for the scheduler and
  // Jarvis callers while the runtime is fully on the platform authority.
  if (session.user?.isOwner || session.ctx?.isOwner) return session;
  sendJson(res, 403, { success: false, error: 'Insufficient role for this API endpoint', required: groups });
  return { ok: false };
}

function requireAdminSession(req, res, options = {}) {
  return requireRoleSession(req, res, ['system.admin'], options);
}
function safeReviewReportSegment(value, fallback = 'report') {
  const cleaned = String(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return cleaned || fallback;
}

function saveReviewReport(report) {
  if (!report || typeof report !== 'object') throw new Error('Invalid review report');
  const page = safeReviewReportSegment(report.page || 'page');
  const id = safeReviewReportSegment(report.id || makeId('pilot_review'));
  const file = `${page}-${id}.json`;
  const target = path.join(REVIEW_REPORT_DIR, file);
  const resolvedDir = path.resolve(REVIEW_REPORT_DIR);
  const resolvedTarget = path.resolve(target);
  if (!resolvedTarget.startsWith(resolvedDir + path.sep)) throw new Error('Invalid review report path');
  fs.mkdirSync(resolvedDir, { recursive: true });
  atomicWriteFileSync(resolvedTarget, JSON.stringify({
    ...report,
    savedAt: new Date().toISOString(),
    storage: { folder: 'review-reports', file }
  }, null, 2));
  return file;
}

function probeDefaultPort() {
  const socket = net.createConnection({ host: '127.0.0.1', port: DEFAULT_PORT });
  let done = false;
  const finish = (occupied, error = '') => {
    if (done) return;
    done = true;
    DEFAULT_PORT_PROBE = { checkedAt: new Date().toISOString(), occupied, error };
    socket.destroy();
  };
  socket.setTimeout(300);
  socket.once('connect', () => finish(true));
  socket.once('timeout', () => finish(false, 'timeout'));
  socket.once('error', error => finish(false, error.code || error.message || 'connection failed'));
}

function gitSnapshot() {
  const cp = require('child_process');
  const run = args => {
    try { return cp.execFileSync('git', args, { cwd: __dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
    catch (_) { return ''; }
  };
  return {
    branch: run(['branch', '--show-current']),
    head: run(['rev-parse', '--short', 'HEAD']),
    latest: run(['log', '--oneline', '--decorate', '--max-count=1']),
    statusShort: run(['status', '--short']),
    remote: run(['remote', '-v']),
  };
}

const INTERNAL_ROUTELESS_VIEWS = ['manager_approvals', 'mobile_inventory_count'];

function routeStaticSnapshot() {
  const htmlPath = path.join(__dirname, 'index.html');
  const viewsDir = path.join(__dirname, 'views');
  const html = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : '';
  const nav = [...html.matchAll(/data-page="([^"]+)"/g)].map(match => match[1]);
  const markers = [...html.matchAll(/<!--\s*view:([^\s]+)\s*-->/g)].map(match => match[1]);
  const viewFiles = fs.existsSync(viewsDir) ? fs.readdirSync(viewsDir).filter(file => file.endsWith('.html')).map(file => file.replace(/\.html$/, '')) : [];
  const viewFilesCounted = viewFiles.filter(name => !INTERNAL_ROUTELESS_VIEWS.includes(name)).length;
  const duplicateDataPages = [...new Set(nav.filter((item, idx) => nav.indexOf(item) !== idx))];
  const missingViewFiles = [...new Set(nav)].filter(page => !viewFiles.includes(page));
  const missingMarkers = [...new Set(nav)].filter(page => !markers.includes(page));
  return {
    navCount: new Set(nav).size,
    navTotal: nav.length,
    viewMarkerCount: new Set(markers).size,
    viewMarkerTotal: markers.length,
    viewFiles: viewFilesCounted,
    viewFilesTotal: viewFiles.length,
    viewFilesCounted: viewFilesCounted,
    internalViewFiles: INTERNAL_ROUTELESS_VIEWS,
    duplicateDataPages,
    missingViewFiles,
    missingMarkers,
  };
}


function backupStatusSnapshot() {
  const backups = [];
  try {
    fs.readdirSync(BACKUP_DIR).forEach(file => {
      if (!/^database\.backup\..+\.json$/.test(file)) return;
      const full = path.join(BACKUP_DIR, file);
      const stat = fs.statSync(full);
      backups.push({ file, bytes: stat.size, mtimeMs: stat.mtimeMs, mtime: stat.mtime.toISOString() });
    });
  } catch (_) {}
  backups.sort((a, b) => b.mtimeMs - a.mtimeMs);
  let databaseParse = { ok: false, error: 'database.json not found' };
  try {
    JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    databaseParse = { ok: true };
  } catch (error) {
    databaseParse = { ok: false, error: error.message };
  }
  return {
    backupDir: BACKUP_DIR,
    count: backups.length,
    latest: backups[0] || null,
    databaseParse,
  };
}

function serverStatusSnapshot() {
  return {
    currentPort: ACTIVE_PORT,
    requestedPort: REQUESTED_PORT,
    defaultPort: DEFAULT_PORT,
    fallbackPortUsed: FALLBACK_PORT_USED,
    warning: PORT_WARNING,
    defaultPortProbe: DEFAULT_PORT_PROBE,
    appRoot: __dirname,
    databasePath: DB_FILE,
    sqlitePath: SQLITE_DB_FILE,
    sqliteActive: !!dbSync,
    backupDir: BACKUP_DIR,
    uptimeSeconds: Math.round(process.uptime()),
    nodeVersion: process.version,
    environmentMode: process.env.NODE_ENV || 'production',
  };
}

function safeBackupFileName(file) {
  const name = String(file || '');
  if (!name || name.includes('..') || name.includes('/') || name.includes('\\') || path.basename(name) !== name) return '';
  return /^database\.backup\..+\.json$/.test(name) ? name : '';
}

function collectionCounts(db) {
  const counts = {};
  Object.keys(db || {}).sort().forEach(key => {
    if (Array.isArray(db[key])) counts[key] = db[key].length;
  });
  return counts;
}

function restoreDryRunSnapshot(file) {
  const safeFile = safeBackupFileName(file);
  if (!safeFile) {
    const latest = backupStatusSnapshot().latest?.file || '';
    if (!latest) throw new Error('No backup file available for dry-run');
    return restoreDryRunSnapshot(latest);
  }
  const backupPath = path.join(BACKUP_DIR, safeFile);
  if (!fs.existsSync(backupPath)) throw new Error('Backup file not found');
  const backup = readJsonFile(backupPath);
  const live = dbSync ? loadDbFromSqlite(dbSync) : readJsonFile(DB_FILE);
  const liveKeys = Object.keys(live || {}).sort();
  const backupKeys = Object.keys(backup || {}).sort();
  const liveCounts = collectionCounts(live);
  const backupCounts = collectionCounts(backup);
  const keysOnlyInLive = liveKeys.filter(key => !backupKeys.includes(key));
  const keysOnlyInBackup = backupKeys.filter(key => !liveKeys.includes(key));
  const countDiffs = [...new Set([...Object.keys(liveCounts), ...Object.keys(backupCounts)])]
    .sort()
    .map(key => ({ key, live: liveCounts[key] || 0, backup: backupCounts[key] || 0 }))
    .filter(row => row.live !== row.backup);
  return {
    success: true,
    dryRunOnly: true,
    file: safeFile,
    comparedAt: new Date().toISOString(),
    schema: { live: live._schema_version || null, backup: backup._schema_version || null },
    topLevelKeys: { live: liveKeys.length, backup: backupKeys.length, onlyInLive: keysOnlyInLive, onlyInBackup: keysOnlyInBackup },
    recordCounts: { live: liveCounts, backup: backupCounts, differences: countDiffs },
    warnings: [
      ...(keysOnlyInLive.length ? ['Backup is missing top-level keys present in live database'] : []),
      ...(keysOnlyInBackup.length ? ['Backup has top-level keys not present in live database'] : []),
      ...(countDiffs.length ? ['Some top-level collection counts differ'] : []),
    ],
  };
}

function apiProtectionMatrix() {
  return [
    { endpoint: 'GET /api/auth/session', classification: 'public-safe-session-info', protection: 'public sanitized current session only' },
    { endpoint: 'POST /api/auth/login', classification: 'public-auth-entry', protection: 'public with password hash validation and failure lock' },
    { endpoint: 'POST /api/auth/logout', classification: 'session-clear', protection: 'safe clear, works with or without active session' },
    { endpoint: 'GET /api/auth/bootstrap', classification: 'governance bootstrap', protection: 'requires a valid session and platform:page:home permission' },
    { endpoint: 'GET /api/server/status', classification: 'read-only diagnostic', protection: 'public sanitized status, no secrets' },
    { endpoint: 'GET /api/release/status', classification: 'read-only diagnostic', protection: 'public sanitized status, no secrets' },
    { endpoint: 'POST /api/tts', classification: 'server-side speech synthesis', protection: 'requires platform:tts:use permission; API key stays server-side' },
    { endpoint: 'POST /api/review-report', classification: 'local QA report write', protection: 'requires platform:review_report:save permission; writes only to review-reports' },
    { endpoint: 'GET /api/db', classification: 'full data read', protection: 'requires platform:db:read permission; governed paths projected from canonical platform tables' },
    { endpoint: 'POST /api/db', classification: 'dangerous write', protection: 'requires platform:db:write permission + X-Octagon-Full-Sync header; governed paths strangled to canonical platform writers; fail-closed on unreadable existing state' },
    { endpoint: 'POST /api/collection', classification: 'data write', protection: 'requires platform:db:write permission' },
    { endpoint: 'POST /api/record', classification: 'data write', protection: 'requires platform:db:write permission' },
    { endpoint: 'POST /api/upload', classification: 'file write', protection: 'requires platform:db:write permission; bounded body; filename sanitized' },
    { endpoint: 'POST /api/backup', classification: 'admin backup write', protection: 'requires platform:backup:verify permission' },
    { endpoint: 'GET /api/backups', classification: 'admin backup read', protection: 'requires platform:backup:verify permission' },
    { endpoint: 'GET /api/backup/verify', classification: 'backup dry verification', protection: 'requires platform:backup:verify permission' },
    { endpoint: 'GET|POST /api/restore/dry-run', classification: 'restore dry-run', protection: 'requires platform:backup:restore permission' },
    { endpoint: 'POST /api/restore', classification: 'dangerous destructive restore', protection: 'requires platform:backup:restore permission plus typed confirmation and pre-restore backup' },
    { endpoint: 'GET|POST /api/whatsapp/webhook', classification: 'webhook-special', protection: 'fail-closed verify token + HMAC signature (env-configured) + rate limit' },
    { endpoint: 'GET /api/cron/status', classification: 'read-only scheduler diagnostic', protection: 'requires a valid session' },
    { endpoint: 'POST /api/cron/run', classification: 'scheduler force-run (notification-generator only, no direct finance/payroll writes)', protection: 'requires a valid session' },
    { endpoint: 'POST /api/cron/alerts/dismiss', classification: 'scheduled alert dismissal', protection: 'requires a valid session' },
    { endpoint: 'POST /api/sequence/next', classification: 'document numbering (T1.4)', protection: 'open utility; issues next number from dedicated sequences table only (no business data touched), race-safe transaction' },
    { endpoint: 'GET /api/sequence/peek', classification: 'document numbering read (T1.4)', protection: 'open read-only; returns next number without consuming it' },
  ];
}

// Security hardening 2026-07-05: hand the shared helpers to the Jarvis
// security layer (server-side tool gate, approvals, one-time grants, AI proxy).
jarvisSecurity.init({
  sendJson,
  readRequestBody,
  requireSession,
  requireRoleSession,
  appendServerAudit,
  loadDbForMutation,
  saveDb,
  makeId,
});

let octagonScheduler = null;

const server = http.createServer((req, res) => {
  // Inspect the raw request target before URL parsing normalizes dot segments.
  // Otherwise `/../server.js` can become `/server.js` before the resolved-path
  // guard below sees it.
  const rawPath = String(req.url || '').split('?')[0];
  let decodedRawPath = rawPath;
  try {
    decodedRawPath = decodeURIComponent(rawPath);
  } catch (_) {
    return sendJson(res, 400, { error: 'Invalid path encoding' });
  }
  if (/(^|[\\/])\.\.(?:[\\/]|$)/.test(decodedRawPath)) {
    return sendJson(res, 403, { error: 'Security constraint: invalid path' });
  }
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // Security hardening 2026-07-05: /api/jarvis/* (server-side tool gate,
  // approvals, grants) and /api/ai/* (provider proxy — keys stay in .env).
  if (jarvisSecurity.handle(req, res, requestUrl)) return;

  // T3.1: /api/cron/* — server-side scheduler status/force-run/dismiss.
  if (octagonScheduler && octagonScheduler.handle(req, res, requestUrl)) return;

  // T1.4: unified document numbering. POST /api/sequence/next {code, prefix?, padding?}
  // -> { ok, data:{ sequence, number, ... } }. Race-safe (transaction). The
  // client (OctagonSeq) falls back to a local OFFLINE- counter on any non-200.
  if (requestUrl.pathname === '/api/sequence/next' && req.method === 'POST') {
    readRequestBody(req).then(body => {
      let parsed = {};
      try { parsed = body ? JSON.parse(body) : {}; } catch (_) { return sendJson(res, 400, { ok: false, data: null, error: 'Invalid JSON' }); }
      try {
        const result = issueNextSequence(parsed.code, { prefix: parsed.prefix, padding: parsed.padding });
        return sendJson(res, 200, { ok: true, data: result, error: null });
      } catch (error) {
        return sendJson(res, error.statusCode || 500, { ok: false, data: null, error: error.message || 'Sequence issue failed' });
      }
    }).catch(error => sendJson(res, 500, { ok: false, data: null, error: error.message || 'Sequence request failed' }));
    return;
  }

  // T1.4: GET /api/sequence/peek?code=inv — read the NEXT number without
  // consuming it (diagnostics / settings display; never used for issuing).
  if (requestUrl.pathname === '/api/sequence/peek' && req.method === 'GET') {
    try {
      const code = normalizeSequenceCode(requestUrl.searchParams.get('code'));
      if (!code) return sendJson(res, 400, { ok: false, data: null, error: 'code is required' });
      if (!dbSync) return sendJson(res, 503, { ok: false, data: null, error: 'Sequence store unavailable' });
      const row = dbSync.prepare('SELECT code, prefix, padding, next_number, year FROM sequences WHERE code = ?').get(code);
      return sendJson(res, 200, { ok: true, data: row || null, error: null });
    } catch (error) {
      return sendJson(res, 500, { ok: false, data: null, error: error.message || 'Sequence peek failed' });
    }
  }

  if (requestUrl.pathname === '/api/auth/session' && req.method === 'GET') {
    if (!platformAuthority) return sendJson(res, 503, { authenticated: false, error: 'Platform authority not initialized' });
    return platformAuthority.handleSessionInfo(req, res);
  }

  if (requestUrl.pathname === '/api/auth/login' && req.method === 'POST') {
    if (!platformAuthority) return sendJson(res, 503, { success: false, error: 'Platform authority not initialized' });
    return platformAuthority.handleLogin(req, res);
  }

  if (requestUrl.pathname === '/api/auth/logout' && req.method === 'POST') {
    if (!platformAuthority) return sendJson(res, 503, { success: false, error: 'Platform authority not initialized' });
    return platformAuthority.handleLogout(req, res);
  }

  if (requestUrl.pathname === '/api/auth/set-password' && req.method === 'POST') {
    if (!platformAuthority) return sendJson(res, 503, { success: false, error: 'Platform authority not initialized' });
    return platformAuthority.handleSetPassword(req, res);
  }

  if (requestUrl.pathname === '/api/auth/context' && req.method === 'POST') {
    if (!platformAuthority) return sendJson(res, 503, { success: false, error: 'Platform authority not initialized' });
    return platformAuthority.handleContextSwitch(req, res);
  }

  if (requestUrl.pathname === '/api/auth/bootstrap' && req.method === 'GET') {
    if (!platformAuthority) return sendJson(res, 503, { success: false, error: 'Platform authority not initialized' });
    return platformAuthority.handleBootstrap(req, res);
  }

  if (requestUrl.pathname === '/api/auth/options' && req.method === 'GET') {
    if (!dbSync) return sendJson(res, 503, { success: false, error: 'Platform authority not initialized' });
    const users = dbSync.prepare(`
      SELECT id, login, name, locale
      FROM identity_users
      WHERE status = 'active'
      ORDER BY name, login
    `).all().map(user => ({
      id: user.id,
      login: user.login,
      name: user.name,
      displayName: user.name,
      locale: user.locale || 'ar',
    }));
    return sendJson(res, 200, { success: true, users });
  }

  if (platformApiHandler && requestUrl.pathname.startsWith('/api/v1/')) {
    return platformApiHandler(req, res, requestUrl);
  }

  if (requestUrl.pathname === '/api/server/status' && req.method === 'GET') {
    return sendJson(res, 200, {
      success: true,
      generatedAt: new Date().toISOString(),
      server: serverStatusSnapshot(),
      apiProtection: apiProtectionMatrix(),
    });
  }

  if (requestUrl.pathname === '/api/release/status' && req.method === 'GET') {
    const liveSessions = platformAuthority
      ? platformAuthority.dialect.prepare("SELECT COUNT(*) AS n FROM identity_sessions WHERE revoked_at IS NULL AND absolute_expires_at > datetime('now')").get().n
      : 0;
    return sendJson(res, 200, {
      app: 'Octagon ERP',
      phase: 'Phase 02 runtime',
      generatedAt: new Date().toISOString(),
      git: gitSnapshot(),
      route: routeStaticSnapshot(),
      backup: backupStatusSnapshot(),
      server: serverStatusSnapshot(),
      auth: { serverSessionFoundation: true, sessionTtlHours: AUTH_SESSION_TTL_MS / 3600000, activeSessions: liveSessions, apiProtectionFoundation: true, platformAuthority: !!platformAuthority },
      apiProtection: apiProtectionMatrix(),
    });
  }

  if (requestUrl.pathname === '/api/tts' && req.method === 'POST') {
    const guard = requirePermission(req, res, 'platform:tts:use');
    if (!guard.ok) return;
    const session = guard;
    readRequestBody(req, 32 * 1024).then(async body => {
      let parsed = {};
      try { parsed = body ? JSON.parse(body) : {}; } catch (error) { return sendJson(res, 400, { success: false, error: 'Invalid JSON' }); }
      try {
        const result = await synthesizeServerTTS(parsed.text, parsed.lang || 'ar-SA');
        return sendJson(res, 200, { success: true, ...result });
      } catch (error) {
        return sendJson(res, error.statusCode || 500, {
          success: false,
          error: error.message || 'TTS failed',
          providerError: error.providerError || undefined
        });
      }
    }).catch(error => sendJson(res, error.message === 'Payload too large' ? 413 : 500, { success: false, error: error.message || 'Failed to read TTS body' }));
    return;
  }

  if (requestUrl.pathname === '/api/review-report' && req.method === 'POST') {
    const guard = requirePermission(req, res, 'platform:review_report:save');
    if (!guard.ok) return;
    const session = guard;
    readRequestBody(req, 5 * 1024 * 1024).then(body => {
      let parsed = {};
      try { parsed = body ? JSON.parse(body) : {}; } catch (error) { return sendJson(res, 400, { success: false, error: 'Invalid JSON' }); }
      try {
        const report = parsed.report || parsed;
        if (!report || typeof report !== 'object' || !report.page) return sendJson(res, 400, { success: false, error: 'Invalid review report' });
        report.savedBy = report.savedBy || session.userId || 'unknown';
        const file = saveReviewReport(report);
        return sendJson(res, 200, { success: true, file, folder: 'review-reports' });
      } catch (error) {
        return sendJson(res, 400, { success: false, error: error.message || 'Failed to save review report' });
      }
    }).catch(error => sendJson(res, error.message === 'Payload too large' ? 413 : 500, { success: false, error: error.message || 'Failed to read review report body' }));
    return;
  }

  if (requestUrl.pathname === '/api/backup/verify' && req.method === 'GET') {
    const guard = requirePermission(req, res, 'platform:backup:verify');
    if (!guard.ok) return;
    try {
      const requested = requestUrl.searchParams.get('file') || '';
      const status = backupStatusSnapshot();
      const file = requested || status.latest?.file || '';
      if (!file) return sendJson(res, 404, { success: false, error: 'No backup file available to verify' });
      if (file.includes('..') || file.includes('/') || file.includes('\\') || path.basename(file) !== file) {
        return sendJson(res, 403, { success: false, error: 'Invalid backup filename' });
      }
      const target = path.join(BACKUP_DIR, file);
      if (!fs.existsSync(target)) return sendJson(res, 404, { success: false, error: 'Backup file not found' });
      const errors = verifyBackupAgainstLive(target);
      return sendJson(res, 200, { success: errors.length === 0, file, errors });
    } catch (error) {
      return sendJson(res, 500, { success: false, error: error.message || 'Backup verification failed' });
    }
  }

  if (requestUrl.pathname === '/api/restore/dry-run' && (req.method === 'GET' || req.method === 'POST')) {
    const guard = requirePermission(req, res, 'platform:backup:restore');
    if (!guard.ok) return;
    const run = body => {
      try {
        let parsed = {};
        if (body) parsed = JSON.parse(body);
        const file = parsed.file || requestUrl.searchParams.get('file') || '';
        return sendJson(res, 200, restoreDryRunSnapshot(file));
      } catch (error) {
        return sendJson(res, 400, { success: false, dryRunOnly: true, error: error.message || 'Restore dry-run failed' });
      }
    };
    if (req.method === 'POST') readRequestBody(req).then(run).catch(error => sendJson(res, 500, { success: false, error: error.message || 'Failed to read request body' }));
    else run('');
    return;
  }

  if (requestUrl.pathname === '/api/whatsapp/webhook' && req.method === 'GET') {
    const mode = requestUrl.searchParams.get('hub.mode');
    const token = requestUrl.searchParams.get('hub.verify_token');
    const challenge = requestUrl.searchParams.get('hub.challenge');
    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || '';
    // Fail closed: without a configured verify token there is no shared
    // secret to check against, so every verification attempt is rejected.
    if (!verifyToken) return sendJson(res, 503, { success: false, error: 'WHATSAPP_VERIFY_TOKEN not configured' });
    if (mode === 'subscribe' && token === verifyToken && challenge) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.writeHead(200);
      return res.end(challenge);
    }
    return sendJson(res, 403, { success: false, error: 'Webhook verification failed' });
  }

  if (requestUrl.pathname === '/api/whatsapp/webhook' && req.method === 'POST') {
    if (!checkWhatsAppRateLimit(req)) {
      return sendJson(res, 429, { success: false, error: 'Rate limit exceeded' });
    }
    readRequestBody(req).then(rawBody => {
      const signature = verifyWhatsAppSignature(rawBody, req.headers['x-hub-signature-256']);
      if (!signature.enforced) {
        // Fail closed: an unsigned/unverifiable webhook is never accepted.
        return sendJson(res, 503, { success: false, error: signature.reason || 'Webhook signature enforcement unavailable' });
      }
      if (!signature.verified) {
        return sendJson(res, 403, { success: false, error: signature.reason });
      }
      let payload;
      try {
        payload = rawBody ? JSON.parse(rawBody) : {};
      } catch (error) {
        return sendJson(res, 400, { success: false, error: 'Invalid JSON' });
      }
      try {
        const created = appendWhatsAppWebhookPayload(payload, signature);
        return sendJson(res, 200, {
          success: true,
          received: created.length,
          signatureVerified: signature.verified,
          signatureEnforced: signature.enforced,
          ids: created.map(item => item.id),
        });
      } catch (error) {
        console.error('WhatsApp webhook failed:', error);
        return sendJson(res, 500, { success: false, error: error.message || 'Webhook processing failed' });
      }
    }).catch(error => {
      sendJson(res, error.message === 'Payload too large' ? 413 : 500, { success: false, error: error.message || 'Webhook body read failed' });
    });
    return;
  }

  const FINANCE_GOVERNED_COLLECTIONS = [
    'finance', 'finance_accounts', 'finance_journals', 'finance_documents', 'finance_document_lines',
    'finance_journal_entries', 'finance_journal_lines', 'finance_locks', 'finance_periods', 'finance_taxes',
    'finance_currencies', 'finance_exchange_rates', 'finance_payments', 'finance_allocations',
    'finance_bank_statements', 'finance_cashboxes', 'finance_budgets', 'finance_expenses',
    'account_moves', 'accounts', 'omni.finance_accounts', 'omni.account_moves'
  ];

  function isFinanceGovernedCollection(colName) {
    if (!colName) return false;
    const lower = String(colName).toLowerCase();
    return FINANCE_GOVERNED_COLLECTIONS.some(c => lower === c || lower.startsWith('finance_') || lower.startsWith('omni.finance_') || lower.startsWith('finance.'));
  }

  // API Routes
  if (requestUrl.pathname === '/api/db' && req.method === 'GET') {
    const guard = requirePermission(req, res, 'platform:db:read');
    if (!guard.ok) return;
    if (dbSync) {
      try {
        const db = loadDbFromSqlite(dbSync);
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.writeHead(200);
        return res.end(JSON.stringify(db));
      } catch (e) {
        console.error('Failed to load DB from SQLite:', e.message);
      }
    }
    if (!fs.existsSync(DB_FILE)) {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.writeHead(200);
      return res.end(JSON.stringify({ employees: [], config: {} }));
    }
    const data = fs.readFileSync(DB_FILE);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.writeHead(200);
    return res.end(data);
  }

  if (requestUrl.pathname === '/api/db' && req.method === 'POST') {
    const guard = requirePermission(req, res, 'platform:db:write');
    if (!guard.ok) return;
    // T1.3: a full-DB-replacement POST must explicitly declare intent. This
    // alone bounces naive/scripted probes (e.g. a bare `curl -X POST
    // /api/db -d '{"omni":{}}'`) before we even look at the payload — the
    // real app's saveData()/PentagonDB.save() send this header.
    if (req.headers['x-octagon-full-sync'] !== 'yes') {
      logWriteGuardRejection('missing_full_sync_header', { path: '/api/db' }, req);
      return sendJson(res, 409, { ok: false, error: 'يتطلب هذا المسار ترويسة X-Octagon-Full-Sync: yes للحفظ الكامل', collection: null });
    }
    let body = '';
    let bodyTooLarge = false;
    req.on('data', chunk => {
      body += chunk.toString();
      if (!bodyTooLarge && Buffer.byteLength(body) > MAX_FULL_SYNC_BODY_BYTES) {
        bodyTooLarge = true;
        sendJson(res, 413, { ok: false, error: 'Payload too large' });
        req.destroy();
      }
    });
    req.on('end', () => {
      if (bodyTooLarge) return;
      try {
        const parsed = JSON.parse(body);
        let existing = null;
        if (dbSync) {
          try {
            existing = loadDbFromSqlite(dbSync);
          } catch (loadError) {
            // Fail closed: without the current state the wipe protections
            // below cannot run, so this write must not proceed.
            console.error('[/api/db POST] refusing write: existing DB unreadable:', loadError.message);
            return sendJson(res, 503, { ok: false, error: 'Existing database unreadable; write refused (fail-closed)' });
          }
        } else if (fs.existsSync(DB_FILE)) {
          try {
            existing = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
          } catch (mergeError) {
            console.error('[/api/db POST] refusing write: database.json unreadable:', mergeError.message);
            return sendJson(res, 503, { ok: false, error: 'Existing database unreadable; write refused (fail-closed)' });
          }
        }

        if (existing) {
          V5_PRESERVED_TOP_LEVEL_KEYS.forEach(key => {
            if (parsed[key] === undefined && existing[key] !== undefined) {
              parsed[key] = existing[key];
            }
          });
          // Defensive: never let an empty employees[] in the payload destroy a non-empty existing list.
          // The client's DOMContentLoaded fires saveData(true) BEFORE loadData fully finishes in some
          // races, which used to wipe the entire workforce. If you truly want to delete all employees,
          // do it through the UI (which uses /api/collection or per-record deletes).
          if (Array.isArray(parsed.employees) && parsed.employees.length === 0 &&
              Array.isArray(existing.employees) && existing.employees.length > 0) {
            console.warn('[/api/db POST] refusing to wipe', existing.employees.length, 'employees with empty payload; preserving existing.');
            parsed.employees = existing.employees;
          }
          const tenantResult = applyServerTenantProtectionToDatabase(existing, parsed);
          if (tenantResult.stamped || tenantResult.preservedForeign || tenantResult.preservedMissingCollections) {
            console.warn('[/api/db POST] tenant protection applied', {
              stamped: tenantResult.stamped,
              preservedForeign: tenantResult.preservedForeign,
              preservedMissingCollections: tenantResult.preservedMissingCollections,
            });
          }

          // T1.3: SERVER_TENANT_COLLECTIONS protection above only runs when
          // multiTenant is on (tenantEnabledForWrite) — for this
          // single-tenant deployment that's a no-op, so account_moves/
          // finance.*/omni.jobOrders currently have NO protection against a
          // partial POST wiping them (only employees does, via the specific
          // check above, and even that misses the "key entirely absent"
          // case since Array.isArray(undefined) is false). This check is
          // tenant-independent and runs unconditionally: reject (409, never
          // silently repair) any payload that would replace a currently
          // non-empty protected collection with an empty or missing one.
          for (const { path: colPath, label } of HARD_PROTECTED_COLLECTIONS) {
            const existingArr = getNestedPath(existing, colPath);
            if (!Array.isArray(existingArr) || existingArr.length === 0) continue; // nothing to protect
            const incomingArr = getNestedPath(parsed, colPath);
            if (Array.isArray(incomingArr) && incomingArr.length > 0) continue; // fine
            logWriteGuardRejection('protected_collection_emptied', { collection: label, existingCount: existingArr.length }, req);
            console.warn(`[/api/db POST] REJECTED — payload would replace ${existingArr.length} existing "${label}" records with empty/missing.`);
            return sendJson(res, 409, { ok: false, error: `تم رفض الحفظ: سيؤدي إلى فقدان بيانات "${label}"`, collection: label });
          }
        }

        if (dbSync) {
          saveDbToSqlite(dbSync, parsed, guard.ctx);
        } else {
          safeSaveDb(parsed, guard.ctx);
        }

        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.writeHead(200);
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.writeHead(400);
        res.end(JSON.stringify({ error: e.message || 'Invalid JSON' }));
      }
    });
    return;
  }

  if (requestUrl.pathname === '/api/collection' && req.method === 'POST') {
    const guard = requirePermission(req, res, 'platform:db:write');
    if (!guard.ok) return;
    readRequestBody(req).then(body => {
      try {
        const { collection, data } = JSON.parse(body);
        if (!collection || !Array.isArray(data)) {
          return sendJson(res, 400, { error: 'Invalid collection or data' });
        }
        if (isFinanceGovernedCollection(collection)) {
          return sendJson(res, 403, {
            ok: false,
            code: 'FINANCE_CANONICAL_AUTHORITY_REQUIRED',
            error: 'Governed finance facts cannot be mutated via legacy write routes. Use POST /api/v1/action/:actionId'
          });
        }

        const db = loadDbForMutation();
        const result = mergeTenantCollectionForWrite(db, db, collection, data);
        setNestedPath(db, collection, result.data);
        safeSaveDb(db, guard.ctx);
        sendJson(res, 200, { success: true, stamped: result.stamped, preservedForeign: result.preservedForeign });
      } catch (e) {
        sendJson(res, 400, { error: e.message || 'Invalid JSON' });
      }
    }).catch(error => {
      sendJson(res, 500, { error: error.message || 'Failed to read request body' });
    });
    return;
  }

  if (requestUrl.pathname === '/api/record' && req.method === 'POST') {
    const guard = requirePermission(req, res, 'platform:db:write');
    if (!guard.ok) return;
    readRequestBody(req).then(body => {
      try {
        const { collection, id, data } = JSON.parse(body);
        if (!collection || !id || !data) {
          return sendJson(res, 400, { error: 'Invalid collection, id, or data' });
        }
        if (isFinanceGovernedCollection(collection)) {
          return sendJson(res, 403, {
            ok: false,
            code: 'FINANCE_CANONICAL_AUTHORITY_REQUIRED',
            error: 'Governed finance facts cannot be mutated via legacy write routes. Use POST /api/v1/action/:actionId'
          });
        }

        const db = loadDbForMutation();
        let arr = getNestedPath(db, collection);
        if (!Array.isArray(arr)) {
          arr = [];
          setNestedPath(db, collection, arr);
        }
        const idx = arr.findIndex(item => item && item.id === id);
        const prepared = prepareTenantRecordWrite(db, db, collection, id, data, idx !== -1 ? arr[idx] : null);
        if (idx !== -1) {
          arr[idx] = prepared;
        } else {
          arr.push(prepared);
        }
        safeSaveDb(db, guard.ctx);
        sendJson(res, 200, { success: true, stamped: !recordTenantCompanyId(data) && !!recordTenantCompanyId(prepared) });
      } catch (e) {
        sendJson(res, 400, { error: e.message || 'Invalid JSON' });
      }
    }).catch(error => {
      sendJson(res, 500, { error: error.message || 'Failed to read request body' });
    });
    return;
  }

  // Production Hardening Final Lock Sprint (2026-07-04): server-backed
  // idempotency for sensitive postings. See the operation_locks table
  // comment in initializeDatabase() for why this closes the cross-tab race
  // that a client-side in-memory lock cannot.
  if (requestUrl.pathname === '/api/operation-lock/acquire' && req.method === 'POST') {
    const guard = requireSession(req, res);
    if (!guard.ok) return;
    if (!dbSync) { sendJson(res, 503, { error: 'SQLite غير نشطة — لا يمكن ضمان القفل الذري في هذا الوضع' }); return; }
    readRequestBody(req).then(body => {
      try {
        const { lockKey, operationType, sourceCanonicalKey, createdBy } = JSON.parse(body);
        if (!lockKey) return sendJson(res, 400, { error: 'lockKey مطلوب' });
        const STALE_MS = 5 * 60 * 1000;
        const now = new Date().toISOString();
        try {
          dbSync.prepare(`
            INSERT INTO operation_locks (lockKey, id, operationType, sourceCanonicalKey, status, createdAt, completedAt, failedAt, createdBy, relatedMoveId, errorMessage)
            VALUES (?, ?, ?, ?, 'active', ?, NULL, NULL, ?, '', '')
          `).run(lockKey, makeId('lock'), operationType || '', sourceCanonicalKey || '', now, createdBy || 'system');
          return sendJson(res, 200, { acquired: true, reason: 'lock_created', lockKey });
        } catch (insertErr) {
          // PRIMARY KEY collision on lockKey — a lock already exists. This is
          // the atomic uniqueness guarantee: exactly one of any number of
          // concurrent acquire attempts for the same lockKey reaches here.
          const existing = dbSync.prepare('SELECT * FROM operation_locks WHERE lockKey = ?').get(lockKey);
          if (!existing) {
            // Extremely unlikely (row vanished between insert and select) — fail closed.
            return sendJson(res, 500, { error: insertErr.message || 'تعذر الحصول على القفل' });
          }
          if (existing.status === 'completed') {
            return sendJson(res, 200, { acquired: false, reason: 'reused_existing', lockKey, relatedMoveId: existing.relatedMoveId || '' });
          }
          if (existing.status === 'failed') {
            // A failed attempt never completed — safe to reclaim and retry.
            dbSync.prepare(`UPDATE operation_locks SET status='active', createdAt=?, failedAt=NULL, errorMessage='' WHERE lockKey=?`).run(now, lockKey);
            return sendJson(res, 200, { acquired: true, reason: 'reclaimed_after_failed', lockKey });
          }
          // status === 'active'
          const ageMs = Date.now() - new Date(existing.createdAt).getTime();
          if (ageMs <= STALE_MS) {
            return sendJson(res, 200, { acquired: false, reason: 'blocked_in_progress', lockKey, ageMs });
          }
          // Stale active lock. If it never recorded a relatedMoveId, the
          // previous attempt almost certainly died before creating anything —
          // safe to reclaim. If it DID record a relatedMoveId but never
          // completed, we cannot be sure whether the move was fully committed
          // and the "complete" call just failed to arrive, or something else
          // — refuse to guess and surface it for manual review instead.
          if (!existing.relatedMoveId) {
            dbSync.prepare(`UPDATE operation_locks SET status='active', createdAt=?, failedAt=NULL, errorMessage='' WHERE lockKey=?`).run(now, lockKey);
            return sendJson(res, 200, { acquired: true, reason: 'stale_lock_recovered', lockKey });
          }
          return sendJson(res, 200, { acquired: false, reason: 'stale_lock_needs_manual_check', lockKey, relatedMoveId: existing.relatedMoveId, ageMs });
        }
      } catch (e) {
        sendJson(res, 400, { error: e.message || 'Invalid JSON' });
      }
    }).catch(error => sendJson(res, 500, { error: error.message || 'Failed to read request body' }));
    return;
  }

  if (requestUrl.pathname === '/api/operation-lock/complete' && req.method === 'POST') {
    const guard = requireSession(req, res);
    if (!guard.ok) return;
    if (!dbSync) { sendJson(res, 503, { error: 'SQLite غير نشطة' }); return; }
    readRequestBody(req).then(body => {
      try {
        const { lockKey, relatedMoveId } = JSON.parse(body);
        if (!lockKey) return sendJson(res, 400, { error: 'lockKey مطلوب' });
        dbSync.prepare(`UPDATE operation_locks SET status='completed', completedAt=?, relatedMoveId=? WHERE lockKey=?`)
          .run(new Date().toISOString(), relatedMoveId || '', lockKey);
        sendJson(res, 200, { success: true });
      } catch (e) {
        sendJson(res, 400, { error: e.message || 'Invalid JSON' });
      }
    }).catch(error => sendJson(res, 500, { error: error.message || 'Failed to read request body' }));
    return;
  }

  // Used when the operation the lock represents gets reversed (e.g.
  // reopenPayrollPeriod cancels the accrual/advance-settlement moves) — a
  // 'completed' lock pointing at a now-cancelled move must not make the next
  // genuine posting attempt believe it can "reuse" a move that no longer
  // applies. Deleting the row lets the next acquire start fresh.
  if (requestUrl.pathname === '/api/operation-lock/reset' && req.method === 'POST') {
    const guard = requireSession(req, res);
    if (!guard.ok) return;
    if (!dbSync) { sendJson(res, 503, { error: 'SQLite غير نشطة' }); return; }
    readRequestBody(req).then(body => {
      try {
        const { lockKey } = JSON.parse(body);
        if (!lockKey) return sendJson(res, 400, { error: 'lockKey مطلوب' });
        dbSync.prepare('DELETE FROM operation_locks WHERE lockKey=?').run(lockKey);
        sendJson(res, 200, { success: true });
      } catch (e) {
        sendJson(res, 400, { error: e.message || 'Invalid JSON' });
      }
    }).catch(error => sendJson(res, 500, { error: error.message || 'Failed to read request body' }));
    return;
  }

  if (requestUrl.pathname === '/api/operation-lock/fail' && req.method === 'POST') {
    const guard = requireSession(req, res);
    if (!guard.ok) return;
    if (!dbSync) { sendJson(res, 503, { error: 'SQLite غير نشطة' }); return; }
    readRequestBody(req).then(body => {
      try {
        const { lockKey, errorMessage } = JSON.parse(body);
        if (!lockKey) return sendJson(res, 400, { error: 'lockKey مطلوب' });
        dbSync.prepare(`UPDATE operation_locks SET status='failed', failedAt=?, errorMessage=? WHERE lockKey=?`)
          .run(new Date().toISOString(), String(errorMessage || '').slice(0, 500), lockKey);
        sendJson(res, 200, { success: true });
      } catch (e) {
        sendJson(res, 400, { error: e.message || 'Invalid JSON' });
      }
    }).catch(error => sendJson(res, 500, { error: error.message || 'Failed to read request body' }));
    return;
  }

  if (requestUrl.pathname === '/api/upload' && req.method === 'POST') {
    const guard = requirePermission(req, res, 'platform:db:write');
    if (!guard.ok) return;
    let body = '';
    let uploadTooLarge = false;
    req.on('data', chunk => {
      body += chunk.toString();
      if (!uploadTooLarge && Buffer.byteLength(body) > MAX_UPLOAD_BODY_BYTES) {
        uploadTooLarge = true;
        sendJson(res, 413, { error: 'Payload too large' });
        req.destroy();
      }
    });
    req.on('end', () => {
      if (uploadTooLarge) return;
      try {
        const parsed = JSON.parse(body);
        const filename = parsed.filename;
        let content = parsed.content;
        if (!filename || !content) {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Filename and content are required' }));
        }
        
        if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.writeHead(403);
          return res.end(JSON.stringify({ error: 'Security constraint: invalid filename' }));
        }

        const uploadsDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir);
        }

        const base64Data = content.replace(/^data:[^;]+;base64,/, "");
        const buffer = Buffer.from(base64Data, 'base64');

        const ext = path.extname(filename);
        const base = path.basename(filename, ext);
        let finalFilename = filename;
        let counter = 1;
        while (fs.existsSync(path.join(uploadsDir, finalFilename))) {
          finalFilename = `${base}_${counter}${ext}`;
          counter++;
        }

        fs.writeFileSync(path.join(uploadsDir, finalFilename), buffer);
        
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, url: `/uploads/${finalFilename}` }));
      } catch (e) {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message || 'Upload failed' }));
      }
    });
    return;
  }

  if (requestUrl.pathname === '/api/backup' && req.method === 'POST') {
    const guard = requirePermission(req, res, 'platform:backup:verify');
    if (!guard.ok) return;
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        const result = createDatabaseBackup(parsed.tag || 'manual');
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.writeHead(200);
        res.end(JSON.stringify(result));
      } catch (e) {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, error: e.message || 'Backup failed' }));
      }
    });
    return;
  }

  if (requestUrl.pathname === '/api/backups' && req.method === 'GET') {
    const guard = requirePermission(req, res, 'platform:backup:verify');
    if (!guard.ok) return;
    try {
      const files = fs.readdirSync(BACKUP_DIR);
      const backupRegex = /^database\.backup\.(.+)\.json$/;
      const backups = [];
      
      files.forEach(file => {
        const match = file.match(backupRegex);
        if (match) {
          const parts = match[1].split('.');
          const timestamp = parts.pop();
          if (!/^\d{8}_\d{4,6}$/.test(timestamp || '')) return;
          const filePath = path.join(BACKUP_DIR, file);
          const stat = fs.statSync(filePath);
          backups.push({
            file: file,
            tag: parts.join('.') || 'manual',
            timestamp,
            bytes: stat.size,
            created: stat.mtimeMs
          });
        }
      });
      
      backups.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.writeHead(200);
      res.end(JSON.stringify(backups));
    } catch (e) {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message || 'Failed to list backups' }));
    }
    return;
  }

  if (requestUrl.pathname === '/api/restore' && req.method === 'POST') {
    const guard = requirePermission(req, res, 'platform:backup:restore');
    if (!guard.ok) return;
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        const file = parsed.file;
        const expectedConfirmation = file ? `RESTORE ${file}` : '';
        if (!parsed.confirmation || parsed.confirmation !== expectedConfirmation) {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.writeHead(423);
          return res.end(JSON.stringify({
            success: false,
            blocked: true,
            dryRunAvailable: '/api/restore/dry-run',
            error: `Restore is blocked without typed confirmation: ${expectedConfirmation}`
          }));
        }
        
        if (!file) {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Filename is required' }));
        }
        
        if (file.includes('..') || file.includes('/') || file.includes('\\') || path.basename(file) !== file) {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.writeHead(403);
          return res.end(JSON.stringify({ error: 'Security constraint: invalid filename' }));
        }
        
        const backupRegex = /^database\.backup\..*\.json$/;
        if (!backupRegex.test(file)) {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Invalid backup filename format' }));
        }
        
        const backupPath = path.join(BACKUP_DIR, file);
        if (!fs.existsSync(backupPath)) {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.writeHead(404);
          return res.end(JSON.stringify({ error: 'Backup file not found' }));
        }
        
        let safetyBackupName = '';
        try {
          const safetyResult = createDatabaseBackup('pre_restore');
          safetyBackupName = safetyResult.file;
        } catch (safetyErr) {
          console.error('Failed to create safety backup:', safetyErr);
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.writeHead(500);
          return res.end(JSON.stringify({ error: 'Failed to create pre-restore safety backup: ' + safetyErr.message }));
        }
        
        fs.copyFileSync(backupPath, DB_FILE);
        
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.writeHead(200);
        res.end(JSON.stringify({
          success: true,
          restoredFrom: file,
          backupCreated: safetyBackupName
        }));
      } catch (e) {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message || 'Restore failed' }));
      }
    });
    return;
  }

  // Static Files
  if (requestUrl.pathname.startsWith('/uploads/')) {
    const guard = requirePermission(req, res, 'platform:db:read');
    if (!guard.ok) return;
  }
  let filePath = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
  // Fail closed on path traversal: the resolved path must stay inside the
  // application directory.
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(filePath);
  } catch (_) {
    return sendJson(res, 400, { error: 'Invalid path encoding' });
  }
  const resolvedPath = path.resolve(__dirname, decodedPath.replace(/^[/\\]+/, ''));
  if (resolvedPath !== path.resolve(__dirname) && !resolvedPath.startsWith(path.resolve(__dirname) + path.sep)) {
    return sendJson(res, 403, { error: 'Security constraint: invalid path' });
  }
  filePath = resolvedPath;

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    // Defense in depth alongside the global uncaughtException handler above:
    // if the client already disconnected/aborted (or anything upstream
    // already responded on this `res`) by the time this async read
    // completes, writing headers again throws ERR_HTTP_HEADERS_SENT.
    if (res.headersSent || res.writableEnded) return;
    if (err) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.writeHead(404);
      res.end('<h1>404 - الملف غير موجود</h1>');
      return;
    }

    // Inject custom API configuration into HTML — non-secret fields only.
    // The API key is intentionally NOT sent to the browser: this route has no
    // session/auth check, so anyone reaching the server could otherwise read
    // the key straight out of page source. callCustomApi() fails closed
    // ("Custom API key not configured") until a real server-side proxy exists.
    let content = data;
    if (filePath.endsWith('index.html')) {
      const apiConfig = {
        endpoint: process.env.CUSTOM_API_ENDPOINT || '',
        provider: process.env.CUSTOM_API_PROVIDER || 'contactbox',
        model: process.env.CUSTOM_API_MODEL || 'gpt-4'
      };
      const injectionScript = `<script>window.__customApiConfig = ${JSON.stringify(apiConfig)};</script>`;
      content = content.toString().replace('</head>', injectionScript + '\n</head>');
    }

    res.setHeader("Content-Type", contentType);
    if (['.html', '.js', '.css'].includes(ext)) {
      res.setHeader('Cache-Control', 'no-store, max-age=0');
    }
    res.writeHead(200);
    res.end(content);
  });
});

async function initializeDatabase() {
  recoverDbIfCorrupt();

  if (USE_SQLITE) {
    console.log('Database Engine: SQLite Active');
    try {
      dbSync = new DatabaseSync(SQLITE_DB_FILE);
      // WAL + busy_timeout (2026-07-05): with the default journal_mode=delete,
      // ANY second process touching database.db (a verify server on another
      // port, a script, a backup tool) makes concurrent writes throw
      // SQLITE_BUSY immediately — which surfaced to users as failed saves and
      // a misleading "operation in progress (undefined)" toast during payroll
      // posting. WAL lets one writer + many readers coexist, and busy_timeout
      // makes a contended write WAIT up to 5s instead of failing instantly.
      dbSync.exec('PRAGMA journal_mode = WAL;');
      dbSync.exec('PRAGMA busy_timeout = 5000;');
      dbSync.exec('PRAGMA synchronous = NORMAL;');
      // Phase 02: metadata/collections/operation_locks/sequences are legacy runtime
      // tables that the app still relies on; migrations 001–012 build the rest.
      dbSync.exec(`
        CREATE TABLE IF NOT EXISTS metadata (
          key TEXT PRIMARY KEY,
          value TEXT
        );
      `);
      dbSync.exec(`
        CREATE TABLE IF NOT EXISTS collections (
          collection TEXT,
          id TEXT,
          data TEXT,
          PRIMARY KEY (collection, id)
        );
      `);
      // Production Hardening Final Lock Sprint (2026-07-04): server/DB-backed
      // idempotency for sensitive postings (payroll accrual, payroll payment,
      // opening balance, finance-transaction posting, and any future
      // sourceCanonicalKey-based posting). `lockKey` is the PRIMARY KEY, so
      // acquiring a lock is a single atomic SQLite INSERT — see
      // acquireOperationLock() below. This is what actually closes the
      // cross-tab/cross-device race that the previous sprint's in-memory
      // Set-based lock could not: the in-memory lock only protected a single
      // browser tab; this table is shared server-side state, and the INSERT's
      // UNIQUE/PRIMARY KEY violation is detected atomically by SQLite even
      // under concurrent requests (Node's single-threaded event loop runs the
      // synchronous DatabaseSync calls in each request handler to completion
      // without interleaving, so two "simultaneous" acquire requests can never
      // both see the row missing and both insert).
      dbSync.exec(`
        CREATE TABLE IF NOT EXISTS operation_locks (
          lockKey TEXT PRIMARY KEY,
          id TEXT,
          operationType TEXT,
          sourceCanonicalKey TEXT,
          status TEXT,
          createdAt TEXT,
          completedAt TEXT,
          failedAt TEXT,
          createdBy TEXT,
          relatedMoveId TEXT,
          errorMessage TEXT
        );
      `);
      // T1.4: unified document numbering (Odoo ir.sequence equivalent). One row
      // per code; next_number is issued and incremented inside a transaction so
      // two concurrent acquire requests can never receive the same number. year
      // enables a yearly reset (INV-2026-00042 -> INV-2027-00001).
      dbSync.exec(`
        CREATE TABLE IF NOT EXISTS sequences (
          code TEXT PRIMARY KEY,
          prefix TEXT,
          padding INTEGER,
          next_number INTEGER,
          year INTEGER
        );
      `);

      // Phase 02: apply the canonical migration suite (001–012). The legacy
      // auth_sessions table is created by migration 012 only when migrating an
      // existing database and is dropped once migration is complete.
      const { runMigrations } = await import('./database/migration-runner/index.mjs');
      const rowCountBeforeMigrations = dbSync.prepare("SELECT COUNT(*) as count FROM metadata").get().count +
        dbSync.prepare("SELECT COUNT(*) as count FROM collections").get().count;
      if (rowCountBeforeMigrations === 0 && fs.existsSync(DB_FILE)) {
        console.log('SQLite: Database is empty. Importing database.json before canonical migrations...');
        try {
          const jsonDb = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
          saveDbToSqlite(dbSync, jsonDb);
          console.log('SQLite: Legacy import completed successfully.');
        } catch (migrationError) {
          console.error('SQLite legacy import failed:', migrationError.message);
        }
      }

      // Pre-alignment for databases created by pre-migration dev builds: an
      // old x_records table (created outside the migration runner) may lack
      // the company_id/version columns that migration 002's indexes and
      // migration 012's alignment expect. Applied migrations 001-011 are
      // frozen, so the runtime that created the legacy table repairs its own
      // drift here, before the chain runs. No-op on fresh databases.
      const xRecordsTable = dbSync.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='x_records'").get();
      if (xRecordsTable) {
        const xCols = dbSync.prepare('PRAGMA table_info(x_records)').all().map(c => c.name);
        if (!xCols.includes('company_id')) dbSync.exec('ALTER TABLE x_records ADD COLUMN company_id TEXT;');
        if (!xCols.includes('version')) dbSync.exec("ALTER TABLE x_records ADD COLUMN version INTEGER NOT NULL DEFAULT 1;");
      }

      const migrationResult = await runMigrations({ dbPath: SQLITE_DB_FILE, direction: 'up', actor: 'system' });
      if (migrationResult.migrations.length) {
        console.log('Migrations applied:', migrationResult.migrations.join(', '));
      }

    } catch (sqliteInitError) {
      console.error('Failed to initialize SQLite DatabaseSync:', sqliteInitError.message);
      dbSync = null;
    }
  }

  if (!dbSync && fs.existsSync(DB_FILE)) {
    // Loud, impossible-to-miss warning (Production Stabilization Sprint,
    // 2026-07-04): SQLite is the sole live store in normal operation, so
    // landing here means the server is about to run the whole app off
    // database.json instead — which could be an old mirror snapshot rather
    // than the true current state. This must never happen silently.
    console.error('════════════════════════════════════════════════════════');
    console.error('⚠️  DEGRADED MODE: SQLite unavailable — running on database.json.');
    console.error('    database.json is a MIRROR, not guaranteed to be current if');
    console.error('    SQLite has ever been active on this machine. Do not treat this');
    console.error('    session as production-safe until database.db is restored.');
    console.error('════════════════════════════════════════════════════════');
  }
}

(async function start() {
  await initializeDatabase();

  if (dbSync) {
    try {
      const { createPlatformAuthority, mountPlatformApi } = await import('./platform-runtime-bridge.mjs');
      platformAuthority = createPlatformAuthority(dbSync);
      platformApiHandler = await mountPlatformApi(platformAuthority, '/api/v1');
      const { createGovernanceStrangler } = await import('./platform/server/governance-strangler.mjs');
      governanceStrangler = createGovernanceStrangler(platformAuthority);
      console.log('Phase 02 platform authority initialized');
      console.log('Phase 02 governance strangler active: legacy blob is no longer a governance authority');
    } catch (err) {
      console.error('Failed to initialize Phase 02 platform authority:', err.message);
      console.error(err.stack || '');
    }
  }

  // The governance collections module is also needed in degraded non-SQLite
  // mode so safeSaveDb can strip governed paths (fail closed).
  if (!governanceCollections) {
    try {
      governanceCollections = await import('./platform/server/governance-collections.mjs');
    } catch (err) {
      console.error('Governance collections module unavailable:', err.message);
    }
  }

  // T3.1: install after initializeDatabase() so dbSync (if SQLite is active)
  // is already set. Read-only notification generators only — see
  // server-scheduler.js's own header comment.
  octagonScheduler = installOctagonScheduler({
    sqliteDb: dbSync,
    loadDbForMutation,
    saveDb,
    makeId,
    sendJson,
    readRequestBody,
    requireSession,
    // T1.5: the scheduler's nightly_backup_verify job calls ctx.createDatabaseBackup('scheduler');
    // hand it the full create -> verify -> prune(14) -> log cycle instead of the raw
    // create, so the nightly job satisfies T1.5 without any scheduler-side change.
    createDatabaseBackup: runNightlyBackupCycle,
    backupStatusSnapshot,
    serverStatusSnapshot,
    routeStaticSnapshot,
    dbFile: DB_FILE,
    sqliteDbFile: SQLITE_DB_FILE,
    backupDir: BACKUP_DIR,
  });

  probeDefaultPort();

  let fallbackListenIndex = 0;
  server.on('error', error => {
    if (error.code === 'EADDRINUSE' && fallbackListenIndex < FALLBACK_PORTS.length) {
      const blockedPort = PORT;
      const nextPort = FALLBACK_PORTS[fallbackListenIndex++];
      FALLBACK_PORT_USED = true;
      ACTIVE_PORT = nextPort;
      PORT = nextPort;
      PORT_WARNING = `Port ${blockedPort} is already in use. No process was killed; trying fallback port ${nextPort}.`;
      console.warn(PORT_WARNING);
      server.listen(nextPort);
      return;
    }
    console.error(`Server failed to start on port ${PORT}:`, error.message || error);
    process.exitCode = 1;
  });

  server.listen(REQUESTED_PORT, () => {
    console.log(`\n  ⬡ OCTAGON ERP`);
    console.log(`  ──────────────────────────`);
    console.log(`  ✅ Server running: http://localhost:${PORT}`);
    console.log(`  💾 Database file:  ${DB_FILE}`);
    console.log(`  🛡  Safe persistence: atomic writes + .prev snapshot + auto-recovery\n`);
  });
})();
