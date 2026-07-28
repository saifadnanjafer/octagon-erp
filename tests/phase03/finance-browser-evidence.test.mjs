// Phase 03 live browser evidence — Puppeteer end-to-end test for finance.
//
// This suite exists because the Phase 03 closure audit
// (docs/evidence/phase-03/closure-claim-diff-audit.md and the 2026-07-22
// correction appended to docs/evidence/phase-03/browser-regression-report.md)
// found that the earlier "E2E Browser Regression Report" (BR-01…BR-16 PASS)
// was narrative-only: no executable test, no screenshots, no machine-readable
// results. This file produces REAL, re-runnable browser evidence.
//
// It starts the real server.js on a disposable port and SQLite database
// (never database.db — see tests/phase02/harness.mjs), opens index.html in
// headless Chromium, performs the actual Octagon login flow through the DOM,
// and verifies the feasible Phase 03 browser core set:
//
//   P03-BR-01  login/logout: session cookie issued, revoked server-side
//   P03-BR-02  finance navigation renders for an authorized user (Arabic)
//   P03-BR-03  role-based denial: a principal with platform:db:read/write but
//              no finance grant is denied (403) from the page context.
//              NOTE: the shell's menu gating (app.js PLATFORM_PAGE_NAV_MAP)
//              only covers home/approvals/workflow/users/settings/security —
//              the finance nav button is NOT permission-gated in the UI, so
//              this scenario proves the API-level denial instead of menu
//              hiding. That UI gap is recorded in the results JSON.
//   P03-BR-04  finance page renders with no pageerror and no console errors
//              (allowlist: benign 401/404 resource logs emitted pre-login and
//              "[saveData] BLOCKED" — same allowlist as the phase02 suite)
//   P03-BR-05  canonical runtime round trip FROM THE PAGE CONTEXT:
//              fetch POST /api/v1/action/finance_account:create -> 200, then
//              GET /api/v1/finance/accounts contains the created account —
//              proving Browser -> API -> Phase 02 authz -> canonical engine
//   P03-BR-06  unauthenticated fetch from a fresh browser context -> 401
//   P03-BR-07  Arabic RTL render + English LTR switch (#omniLanguageToggle)
//   P03-BR-08  desktop (1366px) and mobile (375px) viewports
//   P03-BR-09  unrelated-page regression: timesheet/employees still render
//              after finance operations
//
// Artifacts:
//   screenshots -> docs/evidence/phase-03/browser-screenshots/
//                  named <scenario-id>_<timestamp>_<viewport>_<locale>.png
//   results JSON -> docs/evidence/phase-03/browser-results/
//                  scenario ids, pass/fail, timestamps, git commit, viewport,
//                  locale, console-error/pageerror counts per scenario
//
// Run: node tests/phase03/finance-browser-evidence.test.mjs

