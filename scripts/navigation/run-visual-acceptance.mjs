#!/usr/bin/env node
/* Navigation Recovery 2 — real Chromium geometry and responsive acceptance. */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const baseUrl = process.env.NAV_AUDIT_URL || 'http://127.0.0.1:8091';
const phase = process.env.NAV_VISUAL_PHASE === 'before' ? 'before' : 'after';
const artifactDir = path.join(root, 'review-artifacts', 'navigation-visual-recovery-2');
const screenshotDir = path.join(artifactDir, phase);
const reportPath = path.join(artifactDir, `${phase}-report.json`);
const password = 'Octagon123!';
const viewports = [
  { name: 'ar-339x950', width: 339, height: 950, lang: 'ar' },
  { name: 'ar-390x844', width: 390, height: 844, lang: 'ar' },
  { name: 'en-390x844', width: 390, height: 844, lang: 'en' },
  { name: 'ar-1366x768', width: 1366, height: 768, lang: 'ar' },
  { name: 'en-1440x900', width: 1440, height: 900, lang: 'en' },
];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const isMobile = viewport => viewport.width <= 768;

async function authenticate(page, viewport) {
  await page.goto(`${baseUrl}/?navigationVisual=${phase}`, { waitUntil: 'networkidle2', timeout: 60000 });
  const result = await page.evaluate(async ({ password: loginPassword, lang }) => {
    const response = await fetch('/api/auth/login', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'review.sysadmin', password: loginPassword }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.authenticated) return { ok: false, status: response.status };
    await fetch('/api/auth/context', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId: 'c_alwarsha_demo', branchId: 'b_alwarsha_demo_main' }),
    });
    localStorage.setItem('octagon_user_id', body.user?.id || 'usr_review_sysadmin');
    localStorage.setItem('pentagon_user_id', body.user?.id || 'usr_review_sysadmin');
    localStorage.setItem('octagon_language', lang);
    localStorage.setItem('pentagon_language', lang);
    localStorage.setItem('octagon-sidebar-collapsed', '0');
    return { ok: true, status: response.status };
  }, { password, lang: viewport.lang });
  assert.equal(result.ok, true, `review authentication failed: HTTP ${result.status}`);
  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(450);
  await page.evaluate(lang => {
    if (typeof window.octagonSetLanguage === 'function') window.octagonSetLanguage(lang);
  }, viewport.lang);
  await sleep(300);
}

// Keep the browser interaction above explicit while avoiding a stale ElementHandle.
async function documentState(page, key) {
  return page.evaluate(property => document.body.classList.contains(property), key);
}

async function openSidebar(page, viewport) {
  if (!isMobile(viewport)) {
    await page.evaluate(() => {
      if (document.body.classList.contains('sidebar-collapsed')) window.toggleSidebarCompact();
    });
    return;
  }
  const initiallyClosed = await documentState(page, 'sidebar-collapsed');
  assert.equal(initiallyClosed, true, `${viewport.name}: mobile drawer must start closed`);
  await page.evaluate(() => window.toggleSidebarCompact());
  await sleep(240);
  assert.equal(await documentState(page, 'sidebar-collapsed'), false, `${viewport.name}: drawer did not open`);
}

async function setDomain(page, domain) {
  await page.evaluate(key => window.setNavDomain(key), domain);
  await sleep(90);
}

async function setAllGroups(page, open) {
  await page.evaluate(isOpen => {
    document.querySelectorAll('.sidebar-nav > .nav-group[data-nav-group]').forEach(group => {
      window.setNavGroupOpen(group.dataset.navGroup, isOpen);
    });
  }, open);
  await sleep(80);
}

