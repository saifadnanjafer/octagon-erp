// Phase 02 runtime adversarial tests.
//
// Spawns the real server.js and probes fail-closed guards, session handling,
// path traversal, tenant isolation, and secrets hygiene at the HTTP boundary.

import assert from 'node:assert';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import net from 'node:net';
import { setup, cleanup, run, seedOrg, STRONG_PASSWORD } from './harness.mjs';
import { openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { GOVERNED_PATHS } from '../../platform/server/governance-collections.mjs';
import { allocatePort } from '../helpers/allocate-port.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

function tmpJsonPath(suite) {
  return path.join(os.tmpdir(), `octagon-p02-${suite}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.json`);
}

function startServer({ dbPath, jsonPath, port, envExtra = {} }) {
  return new Promise((resolve, reject) => {
    const backupDir = path.join(os.tmpdir(), `octagon-backup-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
    const reportDir = path.join(os.tmpdir(), `octagon-reports-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
    const env = {
      ...process.env,
      ...envExtra,
      USE_SQLITE: 'true',
      OCTAGON_SQLITE_DB_FILE: dbPath,
      OCTAGON_DB_FILE: jsonPath,
      OCTAGON_BACKUP_DIR: backupDir,
      OCTAGON_REVIEW_REPORT_DIR: reportDir,
      PORT: String(port),
      OCTAGON_DEFAULT_PORT: String(port),
      OCTAGON_FALLBACK_PORTS: '',
      NODE_ENV: 'test',
    };
    const proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: 'pipe' });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });

    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error(`Server failed to start within timeout. stderr: ${stderr}`));
    }, 15000);

    const checkReady = async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/server/status`);
        if (res.ok) {
          clearTimeout(timeout);
          resolve({ proc, port, stdout: () => stdout, stderr: () => stderr, stop: () => new Promise(r => {
            proc.on('close', () => {
              for (const d of [backupDir, reportDir]) {
                try {
                  for (const f of fs.readdirSync(d)) fs.unlinkSync(path.join(d, f));
                  fs.rmdirSync(d);
                } catch {}
              }
              r();
            });
            proc.kill();
          }) });
          return;
        }
      } catch { /* not ready yet */ }
      if (proc.exitCode !== null) {
        clearTimeout(timeout);
        reject(new Error(`Server exited early (code ${proc.exitCode}). stderr: ${stderr}`));
        return;
      }
      setTimeout(checkReady, 200);
    };
    setTimeout(checkReady, 500);
  });
}

async function login(base, userId, password, tenantId) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, password, tenantId }),
    credentials: 'include',
  });
  const payload = await res.json().catch(() => ({}));
  const cookies = res.headers.get('set-cookie') || '';
  return { res, payload, cookies };
}

async function withCookie(base, cookies, method, path, body, extraHeaders = {}) {
  const opts = { method, credentials: 'include', headers: { Cookie: cookies, ...extraHeaders } };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${base}${path}`, opts);
  const payload = await res.json().catch(() => ({}));
  return { res, payload };
}

