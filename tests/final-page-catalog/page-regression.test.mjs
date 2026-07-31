// tests/final-page-catalog/page-regression.test.mjs
//
// The permanent page-registry regression scan (§79).
//
// Before this wave the only record of which pages exist lived in three
// JavaScript literals inside a 37k-line app.js. Pages silently drifted out of
// navigation, lost their permission entry, or were referenced with no DOM
// section behind them, and nothing caught it.
//
// This suite reads the real registration surfaces and fails on any of the
// defects §79 enumerates. It is static: it parses files, starts no server, and
// never opens a database.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectInventory, classify } from '../../scripts/page-catalog-inventory.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const inv = collectInventory();
const rows = inv.pages.map((p) => ({ ...p, ...classify(p) }));
const byId = new Map(rows.map((r) => [r.id, r]));

/**
 * Pages carried over from before this wave that are known-incomplete.
 *
 * This list is an explicit debt ledger, not a mute button: every entry is
 * recorded in docs/evidence/final-page-catalog/ with a disposition. Adding a
 * NEW page to it requires the same. The list may only shrink.
 */
const KNOWN_INCOMPLETE = new Set([
  // Deliberately not in a nav group — reached by the logo / boot resume.
  'home',
  // Pre-existing pages awaiting nav-group assignment (FP-10).
  'canonical_console', 'canonical_inventory', 'products', 'parties',
  'warehouses', 'locations', 'telegram', 'knowledge_base',
  'finance_installments', 'omni_communications', 'pos_deepening',
  'sales_commission', 'sales_contracts', 'sales_price_lists',
  // JS-rendered shells with no view fragment, by design.
  'import_center', 'system_settings',
  // Reached from within another page rather than the sidebar.
  'manager_approvals', 'mobile_inventory_count',
  // Permission keys with no page behind them; dispositioned in the
  // consolidation register (§B2, §B3), retired in FP-10.
  'settings', 'system_check',
]);

/** Pages this wave added and therefore holds to the full standard. */
const FPC_PAGES = ['enterprise_home', 'my_work', 'unified_inbox'];

// ---------------------------------------------------------------------------
// §79 defect classes
// ---------------------------------------------------------------------------

test('no navigation entry points at a page that does not exist', () => {
  const registered = new Set(inv.pages.map((p) => p.id));
  const orphans = [];
  for (const [group, pages] of Object.entries(inv.navGroupPages)) {
    for (const page of pages) {
      if (!registered.has(page)) orphans.push(`${group} -> ${page}`);
    }
  }
  assert.deepEqual(orphans, [], `navigation entries with no page: ${orphans.join(', ')}`);
});

test('no duplicate page ID', () => {
  const seen = new Set();
  const dupes = [];
  for (const page of inv.pages) {
    if (seen.has(page.id)) dupes.push(page.id);
    seen.add(page.id);
  }
  assert.deepEqual(dupes, [], `duplicate page ids: ${dupes.join(', ')}`);
});

test('no two pages share a DOM section id', () => {
  const owners = new Map();
  const collisions = [];
  for (const page of inv.pages) {
    if (!page.sectionId) continue;
    // warehouses/locations legitimately share one view and one section; they
    // are two routes into the same workspace, declared in viewFileNameMap.
    const allowedPair = ['warehouses', 'locations'];
    if (owners.has(page.sectionId)) {
      const first = owners.get(page.sectionId);
      const bothAllowed = allowedPair.includes(first) && allowedPair.includes(page.id);
      if (!bothAllowed) collisions.push(`${page.sectionId}: ${first} + ${page.id}`);
    } else {
      owners.set(page.sectionId, page.id);
    }
  }
  assert.deepEqual(collisions, [], `DOM section id collisions: ${collisions.join(', ')}`);
});

test('every view fragment belongs to a registered page', () => {
  assert.deepEqual(
    inv.orphanViews, [],
    `view fragments with no registered page id: ${inv.orphanViews.join(', ')}`,
  );
});