async function geometry(page, viewport, domain) {
  return page.evaluate(({ viewport: view, domain: activeDomain }) => {
    const nav = document.querySelector('.sidebar-nav');
    const sidebar = document.querySelector('#sidebar');
    const main = document.querySelector('#mainContent');
    const groups = [...nav.children].filter(element => element.matches('.nav-group'));
    const visible = element => {
      const style = getComputedStyle(element);
      return !element.hidden && style.display !== 'none' && element.offsetHeight > 0;
    };
    const rect = element => {
      const value = element.getBoundingClientRect();
      return { x: value.x, y: value.y, right: value.right, bottom: value.bottom, width: value.width, height: value.height };
    };
    const visibleButtons = [...nav.querySelectorAll('.nav-btn[data-page]')].filter(visible);
    const activeGroups = groups.filter(group => !group.hidden);
    const inactiveGroups = groups.filter(group => group.hidden);
    const collapsedBodies = groups
      .filter(group => group.classList.contains('collapsed'))
      .map(group => ({ group: group.dataset.navGroup, height: group.querySelector('.nav-group-body')?.offsetHeight ?? -1 }));
    const emptyExpandedGroups = groups
      .filter(group => !group.hidden && !group.classList.contains('collapsed'))
      .filter(group => ![...group.querySelectorAll('.nav-btn[data-page]')].some(visible))
      .map(group => group.dataset.navGroup);
    const duplicatePageIds = [...new Set(visibleButtons.map(button => button.dataset.page))]
      .filter(pageId => visibleButtons.filter(button => button.dataset.page === pageId).length > 1);
    const labelProblems = visibleButtons
      .filter(button => {
        const label = button.querySelector('.nav-label');
        const labelRect = label?.getBoundingClientRect();
        const navRect = nav.getBoundingClientRect();
        return !label?.dataset.i18nAr?.trim()
          || !label?.dataset.i18nEn?.trim()
          || !labelRect
          || labelRect.left < navRect.left - 2
          || labelRect.right > navRect.right + 2;
      })
      .map(button => button.dataset.page);
    const headerProblems = activeGroups
      .filter(group => visible(group))
      .filter(group => {
        const span = group.querySelector('.nav-group-toggle span[data-i18n-ar]');
        return !span?.dataset.i18nAr?.trim() || !span?.dataset.i18nEn?.trim();
      })
      .map(group => group.dataset.navGroup);
    const visibleGroups = activeGroups.filter(visible);
    const gapPairs = visibleGroups.slice(0, -1).map((group, index) => {
      const next = visibleGroups[index + 1];
      return { from: group.dataset.navGroup, to: next.dataset.navGroup, gap: next.getBoundingClientRect().top - group.getBoundingClientRect().bottom };
    });
    const reviewControls = [...document.querySelectorAll('#pilotReviewLauncher, #pilotReviewDock')];
    const navButtons = visibleButtons.map(button => rect(button));
    const reviewOverlaps = reviewControls.filter(control => visible(control)).filter(control => {
      const a = control.getBoundingClientRect();
      return navButtons.some(b => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top);
    }).map(control => control.id);
    const childFlexProblems = [...sidebar.children]
      .filter(child => child !== nav)
      .filter(child => getComputedStyle(child).flexGrow === '1')
      .map(child => child.className || child.id || child.tagName);
    const groupViewportMinProblems = groups
      .filter(group => /vh|vw/.test(getComputedStyle(group).minHeight) || /vh|vw/.test(getComputedStyle(group.querySelector('.nav-group-body')).minHeight))
      .map(group => group.dataset.navGroup);
    const bodyOverflow = document.documentElement.scrollWidth - view.width;
    return {
      domain: activeDomain,
      dir: document.documentElement.dir,
      lang: document.documentElement.lang,
      navRoots: document.querySelectorAll('.sidebar-nav').length,
      activeDomainCount: new Set(activeGroups.map(group => group.dataset.navDomain)).size,
      activeGroupCount: activeGroups.length,
      inactiveNonZero: inactiveGroups.filter(group => group.offsetHeight !== 0).map(group => group.dataset.navGroup),
      collapsedBodies,
      emptyExpandedGroups,
      duplicatePageIds,
      headerProblems,
      labelProblems,
      navHorizontalOverflow: nav.scrollWidth - nav.clientWidth,
      bodyHorizontalOverflow: bodyOverflow,
      gapPairs,
      reviewDescendantRoots: reviewControls.filter(control => control.closest('.sidebar-nav')).map(control => control.id),
      reviewOverlaps,
      childFlexProblems,
      groupViewportMinProblems,
      sidebar: rect(sidebar),
      main: rect(main),
      drawer: { collapsed: document.body.classList.contains('sidebar-collapsed'), pointerEvents: getComputedStyle(sidebar).pointerEvents, transform: getComputedStyle(sidebar).transform },
      visiblePageIds: visibleButtons.map(button => button.dataset.page),
    };
  }, { viewport, domain });
}

function assertGeometry(snapshot, viewport, mode) {
  const prefix = `${viewport.name}/${snapshot.domain}/${mode}`;
  assert.equal(snapshot.navRoots, 1, `${prefix}: duplicate navigation roots`);
  assert.equal(snapshot.activeDomainCount, snapshot.activeGroupCount ? 1 : 0, `${prefix}: multiple active domain panels`);
  assert.deepEqual(snapshot.inactiveNonZero, [], `${prefix}: hidden domains reserve height`);
  assert.deepEqual(snapshot.collapsedBodies.filter(item => item.height !== 0), [], `${prefix}: collapsed body reserves height`);
  assert.deepEqual(snapshot.emptyExpandedGroups, [], `${prefix}: visible empty group`);
  assert.deepEqual(snapshot.duplicatePageIds, [], `${prefix}: duplicate visible page`);
  assert.deepEqual(snapshot.headerProblems, [], `${prefix}: bilingual group header missing`);
  assert.deepEqual(snapshot.labelProblems, [], `${prefix}: label missing or outside sidebar`);
  assert.ok(snapshot.navHorizontalOverflow <= 1, `${prefix}: sidebar nav horizontal overflow ${snapshot.navHorizontalOverflow}`);
  assert.ok(snapshot.bodyHorizontalOverflow <= 1, `${prefix}: viewport horizontal overflow ${snapshot.bodyHorizontalOverflow}`);
  assert.deepEqual(snapshot.reviewDescendantRoots, [], `${prefix}: review control inside sidebar nav`);
  assert.deepEqual(snapshot.reviewOverlaps, [], `${prefix}: review control overlaps navigation`);
  assert.deepEqual(snapshot.childFlexProblems, [], `${prefix}: sidebar child unexpectedly grows`);
  assert.deepEqual(snapshot.groupViewportMinProblems, [], `${prefix}: group has viewport minimum`);
  assert.ok(snapshot.gapPairs.every(pair => pair.gap <= 24), `${prefix}: unexplained group gap ${JSON.stringify(snapshot.gapPairs)}`);
  if (isMobile(viewport)) {
    assert.equal(snapshot.drawer.collapsed, false, `${prefix}: drawer is not open`);
    assert.equal(snapshot.drawer.pointerEvents, 'auto', `${prefix}: open drawer is not interactive`);
    assert.ok(snapshot.main.width >= viewport.width - 1, `${prefix}: mobile content does not occupy viewport`);
  }
}

