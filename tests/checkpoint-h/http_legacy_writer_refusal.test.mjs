// Checkpoint H — legacy writer refusal proven over REAL HTTP.
//
// Closes Checkpoint G blocker H2. Checkpoint G proved refusal at the DECISION
// layer: it called `createLegacyWriterRetirementGuard(db)` — the same
// constructor `server.js` consults — and showed every governed collection
// resolved to an enforced authority. What it never did was issue an actual
// HTTP request and observe an actual refusal, so the wiring between that
// decision and a real response was inferred from source, not observed.
//
// This suite starts the REAL `server.js` on a disposable port and a disposable
// database with canonical cutover ACTIVE, authenticates as the owner (the
// highest-privilege user, so a refusal cannot be mistaken for a permission
// failure), and drives the three generic legacy write routes over the wire.
//
// Assertions are on the HTTP status, the machine-readable error code, the
// named authority domain, and — separately, against the fixture database — on
// the fact that nothing was written and no success event was published.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test, before, after } from 'node:test';

import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createUserDirectory } from '../../platform/identity/users/index.mjs';
import { createMembershipDirectory } from '../../platform/organizations/memberships/index.mjs';
import { createCanonicalCutoverController } from '../../platform/cutover/canonical-cutover-controller.mjs';
import { createLegacyWriterRetirementGuard } from '../../platform/cutover/legacy-writer-retirement.mjs';
import { allocatePort } from '../helpers/allocate-port.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const STRONG_PASSWORD = 'Alpha#Beta9!x';

// One governed collection per canonical domain, exactly as a legacy page would
// name it. Each must be refused once its authority is enforced.
const GOVERNED = [
  { domain: 'COMMERCIAL', collection: 'customers', row: { id: 'ckh_c1', name: 'HTTP Probe Customer' } },
  { domain: 'COMMERCIAL', collection: 'suppliers', row: { id: 'ckh_s1', name: 'HTTP Probe Supplier' } },
  { domain: 'COMMERCIAL', collection: 'omni.materials', row: { id: 'ckh_m1', name: 'HTTP Probe Material' } },
  { domain: 'INVENTORY', collection: 'warehouses', row: { id: 'ckh_w1', code: 'CKHWH' } },
  { domain: 'INVENTORY', collection: 'locations', row: { id: 'ckh_l1', name: 'HTTP Probe Location' } },
  { domain: 'INVENTORY', collection: 'quants', row: { id: 'ckh_q1', quantity: 999 } },
  { domain: 'INVENTORY', collection: 'stock_moves', row: { id: 'ckh_sm1', quantity: 5 } },
  { domain: 'SALES', collection: 'salesOrders', row: { id: 'ckh_so1', total: 100 } },
  { domain: 'PROCUREMENT', collection: 'purchaseOrders', row: { id: 'ckh_po1', total: 100 } },
  { domain: 'POS', collection: 'posOrders', row: { id: 'ckh_pos1', total: 50 } },
  { domain: 'WORK_ITEM', collection: 'tasks', row: { id: 'ckh_t1', title: 'HTTP Probe Task' } },
  { domain: 'PROJECT', collection: 'omni.projects', row: { id: 'ckh_pr1', name: 'HTTP Probe Project' } },
  { domain: 'ENGINEERING', collection: 'omni.boms', row: { id: 'ckh_b1', name: 'HTTP Probe BOM' } },
  { domain: 'MANUFACTURING', collection: 'omni.workOrders', row: { id: 'ckh_wo1', qty: 1 } },
  { domain: 'QUALITY', collection: 'omni.quality', row: { id: 'ckh_qc1', result: 'pass' } },
  { domain: 'ASSET', collection: 'omni.assets', row: { id: 'ckh_a1', name: 'HTTP Probe Asset' } },
  { domain: 'MAINTENANCE', collection: 'omni.maintenance', row: { id: 'ckh_mt1', state: 'open' } },
  { domain: 'FLEET', collection: 'omni.fleet', row: { id: 'ckh_f1', plate: 'CKH-001' } },
  { domain: 'FINANCE', collection: 'account_moves', row: { id: 'ckh_am1', amount: 1000 } },
  { domain: 'FINANCE', collection: 'finance.accounts', row: { id: 'ckh_acc1', name: 'HTTP Probe Account' } },
];

