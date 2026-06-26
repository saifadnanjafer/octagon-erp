const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let DatabaseSync;
try {
  DatabaseSync = require('node:sqlite').DatabaseSync;
} catch (e) {
  console.warn('node:sqlite not supported in this Node.js version, SQLite mode disabled.');
}

const PORT = process.env.PORT || 8080;
const DB_FILE = process.env.OCTAGON_DB_FILE ? path.resolve(process.env.OCTAGON_DB_FILE) : path.join(__dirname, 'database.json');
const DB_PREV_FILE = DB_FILE + '.prev';
const SQLITE_DB_FILE = process.env.OCTAGON_SQLITE_DB_FILE ? path.resolve(process.env.OCTAGON_SQLITE_DB_FILE) : path.join(__dirname, 'database.db');
const SQLITE_DISABLED = process.env.USE_SQLITE === 'false';
const USE_SQLITE = !SQLITE_DISABLED && (process.env.USE_SQLITE === 'true' || fs.existsSync(SQLITE_DB_FILE)) && !!DatabaseSync;

let dbSync = null;
const BACKUP_KEEP = 30;
const AUTO_BACKUP_INTERVAL_MS = 60 * 60 * 1000; // at most one auto-snapshot per hour of activity
let lastAutoBackupMs = 0;
const BACKUP_TAG_RE = /[^a-z0-9_]/gi;
const BACKUP_DIR = process.env.OCTAGON_BACKUP_DIR ? path.resolve(process.env.OCTAGON_BACKUP_DIR) : __dirname;
const AUTH_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const authSessions = new Map();
const authFailures = new Map();
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
  'payments',
  'maintenance_requests',
  'production_orders',
  'work_orders',
  'audit_log',
];

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