import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setup, cleanup, seedOrg, STRONG_PASSWORD } from '../phase02/harness.mjs';
import { openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { seedChartOfAccounts } from '../../platform/finance/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const SCREENSHOT_DIR = path.join(ROOT, 'docs', 'evidence', 'phase-03', 'browser-screenshots');
const RESULTS_DIR = path.join(ROOT, 'docs', 'evidence', 'phase-03', 'browser-results');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
fs.mkdirSync(RESULTS_DIR, { recursive: true });

const RUN_STARTED = new Date();
const RUN_ID = RUN_STARTED.toISOString().replace(/[:.]/g, '-');
const GIT_COMMIT = (() => {
  try {
    return execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
})();
const GIT_BRANCH = (() => {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
})();

// Benign noise the app emits before login (unauthenticated resource probes),
// handled optimistic-write conflicts between disposable browser sessions, and
// the saveData blocker. Same policy as tests/phase02/browser-live-evidence.test.mjs.
const CONSOLE_ERROR_ALLOWLIST = /\b401\b|\b404\b|\b409\b|\[saveData\] BLOCKED/;

function tmpJsonPath(suite) {
  return path.join(os.tmpdir(), `octagon-p03-browser-${suite}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.json`);
}

// Copied from tests/phase02/browser-live-evidence.test.mjs: seedOrg creates
// UUID membership ids, but syncIdentityUsers generates deterministic ids
// (mem_<user_id>_<company_id>). Align ids so the runtime sync is idempotent.
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

// Copied from tests/phase03/finance-http-api.test.mjs: give u_clerk a role
// holding ONLY platform:db:write + platform:db:read (no finance grant).
function seedApiWriterRole(dialect) {
  const now = new Date().toISOString();
  dialect.prepare(`
    INSERT INTO authorization_roles (id, tenant_id, name, label_ar, is_system, status, created_at, updated_at)
    VALUES ('role_api_writer', 'default', 'api_writer', 'كاتب API', 0, 'active', ?, ?)
    ON CONFLICT(id) DO NOTHING
  `).run(now, now);
  const grant = dialect.prepare(`
    INSERT INTO authorization_grants (id, role_id, permission, effect, scope, document_states, requires_approval, created_at, created_by)
    VALUES (?, 'role_api_writer', ?, 'allow', 'all', '[]', 0, ?, 'phase03_browser_test')
    ON CONFLICT DO NOTHING
  `);
  grant.run('grant_api_writer_db_write', 'platform:db:write', now);
  grant.run('grant_api_writer_db_read', 'platform:db:read', now);
  // platform:page:home keeps the clerk's app shell functional (the bootstrap
  // endpoint requires it) WITHOUT any finance grant — the scenario still
  // proves the finance denial itself.
  grant.run('grant_api_writer_page_home', 'platform:page:home', now);
  dialect.prepare(`
    INSERT INTO authorization_role_assignments (id, user_id, actor_type, role_id, company_id, status, created_at, created_by)
    VALUES ('asg_u_clerk_api_writer', 'u_clerk', 'user', 'role_api_writer', NULL, 'active', ?, 'phase03_browser_test')
    ON CONFLICT DO NOTHING
  `).run(now);
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
    }, 20000);

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

/**
 * Boot a disposable server for one scenario.
 * opts.seedFinance: seed the canonical chart of accounts in c_alpha_1.
 * opts.clerkApiWriter: give u_clerk the db:read+db:write (no finance) role.
 */
async function boot(suite, opts = {}) {
  const { dialect, dbPath } = await setup(`browser-${suite}`);
  seedOrg(dialect);
  if (opts.seedFinance) {
    seedChartOfAccounts(dialect, { companyId: 'c_alpha_1', userId: 'u_owner' });
  }
  if (opts.clerkApiWriter) seedApiWriterRole(dialect);
  fixMembershipIds(dialect);
  dialect.close();
  const jsonPath = tmpJsonPath(suite);
  const port = 19780 + Math.floor(Math.random() * 1000);
  const base = `http://127.0.0.1:${port}`;
  const server = await startServer({ dbPath, jsonPath, port });
  const stop = async () => {
    await server.stop();
    for (const f of [jsonPath, jsonPath + '.prev']) { try { fs.unlinkSync(f); } catch { /* not present */ } }
    await cleanup(openMigrationDatabase(dbPath), dbPath).catch(() => {});
  };
  return { base, stop };
}

async function launchBrowser() {
  const puppeteer = await import('puppeteer');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  return browser;
}

/** Collect console errors and pageerrors, split into allowlisted vs real. */
function createErrorCollector(page) {
  const collector = { consoleErrors: [], pageErrors: [], allowlisted: [] };
  page.on('console', msg => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (CONSOLE_ERROR_ALLOWLIST.test(text)) collector.allowlisted.push(text);
    else collector.consoleErrors.push(text);
  });
  page.on('pageerror', err => {
    const text = err.message || String(err);
    collector.pageErrors.push(text);
  });
  return collector;
}

async function waitForAppInit(page) {
  await page.waitForFunction(() => window.__dataLoadComplete === true, { timeout: 30000 });
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
    const switched = await page.evaluate(() => {
      if (typeof window.showLoginFromIntro !== 'function') return false;
      window.showLoginFromIntro();
      return true;
    });
    assert.equal(switched, true, 'intro-to-login action must be mounted');
  }
}

async function waitForLoginOverlayHidden(page) {
  await page.waitForFunction(() => {
    const el = document.getElementById('loginOverlay');
    return !el || window.getComputedStyle(el).display === 'none';
  }, { timeout: 15000 });
}

async function loginAs(page, userId, password) {
  await page.evaluate(async () => {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
    }).catch(() => {});
    window.__octagonServerSession = { authenticated: false, mode: 'test-reset' };
    localStorage.clear();
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForAppInit(page);
  await page.waitForFunction(() =>
    window.__octagonServerSession
      && window.__octagonServerSession.authenticated === false,
  { timeout: 15000 });
  await ensureLoginOverlayVisible(page);

  await page.evaluate((id) => {
    if (typeof performLogin === 'function') performLogin(id);
  }, userId);

  await page.waitForFunction(() => {
    const overlay = document.getElementById('omniModalOverlay');
    return overlay && window.getComputedStyle(overlay).display !== 'none';
  }, { timeout: 10000 });

  const title = await page.evaluate(() => document.getElementById('omniModalTitle')?.textContent || '');
  assert.ok(title.includes('تسجيل') || title.toLowerCase().includes('login'), `expected password prompt modal, got: ${title}`);

  await page.type('#omniPromptPassword', password, { delay: 10 });
  await page.click('#omniModalConfirm');

  await page.waitForFunction(() => {
    const overlay = document.getElementById('omniModalOverlay');
    return !overlay || window.getComputedStyle(overlay).display === 'none';
  }, { timeout: 15000 });
  await waitForLoginOverlayHidden(page);
  // The prompt modal closes before performLogin's asynchronous data reload and
  // identity merge necessarily settle. Wait for the authoritative principal,
  // including its groups, before exercising permission-gated Finance routes.
  await page.waitForFunction((expectedUserId) => {
    const user = window.PentagonAuth?.getCurrentUser?.();
    return window.__octagonServerSession?.authenticated === true
      && user?.id === expectedUserId
      && Array.isArray(user.groups)
      && user.groups.length > 0;
  }, { timeout: 30000, polling: 250 }, userId);
}

async function logout(page) {
  await page.evaluate(() => {
    if (typeof performLogout === 'function') performLogout();
  });
  await waitForLoginOverlay(page);
}

