// Phase 02 live browser evidence — Puppeteer end-to-end test.
//
// Starts the real server.js on a disposable port and SQLite database, opens
// index.html in a headless Chromium instance, performs the actual Octagon
// login flow through the DOM, and verifies that:
//   - the shell preserves Arabic lang="ar" and dir="rtl"
//   - the platform bootstrap controls page/action visibility
//   - owner sees privileged pages that clerk does not
//   - logout returns the user to the login overlay
//   - direct API calls to hidden actions are denied
//
// Screenshots are written to docs/evidence/phase-02/browser-screenshots/.

import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setup, cleanup, run, seedOrg, STRONG_PASSWORD } from './harness.mjs';
import { openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createRoleAdministration } from '../../platform/authorization/roles/index.mjs';
import { createPermissionRegistry } from '../../platform/authorization/registry/index.mjs';
import { createPermissionEvaluator } from '../../platform/authorization/evaluator/index.mjs';
import { createPolicyEngine } from '../../platform/policies/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const SCREENSHOT_DIR = path.join(ROOT, 'docs', 'evidence', 'phase-02', 'browser-screenshots');

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

async function launchBrowser() {
  const puppeteer = await import('puppeteer');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  return browser;
}

function attachPageLogging(page) {
  page.on('console', msg => console.log(`[browser console ${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => console.error(`[browser pageerror] ${err.message || err}`));
  page.on('requestfailed', req => console.warn(`[browser requestfailed] ${req.url()} ${req.failure()?.errorText || ''}`));
}

async function waitForAppInit(page) {
  // Wait for the DOMContentLoaded-driven init to complete loadData().
  await page.waitForFunction(() => window.__dataLoadComplete === true, { timeout: 15000 });
}

function grantClerkLimitedRole(dialect) {
  const registry = createPermissionRegistry(dialect);
  const policyEngine = createPolicyEngine(dialect);
  const evaluator = createPermissionEvaluator(dialect, { permissionRegistry: registry, policyEngine });
  const roles = createRoleAdministration(dialect, { permissionRegistry: registry, evaluator });
  const now = new Date().toISOString();
  const tenantId = 't_alpha';
  const roleId = 'role_clerk_limited';
  roles.createRole({ id: roleId, tenantId, name: 'clerk_limited', labelAr: 'موظف محدود' }, 'test');
  dialect.prepare(`
    INSERT INTO authorization_grants (id, role_id, permission, effect, scope, document_states, requires_approval, created_at, created_by)
    VALUES (?, ?, 'platform:page:home', 'allow', 'all', '[]', 0, ?, 'test'),
           (?, ?, 'platform:page:approvals', 'allow', 'all', '[]', 0, ?, 'test'),
           (?, ?, 'platform:page:inbox', 'allow', 'all', '[]', 0, ?, 'test'),
           (?, ?, 'platform:page:workflows', 'allow', 'all', '[]', 0, ?, 'test')
    ON CONFLICT DO NOTHING
  `).run(
    `grant_${now}_home`, roleId, now,
    `grant_${now}_approvals`, roleId, now,
    `grant_${now}_inbox`, roleId, now,
    `grant_${now}_workflows`, roleId, now,
  );
  roles.assign({ userId: 'u_clerk', roleId, companyId: 'c_alpha_1' }, 'test');
}

async function waitForLoginOverlay(page) {
  await page.waitForFunction(() => {
    const el = document.getElementById('loginOverlay');
    const intro = document.getElementById('introScreen');
    const introVisible = intro && window.getComputedStyle(intro).display !== 'none';
    const overlayVisible = el && window.getComputedStyle(el).display !== 'none';
    return overlayVisible || introVisible;
  }, { timeout: 15000 });
}

async function ensureLoginOverlayVisible(page) {
  await waitForLoginOverlay(page);
  const isIntroVisible = await page.evaluate(() => {
    const intro = document.getElementById('introScreen');
    return intro && window.getComputedStyle(intro).display !== 'none';
  });
  if (isIntroVisible) {
    await page.click('button[onclick*="showLoginFromIntro"]');
    await page.waitForFunction(() => {
      const el = document.getElementById('loginOverlay');
      return el && window.getComputedStyle(el).display !== 'none';
    }, { timeout: 5000 });
  }
}

async function waitForLoginOverlayHidden(page) {
  await page.waitForFunction(() => {
    const el = document.getElementById('loginOverlay');
    return !el || window.getComputedStyle(el).display === 'none';
  }, { timeout: 15000 });
}

async function loginAsOwner(page, password) {
  // Clear any stored session and invoke the real login function directly.
  // The loginUserList only contains seeded client-side users; the server-side
  // owner identity is not pre-created in the UI list, so we call performLogin
  // as the shell would after a user clicks a list entry.
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForAppInit(page);
  await ensureLoginOverlayVisible(page);

  await page.evaluate((userId) => {
    if (typeof performLogin === 'function') performLogin(userId);
  }, 'owner');

  // The password prompt is backed by the canonical server identity authority.
  await page.waitForFunction(() => {
    const overlay = document.getElementById('omniModalOverlay');
    return overlay && window.getComputedStyle(overlay).display !== 'none';
  }, { timeout: 10000 });

  const title = await page.evaluate(() => document.getElementById('omniModalTitle')?.textContent || '');
  assert.ok(title.includes('تسجيل') || title.toLowerCase().includes('login'), `expected password prompt modal, got: ${title}`);

  await page.type('#omniPromptPassword', password, { delay: 10 });
  await page.click('#omniModalConfirm');

  // Wait for the modal to close and the login overlay to hide.
  await page.waitForFunction(() => {
    const overlay = document.getElementById('omniModalOverlay');
    return !overlay || window.getComputedStyle(overlay).display === 'none';
  }, { timeout: 15000 });
  await waitForLoginOverlayHidden(page);
}

async function loginAsClerk(page, password) {
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForAppInit(page);
  await ensureLoginOverlayVisible(page);

  await page.evaluate((userId) => {
    if (typeof performLogin === 'function') performLogin(userId);
  }, 'clerk');

  await page.waitForFunction(() => {
    const overlay = document.getElementById('omniModalOverlay');
    return overlay && window.getComputedStyle(overlay).display !== 'none';
  }, { timeout: 10000 });

  await page.type('#omniPromptPassword', password, { delay: 10 });
  await page.click('#omniModalConfirm');

  await page.waitForFunction(() => {
    const overlay = document.getElementById('omniModalOverlay');
    return !overlay || window.getComputedStyle(overlay).display === 'none';
  }, { timeout: 15000 });
  await waitForLoginOverlayHidden(page);
}

async function logout(page) {
  await page.evaluate(() => {
    if (typeof performLogout === 'function') performLogout();
  });
  await waitForLoginOverlay(page);
}

async function testRtlAndLoginBootstrap() {
  const { dialect, dbPath } = await setup('browser-live');
  seedOrg(dialect);
  dialect.close();
  const jsonPath = tmpJsonPath('browser-live');
  const port = 18580 + Math.floor(Math.random() * 1000);
  const base = `http://127.0.0.1:${port}`;
  const server = await startServer({ dbPath, jsonPath, port });
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    attachPageLogging(page);
    await page.setViewport({ width: 1366, height: 900 });
    await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForAppInit(page);

    // Verify Arabic/RTL identity from the root element.
    const lang = await page.evaluate(() => document.documentElement.getAttribute('lang'));
    const dir = await page.evaluate(() => document.documentElement.getAttribute('dir'));
    assert.strictEqual(lang, 'ar', 'document language is Arabic');
    assert.strictEqual(dir, 'rtl', 'document direction is RTL');

    await loginAsOwner(page, STRONG_PASSWORD);

    // Verify the platform bootstrap was applied.
    const bootstrap = await page.evaluate(() => window.__octagonBootstrap);
    assert.ok(bootstrap && bootstrap.success, 'bootstrap payload was applied after login');
    assert.strictEqual(bootstrap.actor.locale, 'ar', 'bootstrap preserves Arabic locale');
    assert.strictEqual(bootstrap.actor.direction, 'rtl', 'bootstrap preserves RTL direction');
    assert.ok(bootstrap.navigation.pages.some(p => p.id === 'home'), 'home page is visible to owner');
    assert.ok(bootstrap.actions.find(a => a.id === 'db_write' && a.enabled), 'owner has db_write enabled');

    // Screenshot after login.
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'owner-login.png'), fullPage: false });
  } finally {
    await browser.close();
    await server.stop();
    for (const f of [jsonPath, jsonPath + '.prev']) { try { fs.unlinkSync(f); } catch {} }
    await cleanup(openMigrationDatabase(dbPath), dbPath).catch(() => {});
  }
}