function saveDbToSqlite(sqliteDb, db) {
  const collections = {};
  const metadata = {};
  extractDbCollections(db, '', collections, metadata);
  
  sqliteDb.exec("BEGIN TRANSACTION");
  try {
    sqliteDb.exec("DELETE FROM metadata");
    sqliteDb.exec("DELETE FROM collections");
    
    const insertMeta = sqliteDb.prepare("INSERT INTO metadata (key, value) VALUES (?, ?)");
    for (const key in metadata) {
      insertMeta.run(key, JSON.stringify(metadata[key]));
    }
    
    const insertCol = sqliteDb.prepare("INSERT INTO collections (collection, id, data) VALUES (?, ?, ?)");
    const seen = new Set();
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
        insertCol.run(colName, id, JSON.stringify(rec));
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
  
  return db;
}

// Single safe entry point for every DB write. Validates, keeps a last-good
// snapshot, writes atomically, and throttled-auto-backups.
function safeSaveDb(db) {
  if (!db || typeof db !== 'object') throw new Error('Refusing to save invalid DB (not an object)');
  sanitizePersistedArabicText(db);
  
  if (dbSync) {
    saveDbToSqlite(dbSync, db);
    return;
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

function saveDb(db) {
  safeSaveDb(db);
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

function authSessionFromRequest(req) {
  const token = parseCookies(req).octagon_session;
  if (!token) return null;
  const session = authSessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    authSessions.delete(token);
    return null;
  }
  return { token, session };
}

function hashClientPassword(password, salt) {
  return crypto.createHash('sha256').update(String(password || '') + String(salt || '')).digest('hex');
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

function routeStaticSnapshot() {
  const htmlPath = path.join(__dirname, 'index.html');
  const viewsDir = path.join(__dirname, 'views');
  const html = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : '';
  const nav = [...html.matchAll(/data-page="([^"]+)"/g)].map(match => match[1]);
  const markers = [...html.matchAll(/<!--\s*view:([^\s]+)\s*-->/g)].map(match => match[1]);
  const viewFiles = fs.existsSync(viewsDir) ? fs.readdirSync(viewsDir).filter(file => file.endsWith('.html')).map(file => file.replace(/\.html$/, '')) : [];
  const duplicateDataPages = [...new Set(nav.filter((item, idx) => nav.indexOf(item) !== idx))];
  const missingViewFiles = [...new Set(nav)].filter(page => !viewFiles.includes(page));
  const missingMarkers = [...new Set(nav)].filter(page => !markers.includes(page));
  return {
    navCount: new Set(nav).size,
    navTotal: nav.length,
    viewMarkerCount: new Set(markers).size,
    viewMarkerTotal: markers.length,
    viewFiles: viewFiles.length,
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

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (requestUrl.pathname === '/api/auth/session' && req.method === 'GET') {
    const active = authSessionFromRequest(req);
    if (!active) return sendJson(res, 200, { authenticated: false, user: null });
    try {
      const db = loadDbForMutation();
      const user = userListFromDb(db).find(item => item.id === active.session.userId);
      return sendJson(res, 200, {
        authenticated: !!user,
        user: enrichAuthUser(db, user),
        expiresAt: new Date(active.session.expiresAt).toISOString(),
      });
    } catch (error) {
      return sendJson(res, 500, { authenticated: false, error: error.message || 'Session check failed' });
    }
  }

  if (requestUrl.pathname === '/api/auth/login' && req.method === 'POST') {
    readRequestBody(req).then(body => {
      let parsed = {};
      try { parsed = body ? JSON.parse(body) : {}; } catch (error) { return sendJson(res, 400, { success: false, error: 'Invalid JSON' }); }
      const userId = String(parsed.userId || '').trim();
      const password = String(parsed.password || '');
      const db = loadDbForMutation();
      const user = userListFromDb(db).find(item => item.id === userId);
      const failure = authFailures.get(userId) || { count: 0, lockedUntil: 0 };
      if (failure.lockedUntil && Date.now() < failure.lockedUntil) {
        appendServerAudit(db, { action: 'login_locked', status: 'blocked', actorId: userId || 'unknown', actorName: user?.displayName || user?.name || userId || 'unknown', payload: { userId, lockedUntil: new Date(failure.lockedUntil).toISOString() } });
        saveDb(db);
        return sendJson(res, 423, { success: false, locked: true, error: 'Account temporarily locked after failed logins' });
      }
      if (!user) {
        appendServerAudit(db, { action: 'login_failed', status: 'failed', actorId: userId || 'unknown', actorName: userId || 'unknown', payload: { userId, reason: 'user_not_found' } });
        saveDb(db);
        return sendJson(res, 401, { success: false, error: 'Invalid credentials' });
      }
      if (!user.passwordHash || !user.passwordSalt) {
        appendServerAudit(db, { action: 'login_setup_required', status: 'blocked', actorId: user.id, actorName: user.displayName || user.name || user.id, payload: { userId: user.id } });
        saveDb(db);
        return sendJson(res, 409, { success: false, setupRequired: true, error: 'Password setup required in local client flow' });
      }
      const expected = String(user.passwordHash || '');
      const actual = hashClientPassword(password, user.passwordSalt);
      if (actual !== expected) {
        failure.count += 1;
        if (failure.count >= 5) failure.lockedUntil = Date.now() + (15 * 60 * 1000);
        authFailures.set(user.id, failure);
        appendServerAudit(db, { action: 'login_failed', status: 'failed', actorId: user.id, actorName: user.displayName || user.name || user.id, payload: { userId: user.id, failedCount: failure.count } });
        saveDb(db);
        return sendJson(res, 401, { success: false, error: 'Invalid credentials', failedCount: failure.count, locked: !!failure.lockedUntil });
      }
      authFailures.delete(user.id);
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = Date.now() + AUTH_SESSION_TTL_MS;
      authSessions.set(token, { userId: user.id, createdAt: Date.now(), expiresAt });
      user.lastServerLoginAt = new Date().toISOString();
      appendServerAudit(db, { action: 'login_success', status: 'success', actorId: user.id, actorName: user.displayName || user.name || user.id, payload: { userId: user.id, expiresAt: new Date(expiresAt).toISOString() } });
      saveDb(db);
      setAuthCookie(res, token, Math.floor(AUTH_SESSION_TTL_MS / 1000));
      return sendJson(res, 200, { success: true, authenticated: true, user: enrichAuthUser(db, user), expiresAt: new Date(expiresAt).toISOString() });
    }).catch(error => sendJson(res, 500, { success: false, error: error.message || 'Login failed' }));
    return;
  }

  if (requestUrl.pathname === '/api/auth/logout' && req.method === 'POST') {
    const active = authSessionFromRequest(req);
    if (active) authSessions.delete(active.token);
    try {
      const db = loadDbForMutation();
      appendServerAudit(db, { action: 'logout_success', status: 'success', actorId: active?.session?.userId || 'unknown', actorName: active?.session?.userId || 'unknown', payload: { userId: active?.session?.userId || '' } });
      saveDb(db);
    } catch (_) {}
    setAuthCookie(res, '', 0);
    return sendJson(res, 200, { success: true });
  }

  if (requestUrl.pathname === '/api/release/status' && req.method === 'GET') {
    return sendJson(res, 200, {
      app: 'Octagon ERP',
      phase: 'Phase 7A',
      generatedAt: new Date().toISOString(),
      git: gitSnapshot(),
      route: routeStaticSnapshot(),
      backup: backupStatusSnapshot(),
      auth: { serverSessionFoundation: true, sessionTtlHours: AUTH_SESSION_TTL_MS / 3600000, activeSessions: authSessions.size },
    });
  }

  if (requestUrl.pathname === '/api/backup/verify' && req.method === 'GET') {
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

  if (requestUrl.pathname === '/api/whatsapp/webhook' && req.method === 'GET') {
    const mode = requestUrl.searchParams.get('hub.mode');
    const token = requestUrl.searchParams.get('hub.verify_token');
    const challenge = requestUrl.searchParams.get('hub.challenge');
    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || 'octagon-local-dev';
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
      if (signature.enforced && !signature.verified) {
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

  // API Routes
  if (req.url === '/api/db' && req.method === 'GET') {
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

  if (req.url === '/api/db' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        let existing = null;
        if (dbSync) {
          try {
            existing = loadDbFromSqlite(dbSync);
          } catch(e) {}
        } else if (fs.existsSync(DB_FILE)) {
          try {
            existing = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
          } catch (mergeError) {}
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
        }
        
        if (dbSync) {
          saveDbToSqlite(dbSync, parsed);
        } else {
          safeSaveDb(parsed);
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

  if (req.url === '/api/collection' && req.method === 'POST') {
    readRequestBody(req).then(body => {
      try {
        const { collection, data } = JSON.parse(body);
        if (!collection || !Array.isArray(data)) {
          return sendJson(res, 400, { error: 'Invalid collection or data' });
        }
        
        const db = loadDbForMutation();
        const result = mergeTenantCollectionForWrite(db, db, collection, data);
        setNestedPath(db, collection, result.data);
        safeSaveDb(db);
        sendJson(res, 200, { success: true, stamped: result.stamped, preservedForeign: result.preservedForeign });
      } catch (e) {
        sendJson(res, 400, { error: e.message || 'Invalid JSON' });
      }
    }).catch(error => {
      sendJson(res, 500, { error: error.message || 'Failed to read request body' });
    });
    return;
  }

  if (req.url === '/api/record' && req.method === 'POST') {
    readRequestBody(req).then(body => {
      try {
        const { collection, id, data } = JSON.parse(body);
        if (!collection || !id || !data) {
          return sendJson(res, 400, { error: 'Invalid collection, id, or data' });
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
        safeSaveDb(db);
        sendJson(res, 200, { success: true, stamped: !recordTenantCompanyId(data) && !!recordTenantCompanyId(prepared) });
      } catch (e) {
        sendJson(res, 400, { error: e.message || 'Invalid JSON' });
      }
    }).catch(error => {
      sendJson(res, 500, { error: error.message || 'Failed to read request body' });
    });
    return;
  }

  if (req.url === '/api/upload' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
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

  if (req.url === '/api/backup' && req.method === 'POST') {
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

  if (req.url === '/api/backups' && req.method === 'GET') {
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

  if (req.url === '/api/restore' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        const file = parsed.file;
        
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
  let filePath = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
  filePath = path.join(__dirname, decodeURIComponent(filePath));
  
  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.writeHead(404);
      res.end('<h1>404 - الملف غير موجود</h1>');
      return;
    }
    res.setHeader("Content-Type", contentType);
    if (['.html', '.js', '.css'].includes(ext)) {
      res.setHeader('Cache-Control', 'no-store, max-age=0');
    }
    res.writeHead(200);
    res.end(data);
  });
});

function initializeDatabase() {
  recoverDbIfCorrupt();
  
  if (USE_SQLITE) {
    console.log('Database Engine: SQLite Active');
    try {
      dbSync = new DatabaseSync(SQLITE_DB_FILE);
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
      
      const rowCount = dbSync.prepare("SELECT COUNT(*) as count FROM metadata").get().count +
                       dbSync.prepare("SELECT COUNT(*) as count FROM collections").get().count;
                       
      if (rowCount === 0 && fs.existsSync(DB_FILE)) {
        console.log('SQLite: Database is empty. Migrating database.json to SQLite database.db...');
        try {
          const jsonDb = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
          saveDbToSqlite(dbSync, jsonDb);
          console.log('SQLite: Migration completed successfully.');
        } catch (migrationError) {
          console.error('SQLite Migration failed:', migrationError.message);
        }
      }
    } catch (sqliteInitError) {
      console.error('Failed to initialize SQLite DatabaseSync:', sqliteInitError.message);
      dbSync = null;
    }
  }
}

initializeDatabase();

server.listen(PORT, () => {
  console.log(`\n  ⬡ OCTAGON ERP`);
  console.log(`  ──────────────────────────`);
  console.log(`  ✅ Server running: http://localhost:${PORT}`);
  console.log(`  💾 Database file:  ${DB_FILE}`);
  console.log(`  🛡  Safe persistence: atomic writes + .prev snapshot + auto-recovery\n`);
});