async function withoutCookie(base, method, path, body, extraHeaders = {}) {
  const opts = { method, headers: { ...extraHeaders } };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${base}${path}`, opts);
  const payload = await res.json().catch(() => ({}));
  return { res, payload };
}

function fixMembershipIds(dialect) {
  dialect.exec('PRAGMA foreign_keys = OFF;');
  try {
    const memberships = dialect.prepare('SELECT id, user_id, company_id, branch_id FROM organization_memberships').all();
    const idMap = new Map();
    for (const m of memberships) {
      const newId = `mem_${m.user_id}_${m.company_id}`;
      idMap.set(m.id, newId);
      dialect.prepare('UPDATE organization_memberships SET id = ? WHERE id = ?').run(newId, m.id);
    }
    const scopes = dialect.prepare('SELECT id, membership_id FROM organization_scope_assignments').all();
    for (const s of scopes) {
      const newId = idMap.get(s.membership_id);
      if (newId) {
        dialect.prepare('UPDATE organization_scope_assignments SET membership_id = ? WHERE id = ?').run(newId, s.id);
      }
    }
  } finally {
    dialect.exec('PRAGMA foreign_keys = ON;');
  }
}

function openSqlite(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  return db;
}

function countRows(db, sql, ...args) {
  return Number(db.prepare(sql).get(...args)?.n || 0);
}

function grantClerkHomePage(dialect, clerkUserId, companyId) {
  const now = new Date().toISOString();
  dialect.prepare(`
    INSERT INTO authorization_permissions (id, module_id, kind, resource, action, label_ar, label_en, created_at, updated_at)
    VALUES ('platform:page:home', 'platform_kernel', 'page', 'platform', 'page:home', 'home', 'home', ?, ?)
    ON CONFLICT(id) DO NOTHING
  `).run(now, now);
  dialect.prepare(`
    INSERT INTO authorization_roles (id, tenant_id, name, label_ar, is_system, status, created_at, updated_at)
    VALUES ('r_clerk_read', 'default', 'clerk_read', 'clerk', 0, 'active', ?, ?)
    ON CONFLICT(id) DO NOTHING
  `).run(now, now);
  dialect.prepare(`
    INSERT INTO authorization_grants (id, role_id, permission, effect, scope, document_states, requires_approval, created_at, created_by)
    VALUES ('grant_clerk_home', 'r_clerk_read', 'platform:page:home', 'allow', 'company', '[]', 0, ?, 'test')
    ON CONFLICT(id) DO NOTHING
  `).run(now);
  dialect.prepare(`
    INSERT INTO authorization_role_assignments (id, user_id, actor_type, role_id, company_id, status, created_at, created_by)
    VALUES ('asg_clerk_read', ?, 'user', 'r_clerk_read', ?, 'active', ?, 'test')
    ON CONFLICT(id) DO NOTHING
  `).run(clerkUserId, companyId, now);
}

function rawRequest(host, port, requestLine, headers = {}) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let response = '';
    socket.connect(port, host, () => {
      let headerLines = Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\r\n');
      if (headerLines) headerLines = '\r\n' + headerLines;
      socket.write(`${requestLine} HTTP/1.1\r\nHost: ${host}:${port}${headerLines}\r\n\r\n`);
    });
    socket.on('data', d => { response += d; });
    socket.on('end', () => {
      const lines = response.split('\r\n');
      const statusLine = lines[0];
      const statusMatch = statusLine.match(/HTTP\/1\.1 (\d{3})/);
      const status = statusMatch ? Number(statusMatch[1]) : 0;
      const bodyStart = response.indexOf('\r\n\r\n');
      const body = bodyStart >= 0 ? response.slice(bodyStart + 4) : '';
      resolve({ status, body });
    });
    socket.on('error', reject);
  });
}

function buildFullSyncPayload() {
  return {
    __actorId: 'evil_actor',
    actorId: 'other_user',
    companyId: 'evil',
    groups: ['system.admin'],
    omni: {
      users: [{
        id: 'u_adv_new',
        login: 'adv_new',
        displayName: 'Adv New',
        email: 'adv@example.com',
        passwordHash: 'deadbeefcafe1234deadbeefcafe1234',
        passwordSalt: 'salty_salty_42',
        isOwner: false,
        role: 'employee',
        roleId: 'employee',
        companyId: 'default',
        createdAt: '2026-07-21T00:00:00.000Z',
      }],
      roles: [
        { id: 'admin', name: 'Admin', permissions: ['platform:db:read'] },
      ],
      notifications: [
        { id: 'adv1', type: 'system', title: 'Adv1', message: 'adv', severity: 'informational', targetUserId: 'u_adv_new', createdAt: '2026-07-21T00:00:01.000Z' },
      ],
      adminSettings: { organization: { name: 'Adv Co', currency: 'IQD' } },
      systemLog: [{ id: 'adv_log', level: 'info', message: 'adv', createdAt: '2026-07-21T00:00:02.000Z' }],
      kanban: [{ id: 'adv_kan', title: 'Adv task', stage: 'todo' }],
    },
  };
}

async function testBodyOverrideIgnoredOnDb() {
  const { dialect, dbPath } = await setup('adv-db-override');
  const org = seedOrg(dialect); fixMembershipIds(dialect);
  dialect.close();
  const jsonPath = tmpJsonPath('adv-db-override');
  const port = await allocatePort();
  const base = `http://127.0.0.1:${port}`;
  const server = await startServer({ dbPath, jsonPath, port });
  try {
    const { cookies } = await login(base, 'owner', STRONG_PASSWORD, org.tenantA);
    const payload = buildFullSyncPayload();
    const { res } = await withCookie(base, cookies, 'POST', '/api/db', payload, { 'X-Octagon-Full-Sync': 'yes' });
    assert.strictEqual(res.status, 200, 'full sync failed');
    await new Promise(r => setTimeout(r, 100));
    const db = openSqlite(dbPath);
    try {
      const auditRows = db.prepare("SELECT actor_id, after_value FROM platform_audit_log WHERE resource = 'governance_cutover' AND action LIKE 'governance.sync.%'").all();
      assert.ok(auditRows.length > 0, 'governance audit rows missing');
      for (const row of auditRows) {
        assert.strictEqual(row.actor_id, org.userOwner, `audit actor ${row.actor_id} should be session owner ${org.userOwner}`);
      }
      const user = db.prepare("SELECT * FROM identity_users WHERE id = 'u_adv_new'").get();
      assert.ok(user, 'new user missing');
      assert.strictEqual(user.is_owner, 0, 'top-level role override must not make user owner');
    } finally {
      db.close();
    }
  } finally {
    await server.stop();
    for (const f of [jsonPath, jsonPath + '.prev']) { try { fs.unlinkSync(f); } catch {} }
    await cleanup(openMigrationDatabase(dbPath), dbPath).catch(() => {});
  }
}