async function getSessionCookie(page, baseUrl) {
  const url = new URL(baseUrl).origin;
  const cookies = await page.cookies(url);
  const session = cookies.find(c => c.name === 'octagon_session');
  return session?.value || null;
}

async function apiFetch(base, cookieValue, method, path, body) {
  const headers = cookieValue ? { Cookie: `octagon_session=${cookieValue}` } : {};
  const opts = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${base}${path}`, opts);
  const payload = await res.json().catch(() => ({}));
  return { res, payload };
}

async function navigateToPage(page, pageId) {
  const navigated = await page.evaluate((p) => {
    if (typeof switchPage === 'function') {
      try {
        switchPage(p);
        return true;
      } catch (e) {
        console.error('switchPage failed:', e);
      }
    }
    return false;
  }, pageId);
  if (!navigated) {
    await page.evaluate((p) => { window.location.hash = `#page${p.charAt(0).toUpperCase() + p.slice(1)}`; }, pageId);
  }
  await new Promise(r => setTimeout(r, 400));
}

const PAGE_ELEMENT_MAP = {
  home: 'pageHome', timesheet: 'pageTimesheet', employees: 'pageEmployees',
  finance: 'pageFinance', command_center: 'pageCommandCenter', kanban: 'pageKanban',
};

async function assertPageRendered(page, pageId, timeout = 30000) {
  const elId = PAGE_ELEMENT_MAP[pageId];
  assert.ok(elId, `unknown page ${pageId}`);
  await page.waitForFunction((id) => {
    const el = document.getElementById(id);
    return el && window.getComputedStyle(el).display !== 'none' && el.innerHTML.trim().length > 0;
  }, { timeout }, elId);
}

async function navigateUntilRendered(page, pageId, attempts = 12) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await navigateToPage(page, pageId);
    try {
      await assertPageRendered(page, pageId, 2500);
      return true;
    } catch {
      // Permission reapplication and legacy page rendering settle through
      // separate asynchronous callbacks. Retry the same authorized user
      // action; the caller still fails closed with diagnostics if none render.
    }
  }
  return false;
}

/** Screenshot helper: <scenario-id>_<timestamp>_<viewport>_<locale>.png */
async function shot(page, scenarioId, viewport, locale) {
  const filename = `${scenarioId}_${new Date().toISOString().replace(/[:.]/g, '-')}_${viewport}_${locale}.png`;
  const fullPath = path.join(SCREENSHOT_DIR, filename);
  await page.screenshot({ path: fullPath, fullPage: false });
  return path.relative(ROOT, fullPath);
}

let idemCounter = 0;
function nextIdempotencyKey() {
  idemCounter += 1;
  return `p03-browser-${process.pid}-${idemCounter}`;
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

async function scenarioLoginLogoutSession() {
  const { base, stop } = await boot('login-logout');
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 900 });
    await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForAppInit(page);

    await loginAs(page, 'owner', STRONG_PASSWORD);
    const bootstrap = await page.evaluate(() => window.__octagonBootstrap);
    assert.ok(bootstrap && bootstrap.success, 'owner bootstrap applied after login');

    const cookieValue = await getSessionCookie(page, base);
    assert.ok(cookieValue, 'session cookie issued on login');

    // The live session can read the canonical finance surface.
    const before = await apiFetch(base, cookieValue, 'GET', '/api/v1/finance/accounts');
    assert.strictEqual(before.res.status, 200, `live session reads finance/accounts: ${before.res.status}`);

    await logout(page);
    const overlayVisible = await page.evaluate(() => {
      const el = document.getElementById('loginOverlay');
      const intro = document.getElementById('introScreen');
      return (el && window.getComputedStyle(el).display !== 'none') || (intro && window.getComputedStyle(intro).display !== 'none');
    });
    assert.ok(overlayVisible, 'login overlay reappears after logout');

    const session = await apiFetch(base, cookieValue, 'GET', '/api/auth/session');
    assert.strictEqual(session.payload.authenticated, false, 'server reports session unauthenticated after logout');

    const after = await apiFetch(base, cookieValue, 'GET', '/api/v1/finance/accounts');
    assert.strictEqual(after.res.status, 401, `revoked session denied on finance/accounts: ${after.res.status}`);

    const shotPath = await shot(page, 'P03-BR-01', 'desktop-1366', 'ar');
    return { screenshots: [shotPath] };
  } finally {
    await browser.close();
    await stop();
  }
}

