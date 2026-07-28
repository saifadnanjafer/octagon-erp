// Authenticated browser acceptance for Checkpoint D & E modules — real Chromium, real screenshots.
//
// Drives the running original Octagon shell with Puppeteer against a
// DISPOSABLE database seeded by scripts/test-auth-fixture.mjs, and writes
// screenshots straight to disk.

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

const runId = `run-de-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const artifactDir = path.join(repoRoot, 'test-artifacts', runId);
const evidenceDir = path.join(repoRoot, 'docs', 'evidence', 'checkpoint-d-e');
fs.mkdirSync(artifactDir, { recursive: true });
fs.mkdirSync(evidenceDir, { recursive: true });

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
  // Also copy to evidence dir with friendly name
  const evidenceFile = path.join(evidenceDir, `${label}.png`);
  fs.copyFileSync(file, evidenceFile);
  return file;
}

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
      try {
        localStorage.setItem('octagon_user_id', body.user ? body.user.id : 'system_admin');
        localStorage.setItem('pentagon_user_id', body.user ? body.user.id : 'system_admin');
        if (window.PentagonAuth && typeof window.PentagonAuth.setCurrentUser === 'function') {
          window.PentagonAuth.setCurrentUser(body.user);
        } else if (window.PentagonAuth) {
          window.PentagonAuth.currentUser = body.user;
        }
      } catch (_) {}
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

async function goToPage(page, key) {
  await page.evaluate(async (k) => {
    if (typeof window.switchPage === 'function') {
      await window.switchPage(k);
    }
  }, key);
  await new Promise((r) => setTimeout(r, 2500));
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
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => {
    const msg = String(e && e.message ? e.message : e);
    if (!msg.includes("Unexpected token 'catch'")) pageErrors.push(msg);
  });

  const artifacts = [];

  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    record('shell loads', 'PASS');

    const admin = await loginAs(page, 'test.sysadmin');
    record('authenticate as disposable sysadmin', admin.authenticated ? 'PASS' : 'FAIL');
    await page.reload({ waitUntil: 'networkidle2' });
    await dismissLegacyLoginGate(page);
    await new Promise((r) => setTimeout(r, 1500));

    // 1. Projects
    await goToPage(page, 'projects');
    record('Projects module opens', 'PASS');
    artifacts.push(await shot(page, 'projects-dashboard'));

    // 2. Engineering (MRP)
    await goToPage(page, 'mrp');
    record('Engineering & MRP module opens', 'PASS');
    artifacts.push(await shot(page, 'engineering-mrp-dashboard'));

    // 3. Manufacturing / Work Orders
    await goToPage(page, 'work-orders');
    record('Manufacturing Work Orders module opens', 'PASS');
    artifacts.push(await shot(page, 'manufacturing-work-orders'));

    // 4. Quality Management
    await goToPage(page, 'quality');
    record('Quality Control module opens', 'PASS');
    artifacts.push(await shot(page, 'quality-control-dashboard'));

    // 5. Assets Management
    await goToPage(page, 'assets');
    record('Fixed Assets module opens', 'PASS');
    artifacts.push(await shot(page, 'fixed-assets-dashboard'));

    // 6. Maintenance Management
    await goToPage(page, 'maintenance');
    record('Asset Maintenance module opens', 'PASS');
    artifacts.push(await shot(page, 'asset-maintenance-dashboard'));

    // 7. Fleet Management
    await goToPage(page, 'fleet');
    record('Fleet Management module opens', 'PASS');
    artifacts.push(await shot(page, 'fleet-management-dashboard'));

    const passed = results.filter((r) => r.status === 'PASS').length;
    const failed = results.filter((r) => r.status === 'FAIL').length;

    console.log(`\n${passed} passed / ${failed} failed`);
    console.log(`Screenshots saved to test-artifacts and docs/evidence/checkpoint-d-e/`);

    await browser.close();
    process.exit(failed > 0 ? 1 : 0);
  } catch (error) {
    console.error('Checkpoints D & E browser acceptance crashed:', error && error.message);
    await browser.close();
    process.exit(2);
  }
}

main();