async function testBodyOverrideIgnoredOnApiV1() {
  const { dialect, dbPath } = await setup('adv-api-override');
  const org = seedOrg(dialect); fixMembershipIds(dialect);
  dialect.close();
  const jsonPath = tmpJsonPath('adv-api-override');
  const port = await allocatePort();
  const base = `http://127.0.0.1:${port}`;
  const server = await startServer({ dbPath, jsonPath, port });
  try {
    const { cookies } = await login(base, 'owner', STRONG_PASSWORD, org.tenantA);
    const body = {
      actorId: 'other_user',
      userId: 'other_user',
      companyId: 'c_beta_1',
      tenantId: 't_beta',
      groups: ['system.admin'],
      message: 'cross-tenant attempt',
    };
    const { res, payload } = await withCookie(base, cookies, 'POST', '/api/v1/x/legacy_system_log', body);
    assert.strictEqual(res.status, 201, `api v1 create failed: ${res.status}`);
    const id = payload.data?.id;
    assert.ok(id, 'created record missing id');
    await new Promise(r => setTimeout(r, 100));
    const db = openSqlite(dbPath);
    try {
      const row = db.prepare("SELECT company_id, data FROM x_records WHERE entity = 'legacy_system_log' AND id = ?").get(id);
      assert.ok(row, 'created x_records row missing');
      // The actual scoping column must come from the session context, not the body.
      assert.strictEqual(row.company_id, org.companyA1, `company_id ${row.company_id} should be session company ${org.companyA1}`);
    } finally {
      db.close();
    }
  } finally {
    await server.stop();
    for (const f of [jsonPath, jsonPath + '.prev']) { try { fs.unlinkSync(f); } catch {} }
    await cleanup(openMigrationDatabase(dbPath), dbPath).catch(() => {});
  }
}

