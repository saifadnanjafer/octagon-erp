// Permanent regression coverage for the Navigation Visual Recovery 2 closure
// defect: switchPage('workshop_readiness') left the previously active
// Build12 self-rendered host (workshop_pack_setup) visible because core
// switchPage only stripped the .page-active CLASS, while Build10/11/12 hosts
// additionally rely on an inline style.display to toggle visibility — an
// inline style always beats a CSS class rule, so the stale host stayed on
// screen. See docs/navigation/NAVIGATION-VISUAL-RECOVERY-2-ROOT-CAUSE.md.
//
// Drives the REAL application (server.js + index.html + app.js + every
// Build10/11/12 module wrapped around the real core switchPage) through real
// visible Puppeteer clicks — no direct switchPage() calls — against the
// disposable review environment. Requires `npm run review:setup` to have run
// once and a review server already listening (matching the precondition
// scripts/navigation/run-click-audit.mjs already assumes for test:navigation).
import assert from 'node:assert/strict';
import test from 'node:test';
import puppeteer from 'puppeteer';

const baseUrl = process.env.NAV_AUDIT_URL || 'http://127.0.0.1:8091';
const reviewPassword = 'Octagon123!'; // disposable local review fixture only

const NAV = {
  workshop_pack_setup: { domain: 'commercial', group: 'commercial_verticals' },
  workshop_readiness: { domain: 'ops', group: 'ops_control' },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const selectorFor = (attribute, value) => `[${attribute}="${String(value).replaceAll('"', '\\"')}"]`;

// The review fixture is a small, permission-scoped dataset: browsing any page
// in this app legitimately triggers background requests (notifications,
// activity feed, saved views, ...) that the fixture answers with expected
// 400/401/403/404s, plus a guarded "empty employees" persistence warning —
// see docs/navigation/NAVIGATION-VISUAL-RECOVERY-2-ROOT-CAUSE.md's console
// noise classification. None of that indicates a navigation defect. Only
// genuinely unexpected failures (server 500s, unhandled rejections, thrown
// TypeErrors) should fail this regression.
function unexpectedConsoleErrors(consoleErrors) {
  return consoleErrors.filter((message) => (
    /status of 500/.test(message)
    || /unhandled promise rejection/i.test(message)
    || /TypeError/.test(message)
  ));
}

async function assertReviewServerReachable() {
  try {
    const response = await fetch(baseUrl, { method: 'GET' });
    if (!response.ok && response.status !== 304) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    throw new Error(
      `Review server not reachable at ${baseUrl}. Run "npm run review:setup" once, then ` +
      `"PORT=8091 npm run review:start" before this test (same precondition as test:navigation). ` +
      `Underlying error: ${error.message}`
    );
  }
}

async function authenticate(page) {
  const result = await page.evaluate(async (password) => {
    const login = await fetch('/api/auth/login', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'review.sysadmin', password })
    });
    const body = await login.json().catch(() => ({}));
    if (!login.ok || !body.authenticated) return { ok: false, status: login.status };
    await fetch('/api/auth/context', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId: 'c_alwarsha_demo', branchId: 'b_alwarsha_demo_main' })
    });
    localStorage.setItem('octagon_user_id', body.user?.id || 'usr_review_sysadmin');
    localStorage.setItem('pentagon_user_id', body.user?.id || 'usr_review_sysadmin');
    return { ok: true, status: login.status };
  }, reviewPassword);
  if (!result.ok) throw new Error(`review authentication failed (HTTP ${result.status})`);
}

async function clickVisible(page, selector) {
  const locator = page.locator(selector);
  await locator.wait({ state: 'visible', timeout: 5000 });
  await locator.click({ timeout: 5000 });
  await sleep(120);
}

async function goTo(page, pageId) {
  const meta = NAV[pageId];
  await clickVisible(page, `.module-domain-tab${selectorFor('data-nav-domain', meta.domain)}`);
  const group = `[data-nav-group="${meta.group}"]`;
  const isCollapsed = await page.$eval(group, (element) => element.classList.contains('collapsed'));
  if (isCollapsed) await clickVisible(page, `${group} .nav-group-toggle`);
  await clickVisible(page, `${group} .nav-btn${selectorFor('data-page', pageId)}`);
  await sleep(250);
}

// Captures exactly the fields the closure spec requires: nav-active state,
// top-level domain, sidebar group, the destination workspace's visibility,
// and whether the PREVIOUS page's host (own class + inline style) leaked
// through — the exact mechanism of the original defect.
async function captureTerminalState(page, pageId, previousPageId) {
  return page.evaluate(({ id, previousId }) => {
    const navButton = document.querySelector(`.nav-btn[data-page="${CSS.escape(id)}"]`);
    const domainTab = document.querySelector('.module-domain-tab.active');
    const group = navButton ? navButton.closest('[data-nav-group]') : null;
    const activePages = [...document.querySelectorAll('.page')].filter((el) => el.classList.contains('page-active'));
    const visiblePages = [...document.querySelectorAll('.page')].filter((el) => getComputedStyle(el).display !== 'none');
    const destination = document.querySelector('.page.page-active')
      || visiblePages.find((el) => (el.id === (previousId ? null : undefined)) || true);
    const previousHost = previousId
      ? (document.querySelector(`[data-build10-page="${previousId}"].page`)
        || document.querySelector(`.b11-page[data-build11-page="${previousId}"]`)
        || document.querySelector(`.b12-page[data-build12-page="${previousId}"]`)
        || document.querySelector(`[data-page="${previousId}"].page`))
      : null;
    return {
      activeNav: !!navButton?.classList.contains('active'),
      activeDomain: domainTab?.dataset.navDomain || null,
      activeGroup: group?.dataset.navGroup || null,
      activePageCount: activePages.length,
      visiblePageCount: visiblePages.length,
      destinationVisible: Boolean(destination && getComputedStyle(destination).display !== 'none'),
      destinationHasContent: Boolean(destination?.textContent?.trim()),
      destinationTitle: destination?.querySelector('h1,h2,h3')?.textContent?.trim() || null,
      previousHostVisible: previousHost ? getComputedStyle(previousHost).display !== 'none' : false,
      previousHostHasPageActive: previousHost ? previousHost.classList.contains('page-active') : false,
    };
  }, { id: pageId, previousId: previousPageId || null });
}