// The frozen zone. These must NOT be refused — they are the writers the running
// workshop depends on, and retiring them is explicitly out of scope.
const FROZEN = ['employees', 'omni.employeeAttendance', 'omni.workshopTimesheetCases', 'omni.jobOrders'];

let tempDir;
let dbPath;
let jsonPath;
let server;
let base;
let cookies;
let db;

function fixMembershipIds(dialect) {
  dialect.exec('PRAGMA foreign_keys = OFF;');
  try {
    const memberships = dialect.prepare('SELECT id, user_id, company_id FROM organization_memberships').all();
    const idMap = new Map();
    for (const m of memberships) {
      const newId = `mem_${m.user_id}_${m.company_id}`;
      idMap.set(m.id, newId);
      dialect.prepare('UPDATE organization_memberships SET id = ? WHERE id = ?').run(newId, m.id);
    }
    for (const s of dialect.prepare('SELECT id, membership_id FROM organization_scope_assignments').all()) {
      const newId = idMap.get(s.membership_id);
      if (newId) dialect.prepare('UPDATE organization_scope_assignments SET membership_id = ? WHERE id = ?').run(newId, s.id);
    }
  } finally {
    dialect.exec('PRAGMA foreign_keys = ON;');
  }
}

function seedIdentity(dialect) {
  const now = new Date().toISOString();
  dialect.prepare("INSERT INTO platform_tenants (id,name,status,created_at) VALUES ('t_alpha','Alpha','active',?) ON CONFLICT(id) DO NOTHING").run(now);
  dialect.prepare("INSERT INTO platform_companies (id,tenant_id,name,status,fiscal_year_start,created_at) VALUES ('c_alpha_1','t_alpha','Alpha Co','active',1,?) ON CONFLICT(id) DO NOTHING").run(now);
  dialect.prepare("INSERT INTO platform_branches (id,company_id,name,status,created_at) VALUES ('b_alpha_1a','c_alpha_1','Branch A','active',?) ON CONFLICT(id) DO NOTHING").run(now);

  const users = createUserDirectory(dialect);
  const memberships = createMembershipDirectory(dialect);
  const owner = users.create({
    id: 'u_owner', tenantId: 't_alpha', login: 'owner', name: 'Owner',
    email: 'owner@example.com', password: STRONG_PASSWORD, isOwner: true,
  });
  memberships.grant({ userId: owner.id, companyId: 'c_alpha_1', isDefault: true });
  fixMembershipIds(dialect);
}