async function scenarioFinanceNavigation() {
  const { base, stop } = await boot('finance-nav', { seedFinance: true });
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 900 });
    await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForAppInit(page);

    await loginAs(page, 'owner', STRONG_PASSWORD);

    // Real user flow: navigate to the finance page first — the render path
    // re-applies UI permissions (renderJournalEntryTab → enforceUIPermissions),
    // which is what settles the nav button after the async post-login user
    // resolution. (Observation recorded in the results: in a fresh disposable
    // store the nav button can stay stale-hidden until the first post-login
    // render; it self-heals on navigation and never fails OPEN.)
    const financeRendered = await navigateUntilRendered(page, 'finance');
    if (!financeRendered) {
      const diagnostics = await page.evaluate(() => {
        const el = document.getElementById('pageFinance');
        const user = window.PentagonAuth?.getCurrentUser?.();
        return {
          currentPage: typeof currentPage !== 'undefined' ? currentPage : 'n/a',
          display: el ? window.getComputedStyle(el).display : null,
          htmlLength: el?.innerHTML.trim().length || 0,
          user: user ? { id: user.id, groups: user.groups } : null,
          checkPageFinance: window.PermissionService?.checkPage?.('finance') ?? 'n/a',
        };
      });
      assert.fail(`finance page renders for owner; diagnostics: ${JSON.stringify(diagnostics)}`);
    }

    // The sidebar is domain-tabbed: the finance button lives in the 'finance'
    // nav domain (group finance_accounts), hidden until the user activates the
    // المالية domain tab — follow the real user flow first.
    await page.evaluate(() => {
      const tab = document.querySelector('.module-domain-tab[data-nav-domain="finance"]');
      if (tab) tab.click();
      else if (typeof setNavDomain === 'function') setNavDomain('finance');
    });

    // Post-login render is asynchronous (bootstrap + permission application);
    // poll for the nav button instead of asserting on a fixed instant.
    let navDiagnostics = null;
    try {
      await page.waitForFunction(() => {
        const el = document.querySelector('.nav-btn[data-page="finance"]');
        return el && window.getComputedStyle(el).display !== 'none';
      }, { timeout: 20000, polling: 500 });
    } catch (waitErr) {
      navDiagnostics = await page.evaluate(() => {
        const el = document.querySelector('.nav-btn[data-page="finance"]');
        const chain = [];
        let node = el;
        while (node && chain.length < 6) {
          chain.push(`${node.tagName}#${node.id || ''}.${String(node.className || '').split(' ')[0]}:${window.getComputedStyle(node).display}`);
          node = node.parentElement;
        }
        const cached = window.PentagonDB?.getCached?.();
        const omniUsers = cached?.omni?.users || cached?.['omni.users'] || [];
        const current = window.PentagonAuth?.getCurrentUser?.() || null;
        let afterReapply = null;
        try {
          if (typeof enforceUIPermissions === 'function') enforceUIPermissions();
          afterReapply = el ? window.getComputedStyle(el).display : null;
        } catch (e) { afterReapply = `error: ${e.message}`; }
        return {
          exists: !!el,
          display: el ? window.getComputedStyle(el).display : null,
          chain,
          bootstrap: !!window.__octagonBootstrap,
          dataLoadComplete: window.__dataLoadComplete === true,
          currentUser: current ? { id: current.id, role: current.role, roleId: current.roleId, groups: current.groups } : null,
          omniUserIds: Array.isArray(omniUsers) ? omniUsers.map(u => u.id) : String(typeof omniUsers),
          checkPageFinance: window.PermissionService?.checkPage ? window.PermissionService.checkPage('finance') : 'n/a',
          afterReapply,
        };
      });
    }
    assert.ok(navDiagnostics === null, `finance nav button is visible for owner; diagnostics: ${JSON.stringify(navDiagnostics)}`);

    const title = await page.evaluate(() => document.querySelector('#pageFinance .page-title')?.textContent || '');
    assert.ok(title.includes('الداشبورد المالي'), `finance page renders its Arabic title, got: ${title.trim()}`);

    const shotPath = await shot(page, 'P03-BR-02', 'desktop-1366', 'ar');
    return {
      screenshots: [shotPath],
      notes: [
        'Observation (UI timing, fails closed): in a fresh disposable store the finance nav button can remain hidden ' +
        'immediately after login until the first post-login render re-applies permissions (enforceUIPermissions). ' +
        'It self-heals on navigation and never fails open. Recorded for Phase 04 hardening backlog.',
      ],
    };
  } finally {
    await browser.close();
    await stop();
  }
}

async function scenarioRoleBasedDenial() {
  const { base, stop } = await boot('role-denial', { seedFinance: true, clerkApiWriter: true });
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 900 });
    await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForAppInit(page);

    await loginAs(page, 'clerk', STRONG_PASSWORD);
    // The platform bootstrap is fetched asynchronously after login; wait for it
    // rather than asserting on a fixed instant.
    await page.waitForFunction(() => {
      const b = window.__octagonBootstrap;
      return b && b.success === true;
    }, { timeout: 20000, polling: 500 });
    const bootstrap = await page.evaluate(() => window.__octagonBootstrap);
    assert.ok(bootstrap && bootstrap.success, 'clerk bootstrap applied after login');

    // Menu-gating reality check: app.js PLATFORM_PAGE_NAV_MAP does not gate
    // the finance nav button, so we prove the denial at the API layer from
    // the page context instead (and record the UI gap in the results).
    const financeNavVisibleForClerk = await page.evaluate(() => {
      const el = document.querySelector('.nav-btn[data-page="finance"]');
      return el ? window.getComputedStyle(el).display !== 'none' : false;
    });

    // Prove the clerk's db:read grant is live so the finance denial below is
    // attributable to the missing finance permission, not a dead session.
    const meta = await page.evaluate(async () => {
      const res = await fetch('/api/v1/meta/entities', { credentials: 'same-origin' });
      return { status: res.status };
    });
    assert.strictEqual(meta.status, 200, `clerk holds platform:db:read (meta/entities): ${meta.status}`);

    // API-level denial from the page context: finance_account:create requires
    // the action's declared finance permission, which the clerk lacks.
    const denied = await page.evaluate(async (idemKey) => {
      const res = await fetch('/api/v1/action/finance_account:create', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'x-idempotency-key': idemKey },
        body: JSON.stringify({ code: '199888', name: 'Clerk Browser Attempt', type: 'asset' }),
      });
      const payload = await res.json().catch(() => ({}));
      return { status: res.status, success: payload.success ?? null };
    }, nextIdempotencyKey());
    assert.strictEqual(denied.status, 403, `clerk finance action denied from page context: ${JSON.stringify(denied)}`);
    assert.strictEqual(denied.success, false, 'denial envelope carries success=false');

    const shotPath = await shot(page, 'P03-BR-03', 'desktop-1366', 'ar');
    return {
      screenshots: [shotPath],
      notes: [
        'Menu gating (app.js PLATFORM_PAGE_NAV_MAP) does not cover the finance nav button; ' +
        `finance nav visible for clerk: ${financeNavVisibleForClerk}. ` +
        'Denial is therefore proven at the API layer from the page context (403 on finance_account:create).',
      ],
    };
  } finally {
    await browser.close();
    await stop();
  }
}

