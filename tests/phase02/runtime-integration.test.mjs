// Phase 02 runtime authority integration tests.
//
// Starts the real server.js on a disposable port and SQLite database, seeds an
// owner and a clerk through the test harness, then exercises the HTTP routes that
// now resolve through the platform authority.

import assert from 'node:assert';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setup, cleanup, run, seedOrg, STRONG_PASSWORD } from './harness.mjs';
import { openMigrationDatabase } from '../../database/migration-runner/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

function tmpJsonPath(suite) {
  return path.join(os.tmpdir(), `octagon-p02-${suite}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.json`);
}

function startServer({ dbPath, jsonPath, port }) {
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
          resolve({ proc, port, stop: () => new Promise(r => { proc.on('close', r); proc.kill(); }) });
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

async function withCookie(base, cookies, method, path, body) {
  const opts = { method, credentials: 'include', headers: { Cookie: cookies } };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${base}${path}`, opts);
  const payload = await res.json().catch(() => ({}));
  return { res, payload };
}

async function testServerStartsAndLoginWorks() {
  const { dialect, dbPath } = await setup('runtime-integration');
  const org = seedOrg(dialect);
  dialect.close();
  const jsonPath = tmpJsonPath('runtime-integration');
  const port = 18080 + Math.floor(Math.random() * 1000);
  const base = `http://127.0.0.1:${port}`;
  const server = await startServer({ dbPath, jsonPath, port });
  try {
    const { res, payload, cookies } = await login(base, 'owner', STRONG_PASSWORD, org.tenantA);
    assert.strictEqual(res.status, 200, `login failed: ${payload.error || res.status}`);
    assert.strictEqual(payload.authenticated, true);
    assert.ok(payload.user);
    assert.ok(cookies.includes('octagon_session='), 'session cookie was not set');

    const session = await withCookie(base, cookies, 'GET', '/api/auth/session');
    assert.strictEqual(session.res.status, 200);
    assert.strictEqual(session.payload.authenticated, true);
    assert.strictEqual(session.payload.user?.login, 'owner');

    const bootstrap = await withCookie(base, cookies, 'GET', '/api/auth/bootstrap');
    assert.strictEqual(bootstrap.res.status, 200);
    assert.strictEqual(bootstrap.payload.success, true);
    assert.ok(Array.isArray(bootstrap.payload.navigation?.pages));
    assert.ok(Array.isArray(bootstrap.payload.actions));
    assert.ok(bootstrap.payload.actor?.locale === 'ar' || bootstrap.payload.actor?.direction === 'rtl', 'RTL identity preserved');
  } finally {
    await server.stop();
    for (const f of [jsonPath, jsonPath + '.prev']) { try { fs.unlinkSync(f); } catch {} }
    await cleanup(openMigrationDatabase(dbPath), dbPath).catch(() => {});
  }
}

async function testUnauthenticatedRoutesAreBlocked() {
  const { dialect, dbPath } = await setup('runtime-blocked');
  seedOrg(dialect);
  dialect.close();
  const jsonPath = tmpJsonPath('runtime-blocked');
  const port = 18180 + Math.floor(Math.random() * 1000);
  const base = `http://127.0.0.1:${port}`;
  const server = await startServer({ dbPath, jsonPath, port });
  try {
    const tts = await fetch(`${base}/api/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.ok(tts.status === 401 || tts.status === 403, `expected 401/403 for tts, got ${tts.status}`);

    const dbWrite = await fetch(`${base}/api/db`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.ok(dbWrite.status === 401 || dbWrite.status === 403, `expected 401/403 for db write, got ${dbWrite.status}`);

    const backup = await fetch(`${base}/api/backup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.ok(backup.status === 401 || backup.status === 403, `expected 401/403 for backup, got ${backup.status}`);

    const restore = await fetch(`${base}/api/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.ok(restore.status === 401 || restore.status === 403, `expected 401/403 for restore, got ${restore.status}`);

    // GET /api/db remains unauthenticated by design (it was already open).
    const dbRead = await fetch(`${base}/api/db`, { method: 'GET' });
    assert.strictEqual(dbRead.status, 200, 'GET /api/db should remain open');
  } finally {
    await server.stop();
    for (const f of [jsonPath, jsonPath + '.prev']) { try { fs.unlinkSync(f); } catch {} }
    await cleanup(openMigrationDatabase(dbPath), dbPath).catch(() => {});
  }
}

async function testClerkIsDeniedPrivilegedActions() {
  const { dialect, dbPath } = await setup('runtime-clerk');
  const org = seedOrg(dialect);
  dialect.close();
  const jsonPath = tmpJsonPath('runtime-clerk');
  const port = 18280 + Math.floor(Math.random() * 1000);
  const base = `http://127.0.0.1:${port}`;
  const server = await startServer({ dbPath, jsonPath, port });
  try {
    const { cookies } = await login(base, 'clerk', STRONG_PASSWORD, org.tenantA);
    const dbWrite = await withCookie(base, cookies, 'POST', '/api/db', { employees: [] });
    assert.strictEqual(dbWrite.res.status, 403, `clerk should not be allowed db write, got ${dbWrite.res.status}`);

    const backup = await withCookie(base, cookies, 'POST', '/api/backup', { tag: 'manual' });
    assert.strictEqual(backup.res.status, 403, `clerk should not be allowed backup, got ${backup.res.status}`);

    const restore = await withCookie(base, cookies, 'POST', '/api/restore', { file: 'x' });
    assert.strictEqual(restore.res.status, 403, `clerk should not be allowed restore, got ${restore.res.status}`);
  } finally {
    await server.stop();
    for (const f of [jsonPath, jsonPath + '.prev']) { try { fs.unlinkSync(f); } catch {} }
    await cleanup(openMigrationDatabase(dbPath), dbPath).catch(() => {});
  }
}

await run('Phase 02 / runtime integration', [
  ['server starts, login, session, bootstrap work', testServerStartsAndLoginWorks],
  ['unauthenticated privileged routes are blocked', testUnauthenticatedRoutesAreBlocked],
  ['clerk is denied privileged actions', testClerkIsDeniedPrivilegedActions],
]);