async function capture(page, viewport, domain) {
  fs.mkdirSync(screenshotDir, { recursive: true });
  const name = `${viewport.name}-${domain}.png`;
  await page.screenshot({ path: path.join(screenshotDir, name), fullPage: false });
  return name;
}

async function main() {
  fs.mkdirSync(artifactDir, { recursive: true });
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(String(error?.message || error)));
  const results = [];
  try {
    for (const viewport of viewports) {
      await page.setViewport({ width: viewport.width, height: viewport.height });
      await authenticate(page, viewport);
      await openSidebar(page, viewport);
      if (phase === 'before') {
        await page.addStyleTag({ content: 'html[dir="rtl"] #pilotReviewLauncher,html[dir="rtl"] #pilotReviewDock{right:22px!important}body:not(.sidebar-collapsed) #pilotReviewLauncher{display:inline-flex!important}' });
      }
      const domains = await page.evaluate(() => [...document.querySelectorAll('.module-domain-tab[data-nav-domain]')].map(button => button.dataset.navDomain));
      assert.deepEqual(domains.length, 7, `${viewport.name}: expected seven navigation domains`);
      for (const domain of domains) {
        await setDomain(page, domain);
        await setAllGroups(page, false);
        const collapsed = await geometry(page, viewport, domain);
        if (phase === 'after') assertGeometry(collapsed, viewport, 'collapsed');
        await page.evaluate(() => {
          const group = document.querySelector('.sidebar-nav > .nav-group:not([hidden])');
          if (group) window.setNavGroupOpen(group.dataset.navGroup, true);
        });
        await sleep(80);
        const expanded = await geometry(page, viewport, domain);
        if (phase === 'after') assertGeometry(expanded, viewport, 'expanded');
        results.push({ viewport: viewport.name, domain, collapsed, expanded, screenshot: domain === 'resources' ? await capture(page, viewport, domain) : null });
      }
      if (isMobile(viewport)) {
        await page.evaluate(() => window.toggleSidebarCompact());
        await sleep(220);
        const closed = await page.evaluate(() => {
          const sidebar = document.querySelector('#sidebar');
          const main = document.querySelector('#mainContent');
          return { collapsed: document.body.classList.contains('sidebar-collapsed'), pointerEvents: getComputedStyle(sidebar).pointerEvents, mainWidth: main.getBoundingClientRect().width, transform: getComputedStyle(sidebar).transform };
        });
        assert.equal(closed.collapsed, true, `${viewport.name}: drawer did not close`);
        assert.equal(closed.pointerEvents, 'none', `${viewport.name}: closed drawer remains interactive`);
        assert.ok(closed.mainWidth >= viewport.width - 1, `${viewport.name}: closed drawer leaves an empty content column`);
      }
    }
  } finally {
    await browser.close();
  }
  const report = { generatedAt: new Date().toISOString(), phase, baseUrl, viewports, totals: { cases: results.length, pass: phase === 'after' ? results.length : 0 }, consoleErrors, pageErrors, results };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  if (phase === 'after') {
    const rows = viewports.map(viewport => {
      const image = `${viewport.name}-resources.png`;
      return `<tr><th>${viewport.name}</th><td><img src="before/${image}" alt="Before ${viewport.name}"></td><td><img src="after/${image}" alt="After ${viewport.name}"></td></tr>`;
    }).join('');
    fs.writeFileSync(path.join(artifactDir, 'before-after.html'), `<!doctype html><meta charset="utf-8"><title>Navigation Visual Recovery 2</title><style>body{font:14px system-ui;background:#0f172a;color:#e2e8f0;margin:20px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #334155;padding:8px;vertical-align:top}th{white-space:nowrap}img{display:block;max-width:100%;height:auto}</style><h1>Navigation Visual Recovery 2 — Before / After</h1><table><thead><tr><th>State</th><th>Before</th><th>After</th></tr></thead><tbody>${rows}</tbody></table>`, 'utf8');
  }
  console.log(`Navigation visual acceptance: ${report.totals.pass}/${report.totals.cases} cases passed (${phase}); consoleErrors=${consoleErrors.length}; pageErrors=${pageErrors.length}`);
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