async function scenarioFinancePageCleanRender() {
  const { base, stop } = await boot('finance-render', { seedFinance: true });
  const browser = await launchBrowser();
  let collector;
  try {
    const page = await browser.newPage();
    collector = createErrorCollector(page);
    await page.setViewport({ width: 1366, height: 900 });
    await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForAppInit(page);

    await loginAs(page, 'owner', STRONG_PASSWORD);
    assert.equal(await navigateUntilRendered(page, 'finance'), true, 'Finance page settles after authorized login');

    // Walk every finance tab so all legacy-backed finance views render.
    for (const tab of ['journal', 'trial_balance', 'pl', 'ledger', 'dashboard']) {
      await page.evaluate((t) => { if (typeof switchFinanceTab === 'function') switchFinanceTab(t); }, tab);
      await new Promise(r => setTimeout(r, 500));
    }

    assert.strictEqual(collector.pageErrors.length, 0,
      `no uncaught pageerror on finance page; got: ${collector.pageErrors.join(' | ')}`);
    assert.strictEqual(collector.consoleErrors.length, 0,
      `no non-allowlisted console errors on finance page; got: ${collector.consoleErrors.join(' | ')}`);

    const shotPath = await shot(page, 'P03-BR-04', 'desktop-1366', 'ar');
    return {
      screenshots: [shotPath],
      consoleErrors: collector.consoleErrors.length,
      pageErrors: collector.pageErrors.length,
      allowlistedConsoleErrors: collector.allowlisted.length,
    };
  } finally {
    await browser.close();
    await stop();
  }
}

async function scenarioCanonicalRoundTripFromPage() {
  const { base, stop } = await boot('canonical-roundtrip', { seedFinance: true });
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 900 });
    await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForAppInit(page);

    await loginAs(page, 'owner', STRONG_PASSWORD);

    // Pin the active company context to c_alpha_1 (owner's default company)
    // so the governed action resolves its company scope deterministically.
    const ctxSwitch = await page.evaluate(async () => {
      const res = await fetch('/api/auth/context', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: 'c_alpha_1' }),
      });
      return { status: res.status };
    });
    assert.strictEqual(ctxSwitch.status, 200, `context switch to c_alpha_1: ${ctxSwitch.status}`);

    const accountCode = `1997${String(Math.floor(Math.random() * 100)).padStart(2, '0')}`;
    const created = await page.evaluate(async ({ code, idemKey }) => {
      const res = await fetch('/api/v1/action/finance_account:create', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'x-idempotency-key': idemKey },
        body: JSON.stringify({ code, name: 'Browser Evidence Clearing', type: 'asset' }),
      });
      const payload = await res.json().catch(() => ({}));
      return { status: res.status, success: payload.success ?? null, dataCode: payload.data?.code ?? null };
    }, { code: accountCode, idemKey: nextIdempotencyKey() });
    assert.strictEqual(created.status, 200, `finance_account:create from page context: ${JSON.stringify(created)}`);
    assert.strictEqual(created.success, true, 'action envelope success=true');
    assert.strictEqual(created.dataCode, accountCode, 'created account code echoed back');

    const accounts = await page.evaluate(async () => {
      const res = await fetch('/api/v1/finance/accounts', { credentials: 'same-origin' });
      const payload = await res.json().catch(() => ({}));
      return { status: res.status, codes: (payload.data || []).map(a => a.code) };
    });
    assert.strictEqual(accounts.status, 200, `GET finance/accounts from page context: ${accounts.status}`);
    assert.ok(accounts.codes.includes(accountCode),
      `created account ${accountCode} readable through canonical query (total ${accounts.codes.length} accounts)`);
    assert.ok(accounts.codes.includes('101000'), 'seeded COA (101000 Cash) present through canonical query');

    const shotPath = await shot(page, 'P03-BR-05', 'desktop-1366', 'ar');
    return {
      screenshots: [shotPath],
      notes: [`created account code: ${accountCode}`, `accounts visible: ${accounts.codes.length}`],
    };
  } finally {
    await browser.close();
    await stop();
  }
}