test('every view fragment declares a section id that matches its page', () => {
  const mismatches = [];
  for (const page of inv.pages) {
    if (!page.viewFile || !page.sectionId) continue;
    const viewKey = page.viewFile.replace(/^views\//, '').replace(/\.html$/, '');
    const declared = inv.viewSectionIds[viewKey];
    if (!declared) {
      mismatches.push(`${page.viewFile} declares no id="pageXxx"`);
      continue;
    }
    // Shared views (warehouses/locations) declare the first page's section.
    if (declared !== page.sectionId && !['warehouses', 'locations'].includes(page.id)) {
      mismatches.push(`${page.id}: map says ${page.sectionId}, view says ${declared}`);
    }
  }
  assert.deepEqual(mismatches, [], mismatches.join('; '));
});

test('every page in a navigation group has a permission entry', () => {
  const missing = rows
    .filter((r) => r.navGroup && !r.permissionRegistered)
    .map((r) => r.id)
    .filter((id) => !KNOWN_INCOMPLETE.has(id));
  assert.deepEqual(missing, [], `navigable pages without a permission: ${missing.join(', ')}`);
});

test('every page with a permission entry resolves to a real page', () => {
  const dangling = rows
    .filter((r) => r.permissionRegistered && !r.sectionId)
    .map((r) => r.id)
    .filter((id) => !KNOWN_INCOMPLETE.has(id));
  assert.deepEqual(dangling, [], `permission keys with no page behind them: ${dangling.join(', ')}`);
});

test('the known-incomplete ledger contains no page that is now complete', () => {
  // The ledger may only shrink. A page that has been fixed must be removed
  // from it, or the exemption silently protects the next regression.
  const stale = [...KNOWN_INCOMPLETE].filter((id) => {
    const row = byId.get(id);
    return row && row.status === 'COMPLETE';
  });
  assert.deepEqual(stale, [], `these pages are complete and must leave KNOWN_INCOMPLETE: ${stale.join(', ')}`);
});

// ---------------------------------------------------------------------------
// Pages added by this wave are held to the full standard
// ---------------------------------------------------------------------------

test('every Final Page Catalog page is fully registered', () => {
  for (const id of FPC_PAGES) {
    const row = byId.get(id);
    assert.ok(row, `${id} is not registered at all`);
    assert.equal(row.status, 'COMPLETE', `${id} is ${row.status}: ${row.blockers.join('; ')}`);
    assert.ok(row.sectionId, `${id} has no DOM section id`);
    assert.ok(row.viewFile, `${id} has no view fragment`);
    assert.ok(row.navGroup, `${id} is not in a navigation group`);
    assert.ok(row.navButton, `${id} has no sidebar button`);
    assert.ok(row.permissionRegistered, `${id} has no permission entry`);
    assert.ok(row.prefetched, `${id} is not in the prefetch list`);
  }
});

test('every Final Page Catalog page has a controller module', () => {
  const controllers = {
    enterprise_home: 'modules/fpc-enterprise-home.js',
    my_work: 'modules/fpc-my-work.js',
    unified_inbox: 'modules/fpc-unified-inbox.js',
  };
  for (const [id, file] of Object.entries(controllers)) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${id} controller ${file} is missing`);
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    // Each controller must self-activate through the switchPage wrapper, or the
    // shell's async view hydration races it and the page renders blank.
    assert.match(src, /root\.switchPage\s*=\s*function/, `${id} does not wrap switchPage`);
    assert.match(src, /ensurePageTemplateLoaded/, `${id} does not wait for its template`);
  }
});

test('Final Page Catalog pages are loaded by the shell', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const file of [
    'modules/octagon-page-kit.js', 'modules/octagon-page-kit.css',
    'modules/fpc-enterprise-home.js', 'modules/fpc-my-work.js', 'modules/fpc-unified-inbox.js',
  ]) {
    assert.ok(html.includes(file), `${file} is not referenced by index.html`);
  }
  // The kit must load before any page that uses it.
  assert.ok(
    html.indexOf('modules/octagon-page-kit.js') < html.indexOf('modules/fpc-enterprise-home.js'),
    'the page kit must load before the pages that render through it',
  );
});

// ---------------------------------------------------------------------------
// Honesty rules (§74)
// ---------------------------------------------------------------------------

test('no Final Page Catalog page writes through generic legacy CRUD', () => {
  const files = ['modules/fpc-enterprise-home.js', 'modules/fpc-my-work.js', 'modules/fpc-unified-inbox.js'];
  for (const file of files) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.ok(!/\/api\/db\b/.test(src), `${file} must not touch the generic /api/db writer`);
    assert.ok(!/PentagonDB\.mutate/.test(src), `${file} must not mutate the legacy store directly`);
    assert.ok(!/saveData\s*\(/.test(src), `${file} must not call the legacy saveData()`);
  }
});

test('no Final Page Catalog page hardcodes a business number', () => {
  const files = ['modules/fpc-enterprise-home.js', 'modules/fpc-my-work.js', 'modules/fpc-unified-inbox.js'];
  for (const file of files) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    // A KPI must come from a query or be rendered unavailable. `value:` bound
    // to a numeric literal is exactly the fake-green-zero defect §74 forbids.
    const fakeKpi = /value:\s*\d+(\.\d+)?\s*[,}]/.exec(src);
    assert.equal(fakeKpi, null, `${file} hardcodes a KPI value: ${fakeKpi && fakeKpi[0]}`);
  }
});

test('the page kit renders every required state', () => {
  const src = fs.readFileSync(path.join(ROOT, 'modules/octagon-page-kit.js'), 'utf8');
  for (const state of [
    'loading', 'empty', 'populated', 'validation_error', 'permission_denied',
    'module_disabled', 'entitlement_denied', 'not_available', 'backend_failure',
  ]) {
    assert.ok(src.includes(`'${state}'`), `the kit does not define the ${state} state`);
  }
});

test('the page kit isolates identifiers so RTL cannot reorder them', () => {
  const src = fs.readFileSync(path.join(ROOT, 'modules/octagon-page-kit.js'), 'utf8');
  // U+2068 FIRST STRONG ISOLATE / U+2069 POP DIRECTIONAL ISOLATE.
  assert.ok(src.includes('\u2068') && src.includes('\u2069'),
    'codes and numbers must be bidi-isolated or Arabic RTL reorders them');
});

test('the page kit stylesheet leaks no global selector', () => {
  // Strip comments first — a /* … */ block contains commas and braces and
  // would otherwise be parsed as a selector list.
  const css = fs.readFileSync(path.join(ROOT, 'modules/octagon-page-kit.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const leaks = [];
  // Every rule must be scoped to .opk- (or be an at-rule / keyframe step).
  for (const selector of css.split('}').map((chunk) => chunk.split('{')[0].trim()).filter(Boolean)) {
    if (selector.startsWith('@')) continue;
    if (/^(from|to|\d+%)$/.test(selector)) continue;
    const parts = selector.split(',').map((s) => s.trim()).filter(Boolean);
    for (const part of parts) {
      if (!part.includes('.opk-')) leaks.push(part);
    }
  }
  assert.deepEqual(leaks, [], `unscoped selectors would leak into every page: ${leaks.join(' | ')}`);
});

test('mobile touch targets are declared for the kit primitives', () => {
  const css = fs.readFileSync(path.join(ROOT, 'modules/octagon-page-kit.css'), 'utf8');
  assert.match(css, /@media \(max-width: 640px\)/, 'the kit declares no mobile breakpoint');
  assert.match(css, /min-height:\s*4[2-9]px/, 'mobile controls must reach a usable touch height');
  assert.match(css, /overflow-x:\s*auto/, 'wide tables must scroll inside their own container');
});
