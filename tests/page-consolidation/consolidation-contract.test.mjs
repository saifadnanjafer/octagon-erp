// Page Consolidation & Functional Depth — permanent regression contract.
//
// Guards the owner-approved consolidation decisions recorded in
// docs/navigation/OWNER_CONSOLIDATION_DECISIONS.md against silent regression.
//
// The central rule this suite enforces is ZERO CAPABILITY LOSS: a page may be
// demoted from a primary sidebar destination to a TAB or an ALIAS, but the
// capability must remain reachable. A demotion that leaves an id unreachable
// is a capability deletion, not a consolidation, and must fail here.
//
// Deliberately browser-free so it stays fast and runs in any environment: it
// asserts on the navigation registry, the real redirect wiring in source, and
// the generated functional ledger. The browser-driven proof that navigation
// actually lands correctly lives in tests/navigation/ and the click audit.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const P = (...parts) => path.join(root, ...parts);
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const readText = (file) => fs.readFileSync(file, 'utf8');

const registry = readJson(P('docs', 'navigation', 'NAVIGATION_FORENSIC_REPORT.json'));
const byId = new Map(registry.items.map((item) => [item.id, item]));
const primaryIds = registry.items.filter((item) => item.visibleInPrimaryNavigation).map((item) => item.id);

// The owner-approved reclassifications, with the canonical destination each one
// must remain reachable through.
const RECLASSIFIED = [
  { id: 'calculator', type: 'TAB', parent: 'timesheet' },
  { id: 'kanban', type: 'TAB', parent: 'task_manager' },
  { id: 'locations', type: 'TAB', parent: 'warehouses' },
  { id: 'pos_deepening', type: 'ALIAS', parent: 'pos' },
  { id: 'workshop_tv', type: 'TAB', parent: 'task_manager' },
];

// Orphan surfaces the owner decided to PRESERVE. Deleting these view files
// would be exactly the capability loss this wave forbids.
const PRESERVED_ORPHAN_VIEWS = ['credit_collections', 'service_contracts'];

test('every reclassified page is demoted from primary navigation but still registered', () => {
  for (const entry of RECLASSIFIED) {
    const item = byId.get(entry.id);
    assert.ok(item, `${entry.id} must remain in the navigation registry — removing it entirely is capability loss, not consolidation`);
    assert.equal(item.visibleInPrimaryNavigation, false, `${entry.id} must not be a primary sidebar destination`);
    assert.equal(item.currentItemType, entry.type, `${entry.id} must be classified ${entry.type}`);
    assert.equal(item.intendedParentPage, entry.parent, `${entry.id} must declare ${entry.parent} as its canonical parent`);
  }
});

test('every canonical parent of a reclassified page is itself a live primary destination', () => {
  // A tab whose parent is not reachable would strand the capability.
  for (const entry of RECLASSIFIED) {
    const parent = byId.get(entry.parent);
    assert.ok(parent, `${entry.parent} must exist in the registry`);
    assert.equal(parent.visibleInPrimaryNavigation, true, `${entry.parent} must remain a primary destination so ${entry.id} stays reachable`);
  }
});

test('calculator redirects into the timesheet in real switchPage wiring', () => {
  // Registry classification alone is a claim; this asserts the behaviour exists
  // in the code that actually runs.
  const appJs = readText(P('app.js'));
  assert.match(
    appJs,
    /if \(page === 'calculator' && \(!window\.PermissionService \|\| window\.PermissionService\.checkPage\('timesheet'\)\)\) \{/,
    'app.js switchPage must redirect calculator -> timesheet when the user has timesheet permission'
  );
  // The permission-less fallback must survive: a user without timesheet access
  // still needs the standalone calculator, and removing that branch would both
  // strand them and create a redirect loop.
  assert.match(appJs, /return window\.switchPage\('timesheet'\)/, 'the calculator redirect must target timesheet');
});

test('pos_deepening redirects to the canonical POS workspace', () => {
  const posDeepening = readText(P('modules', 'pos-deepening.js'));
  assert.match(posDeepening, /if \(page === 'pos_deepening'\)/, 'pos-deepening.js must intercept its own legacy route');
  const indexHtml = readText(P('index.html'));
  const navButton = /<button[^>]*data-page="pos_deepening"[^>]*>/.exec(indexHtml);
  assert.ok(navButton, 'the pos_deepening nav button must still exist (hidden), not be deleted');
  assert.match(navButton[0], /hidden/, 'the pos_deepening nav button must carry hidden so it is not a second POS destination');
});

test('preserved orphan surfaces are not deleted', () => {
  for (const id of PRESERVED_ORPHAN_VIEWS) {
    const viewFile = P('views', `${id}.html`);
    assert.ok(fs.existsSync(viewFile), `views/${id}.html must be preserved pending the owner's canonical-owner decision — deletion is unauthorized capability loss`);
  }
});

test('no reclassified id collides with a live primary destination', () => {
  // Guards against a demoted id being silently re-promoted by a later change,
  // which would recreate the duplicate destination the consolidation removed.
  const primary = new Set(primaryIds);
  for (const entry of RECLASSIFIED) {
    assert.equal(primary.has(entry.id), false, `${entry.id} must not reappear as a primary destination`);
  }
});

test('the functional ledger covers exactly the canonical primary navigation set', () => {
  const ledgerPath = P('docs', 'product', 'PAGE_FUNCTIONAL_LEDGER.json');
  assert.ok(fs.existsSync(ledgerPath), 'PAGE_FUNCTIONAL_LEDGER.json must exist — run scripts/product/build-ledger.mjs');
  const ledger = readJson(ledgerPath);

  const ledgerIds = new Set(ledger.rows.map((row) => row.pageId));
  const missing = primaryIds.filter((id) => !ledgerIds.has(id));
  const extra = [...ledgerIds].filter((id) => !primaryIds.includes(id));

  assert.deepEqual(missing, [], 'every canonical primary workspace must have a ledger row');
  assert.deepEqual(extra, [], 'the ledger must not invent pages absent from the navigation registry');
  assert.equal(ledger.totalPrimaryPages, primaryIds.length, 'ledger total must equal the derived canonical primary count');
});

test('the ledger reconciles its count against the registry rather than hard-coding it', () => {
  // The count legitimately changes when a page is consolidated. What must never
  // drift is ledger-vs-registry agreement, which the previous assertion covers.
  // This one guards the generator against a stale literal being reintroduced.
  const generator = readText(P('scripts', 'product', 'build-ledger.mjs'));
  assert.equal(/totalPrimaryPages:\s*\d+/.test(generator), false, 'the ledger generator must derive the page count, never hard-code it');
});

test('every ledger row carries the evidence behind its classification', () => {
  const ledger = readJson(P('docs', 'product', 'PAGE_FUNCTIONAL_LEDGER.json'));
  const REQUIRED = ['pageId', 'domain', 'reviewPriority', 'functionalState', 'usabilityState', 'pageArchetype', 'upstreamWorkflow', 'downstreamWorkflow'];
  for (const row of ledger.rows) {
    for (const field of REQUIRED) {
      assert.ok(row[field] !== undefined && row[field] !== null && row[field] !== '', `${row.pageId} is missing ledger field ${field}`);
    }
    // A classification with no evidence is an opinion. Reject silently-empty
    // scoring so the ledger cannot drift back into PENDING_INSPECTION padding.
    assert.equal(/PENDING_INSPECTION/.test(JSON.stringify(row)), false, `${row.pageId} still contains PENDING_INSPECTION placeholder content`);
  }
});