async function scenarioUnauthenticatedDenial() {
  const { base, stop } = await boot('anon-denial', { seedFinance: true });
  const browser = await launchBrowser();
  try {
    // Fresh browser context => no session cookie is shared with anything.
    const anonContext = await browser.createBrowserContext();
    const page = await anonContext.newPage();
    await page.setViewport({ width: 1366, height: 900 });
    await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForAppInit(page);

    const query = await page.evaluate(async () => {
      const res = await fetch('/api/v1/finance/accounts', { credentials: 'same-origin' });
      return { status: res.status };
    });
    assert.strictEqual(query.status, 401, `unauthenticated finance query denied: ${query.status}`);

    const action = await page.evaluate(async (idemKey) => {
      const res = await fetch('/api/v1/action/finance_account:create', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'x-idempotency-key': idemKey },
        body: JSON.stringify({ code: '199999', name: 'Anon Attempt', type: 'asset' }),
      });
      return { status: res.status };
    }, nextIdempotencyKey());
    assert.strictEqual(action.status, 401, `unauthenticated finance action denied: ${action.status}`);

    const shotPath = await shot(page, 'P03-BR-06', 'desktop-1366', 'ar');
    await anonContext.close();
    return { screenshots: [shotPath] };
  } finally {
    await browser.close();
    await stop();
  }
}

async function scenarioRtlLtrLocale() {
  const { base, stop } = await boot('locale', { seedFinance: true });
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 900 });
    await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForAppInit(page);

    await loginAs(page, 'owner', STRONG_PASSWORD);
    assert.equal(await navigateUntilRendered(page, 'finance'), true, 'Finance page settles after authorized login');

    const before = await page.evaluate(() => ({
      lang: document.documentElement.getAttribute('lang'),
      dir: document.documentElement.getAttribute('dir'),
      title: document.querySelector('#pageFinance .page-title')?.textContent || '',
    }));
    assert.strictEqual(before.lang, 'ar', 'document language is Arabic');
    assert.strictEqual(before.dir, 'rtl', 'document direction is RTL');
    assert.ok(/[؀-ۿ]/.test(before.title), 'finance page renders Arabic strings in RTL mode');

    const rtlShot = await shot(page, 'P03-BR-07', 'desktop-1366', 'ar');

    // English/LTR switch exists in the shell (#omniLanguageToggle, proven by
    // the phase02 suite); exercise it on the finance page.
    await page.waitForSelector('#omniLanguageToggle', { timeout: 10000 });
    await page.click('#omniLanguageToggle');
    await new Promise(r => setTimeout(r, 500));

    const after = await page.evaluate(() => ({
      lang: document.documentElement.getAttribute('lang'),
      dir: document.documentElement.getAttribute('dir'),
    }));
    assert.strictEqual(after.lang, 'en', 'language switched to English');
    assert.strictEqual(after.dir, 'ltr', 'direction switched to LTR');

    const ltrShot = await shot(page, 'P03-BR-07', 'desktop-1366', 'en');
    return { screenshots: [rtlShot, ltrShot] };
  } finally {
    await browser.close();
    await stop();
  }
}

