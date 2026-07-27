import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';
import { seedTestIdentities } from '../../scripts/test-auth-fixture.mjs';
import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';

let tempDir;
let dbPath;
let db;

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-session-bridge-test-'));
  dbPath = path.join(tempDir, 'bridge-test.db');
  await freshInstall({ dbPath, backupDir: path.join(tempDir, 'backups'), actor: 'session-bridge-test' });
  db = openMigrationDatabase(dbPath);
  process.env.OCTAGON_TEST_FIXTURE = '1';
  seedTestIdentities(db, { dbPath });
});

after(() => {
  delete process.env.OCTAGON_TEST_FIXTURE;
  try { db?.close(); } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }
});

test('Canonical Session Bridge: unauthenticated status when no session token provided', async () => {
  const authority = createPlatformAuthority(db);
  const req = { headers: {} };
  let jsonResult = null;
  const res = {
    setHeader: () => {},
    writeHead: () => {},
    end: (str) => { jsonResult = JSON.parse(str); }
  };

  authority.handleSessionInfo(req, res);
  assert.equal(jsonResult.authenticated, false);
  assert.equal(jsonResult.user, null);
});

test('Canonical Session Bridge: full lifecycle (login, resolve session, logout, revoke)', async () => {
  const authority = createPlatformAuthority(db);

  // 1. Authenticate sysadmin
  const sysadminUser = db.prepare("SELECT * FROM identity_users WHERE login = 'test.sysadmin'").get();
  assert.ok(sysadminUser);

  const session = authority.sessions.createSession(sysadminUser.id, { activeCompanyId: 'c_octagon_test' });
  assert.ok(session.token);

  // 2. Resolve session from request with cookie
  const reqWithCookie = {
    headers: { cookie: `octagon_session=${session.token}` }
  };
  let sessionInfo = null;
  const res = {
    setHeader: () => {},
    writeHead: () => {},
    end: (str) => { sessionInfo = JSON.parse(str); }
  };

  authority.handleSessionInfo(reqWithCookie, res);
  assert.equal(sessionInfo.authenticated, true);
  assert.equal(sessionInfo.user.id, sysadminUser.id);
  assert.equal(sessionInfo.user.login, 'test.sysadmin');

  // 3. Logout / revoke session
  authority.sessions.revoke(session.sessionId, 'test_logout');

  let postLogoutInfo = null;
  const res2 = {
    setHeader: () => {},
    writeHead: () => {},
    end: (str) => { postLogoutInfo = JSON.parse(str); }
  };
  authority.handleSessionInfo(reqWithCookie, res2);
  assert.equal(postLogoutInfo.authenticated, false);
  assert.equal(postLogoutInfo.user, null);
});

test('Canonical Session Bridge: viewer role gets read access but 403 on write action', async () => {
  const authority = createPlatformAuthority(db);
  const viewerUser = db.prepare("SELECT * FROM identity_users WHERE login = 'test.viewer'").get();
  assert.ok(viewerUser);

  const session = authority.sessions.createSession(viewerUser.id, { activeCompanyId: 'c_octagon_test' });
  const req = {
    headers: { cookie: `octagon_session=${session.token}` }
  };

  const ctx = authority.resolveContext(req, { touch: false });
  assert.ok(ctx);
  assert.equal(ctx.actorId, viewerUser.id);

  const decision = authority.evaluator.evaluate({
    permission: 'commercial:party:write',
    ctx
  });
  assert.equal(decision.allowed, false, 'Viewer role must be denied write permission');
});

test('Literal Action ID Contract: all registered action IDs use literal unencoded colons', async () => {
  const authority = createPlatformAuthority(db);
  const actions = db.prepare("SELECT id FROM platform_actions").all();
  assert.ok(actions.length > 0, 'Platform actions must be populated in database');

  for (const act of actions) {
    assert.ok(!act.id.includes('%3A'), `Action ID ${act.id} must not be URL-encoded with %3A`);
    assert.ok(!act.id.includes('%20'), `Action ID ${act.id} must not contain encoded spaces`);
  }

  const requiredActionIds = ['party:create', 'uom:create', 'product:template:create', 'warehouse:create', 'stock:move:post'];
  for (const reqId of requiredActionIds) {
    const found = actions.some(a => a.id === reqId);
    assert.ok(found, `Action ${reqId} must be registered literally`);
  }
});
