// Phase 02 runtime governance strangler tests.
//
// Spawns the real server.js on a disposable database and exercises the full
// sync / projection / reconciliation path between the legacy state blob and the
// canonical platform tables.

import assert from 'node:assert';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { setup, cleanup, run, seedOrg, STRONG_PASSWORD } from './harness.mjs';
import { openMigrationDatabase, runMigrations } from '../../database/migration-runner/index.mjs';
import { reconcileGovernance, GOVERNED_PATHS } from '../../platform/server/governance-collections.mjs';
import { migration as migration013 } from '../../database/migrations/013_governance_collection_cutover.mjs';

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

function fixMembershipIds(dialect) {
  // seedOrg creates UUID membership ids, but syncIdentityUsers generates
  // deterministic ids (mem_<user_id>_<company_id>). When the server writes,
  // the strangler re-syncs projected users and the generated ids collide with
  // the existing UUID rows. This helper aligns the ids so the runtime sync is
  // idempotent. Foreign keys are briefly disabled to allow the id rewrite.
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

function scanForSecrets(obj, secrets) {
  const found = [];
  const seen = new WeakSet();
  const walk = (value) => {
    if (value === null || value === undefined) return;
    if (typeof value === 'string') {
      for (const s of secrets) {
        if (value.includes(s)) found.push(s);
      }
      return;
    }
    if (typeof value === 'object') {
      if (seen.has(value)) return;
      seen.add(value);
      for (const v of Object.values(value)) walk(v);
    }
  };
  walk(obj);
  return found;
}

function buildFullSyncPayload() {
  return {
    __actorId: 'evil_actor',
    actorId: 'other_user',
    companyId: 'evil',
    groups: ['system.admin'],
    omni: {
      users: [{
        id: 'u_strangler_new',
        login: 'strangler_new',
        displayName: 'Strangler New',
        email: 'new@example.com',
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
        { id: 'clerk', name: 'Clerk', permissions: ['platform:db:read'] },
      ],
      permissions: {
        admin: ['platform:db:write'],
        clerk: ['platform:db:read'],
      },
      userRoles: [{ userId: 'u_strangler_new', roleId: 'clerk' }],
      notifications: [
        { id: 'n1', type: 'system', title: 'N1', message: 'first notification', severity: 'informational', targetUserId: 'u_strangler_new', createdAt: '2026-07-21T00:00:01.000Z' },
        { id: 'n2', type: 'system', title: 'N2', message: 'second notification', severity: 'critical', targetUserId: 'u_strangler_new', createdAt: '2026-07-21T00:00:02.000Z' },
      ],
      requests: [
        { id: 'req_1', type: 'leave', title: 'Leave request', status: 'pending', requesterId: 'u_strangler_new', approverRole: 'admin', amount: 100, createdAt: '2026-07-21T00:00:03.000Z' },
      ],
      adminSettings: { organization: { name: 'Test Co', currency: 'IQD' }, theme: 'dark' },
      workflow: { nodes: [{ id: 'start', type: 'manual' }], edges: [] },
      systemLog: [
        { id: 'log_1', level: 'info', message: 'System started', createdAt: '2026-07-21T00:00:04.000Z' },
      ],
      automationRules: [
        { id: 'rule_1', name: 'Auto-rule', trigger: 'schedule', action: 'notify', createdAt: '2026-07-21T00:00:05.000Z' },
      ],
      kanban: [
        { id: 'kan_1', title: 'Task A', stage: 'todo' },
      ],
    },
  };
}

function buildSecondSyncPayload() {
  const base = buildFullSyncPayload();
  base.omni.notifications = [
    { id: 'n2', type: 'system', title: 'N2 updated', message: 'second notification updated', severity: 'critical', targetUserId: 'u_strangler_new', createdAt: '2026-07-21T00:00:02.000Z' },
  ];
  return base;
}

async function testFullSyncAndCanonicalReads() {
  const { dialect, dbPath } = await setup('strangler-sync');
  const org = seedOrg(dialect); fixMembershipIds(dialect);
  dialect.close();
  const jsonPath = tmpJsonPath('strangler-sync');
  const port = 18380 + Math.floor(Math.random() * 1000);
  const base = `http://127.0.0.1:${port}`;
  const server = await startServer({ dbPath, jsonPath, port });
  try {
    const { cookies } = await login(base, 'owner', STRONG_PASSWORD, org.tenantA);
    const payload = buildFullSyncPayload();
    const { res: syncRes } = await withCookie(base, cookies, 'POST', '/api/db', payload, { 'X-Octagon-Full-Sync': 'yes' });
    assert.strictEqual(syncRes.status, 200, `full sync failed: ${syncRes.status}`);

    // Small sleep so any WAL readers are settled (mostly defensive; server already committed).
    await new Promise(r => setTimeout(r, 100));
    const db = openSqlite(dbPath);
    try {
      // a. canonical rows present
      const user = db.prepare("SELECT * FROM identity_users WHERE id = 'u_strangler_new'").get();
      assert.ok(user, 'new user missing from identity_users');
      assert.strictEqual(user.is_owner, 0, 'new user should not be owner');
      const cred = db.prepare("SELECT * FROM identity_credentials WHERE user_id = 'u_strangler_new'").get();
      assert.ok(cred, 'credential missing');
      assert.strictEqual(cred.algorithm, 'legacy_sha256', 'credential should be legacy_sha256');
      assert.strictEqual(cred.hash, payload.omni.users[0].passwordHash, 'hash should match imported hash');
      assert.ok(db.prepare("SELECT 1 FROM authorization_roles WHERE id LIKE 'role_omni_%' LIMIT 1").get(), 'mirrored role row missing');
      assert.ok(db.prepare("SELECT 1 FROM notifications WHERE id LIKE 'omni_ntf_%' LIMIT 1").get(), 'notification row missing');
      assert.ok(db.prepare("SELECT 1 FROM approval_requests WHERE id LIKE 'omni_req_%' LIMIT 1").get(), 'approval request row missing');
      const settingsRow = db.prepare("SELECT * FROM settings_values WHERE key = 'octagon.legacy.admin_settings'").get();
      assert.ok(settingsRow, 'admin settings settings_values row missing');
      const sysLog = countRows(db, "SELECT COUNT(*) AS n FROM x_records WHERE entity = 'legacy_system_log'");
      const autoRules = countRows(db, "SELECT COUNT(*) AS n FROM x_records WHERE entity = 'legacy_automation_rules'");
      const workflow = countRows(db, "SELECT COUNT(*) AS n FROM x_records WHERE entity = 'legacy_workflow'");
      assert.ok(sysLog >= 1, 'legacy_system_log x_records missing');
      assert.ok(autoRules >= 1, 'legacy_automation_rules x_records missing');
      assert.ok(workflow >= 1, 'legacy_workflow x_records missing');

      // b. NO governed rows in legacy collections/metadata
      const placeholders = GOVERNED_PATHS.map(() => '?').join(',');
      const colCount = countRows(db, `SELECT COUNT(*) AS n FROM collections WHERE collection IN (${placeholders})`, ...GOVERNED_PATHS);
      const metaCount = countRows(db, `SELECT COUNT(*) AS n FROM metadata WHERE key IN (${placeholders})`, ...GOVERNED_PATHS);
      assert.strictEqual(colCount, 0, `governed collections should be empty, found ${colCount}`);
      assert.strictEqual(metaCount, 0, `governed metadata should be empty, found ${metaCount}`);

      // c. operational omni.kanban still in legacy collections
      const kanbanCount = countRows(db, "SELECT COUNT(*) AS n FROM collections WHERE collection = 'omni.kanban'");
      assert.strictEqual(kanbanCount, 1, 'omni.kanban operational data should remain in legacy collections');

      // e. actor override ignored: audit log actor is the session owner, not body claims
      const auditRows = db.prepare("SELECT actor_id, action FROM platform_audit_log WHERE resource = 'governance_cutover' AND action LIKE 'governance.sync.%'").all();
      assert.ok(auditRows.length > 0, 'governance audit rows missing');
      for (const row of auditRows) {
        assert.strictEqual(row.actor_id, org.userOwner, `audit actor ${row.actor_id} should be session owner ${org.userOwner}`);
      }
    } finally {
      db.close();
    }

    // d. GET /api/db projects governed collections back without password secrets
    const { res: readRes, payload: projected } = await withCookie(base, cookies, 'GET', '/api/db');
    assert.strictEqual(readRes.status, 200, 'owner should read db');
    const leakedSecrets = scanForSecrets(projected, ['passwordHash', 'passwordSalt', 'deadbeefcafe1234deadbeefcafe1234', 'salty_salty_42']);
    assert.strictEqual(leakedSecrets.length, 0, `projected DB leaked secrets: ${leakedSecrets.join(', ')}`);
    assert.ok(Array.isArray(projected.omni?.users), 'projected omni.users missing');
    const projectedUser = projected.omni.users.find(u => u.id === 'u_strangler_new');
    assert.ok(projectedUser, 'projected new user missing');
    assert.strictEqual(projectedUser.isOwner, false, 'projected user should not be owner');
    assert.deepStrictEqual(projected.omni.notifications, payload.omni.notifications, 'notifications should round-trip');
    assert.deepStrictEqual(projected.omni.requests, payload.omni.requests, 'requests should round-trip');
    assert.deepStrictEqual(projected.omni.adminSettings, payload.omni.adminSettings, 'admin settings should round-trip');
    assert.deepStrictEqual(projected.omni.workflow, payload.omni.workflow, 'workflow should round-trip');
  } finally {
    await server.stop();
    for (const f of [jsonPath, jsonPath + '.prev']) { try { fs.unlinkSync(f); } catch {} }
    await cleanup(openMigrationDatabase(dbPath), dbPath).catch(() => {});
  }
}

async function testCollectionAndRecordStrangle() {
  const { dialect, dbPath } = await setup('strangler-coll');
  const org = seedOrg(dialect); fixMembershipIds(dialect);
  dialect.close();
  const jsonPath = tmpJsonPath('strangler-coll');
  const port = 18480 + Math.floor(Math.random() * 1000);
  const base = `http://127.0.0.1:${port}`;
  const server = await startServer({ dbPath, jsonPath, port });
  try {
    const { cookies } = await login(base, 'owner', STRONG_PASSWORD, org.tenantA);
    // f. POST /api/collection targeting omni.notifications lands in notifications table
    const { res: collRes } = await withCookie(base, cookies, 'POST', '/api/collection', {
      collection: 'omni.notifications',
      data: [{ id: 'coll_ntf', type: 'alert', title: 'Coll alert', message: 'via collection', severity: 'informational', targetUserId: 'u_owner', createdAt: '2026-07-21T00:00:10.000Z' }],
    });
    assert.strictEqual(collRes.status, 200, `collection write failed: ${collRes.status}`);
    await new Promise(r => setTimeout(r, 100));
    const db1 = openSqlite(dbPath);
    try {
      const ntfCount = countRows(db1, "SELECT COUNT(*) AS n FROM notifications WHERE id LIKE 'omni_ntf_%'");
      assert.ok(ntfCount >= 1, 'notification from /api/collection missing in canonical table');
      const legacyCount = countRows(db1, "SELECT COUNT(*) AS n FROM collections WHERE collection = 'omni.notifications'");
      assert.strictEqual(legacyCount, 0, 'omni.notifications should not be in legacy collections after collection write');
    } finally {
      db1.close();
    }

    // f. POST /api/record targeting omni.notifications lands in notifications table
    const { res: recRes } = await withCookie(base, cookies, 'POST', '/api/record', {
      collection: 'omni.notifications',
      id: 'rec_ntf',
      data: { type: 'alert', title: 'Rec alert', message: 'via record', severity: 'critical', targetUserId: 'u_owner', createdAt: '2026-07-21T00:00:11.000Z' },
    });
    assert.strictEqual(recRes.status, 200, `record write failed: ${recRes.status}`);
    await new Promise(r => setTimeout(r, 100));
    const db2 = openSqlite(dbPath);
    try {
      const recNtf = db2.prepare("SELECT payload FROM notifications WHERE id = 'omni_ntf_rec_ntf'").get();
      assert.ok(recNtf, 'record notification missing from canonical notifications');
      assert.ok(recNtf.payload.includes('Rec alert'), 'record notification payload incorrect');
    } finally {
      db2.close();
    }
  } finally {
    await server.stop();
    for (const f of [jsonPath, jsonPath + '.prev']) { try { fs.unlinkSync(f); } catch {} }
    await cleanup(openMigrationDatabase(dbPath), dbPath).catch(() => {});
  }
}

async function testSyncDeletion() {
  const { dialect, dbPath } = await setup('strangler-delete');
  const org = seedOrg(dialect); fixMembershipIds(dialect);
  dialect.close();
  const jsonPath = tmpJsonPath('strangler-delete');
  const port = 18580 + Math.floor(Math.random() * 1000);
  const base = `http://127.0.0.1:${port}`;
  const server = await startServer({ dbPath, jsonPath, port });
  try {
    const { cookies } = await login(base, 'owner', STRONG_PASSWORD, org.tenantA);
    const first = buildFullSyncPayload();
    const { res: r1 } = await withCookie(base, cookies, 'POST', '/api/db', first, { 'X-Octagon-Full-Sync': 'yes' });
    assert.strictEqual(r1.status, 200, 'first sync failed');

    await new Promise(r => setTimeout(r, 100));
    const db1 = openSqlite(dbPath);
    try {
      assert.strictEqual(countRows(db1, "SELECT COUNT(*) AS n FROM notifications WHERE id = 'omni_ntf_n1'"), 1, 'n1 should exist after first sync');
      assert.strictEqual(countRows(db1, "SELECT COUNT(*) AS n FROM notifications WHERE id = 'omni_ntf_n2'"), 1, 'n2 should exist after first sync');
    } finally {
      db1.close();
    }

    const second = buildSecondSyncPayload();
    const { res: r2 } = await withCookie(base, cookies, 'POST', '/api/db', second, { 'X-Octagon-Full-Sync': 'yes' });
    assert.strictEqual(r2.status, 200, 'second sync failed');

    await new Promise(r => setTimeout(r, 100));
    const db2 = openSqlite(dbPath);
    try {
      assert.strictEqual(countRows(db2, "SELECT COUNT(*) AS n FROM notifications WHERE id = 'omni_ntf_n1'"), 0, 'n1 should be deleted after second sync');
      assert.strictEqual(countRows(db2, "SELECT COUNT(*) AS n FROM notifications WHERE id = 'omni_ntf_n2'"), 1, 'n2 should remain after second sync');
    } finally {
      db2.close();
    }
  } finally {
    await server.stop();
    for (const f of [jsonPath, jsonPath + '.prev']) { try { fs.unlinkSync(f); } catch {} }
    await cleanup(openMigrationDatabase(dbPath), dbPath).catch(() => {});
  }
}

async function testReconciliation() {
  const { dialect, dbPath } = await setup('strangler-recon');
  const org = seedOrg(dialect); fixMembershipIds(dialect);
  dialect.close();
  const jsonPath = tmpJsonPath('strangler-recon');
  const port = 18680 + Math.floor(Math.random() * 1000);
  const base = `http://127.0.0.1:${port}`;
  const server = await startServer({ dbPath, jsonPath, port });
  try {
    const { cookies } = await login(base, 'owner', STRONG_PASSWORD, org.tenantA);
    const { res } = await withCookie(base, cookies, 'POST', '/api/db', buildFullSyncPayload(), { 'X-Octagon-Full-Sync': 'yes' });
    assert.strictEqual(res.status, 200, 'sync failed');
    await new Promise(r => setTimeout(r, 100));
    const db = openSqlite(dbPath);
    try {
      const recon = reconcileGovernance(db);
      assert.strictEqual(recon.legacy_blob_governed_rows, 0, `reconciliation: legacy blob governed rows should be 0, got ${recon.legacy_blob_governed_rows}`);
      assert.ok(recon.notifications >= 2, `reconciliation: notifications should be >=2, got ${recon.notifications}`);
      assert.ok(recon.approvals >= 1, `reconciliation: approvals should be >=1, got ${recon.approvals}`);
    } finally {
      db.close();
    }
  } finally {
    await server.stop();
    for (const f of [jsonPath, jsonPath + '.prev']) { try { fs.unlinkSync(f); } catch {} }
    await cleanup(openMigrationDatabase(dbPath), dbPath).catch(() => {});
  }
}

async function testMigration013FreshUpgradeRollback() {
  const dbPath = path.join(os.tmpdir(), `octagon-p02-mig-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.db`);
  const placeholders = GOVERNED_PATHS.map(() => '?').join(',');

  // Prepare a legacy database with governed rows before migrations run.
  const pre = openMigrationDatabase(dbPath);
  try {
    pre.exec(`
      CREATE TABLE IF NOT EXISTS collections (collection TEXT, id TEXT, data TEXT, PRIMARY KEY (collection, id));
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT);
    `);
    const payload = buildFullSyncPayload();
    const insCol = pre.prepare('INSERT INTO collections (collection, id, data) VALUES (?, ?, ?)');
    const insMeta = pre.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)');
    for (const u of payload.omni.users) {
      insCol.run('omni.users', u.id, JSON.stringify(u));
    }
    for (const r of payload.omni.roles) {
      insCol.run('omni.roles', r.id, JSON.stringify(r));
    }
    insMeta.run('omni.permissions', JSON.stringify(payload.omni.permissions));
    for (const ur of payload.omni.userRoles) {
      insCol.run('omni.userRoles', `${ur.userId}_${ur.roleId}`, JSON.stringify(ur));
    }
    for (const n of payload.omni.notifications) {
      insCol.run('omni.notifications', n.id, JSON.stringify(n));
    }
    for (const r of payload.omni.requests) {
      insCol.run('omni.requests', r.id, JSON.stringify(r));
    }
    insMeta.run('omni.adminSettings', JSON.stringify(payload.omni.adminSettings));
    insMeta.run('omni.workflow', JSON.stringify(payload.omni.workflow));
    for (const l of payload.omni.systemLog) {
      insCol.run('omni.systemLog', l.id, JSON.stringify(l));
    }
    for (const r of payload.omni.automationRules) {
      insCol.run('omni.automationRules', r.id, JSON.stringify(r));
    }
    for (const k of payload.omni.kanban) {
      insCol.run('omni.kanban', k.id, JSON.stringify(k));
    }
  } finally {
    pre.close();
  }

  // Run migrations up: 013 imports and deletes governed rows.
  await runMigrations({ dbPath, direction: 'up' });
  const afterUp = openMigrationDatabase(dbPath);
  try {
    assert.ok(afterUp.prepare("SELECT 1 FROM identity_users WHERE id = 'u_strangler_new'").get(), 'migration 013 did not import user');
    assert.strictEqual(countRows(afterUp, `SELECT COUNT(*) AS n FROM collections WHERE collection IN (${placeholders})`, ...GOVERNED_PATHS), 0, 'governed collections not empty after 013 up');
    assert.strictEqual(countRows(afterUp, "SELECT COUNT(*) AS n FROM collections WHERE collection = 'omni.kanban'"), 1, 'omni.kanban should survive 013 up');
  } finally {
    afterUp.close();
  }

  // Downgrade 013 only: leave only 013 applied so runMigrations down runs just that one.
  const mid = openMigrationDatabase(dbPath);
  try {
    mid.prepare("DELETE FROM schema_migrations WHERE migration_id != '013_governance_collection_cutover'").run();
  } finally {
    mid.close();
  }
  await runMigrations({ dbPath, direction: 'down' });
  const afterDown = openMigrationDatabase(dbPath);
  try {
    assert.ok(countRows(afterDown, `SELECT COUNT(*) AS n FROM collections WHERE collection IN (${placeholders})`, ...GOVERNED_PATHS) > 0, '013 down should re-export governed rows to legacy collections');
    assert.ok(countRows(afterDown, "SELECT COUNT(*) AS n FROM collections WHERE collection = 'omni.users'") >= 1, '013 down should re-export omni.users');
  } finally {
    afterDown.close();
  }

  for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbPath + suffix); } catch {} }
}

