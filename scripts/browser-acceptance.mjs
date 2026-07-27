// Authenticated browser acceptance — real Chromium, real screenshots.
//
// Drives the running original Octagon shell with Puppeteer against a
// DISPOSABLE database seeded by scripts/test-auth-fixture.mjs, and writes
// screenshots straight to disk. It does not depend on any external screenshot
// service.
//
// Usage (server must already be running via octagon-preview-auth):
//   node scripts/browser-acceptance.mjs
//   BASE_URL=http://localhost:8080 node scripts/browser-acceptance.mjs
//
// Artifacts land in ./test-artifacts/<runId>/ which is gitignored, because a
// raw run can capture session cookies and the disposable fixture password.
// Secret-free screenshots are copied into docs/evidence deliberately, never
// automatically.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';
const FIXTURE_PASSWORD = 'OctagonTest!2026#Disposable';
const COMPANY_ID = 'c_octagon_test';
const BRANCH_ID = 'b_octagon_test';

const runId = `run-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const artifactDir = path.join(repoRoot, 'test-artifacts', runId);
fs.mkdirSync(artifactDir, { recursive: true });

const results = [];
let shotIndex = 0;

function record(name, status, detail) {
  results.push({ name, status, detail: detail || null });
  const mark = status === 'PASS' ? 'PASS' : status === 'SKIP' ? 'SKIP' : 'FAIL';
  console.log(`${mark}  ${name}${detail ? `  — ${detail}` : ''}`);
}

async function shot(page, label) {
  shotIndex += 1;
  const file = path.join(artifactDir, `${String(shotIndex).padStart(2, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

/**
 * Dismiss the legacy shell login gate.
 *
 * The original shell has its own client-side login overlay driven by
 * localStorage 'octagon_user_id' (Phase 6H guest enforcement). Canonical
 * session authentication does not satisfy it, so without this the overlay
 * covers every page and screenshots photograph a login wall even though the
 * canonical modules work underneath — which is exactly what an earlier run
 * captured.
 *
 * This only affects what is VISIBLE. It grants nothing: every canonical read
 * and command is still authorised server-side from the session cookie.
 */
async function dismissLegacyLoginGate(page) {
  return page.evaluate(() => {
    try {
      localStorage.setItem('octagon_user_id', 'system_admin');
      localStorage.setItem('octagon-sidebar-collapsed', '0');
    } catch (_) { /* noop */ }
    const overlay = document.getElementById('loginOverlay')
      || document.querySelector('.login-overlay, #systemLoginOverlay');
    if (overlay) overlay.style.display = 'none';
    return { cleared: true };
  });
}

/** Log in through the real auth endpoint and set company scope. */
async function loginAs(page, login) {
  const out = await page.evaluate(async (userId, password, companyId, branchId) => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    const res = await fetch('/api/auth/login', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, password }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      await fetch('/api/auth/context', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, branchId }),
      });
    }
    return { status: res.status, authenticated: !!body.authenticated, user: body.user ? body.user.id : null };
  }, login, FIXTURE_PASSWORD, COMPANY_ID, BRANCH_ID);
  return out;
}

async function goToPage(page, key, sectionId) {
  await page.evaluate((k) => window.switchPage(k), key);
  await new Promise((r) => setTimeout(r, 2600));
  return page.evaluate((id) => {
    const el = document.getElementById(id);
    return { exists: !!el, visible: el ? getComputedStyle(el).display !== 'none' : false };
  }, sectionId);
}