async function testUnauthenticatedRoutesBlocked() {
  const { dialect, dbPath } = await setup('adv-unauth');
  const org = seedOrg(dialect); fixMembershipIds(dialect);
  dialect.close();
  const jsonPath = tmpJsonPath('adv-unauth');
  const port = await allocatePort();
  const base = `http://127.0.0.1:${port}`;
  const server = await startServer({ dbPath, jsonPath, port });
  try {
    const garbageCookie = 'octagon_session=totally-invalid-token-12345;';
    const routes = [
      ['GET', '/api/db', null],
      ['POST', '/api/db', { employees: [] }],
      ['POST', '/api/collection', { collection: 'employees', data: [] }],
      ['POST', '/api/record', { collection: 'employees', id: 'x', data: {} }],
      ['POST', '/api/upload', { filename: 'x.txt', content: 'eHk=' }],
      ['GET', '/uploads/not-present.txt', null],
    ];
    for (const [method, route, body] of routes) {
      const noBody = method === 'GET' || method === 'HEAD' ? undefined : body;
      const noCookie = await withoutCookie(base, method, route, noBody);
      assert.ok(noCookie.res.status === 401 || noCookie.res.status === 403, `expected 401/403 for ${method} ${route} without cookie, got ${noCookie.res.status}`);
      const badCookie = await withCookie(base, garbageCookie, method, route, noBody);
      assert.ok(badCookie.res.status === 401 || badCookie.res.status === 403, `expected 401/403 for ${method} ${route} with garbage cookie, got ${badCookie.res.status}`);
    }
  } finally {
    await server.stop();
    for (const f of [jsonPath, jsonPath + '.prev']) { try { fs.unlinkSync(f); } catch {} }
    await cleanup(openMigrationDatabase(dbPath), dbPath).catch(() => {});
  }
}