async function testSetPasswordAndContext() {
  const { dialect, dbPath } = await setup('strangler-pw-ctx');
  const org = seedOrg(dialect); fixMembershipIds(dialect);
  dialect.close();
  const jsonPath = tmpJsonPath('strangler-pw-ctx');
  const port = 18780 + Math.floor(Math.random() * 1000);
  const base = `http://127.0.0.1:${port}`;
  const server = await startServer({ dbPath, jsonPath, port });
  try {
    // Login owner and clerk, capture clerk cookie.
    const ownerLogin = await login(base, 'owner', STRONG_PASSWORD, org.tenantA);
    assert.strictEqual(ownerLogin.res.status, 200, 'owner login failed');
    const clerkLogin = await login(base, 'clerk', STRONG_PASSWORD, org.tenantA);
    assert.strictEqual(clerkLogin.res.status, 200, 'clerk login failed');
    const clerkCookie = clerkLogin.cookies;

    // Owner resets clerk password.
    const newPassword = 'New#Pass9!x';
    const { res: resetRes, payload: resetPayload } = await withCookie(base, ownerLogin.cookies, 'POST', '/api/auth/set-password', { userId: org.userClerk, password: newPassword });
    assert.strictEqual(resetRes.status, 200, `owner reset failed: ${resetRes.status}`);
    assert.strictEqual(resetPayload.mustChange, true, 'owner reset should set mustChange true');

    // Clerk's old session is revoked.
    const { res: oldSessionRes, payload: sessionPayload } = await withCookie(base, clerkCookie, 'GET', '/api/auth/session');
    assert.strictEqual(oldSessionRes.status, 200, 'session endpoint should still respond');
    assert.strictEqual(sessionPayload.authenticated, false, 'old clerk session should be revoked');

    // Clerk can login with new password.
    const clerkReLogin = await login(base, 'clerk', newPassword, org.tenantA);
    assert.strictEqual(clerkReLogin.res.status, 200, 'clerk should login with new password');

    // Self-service change requires correct current password.
    const { res: wrongCurrentRes } = await withCookie(base, clerkReLogin.cookies, 'POST', '/api/auth/set-password', { userId: org.userClerk, password: 'Another#9Pass', currentPassword: 'wrong' });
    assert.strictEqual(wrongCurrentRes.status, 403, 'self-service set-password with wrong current password should be 403');

    // Context endpoint checks.
    const { res: bogusCtx } = await withCookie(base, clerkReLogin.cookies, 'POST', '/api/auth/context', { companyId: 'no-such-company' });
    assert.strictEqual(bogusCtx.status, 404, 'bogus company should return 404');
    const { res: noMemberCtx } = await withCookie(base, clerkReLogin.cookies, 'POST', '/api/auth/context', { companyId: 'default' });
    assert.strictEqual(noMemberCtx.status, 403, 'company without membership should return 403 for clerk');
    const { res: ownerCtx } = await withCookie(base, ownerLogin.cookies, 'POST', '/api/auth/context', { companyId: 'default' });
    assert.strictEqual(ownerCtx.status, 200, 'owner switching to default should return 200');
  } finally {
    await server.stop();
    for (const f of [jsonPath, jsonPath + '.prev']) { try { fs.unlinkSync(f); } catch {} }
    await cleanup(openMigrationDatabase(dbPath), dbPath).catch(() => {});
  }
}

await run('Phase 02 / runtime strangler', [
  ['full sync lands in canonical tables and strips legacy blob', testFullSyncAndCanonicalReads],
  ['/api/collection and /api/record targeting governed paths are strangled', testCollectionAndRecordStrangle],
  ['sync deletion removes stale governed rows', testSyncDeletion],
  ['reconciliation shows zero legacy blob governed rows', testReconciliation],
  ['migration 013 fresh upgrade + rollback round-trip', testMigration013FreshUpgradeRollback],
  ['set-password and context endpoints behave', testSetPasswordAndContext],
]);