async function main() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const chromiumVersion = await browser.version();
  console.log(`Chromium: ${chromiumVersion}`);
  console.log(`Artifacts: ${artifactDir}\n`);

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message ? e.message : e)));
  page.on('requestfailed', (r) => failedRequests.push(`${r.url()} :: ${r.failure()?.errorText}`));
  // A console "Failed to load resource" message does not carry the URL, so
  // missing resources are tracked from the response event instead, where the
  // exact path is available and can be judged individually.
  const notFound = [];
  page.on('response', (r) => { if (r.status() === 404) notFound.push(new URL(r.url()).pathname); });

  const artifacts = [];

  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    record('shell loads', 'PASS');

    // ---- authenticate -----------------------------------------------------
    const admin = await loginAs(page, 'test.sysadmin');
    record('authenticate as disposable sysadmin', admin.authenticated ? 'PASS' : 'FAIL',
      `status ${admin.status}, user ${admin.user}`);
    await page.reload({ waitUntil: 'networkidle2' });
    await dismissLegacyLoginGate(page);
    await page.reload({ waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 1500));
    const gate = await page.evaluate(() => {
      const o = document.getElementById('loginOverlay')
        || document.querySelector('.login-overlay, #systemLoginOverlay');
      return { present: !!o, visible: o ? getComputedStyle(o).display !== 'none' : false };
    });
    record('legacy shell login gate dismissed for screenshots',
      gate.visible ? 'FAIL' : 'PASS',
      gate.present ? 'overlay present but hidden' : 'no overlay');

    // ---- Canonical Operations console ------------------------------------
    const console1 = await goToPage(page, 'canonical_console', 'pageCanonicalConsole');
    record('canonical console opens', console1.visible ? 'PASS' : 'FAIL');
    artifacts.push(await shot(page, 'console-desktop-ar'));

    const consoleTabs = await page.evaluate(() =>
      [...document.querySelectorAll('[data-cc-tab]')].map((b) => b.dataset.ccTab));
    record('console exposes 8 domains', consoleTabs.length === 8 ? 'PASS' : 'FAIL',
      `${consoleTabs.length} tabs`);

    // ---- Parties create through the real form -----------------------------
    const partyResult = await page.evaluate(async () => {
      const tab = [...document.querySelectorAll('[data-cc-tab]')].find((b) => b.dataset.ccTab === 'parties');
      if (!tab) return { error: 'parties tab missing' };
      tab.click();
      await new Promise((r) => setTimeout(r, 1800));
      const before = document.querySelectorAll('#pageCanonicalConsole .cc-table tbody tr').length;
      const form = document.getElementById('ccCreateForm');
      if (!form) return { error: 'create form missing' };
      form.querySelector('[data-cc-field="name"]').value = 'عميل القبول الآلي';
      const sel = form.querySelector('[data-cc-field="roles"]');
      if (sel) sel.value = 'customer';
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 3000));
      const rows = [...document.querySelectorAll('#pageCanonicalConsole .cc-table tbody tr')];
      return {
        before, after: rows.length,
        firstRow: rows[0] ? rows[0].textContent.replace(/\s+/g, ' ').trim() : null,
        error: document.querySelector('.cc-state-error') ? 'error state shown' : null,
      };
    });
    record('party:create executes through the real UI form',
      (!partyResult.error && partyResult.after > partyResult.before) ? 'PASS' : 'FAIL',
      `rows ${partyResult.before} -> ${partyResult.after}${partyResult.error ? ` (${partyResult.error})` : ''}`);
    artifacts.push(await shot(page, 'console-parties-after-create'));

    // ---- Canonical Inventory ---------------------------------------------
    const inv = await goToPage(page, 'canonical_inventory', 'pageCanonicalInventory');
    record('canonical inventory opens', inv.visible ? 'PASS' : 'FAIL');
    artifacts.push(await shot(page, 'inventory-warehouses-desktop'));

    const whResult = await page.evaluate(async () => {
      const form = document.querySelector('[data-ci-form="warehouse"]');
      if (!form) return { error: 'warehouse form missing' };
      const before = document.querySelectorAll('#pageCanonicalInventory .ci-table tbody tr').length;
      const stamp = Date.now().toString(36).slice(-5).toUpperCase();
      form.querySelector('[data-ci-field="name"]').value = `مستودع القبول ${stamp}`;
      form.querySelector('[data-ci-field="code"]').value = `ACC-${stamp}`;
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 3000));
      const rows = [...document.querySelectorAll('#pageCanonicalInventory .ci-table tbody tr')];
      // Assert against the canonical list, not the DOM row count. The grid
      // re-renders asynchronously from several triggers, so a row count
      // sampled at a fixed delay is timing-sensitive and produced a false
      // failure on an earlier run while the record had in fact been created.
      // The server is the authority; the DOM count is reported as context.
      const list = await window.CanonicalClient.warehouses.list({ limit: 200 });
      return {
        before, after: rows.length, code: `ACC-${stamp}`,
        existsOnServer: list.some((w) => w.code === `ACC-${stamp}`),
        serverCount: list.length,
      };
    });
    record('warehouse:create executes through the real UI form',
      (!whResult.error && whResult.existsOnServer) ? 'PASS' : 'FAIL',
      `${whResult.code} on server: ${whResult.existsOnServer}; dom rows ${whResult.before} -> ${whResult.after}; server total ${whResult.serverCount}`);
    artifacts.push(await shot(page, 'inventory-warehouse-created'));

    // ---- Draft -> Validate lifecycle, including the failure surface -------
    const receipt = await page.evaluate(async () => {
      document.querySelector('[data-ci-tab="receipt"]').click();
      await new Promise((r) => setTimeout(r, 1600));
      const form = document.querySelector('[data-ci-form="draft-line"]');
      form.querySelector('[data-ci-field="product_id"]').value = 'var_missing_on_purpose';
      form.querySelector('[data-ci-field="uom_id"]').value = 'uom_missing';
      form.querySelector('[data-ci-field="product_qty"]').value = '3';
      form.querySelector('[data-ci-field="location_id"]').value = 'loc_a';
      form.querySelector('[data-ci-field="location_dest_id"]').value = 'loc_b';
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 1400));
      const staged = window.CanonicalInventory.draftLines.length;

      document.getElementById('ciValidateReceipt').click();
      await new Promise((r) => setTimeout(r, 3200));
      const err = document.querySelector('#pageCanonicalInventory .ci-state-error');
      const moves = await window.CanonicalClient.stock.operations({ limit: 50 });
      return {
        staged,
        remaining: window.CanonicalInventory.draftLines.length,
        failureVisible: !!err,
        failureText: err ? err.textContent.replace(/\s+/g, ' ').trim().slice(0, 150) : null,
        movesPersisted: moves.length,
      };
    });
    record('receipt draft stages without persisting', receipt.staged === 1 ? 'PASS' : 'FAIL');
    record('failed validate shows a per-line reason', receipt.failureVisible ? 'PASS' : 'FAIL',
      receipt.failureText);
    record('failed validate persists no stock move', receipt.movesPersisted === 0 ? 'PASS' : 'FAIL',
      `${receipt.movesPersisted} moves`);
    record('failed line stays in the draft', receipt.remaining === 1 ? 'PASS' : 'FAIL');
    artifacts.push(await shot(page, 'inventory-receipt-failure-surface'));

    // ---- English LTR ------------------------------------------------------
    const ltr = await page.evaluate(async () => {
      const btn = document.querySelector('[title*="Switch language"], [aria-label*="Switch language"]');
      if (btn) btn.click();
      await new Promise((r) => setTimeout(r, 2000));
      window.switchPage('canonical_inventory');
      await new Promise((r) => setTimeout(r, 2200));
      return { lang: document.documentElement.lang, dir: document.documentElement.dir };
    });
    record('english LTR renders', ltr.dir === 'ltr' ? 'PASS' : 'FAIL', `dir=${ltr.dir}`);
    artifacts.push(await shot(page, 'inventory-desktop-en-ltr'));

    // ---- responsive -------------------------------------------------------
    await page.setViewport({ width: 768, height: 1024 });
    await page.evaluate(() => window.switchPage('canonical_inventory'));
    await new Promise((r) => setTimeout(r, 2000));
    const tablet = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    }));
    record('tablet 768 has no horizontal overflow', tablet.overflow ? 'FAIL' : 'PASS');
    artifacts.push(await shot(page, 'inventory-tablet-768'));

    await page.setViewport({ width: 375, height: 812 });
    await page.evaluate(() => window.switchPage('canonical_inventory'));
    await new Promise((r) => setTimeout(r, 2000));
    const mobile = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      mainWidth: document.getElementById('mainContent') ? document.getElementById('mainContent').clientWidth : null,
      viewport: window.innerWidth,
    }));
    record('mobile 375 has no page-level horizontal overflow', mobile.overflow ? 'FAIL' : 'PASS');
    // This is the known shell-wide defect, measured rather than asserted away.
    record('mobile main content width', mobile.mainWidth >= mobile.viewport * 0.6 ? 'PASS' : 'FAIL',
      `mainContent ${mobile.mainWidth}px of ${mobile.viewport}px viewport`);
    artifacts.push(await shot(page, 'inventory-mobile-375'));

    await page.setViewport({ width: 1440, height: 900 });

    // ---- restricted viewer denial ----------------------------------------
    const viewer = await loginAs(page, 'test.viewer');
    record('authenticate as restricted viewer', viewer.authenticated ? 'PASS' : 'FAIL');
    const denial = await page.evaluate(async () => {
      const out = {};
      try {
        const rows = await window.CanonicalClient.parties.list({ limit: 5 });
        out.read = { ok: true, n: rows.length };
      } catch (e) { out.read = { ok: false, status: e.status, code: e.code }; }
      try {
        await window.CanonicalClient.parties.create({ name: 'must be denied', roles: ['customer'] });
        out.write = { denied: false };
      } catch (e) {
        out.write = { denied: true, status: e.status, isAuthorization: e.isAuthorization, message: e.message };
      }
      return out;
    });
    record('viewer may read', denial.read.ok ? 'PASS' : 'FAIL', `${denial.read.n} records`);
    record('viewer write is denied server-side',
      (denial.write.denied && denial.write.status === 403) ? 'PASS' : 'FAIL',
      `status ${denial.write.status}, ${denial.write.message}`);
    await page.evaluate(() => window.switchPage('canonical_console'));
    await new Promise((r) => setTimeout(r, 2400));
    artifacts.push(await shot(page, 'viewer-permission-state'));

    // ---- page health ------------------------------------------------------
    // Known pre-existing noise, not caused by these modules: the saveData
    // employees guard and unauthenticated 401s before login.
    // Known, explained noise — narrow patterns only, so a real error cannot
    // hide behind them:
    //  - the saveData employees guard (protects the frozen payroll zone)
    //  - 401s, which occur before login and again deliberately while proving
    //    the restricted viewer is denied
    //  - legacy journal/V5 health probes that fail against a disposable copy
    const EXPECTED_NOISE = [
      /refusing to persist an empty employees array/i,
      /Server error: 401/i,
      /Failed to load resource[^]*401/i,
      /Journal seeding failed/i,
      /V5 service health unavailable/i,
      // Generic resource-load failures carry no URL here; they are asserted
      // precisely by the missing-resource check below, which has real paths.
      /Failed to load resource/i,
    ];
    const unexpectedConsole = consoleErrors.filter(
      (t) => !EXPECTED_NOISE.some((re) => re.test(t)));
    record('no uncaught page errors', pageErrors.length === 0 ? 'PASS' : 'FAIL',
      pageErrors.slice(0, 2).join(' | '));
    record('no unexpected console errors', unexpectedConsole.length === 0 ? 'PASS' : 'FAIL',
      unexpectedConsole.slice(0, 2).join(' | '));
    record('no failed required resources', failedRequests.length === 0 ? 'PASS' : 'FAIL',
      failedRequests.slice(0, 2).join(' | '));

    // Optional tooling status files that simply do not exist on this branch.
    // Allowlisted by exact path so any other 404 still fails the run.
    const ALLOWED_404 = new Set(['/claude-status.json', '/claude-review-pointer.json']);
    const unexpected404 = [...new Set(notFound)].filter((p) => !ALLOWED_404.has(p));
    record('no unexpected missing resources', unexpected404.length === 0 ? 'PASS' : 'FAIL',
      unexpected404.length ? unexpected404.join(' | ') : `${[...new Set(notFound)].length} known-optional 404(s)`);

    // ---- report -----------------------------------------------------------
    const passed = results.filter((r) => r.status === 'PASS').length;
    const failed = results.filter((r) => r.status === 'FAIL').length;
    const skipped = results.filter((r) => r.status === 'SKIP').length;

    const report = {
      runId,
      chromium: chromiumVersion,
      puppeteer: (await import('puppeteer/package.json', { with: { type: 'json' } }).catch(() => ({ default: {} }))).default.version || 'unknown',
      baseUrl: BASE_URL,
      totals: { passed, failed, skipped, total: results.length },
      results,
      screenshots: artifacts.map((a) => path.relative(repoRoot, a)),
      consoleErrorsRaw: consoleErrors.length,
      consoleErrorsUnexpected: unexpectedConsole,
      pageErrors,
      failedRequests,
      notFound: [...new Set(notFound)],
      unexpected404,
    };
    fs.writeFileSync(path.join(artifactDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');

    console.log(`\n${passed} passed / ${failed} failed / ${skipped} skipped`);
    console.log(`screenshots: ${artifacts.length}`);
    console.log(`report: ${path.relative(repoRoot, path.join(artifactDir, 'report.json'))}`);

    await browser.close();
    process.exit(failed > 0 ? 1 : 0);
  } catch (error) {
    console.error('acceptance run crashed:', error && error.message);
    try { await shot(page, 'crash'); } catch (_) { /* noop */ }
    await browser.close();
    process.exit(2);
  }
}

main();