async function scenarioViewports() {
  const browser = await launchBrowser();
  const screenshots = [];
  const perViewport = [];
  try {
    const viewports = [
      { name: 'desktop-1366', width: 1366, height: 900 },
      { name: 'mobile-375', width: 375, height: 812 },
    ];
    for (const vp of viewports) {
      // One disposable server per viewport keeps the evidence isolated from
      // optimistic-write versions and prior authenticated browser sessions.
      const { base, stop } = await boot(`viewports-${vp.name}`, { seedFinance: true });
      const page = await browser.newPage();
      const collector = createErrorCollector(page);
      try {
      await page.setViewport({ width: vp.width, height: vp.height });
      await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await waitForAppInit(page);
      await loginAs(page, 'owner', STRONG_PASSWORD);
      // The client-side user resolution settles asynchronously after login and
      // the exact settle point is flaky across runs; retry the navigation (as
      // a real user would) until switchPage('finance') actually takes effect
      // instead of falling back to calculator→timesheet.
      let switched = false;
      for (let attempt = 0; attempt < 30 && !switched; attempt++) {
        await navigateToPage(page, 'finance');
        await new Promise(r => setTimeout(r, 1000));
        switched = await page.evaluate(() => typeof currentPage !== 'undefined' && currentPage === 'finance');
      }
      if (!switched) {
        const navDiag = await page.evaluate(() => ({
          currentPage: typeof currentPage !== 'undefined' ? currentPage : 'n/a',
          checkPageFinance: window.PermissionService?.checkPage ? window.PermissionService.checkPage('finance') : 'n/a',
          currentUser: (() => { const u = window.PentagonAuth?.getCurrentUser?.(); return u ? { id: u.id, groups: u.groups } : null; })(),
          storedUserId: localStorage.getItem('octagon_user_id'),
          serverSession: window.__octagonServerSession ? { authenticated: window.__octagonServerSession.authenticated, mode: window.__octagonServerSession.mode } : null,
        }));
        throw new Error(`${vp.name}: finance page became active after post-login settle; diagnostics: ${JSON.stringify(navDiag)}`);
      }
      try {
        await assertPageRendered(page, 'finance');
      } catch (renderErr) {
        const diag = await page.evaluate(() => {
          const el = document.getElementById('pageFinance');
          return {
            exists: !!el,
            display: el ? window.getComputedStyle(el).display : null,
            htmlLength: el ? el.innerHTML.trim().length : -1,
            currentPage: typeof currentPage !== 'undefined' ? currentPage : 'n/a',
            dataLoadComplete: window.__dataLoadComplete === true,
          };
        });
        throw new Error(`${vp.name}: finance page did not render; diagnostics: ${JSON.stringify(diag)}; cause: ${renderErr.message}`);
      }

      const shellState = await page.evaluate(() => {
        const sidebar = document.querySelector('.sidebar');
        const toggle = document.getElementById('sidebarToggleBtn');
        return {
          sidebarMounted: Boolean(sidebar),
          sidebarVisible: sidebar
            ? window.getComputedStyle(sidebar).display !== 'none'
              && window.getComputedStyle(sidebar).pointerEvents !== 'none'
            : false,
          toggleVisible: toggle ? window.getComputedStyle(toggle).display !== 'none' : false,
          collapsed: document.body.classList.contains('sidebar-collapsed'),
        };
      });
      assert.ok(shellState.sidebarMounted, `${vp.name}: sidebar is mounted`);
      if (vp.width <= 768) {
        assert.equal(shellState.collapsed, true, `${vp.name}: off-canvas sidebar starts closed`);
        assert.ok(shellState.toggleVisible, `${vp.name}: drawer toggle is visible`);
        await page.click('#sidebarToggleBtn');
        await page.waitForFunction(() => !document.body.classList.contains('sidebar-collapsed'));
      } else {
        assert.ok(shellState.sidebarVisible, `${vp.name}: desktop sidebar is visible`);
      }
      assert.strictEqual(collector.pageErrors.length, 0,
        `${vp.name}: no pageerror during finance render; got ${collector.pageErrors.join(' | ')}`);
      assert.strictEqual(collector.consoleErrors.length, 0,
        `${vp.name}: no non-allowlisted console errors; got ${collector.consoleErrors.join(' | ')}`);

      screenshots.push(await shot(page, 'P03-BR-08', vp.name, 'ar'));
      perViewport.push({
        viewport: vp.name,
        consoleErrors: collector.consoleErrors.length,
        pageErrors: collector.pageErrors.length,
        allowlistedConsoleErrors: collector.allowlisted.length,
      });
      } finally {
        await page.close();
        await stop();
      }
    }
    return {
      screenshots,
      perViewport,
      notes: [
        'Each viewport runs against a fresh disposable server and canonical identity session. ' +
        'At 768px and below the shell is verified as a closed off-canvas drawer with a visible toggle.',
      ],
    };
  } finally {
    await browser.close();
  }
}

async function scenarioUnrelatedPageRegression() {
  const { base, stop } = await boot('regression', { seedFinance: true });
  const browser = await launchBrowser();
  let collector;
  try {
    const page = await browser.newPage();
    collector = createErrorCollector(page);
    await page.setViewport({ width: 1366, height: 900 });
    await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForAppInit(page);

    await loginAs(page, 'owner', STRONG_PASSWORD);

    // Perform a real finance operation first (canonical action from the page).
    await page.evaluate(async () => {
      await fetch('/api/auth/context', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: 'c_alpha_1' }),
      });
    });
    const created = await page.evaluate(async (idemKey) => {
      const res = await fetch('/api/v1/action/finance_account:create', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'x-idempotency-key': idemKey },
        body: JSON.stringify({ code: '199600', name: 'Regression Probe', type: 'asset' }),
      });
      return { status: res.status };
    }, nextIdempotencyKey());
    assert.strictEqual(created.status, 200, `finance operation before regression check: ${created.status}`);

    assert.equal(await navigateUntilRendered(page, 'finance'), true, 'Finance page settles after authorized login');

    await navigateToPage(page, 'timesheet');
    await assertPageRendered(page, 'timesheet');
    const timesheetContent = await page.evaluate(() => document.getElementById('pageTimesheet')?.textContent || '');
    assert.ok(timesheetContent.length > 0, 'timesheet page has content after finance operations');

    await navigateToPage(page, 'employees');
    await assertPageRendered(page, 'employees');
    const employeesContent = await page.evaluate(() => document.getElementById('pageEmployees')?.textContent || '');
    assert.ok(employeesContent.length > 0, 'employees page has content after finance operations');

    assert.strictEqual(collector.pageErrors.length, 0,
      `no uncaught pageerror on unrelated pages; got: ${collector.pageErrors.join(' | ')}`);

    const shotPath = await shot(page, 'P03-BR-09', 'desktop-1366', 'ar');
    return {
      screenshots: [shotPath],
      consoleErrors: collector.consoleErrors.length,
      pageErrors: collector.pageErrors.length,
      allowlistedConsoleErrors: collector.allowlisted.length,
    };
  } finally {
    await browser.close();
    await stop();
  }
}