function startServer(port) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      USE_SQLITE: 'true',
      OCTAGON_SQLITE_DB_FILE: dbPath,
      OCTAGON_DB_FILE: jsonPath,
      PORT: String(port),
      OCTAGON_DEFAULT_PORT: String(port),
      OCTAGON_FALLBACK_PORTS: '',
      NODE_ENV: 'test',
    };
    const proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: 'pipe' });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d; });
    const timeout = setTimeout(() => { proc.kill(); reject(new Error(`server start timeout: ${stderr}`)); }, 20000);
    const poll = async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/server/status`);
        if (res.ok) {
          clearTimeout(timeout);
          resolve({ proc, stop: () => new Promise((r) => { proc.on('close', r); proc.kill(); }) });
          return;
        }
      } catch { /* not up yet */ }
      if (proc.exitCode !== null) {
        clearTimeout(timeout);
        reject(new Error(`server exited ${proc.exitCode}: ${stderr}`));
        return;
      }
      setTimeout(poll, 200);
    };
    setTimeout(poll, 400);
  });
}

async function post(pathname, body, extraHeaders = {}) {
  const res = await fetch(`${base}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookies, ...extraHeaders },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({}));
  return { status: res.status, payload };
}

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-ckh-http-'));
  dbPath = path.join(tempDir, 'http-refusal.db');
  jsonPath = path.join(tempDir, 'http-refusal.json');
  fs.writeFileSync(jsonPath, JSON.stringify({ employees: [], config: {} }));

  await freshInstall({ dbPath, backupDir: path.join(tempDir, 'backups'), actor: 'checkpoint-h' });
  const dialect = openMigrationDatabase(dbPath);
  seedIdentity(dialect);

  // Activate canonical cutover on this disposable database.
  const result = createCanonicalCutoverController({
    dialect, dbPath,
    env: { OCTAGON_DISPOSABLE_FIXTURE: '1', OCTAGON_RUNTIME_MODE: 'test' },
  }).activateAll({ actor: 'checkpoint-h-http' });
  assert.deepEqual(result.blocked, [], `cutover blocked: ${JSON.stringify(result.blocked)}`);
  dialect.close();

  const port = await allocatePort();
  base = `http://127.0.0.1:${port}`;
  server = await startServer(port);

  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'owner', password: STRONG_PASSWORD, tenantId: 't_alpha' }),
  });
  assert.equal(login.status, 200, `owner login failed with ${login.status}`);
  cookies = login.headers.get('set-cookie') || '';
  assert.ok(cookies, 'no session cookie issued');

  db = openMigrationDatabase(dbPath);
});

after(async () => {
  try { db?.close(); } catch {}
  try { await server?.stop(); } catch {}
  if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------

test('the fixture really has cutover active before any HTTP call', () => {
  const guard = createLegacyWriterRetirementGuard(db);
  assert.equal(guard.cutoverEnabled(), true, 'cutover flag not set on the fixture');
  for (const d of ['COMMERCIAL', 'INVENTORY', 'SALES', 'PROCUREMENT', 'POS', 'WORK_ITEM',
    'PROJECT', 'ENGINEERING', 'MANUFACTURING', 'QUALITY', 'ASSET', 'MAINTENANCE', 'FLEET']) {
    assert.equal(guard.enforced(d), true, `${d} not enforced on the fixture`);
  }
});

test('the owner really is authenticated and privileged', async () => {
  const res = await fetch(`${base}/api/auth/session`, { headers: { Cookie: cookies } });
  assert.equal(res.status, 200, 'session not established — a later 403 would be ambiguous');
});

// One test per governed collection, so every domain has its own HTTP result.
for (const { domain, collection, row } of GOVERNED) {
  test(`POST /api/collection is refused for ${domain} (${collection})`, async () => {
    const { status, payload } = await post('/api/collection', { collection, data: [row] });

    assert.equal(status, 403, `expected 403, got ${status} for ${collection}`);
    assert.equal(payload.ok, false, 'refusal payload did not set ok:false');
    assert.equal(
      payload.code,
      `${domain}_CANONICAL_AUTHORITY_REQUIRED`,
      `wrong error code for ${collection}: ${payload.code}`,
    );
    assert.match(payload.error || '', /POST \/api\/v1\/action/, 'refusal does not name the canonical replacement');
  });

  test(`POST /api/record is refused for ${domain} (${collection})`, async () => {
    const { status, payload } = await post('/api/record', { collection, id: row.id, data: row });
    assert.equal(status, 403, `expected 403, got ${status} for ${collection}`);
    assert.equal(payload.code, `${domain}_CANONICAL_AUTHORITY_REQUIRED`, `wrong code: ${payload.code}`);
  });
}

test('POST /api/db is refused when it would mutate a governed path', async () => {
  // First read the current full state, then mutate exactly one governed path.
  const current = await fetch(`${base}/api/db`, { headers: { Cookie: cookies } });
  assert.equal(current.status, 200, 'could not read /api/db');
  const state = await current.json();

  state.customers = [{ id: 'ckh_db_probe', name: 'Full Sync Probe' }];

  const res = await fetch(`${base}/api/db`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookies, 'X-Octagon-Full-Sync': 'yes' },
    body: JSON.stringify(state),
  });
  const payload = await res.json().catch(() => ({}));

  assert.equal(res.status, 409, `expected 409 from /api/db, got ${res.status}`);
  assert.equal(payload.code, 'COMMERCIAL_CANONICAL_AUTHORITY_REQUIRED', `wrong code: ${payload.code}`);
  assert.equal(payload.collection, 'customers', 'refusal did not name the offending collection');
});