async function testRoleSpecificNavigation() {
  const { dialect, dbPath } = await setup('browser-live-roles');
  seedOrg(dialect);
  grantClerkLimitedRole(dialect);
  dialect.close();
  const jsonPath = tmpJsonPath('browser-live-roles');
  const port = 18680 + Math.floor(Math.random() * 1000);
  const base = `http://127.0.0.1:${port}`;
  const server = await startServer({ dbPath, jsonPath, port });
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    attachPageLogging(page);
    await page.setViewport({ width: 1366, height: 900 });
    await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForAppInit(page);

    await loginAsOwner(page, STRONG_PASSWORD);
    const ownerVisible = await page.evaluate(() => {
      const el = document.querySelector('.nav-btn[data-page="security_center"]');
      return el ? window.getComputedStyle(el).display !== 'none' : false;
    });
    assert.ok(ownerVisible, 'owner sees security_center page');
    await logout(page);

    await loginAsClerk(page, STRONG_PASSWORD);
    const clerkBootstrap = await page.evaluate(() => window.__octagonBootstrap);
    assert.ok(clerkBootstrap && clerkBootstrap.success, 'clerk bootstrap was applied after login');
    const clerkVisible = await page.evaluate(() => {
      const el = document.querySelector('.nav-btn[data-page="security_center"]');
      return el ? window.getComputedStyle(el).display !== 'none' : false;
    });
    assert.strictEqual(clerkVisible, false, `clerk does not see security_center page; bootstrap pages: ${clerkBootstrap?.navigation?.pages.map(p => p.id).join(',')}`);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'clerk-navigation.png'), fullPage: false });
    await logout(page);
  } finally {
    await browser.close();
    await server.stop();
    for (const f of [jsonPath, jsonPath + '.prev']) { try { fs.unlinkSync(f); } catch {} }
    await cleanup(openMigrationDatabase(dbPath), dbPath).catch(() => {});
  }
}