// ---------------------------------------------------------------------------
// Runner with machine-readable results
// ---------------------------------------------------------------------------

const SCENARIOS = [
  { id: 'P03-BR-01', name: 'login and logout issue and revoke the session cookie', viewport: 'desktop-1366', locale: 'ar', fn: scenarioLoginLogoutSession },
  { id: 'P03-BR-02', name: 'finance navigation renders for an authorized user', viewport: 'desktop-1366', locale: 'ar', fn: scenarioFinanceNavigation },
  { id: 'P03-BR-03', name: 'role-based denial proven from the page context (API-level)', viewport: 'desktop-1366', locale: 'ar', fn: scenarioRoleBasedDenial },
  { id: 'P03-BR-04', name: 'finance page renders with no pageerror and no console errors', viewport: 'desktop-1366', locale: 'ar', fn: scenarioFinancePageCleanRender },
  { id: 'P03-BR-05', name: 'canonical runtime round trip from the page context', viewport: 'desktop-1366', locale: 'ar', fn: scenarioCanonicalRoundTripFromPage },
  { id: 'P03-BR-06', name: 'unauthenticated fetch to finance API is denied (401)', viewport: 'desktop-1366', locale: 'ar', fn: scenarioUnauthenticatedDenial },
  { id: 'P03-BR-07', name: 'Arabic RTL render and English LTR switch', viewport: 'desktop-1366', locale: 'ar+en', fn: scenarioRtlLtrLocale },
  { id: 'P03-BR-08', name: 'desktop and mobile viewports render the finance page', viewport: 'desktop-1366+mobile-375', locale: 'ar', fn: scenarioViewports },
  { id: 'P03-BR-09', name: 'unrelated pages still render after finance operations', viewport: 'desktop-1366', locale: 'ar', fn: scenarioUnrelatedPageRegression },
];

const requested = String(process.env.OCTAGON_BROWSER_TEST_FILTER || '').trim().toLowerCase();
const selected = requested
  ? SCENARIOS.filter(s => s.id.toLowerCase().includes(requested) || s.name.toLowerCase().includes(requested))
  : SCENARIOS;

const scenarioResults = [];
let passed = 0;
console.log(`\n=== Phase 03 / live browser finance evidence (Puppeteer) ===`);
console.log(`git: ${GIT_BRANCH}@${GIT_COMMIT}`);
for (const scenario of selected) {
  const startedAt = new Date();
  const record = {
    id: scenario.id,
    name: scenario.name,
    viewport: scenario.viewport,
    locale: scenario.locale,
    startedAt: startedAt.toISOString(),
    status: 'FAIL',
    durationMs: null,
    consoleErrors: null,
    pageErrors: null,
    screenshots: [],
    notes: [],
    error: null,
  };
  try {
    const detail = (await scenario.fn()) || {};
    record.status = 'PASS';
    record.screenshots = detail.screenshots || [];
    record.notes = detail.notes || [];
    if (detail.consoleErrors !== undefined) record.consoleErrors = detail.consoleErrors;
    if (detail.pageErrors !== undefined) record.pageErrors = detail.pageErrors;
    if (detail.allowlistedConsoleErrors !== undefined) record.allowlistedConsoleErrors = detail.allowlistedConsoleErrors;
    if (detail.perViewport) record.perViewport = detail.perViewport;
    passed++;
    console.log(`PASS: ${scenario.id} ${scenario.name}`);
  } catch (error) {
    record.error = String(error?.stack || error);
    console.error(`FAIL: ${scenario.id} ${scenario.name}\n      ${error?.stack || error}`);
  } finally {
    record.durationMs = Date.now() - startedAt.getTime();
    record.finishedAt = new Date().toISOString();
    scenarioResults.push(record);
  }
}

const resultsDoc = {
  suite: 'phase-03/finance-browser-evidence',
  generatedBy: 'tests/phase03/finance-browser-evidence.test.mjs',
  runCommand: 'node tests/phase03/finance-browser-evidence.test.mjs',
  runStartedAt: RUN_STARTED.toISOString(),
  runFinishedAt: new Date().toISOString(),
  durationMs: Date.now() - RUN_STARTED.getTime(),
  git: { branch: GIT_BRANCH, commit: GIT_COMMIT },
  consoleErrorAllowlist: String(CONSOLE_ERROR_ALLOWLIST),
  totals: { scenarios: selected.length, passed, failed: selected.length - passed },
  scopeNote: 'Proves the SPA shell plus the canonical Browser->API->Phase02-authz->finance-engine path. ' +
    'Most finance UI remains legacy-backed; fiscal close UI, reversal UI, bank import UI, payments UI, ' +
    'budget UI and report cutover are NOT covered by this suite.',
  scenarios: scenarioResults,
};

const resultsPath = path.join(RESULTS_DIR, `finance-browser-evidence_${RUN_ID}.json`);
fs.writeFileSync(resultsPath, JSON.stringify(resultsDoc, null, 2));

console.log(`\nPhase 03 / live browser finance evidence: ${passed}/${selected.length} passed`);
console.log(`Screenshots saved to: ${SCREENSHOT_DIR}`);
console.log(`Results JSON saved to: ${resultsPath}`);

if (passed !== selected.length) {
  process.exitCode = 1;
}