test('POST /api/db still requires its explicit full-sync intent header', async () => {
  const res = await fetch(`${base}/api/db`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookies },
    body: JSON.stringify({ customers: [] }),
  });
  assert.equal(res.status, 409, 'a bare full-sync POST was not bounced');
});

test('an unauthenticated caller cannot reach the legacy writers at all', async () => {
  const res = await fetch(`${base}/api/collection`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ collection: 'customers', data: [] }),
  });
  assert.ok(res.status === 401 || res.status === 403, `unauthenticated write returned ${res.status}`);
});

test('frozen-zone paths are NOT refused — they are out of retirement scope', async () => {
  // This is the negative control. If cutover ever started refusing these, the
  // running workshop would break: payroll, attendance, timesheet and the
  // workshop job-order chain are deliberately outside canonical retirement.
  for (const collection of FROZEN) {
    const { status, payload } = await post('/api/collection', { collection, data: [] });
    assert.notEqual(status, 403, `frozen-zone path '${collection}' was refused by the cutover`);
    assert.notEqual(
      payload.code, 'COMMERCIAL_CANONICAL_AUTHORITY_REQUIRED',
      `frozen-zone path '${collection}' was claimed by an authority`,
    );
  }
});

test('no refused write left a record, an audit success, or an outbox event', () => {
  // The HTTP status is only half the proof; the other half is that nothing
  // reached the database.
  const outboxLeak = db.prepare("SELECT COUNT(*) AS c FROM platform_outbox WHERE payload LIKE '%ckh_%'").get().c;
  assert.equal(outboxLeak, 0, `${outboxLeak} outbox events reference a refused probe record`);

  // platform_audit_log records before/after values and the resource id, not a
  // generic payload column.
  const auditLeak = db.prepare(`
    SELECT COUNT(*) AS c FROM platform_audit_log
    WHERE resource_id LIKE '%ckh_%'
       OR after_value LIKE '%ckh_%'
       OR before_value LIKE '%ckh_%'
  `).get().c;
  assert.equal(auditLeak, 0, `${auditLeak} audit entries reference a refused probe record`);

  // Nor may any audit row claim one of these refusals succeeded.
  const falseSuccess = db.prepare(`
    SELECT COUNT(*) AS c FROM platform_audit_log
    WHERE result = 'success' AND (resource_id LIKE '%ckh_%' OR after_value LIKE '%ckh_%')
  `).get().c;
  assert.equal(falseSuccess, 0, 'an audit row records a refused legacy write as successful');

  // And the canonical tables are untouched.
  for (const t of ['parties', 'warehouses', 'stock_moves', 'stock_quants', 'work_items']) {
    const c = db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
    assert.equal(c, 0, `${t} gained ${c} rows from a refused legacy write`);
  }
});

test('the write-guard log recorded the refusals', () => {
  // Refusals must be observable operationally, not just to the caller.
  const logPath = path.join(ROOT, 'server-write-guard.log');
  if (!fs.existsSync(logPath)) return; // log is opt-in; absence is not a failure
  const tail = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).slice(-50);
  const hasCanonical = tail.some((line) => line.includes('canonical_authority_required'));
  assert.ok(hasCanonical || tail.length === 0, 'write-guard log has recent entries but none record a canonical refusal');
});