test('workshop_pack_setup -> workshop_readiness: destination activates and the Build12 pack_setup host fully deactivates', async (t) => {
  await assertReviewServerReachable();
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 60000 });
  await authenticate(page);
  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate(() => {
    const overlay = document.getElementById('loginOverlay') || document.querySelector('.login-overlay, #systemLoginOverlay');
    if (overlay) overlay.style.display = 'none';
  });

  await goTo(page, 'workshop_pack_setup');
  const packState = await captureTerminalState(page, 'workshop_pack_setup', null);
  assert.equal(packState.activeNav, true, 'workshop_pack_setup nav item should be active immediately after landing on it');

  await goTo(page, 'workshop_readiness');
  const readinessState = await captureTerminalState(page, 'workshop_readiness', 'workshop_pack_setup');

  assert.equal(readinessState.activeNav, true, 'workshop_readiness nav item must be active');
  assert.equal(readinessState.activeDomain, 'ops', 'correct top-level domain (ops) must be active');
  assert.equal(readinessState.activeGroup, 'ops_control', 'correct sidebar group must be active');
  assert.equal(readinessState.destinationVisible, true, 'workshop_readiness workspace must be visible');
  assert.equal(readinessState.destinationHasContent, true, 'workshop_readiness must render non-empty content');
  assert.ok(readinessState.destinationTitle, 'workshop_readiness must render a non-empty title');
  assert.equal(readinessState.activePageCount, 1, 'exactly one canonical page workspace must be page-active');
  assert.equal(readinessState.previousHostVisible, false, 'workshop_pack_setup host must not remain visible');
  assert.equal(readinessState.previousHostHasPageActive, false, 'workshop_pack_setup host must not keep page-active');

  // Delayed stale-reactivation check: Build12's activation is scheduled via a
  // microtask after switchPage returns. Wait past any such deferred callback
  // and assert nothing has reasserted the old page's visibility since.
  await sleep(1500);
  const delayedState = await captureTerminalState(page, 'workshop_readiness', 'workshop_pack_setup');
  assert.equal(delayedState.destinationVisible, true, 'workshop_readiness must remain active after a delay');
  assert.equal(delayedState.previousHostVisible, false, 'no stale callback may reactivate workshop_pack_setup after a delay');
  assert.equal(delayedState.activePageCount, 1, 'still exactly one active page workspace after the delay');

  const unexpected = unexpectedConsoleErrors(consoleErrors);
  assert.equal(unexpected.length, 0, `unexpected console errors (500 / unhandled rejection / TypeError):\n${unexpected.join('\n')}`);
});

test('workshop_readiness -> workshop_pack_setup (reverse transition) also fully deactivates the previous page', async (t) => {
  await assertReviewServerReachable();
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 60000 });
  await authenticate(page);
  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate(() => {
    const overlay = document.getElementById('loginOverlay') || document.querySelector('.login-overlay, #systemLoginOverlay');
    if (overlay) overlay.style.display = 'none';
  });

  await goTo(page, 'workshop_readiness');
  await goTo(page, 'workshop_pack_setup');
  const packState = await captureTerminalState(page, 'workshop_pack_setup', 'workshop_readiness');

  assert.equal(packState.activeNav, true, 'workshop_pack_setup nav item must be active');
  assert.equal(packState.activeDomain, 'commercial', 'correct top-level domain (commercial) must be active');
  assert.equal(packState.destinationVisible, true, 'workshop_pack_setup workspace must be visible');
  assert.equal(packState.destinationHasContent, true, 'workshop_pack_setup must render non-empty content');
  assert.equal(packState.activePageCount, 1, 'exactly one canonical page workspace must be page-active');
  assert.equal(packState.previousHostVisible, false, 'workshop_readiness host must not remain visible');
  assert.equal(packState.previousHostHasPageActive, false, 'workshop_readiness host must not keep page-active');

  await sleep(1500);
  const delayedState = await captureTerminalState(page, 'workshop_pack_setup', 'workshop_readiness');
  assert.equal(delayedState.destinationVisible, true, 'workshop_pack_setup must remain active after a delay');
  assert.equal(delayedState.previousHostVisible, false, 'no stale callback may reactivate workshop_readiness after a delay');

  const unexpected = unexpectedConsoleErrors(consoleErrors);
  assert.equal(unexpected.length, 0, `unexpected console errors (500 / unhandled rejection / TypeError):\n${unexpected.join('\n')}`);
});
