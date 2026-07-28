// Phase 02 browser evidence — contract-level fallback.
//
// A full Puppeteer browser test is the preferred end-to-end evidence, but this
// contract-level suite runs in Node with no Chromium download. It verifies that:
//   - the server returns a complete governance bootstrap payload after login,
//   - the payload preserves Arabic/RTL identity and the expected page catalogue,
//   - app.js is wired to consume the bootstrap and apply platform visibility.
//
// When puppeteer is available, the same server fixture can be reused for a real
// browser login flow.

import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setup, cleanup, run, seedOrg, STRONG_PASSWORD } from './harness.mjs';
import { openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { DEFAULT_PAGE_CATALOGUE } from '../../platform/client/governance-bootstrap.mjs';
import { allocatePort } from '../helpers/allocate-port.mjs';

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
    let stderr = '';
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
      } catch {}
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

async function testBootstrapPayloadShapeAndRtlIdentity() {
  const { dialect, dbPath } = await setup('browser-evidence');
  const org = seedOrg(dialect);
  dialect.close();
  const jsonPath = tmpJsonPath('browser-evidence');
  const port = await allocatePort();
  const base = `http://127.0.0.1:${port}`;
  const server = await startServer({ dbPath, jsonPath, port });
  try {
    const { cookies } = await login(base, 'owner', STRONG_PASSWORD, org.tenantA);
    const res = await fetch(`${base}/api/auth/bootstrap`, {
      method: 'GET',
      credentials: 'include',
      headers: { Cookie: cookies },
    });
    assert.strictEqual(res.status, 200);
    const payload = await res.json();
    assert.strictEqual(payload.success, true);
    assert.ok(payload.version, 'bootstrap carries a version');
    assert.ok(payload.generatedAt, 'bootstrap carries a generatedAt');
    assert.ok(payload.actor, 'bootstrap carries actor');
    assert.strictEqual(payload.actor.locale, 'ar', 'Arabic locale is preserved');
    assert.strictEqual(payload.actor.direction, 'rtl', 'RTL direction is preserved');
    assert.strictEqual(payload.actor.isOwner, true, 'owner is identified as owner');
    assert.ok(Array.isArray(payload.navigation?.pages), 'visible pages list is present');
    assert.ok(payload.navigation.pages.some(p => p.id === 'home'), 'home page is visible');
    assert.ok(payload.actions?.length > 0, 'action metadata is present');
    const dbWrite = payload.actions.find(a => a.id === 'db_write');
    assert.ok(dbWrite, 'db_write action is present');
    assert.strictEqual(dbWrite.enabled, true, 'owner can db_write');
    assert.ok(payload.counters, 'counters object is present');
    assert.strictEqual(payload.cutover?.finance?.enforced, true, 'finance client selection is server-authoritative');
    assert.strictEqual(payload.cutover?.phase04?.enabled, false, 'Phase 04 cutover defaults off');
    assert.strictEqual(payload.cutover?.phase04?.domains?.INVENTORY?.enforced, false, 'inventory writer remains live before accepted cutover');
  } finally {
    await server.stop();
    for (const f of [jsonPath, jsonPath + '.prev']) { try { fs.unlinkSync(f); } catch {} }
    await cleanup(openMigrationDatabase(dbPath), dbPath).catch(() => {});
  }
}

async function testBootstrapPageCatalogueMatchesServerContract() {
  const { dialect, dbPath } = await setup('browser-catalogue');
  seedOrg(dialect);
  dialect.close();
  const jsonPath = tmpJsonPath('browser-catalogue');
  const port = await allocatePort();
  const base = `http://127.0.0.1:${port}`;
  const server = await startServer({ dbPath, jsonPath, port });
  try {
    const { cookies } = await login(base, 'owner', STRONG_PASSWORD, 't_alpha');
    const res = await fetch(`${base}/api/auth/bootstrap`, {
      method: 'GET',
      credentials: 'include',
      headers: { Cookie: cookies },
    });
    const payload = await res.json();
    const expectedIds = new Set(DEFAULT_PAGE_CATALOGUE.map(p => p.id));
    const returnedIds = new Set(payload.navigation.pages.map(p => p.id));
    for (const page of DEFAULT_PAGE_CATALOGUE) {
      assert.ok(returnedIds.has(page.id), `page ${page.id} should be visible to owner`);
    }
    for (const page of payload.navigation.pages) {
      assert.ok(expectedIds.has(page.id), `returned page ${page.id} is in the catalogue`);
      assert.ok(page.labelAr || page.label || page.route, 'page entry carries a label/route');
    }
  } finally {
    await server.stop();
    for (const f of [jsonPath, jsonPath + '.prev']) { try { fs.unlinkSync(f); } catch {} }
    await cleanup(openMigrationDatabase(dbPath), dbPath).catch(() => {});
  }
}

async function testAppJsWiredToBootstrap() {
  const appSource = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  assert.ok(appSource.includes('/api/auth/bootstrap'), 'app.js calls the bootstrap endpoint');
  assert.ok(appSource.includes('__octagonBootstrap'), 'app.js stores the bootstrap payload');
  assert.ok(appSource.includes('applyPlatformBootstrapVisibility'), 'app.js applies bootstrap visibility');
  assert.ok(appSource.includes('isPlatformPageVisible'), 'app.js queries platform page visibility');
  assert.ok(appSource.includes('isPlatformActionEnabled'), 'app.js exposes platform action check');
}

await run('Phase 02 / browser evidence (contract-level)', [
  ['bootstrap payload shape and Arabic/RTL identity', testBootstrapPayloadShapeAndRtlIdentity],
  ['bootstrap page catalogue matches server contract', testBootstrapPageCatalogueMatchesServerContract],
  ['app.js is wired to bootstrap and visibility helpers', testAppJsWiredToBootstrap],
]);