async function testDirectApiDenialForHiddenAction() {
  const { dialect, dbPath } = await setup('browser-live-api');
  seedOrg(dialect);
  dialect.close();
  const jsonPath = tmpJsonPath('browser-live-api');
  const port = 18780 + Math.floor(Math.random() * 1000);
  const base = `http://127.0.0.1:${port}`;
  const server = await startServer({ dbPath, jsonPath, port });
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    attachPageLogging(page);
    await page.setViewport({ width: 1366, height: 900 });
    await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForAppInit(page);

    await loginAsClerk(page, STRONG_PASSWORD);

    // Direct API call without a valid session cookie should be denied.
    const result = await page.evaluate(async (endpoint) => {
      try {
        const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        return { status: res.status, ok: res.ok };
      } catch (e) {
        return { error: e.message };
      }
    }, `${base}/api/db`);
    assert.ok(!result.ok && (result.status === 401 || result.status === 403), `clerk direct API call denied: ${JSON.stringify(result)}`);

    // Attempt a request-body identity override.
    const override = await page.evaluate(async (endpoint) => {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: 'owner', companyId: 'c_alpha_2', role: 'system_admin' }),
        });
        return { status: res.status, ok: res.ok };
      } catch (e) {
        return { error: e.message };
      }
    }, `${base}/api/db`);
    assert.ok(!override.ok && (override.status === 401 || override.status === 403), `request-body override denied: ${JSON.stringify(override)}`);
  } finally {
    await browser.close();
    await server.stop();
    for (const f of [jsonPath, jsonPath + '.prev']) { try { fs.unlinkSync(f); } catch {} }
    await cleanup(openMigrationDatabase(dbPath), dbPath).catch(() => {});
  }
}

await run('Phase 02 / live browser evidence (Puppeteer)', [
  ['RTL identity and owner login bootstrap', testRtlAndLoginBootstrap],
  ['role-specific navigation hides privileged pages', testRoleSpecificNavigation],
  ['direct API calls and identity overrides are denied', testDirectApiDenialForHiddenAction],
]);

console.log(`\nScreenshots saved to: ${SCREENSHOT_DIR}`);