async function testLocalhostBypassBlocked() {
  const { dialect, dbPath } = await setup('adv-localhost');
  const org = seedOrg(dialect); fixMembershipIds(dialect);
  dialect.close();
  const jsonPath = tmpJsonPath('adv-localhost');
  const port = await allocatePort();
  const base = `http://127.0.0.1:${port}`;
  const server = await startServer({ dbPath, jsonPath, port });
  try {
    const routes = [
      ['GET', '/api/db', null],
      ['POST', '/api/db', { employees: [] }],
      ['POST', '/api/collection', { collection: 'employees', data: [] }],
      ['POST', '/api/record', { collection: 'employees', id: 'x', data: {} }],
      ['POST', '/api/upload', { filename: 'x.txt', content: 'eHk=' }],
      ['GET', '/uploads/not-present.txt', null],
    ];
    for (const [method, route, body] of routes) {
      const res = await fetch(`${base}${route}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': '127.0.0.1',
          Host: 'localhost',
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      assert.ok(res.status === 401 || res.status === 403, `localhost bypass probe ${method} ${route} should be blocked, got ${res.status}`);
    }
  } finally {
    await server.stop();
    for (const f of [jsonPath, jsonPath + '.prev']) { try { fs.unlinkSync(f); } catch {} }
    await cleanup(openMigrationDatabase(dbPath), dbPath).catch(() => {});
  }
}

async function testWhatsAppFailClosed() {
  const { dialect, dbPath } = await setup('adv-whatsapp');
  const org = seedOrg(dialect); fixMembershipIds(dialect);
  dialect.close();
  const jsonPath = tmpJsonPath('adv-whatsapp');
  const port = await allocatePort();
  const base = `http://127.0.0.1:${port}`;
  // Explicitly clear WhatsApp secrets so fail-closed path is exercised.
  const server = await startServer({ dbPath, jsonPath, port, envExtra: { WHATSAPP_APP_SECRET: '', WHATSAPP_VERIFY_TOKEN: '' } });
  try {
    const payload = { object: 'whatsapp_business_account', entry: [{ id: 'ev1', changes: [{ value: { messages: [{ id: 'msg1', from: '123', text: { body: 'hello' } }] } }] }] };
    const postRes = await fetch(`${base}/api/whatsapp/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.strictEqual(postRes.status, 503, `unsigned WhatsApp POST should be 503, got ${postRes.status}`);

    const getRes = await fetch(`${base}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=abc&hub.challenge=xyz`);
    assert.strictEqual(getRes.status, 503, `WhatsApp GET verify without token should be 503, got ${getRes.status}`);

    await new Promise(r => setTimeout(r, 100));
    const db = openSqlite(dbPath);
    try {
      assert.strictEqual(countRows(db, "SELECT COUNT(*) AS n FROM collections WHERE collection = 'omni.whatsappSuggestions'"), 0, 'WhatsApp payload should not reach collections');
      assert.strictEqual(countRows(db, "SELECT COUNT(*) AS n FROM collections WHERE collection = 'omni.whatsappIngestHistory'"), 0, 'WhatsApp payload should not reach collections');
      assert.strictEqual(countRows(db, "SELECT COUNT(*) AS n FROM metadata WHERE key = 'omni.whatsappSuggestions'"), 0, 'WhatsApp payload should not reach metadata');
      assert.strictEqual(countRows(db, "SELECT COUNT(*) AS n FROM metadata WHERE key = 'omni.whatsappIngestHistory'"), 0, 'WhatsApp payload should not reach metadata');
    } finally {
      db.close();
    }
  } finally {
    await server.stop();
    for (const f of [jsonPath, jsonPath + '.prev']) { try { fs.unlinkSync(f); } catch {} }
    await cleanup(openMigrationDatabase(dbPath), dbPath).catch(() => {});
  }
}

async function testStaticPathTraversalBlocked() {
  const { dialect, dbPath } = await setup('adv-traversal');
  const org = seedOrg(dialect); fixMembershipIds(dialect);
  dialect.close();
  const jsonPath = tmpJsonPath('adv-traversal');
  const port = await allocatePort();
  const base = `http://127.0.0.1:${port}`;
  const server = await startServer({ dbPath, jsonPath, port });
  try {
    const { cookies } = await login(base, 'owner', STRONG_PASSWORD, org.tenantA);
    const paths = [
      'GET /../server.js',
      'GET /%2e%2e%2fserver.js',
      'GET /uploads/../../server.js',
    ];
    for (const p of paths) {
      const { status, body } = await rawRequest('127.0.0.1', port, p, { Cookie: cookies });
      assert.ok(status === 400 || status === 403 || status === 404, `traversal ${p} should be blocked, got ${status}`);
      assert.ok(!body.includes('require(') && !body.includes('createServer'), `traversal ${p} returned server.js contents`);
    }
  } finally {
    await server.stop();
    for (const f of [jsonPath, jsonPath + '.prev']) { try { fs.unlinkSync(f); } catch {} }
    await cleanup(openMigrationDatabase(dbPath), dbPath).catch(() => {});
  }
}

async function testFailClosedWriteGuard() {
  const { dialect, dbPath } = await setup('adv-write-guard');
  const org = seedOrg(dialect); fixMembershipIds(dialect);
  dialect.close();
  const jsonPath = tmpJsonPath('adv-write-guard');
  const port = await allocatePort();
  const base = `http://127.0.0.1:${port}`;
  const server = await startServer({ dbPath, jsonPath, port });
  try {
    const { cookies } = await login(base, 'owner', STRONG_PASSWORD, org.tenantA);
    const res = await fetch(`${base}/api/db`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookies },
      body: JSON.stringify({ employees: [] }),
    });
    assert.strictEqual(res.status, 409, `POST /api/db without X-Octagon-Full-Sync should be 409, got ${res.status}`);
  } finally {
    await server.stop();
    for (const f of [jsonPath, jsonPath + '.prev']) { try { fs.unlinkSync(f); } catch {} }
    await cleanup(openMigrationDatabase(dbPath), dbPath).catch(() => {});
  }
}

async function testRevokedSessionRejected() {
  const { dialect, dbPath } = await setup('adv-revoke');
  const org = seedOrg(dialect); fixMembershipIds(dialect);
  dialect.close();
  const jsonPath = tmpJsonPath('adv-revoke');
  const port = await allocatePort();
  const base = `http://127.0.0.1:${port}`;
  const server = await startServer({ dbPath, jsonPath, port });
  try {
    const { cookies } = await login(base, 'owner', STRONG_PASSWORD, org.tenantA);
    const logout = await withCookie(base, cookies, 'POST', '/api/auth/logout');
    assert.strictEqual(logout.res.status, 200, 'logout failed');
    const after = await withCookie(base, cookies, 'GET', '/api/db');
    assert.strictEqual(after.res.status, 401, 'reused cookie after logout should be 401');
  } finally {
    await server.stop();
    for (const f of [jsonPath, jsonPath + '.prev']) { try { fs.unlinkSync(f); } catch {} }
    await cleanup(openMigrationDatabase(dbPath), dbPath).catch(() => {});
  }
}

async function testClerkDeniedPrivilegedActions() {
  const { dialect, dbPath } = await setup('adv-clerk');
  const org = seedOrg(dialect); fixMembershipIds(dialect);
  grantClerkHomePage(dialect, org.userClerk, org.companyA1);
  dialect.close();
  const jsonPath = tmpJsonPath('adv-clerk');
  const port = await allocatePort();
  const base = `http://127.0.0.1:${port}`;
  const server = await startServer({ dbPath, jsonPath, port });
  try {
    const { cookies, payload: loginPayload } = await login(base, 'clerk', STRONG_PASSWORD, org.tenantA);
    assert.strictEqual(loginPayload.authenticated, true, 'clerk login failed');
    const db = await withCookie(base, cookies, 'POST', '/api/db', { employees: [] }, { 'X-Octagon-Full-Sync': 'yes' });
    assert.strictEqual(db.res.status, 403, `clerk POST /api/db should be 403, got ${db.res.status}`);
    const backup = await withCookie(base, cookies, 'POST', '/api/backup', { tag: 'manual' });
    assert.strictEqual(backup.res.status, 403, `clerk POST /api/backup should be 403, got ${backup.res.status}`);
    const bootstrap = await withCookie(base, cookies, 'GET', '/api/auth/bootstrap');
    assert.strictEqual(bootstrap.res.status, 200, 'clerk bootstrap should work');
    assert.ok(Array.isArray(bootstrap.payload.navigation?.pages), 'bootstrap pages missing');
    const pageIds = bootstrap.payload.navigation.pages.map(p => p.id);
    assert.ok(pageIds.includes('home'), 'clerk should see home page');
    const hiddenPages = ['security', 'backup', 'settings'];
    for (const hidden of hiddenPages) {
      assert.ok(!pageIds.includes(hidden), `clerk should not see hidden page ${hidden}`);
    }
    assert.ok(bootstrap.payload.navigation.hiddenPageCount > 0, 'clerk should have hidden pages');
  } finally {
    await server.stop();
    for (const f of [jsonPath, jsonPath + '.prev']) { try { fs.unlinkSync(f); } catch {} }
    await cleanup(openMigrationDatabase(dbPath), dbPath).catch(() => {});
  }
}

async function testCrossTenantShape() {
  const { dialect, dbPath } = await setup('adv-tenant');
  const org = seedOrg(dialect); fixMembershipIds(dialect);
  // Insert a cross-tenant x_records row directly.
  const now = new Date().toISOString();
  dialect.prepare(`
    INSERT INTO x_records (entity, id, company_id, data, created_at, updated_at, created_by, removed, version)
    VALUES ('legacy_system_log', 'beta_log', ?, ?, ?, ?, 'test', 0, 1)
  `).run(org.companyB1, JSON.stringify({ message: 'beta tenant log', level: 'info' }), now, now);
  dialect.close();
  const jsonPath = tmpJsonPath('adv-tenant');
  const port = await allocatePort();
  const base = `http://127.0.0.1:${port}`;
  const server = await startServer({ dbPath, jsonPath, port });
  try {
    const { cookies } = await login(base, 'owner', STRONG_PASSWORD, org.tenantA);
    const { res, payload } = await withCookie(base, cookies, 'GET', '/api/v1/x/legacy_system_log');
    assert.strictEqual(res.status, 200, 'list failed');
    assert.ok(Array.isArray(payload.data), 'list data missing');
    assert.ok(!payload.data.some(item => item.id === 'beta_log'), 'owner should not see beta tenant row');
  } finally {
    await server.stop();
    for (const f of [jsonPath, jsonPath + '.prev']) { try { fs.unlinkSync(f); } catch {} }
    await cleanup(openMigrationDatabase(dbPath), dbPath).catch(() => {});
  }
}

async function testSecretsHygiene() {
  const { dialect, dbPath } = await setup('adv-secrets');
  const org = seedOrg(dialect); fixMembershipIds(dialect);
  dialect.close();
  const jsonPath = tmpJsonPath('adv-secrets');
  const port = await allocatePort();
  const base = `http://127.0.0.1:${port}`;
  const server = await startServer({ dbPath, jsonPath, port });
  try {
    const ownerLogin = await login(base, 'owner', STRONG_PASSWORD, org.tenantA);
    const clerkLogin = await login(base, 'clerk', STRONG_PASSWORD, org.tenantA);
    const { res } = await withCookie(base, ownerLogin.cookies, 'POST', '/api/db', buildFullSyncPayload(), { 'X-Octagon-Full-Sync': 'yes' });
    assert.strictEqual(res.status, 200, 'full sync failed');

    const stdout = server.stdout();
    const secrets = [STRONG_PASSWORD, 'deadbeefcafe1234deadbeefcafe1234', 'salty_salty_42', 'passwordHash', 'passwordSalt'];
    for (const secret of secrets) {
      assert.ok(!stdout.includes(secret), `server stdout leaked secret: ${secret}`);
    }

    await new Promise(r => setTimeout(r, 100));
    const db = openSqlite(dbPath);
    try {
      const auditRows = db.prepare("SELECT after_value FROM platform_audit_log").all();
      const combined = JSON.stringify(auditRows);
      assert.ok(!combined.includes('passwordHash'), 'platform_audit_log after_value contains passwordHash');
      assert.ok(!combined.includes('deadbeefcafe1234deadbeefcafe1234'), 'platform_audit_log after_value contains imported hash');
      assert.ok(!combined.includes(STRONG_PASSWORD), 'platform_audit_log after_value contains plaintext password');
    } finally {
      db.close();
    }
  } finally {
    await server.stop();
    for (const f of [jsonPath, jsonPath + '.prev']) { try { fs.unlinkSync(f); } catch {} }
    await cleanup(openMigrationDatabase(dbPath), dbPath).catch(() => {});
  }
}

await run('Phase 02 / runtime adversarial', [
  ['body-supplied actor/company/role ignored on POST /api/db', testBodyOverrideIgnoredOnDb],
  ['body-supplied actor/company ignored on POST /api/v1/x/...', testBodyOverrideIgnoredOnApiV1],
  ['unauthenticated and garbage-cookie requests blocked', testUnauthenticatedRoutesBlocked],
  ['localhost bypass headers do not bypass session', testLocalhostBypassBlocked],
  ['WhatsApp webhook fails closed without secrets', testWhatsAppFailClosed],
  ['static path traversal blocked', testStaticPathTraversalBlocked],
  ['POST /api/db without X-Octagon-Full-Sync is 409', testFailClosedWriteGuard],
  ['revoked session is rejected', testRevokedSessionRejected],
  ['clerk is denied privileged direct APIs', testClerkDeniedPrivilegedActions],
  ['cross-tenant x_records row is not leaked', testCrossTenantShape],
  ['secrets do not leak in stdout or audit log', testSecretsHygiene],
]);
