import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const ROOT = path.resolve(import.meta.dirname, '../..');
const PAGE_IDS = [
  'demand_planning', 'forecast_versions', 'forecast_overrides', 'forecast_accuracy',
  'planning_exceptions', 'mps', 'mps_proposals', 'supply_demand_balance',
  'sop_scenarios', 'sop_review', 'treasury_cash_position', 'liquidity_forecast',
  'treasury_alerts', 'payment_funding_proposals', 'financing_facilities',
  'intercompany_transactions', 'mismatch_queue', 'intercompany_reconciliation',
  'consolidation_groups', 'account_mapping', 'consolidation_runs', 'eliminations',
  'consolidated_reports', 'consolidation_lineage'
];

test('BUILD-08 exposes twenty-four substantive routed workspaces', () => {
  const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(index, /modules\/build08-workspaces\.css/);
  assert.match(index, /modules\/build08-workspaces\.js/);
  for (const pageId of PAGE_IDS) {
    const source = fs.readFileSync(path.join(ROOT, 'views', `${pageId}.html`), 'utf8');
    assert.ok(source.length > 900, `${pageId} is substantive`);
    assert.match(source, new RegExp(`data-build08-page="${pageId}"`));
    assert.match(source, /data-role="status"/);
    assert.match(source, /data-role="filter"/);
    assert.match(source, /data-role="rows"/);
    assert.match(index, new RegExp(`data-page="${pageId}"`), `${pageId} is navigable`);
  }
});

test('workspace controller maps every page to a canonical query and governed actions', () => {
  const source = fs.readFileSync(path.join(ROOT, 'modules/build08-workspaces.js'), 'utf8');
  for (const pageId of PAGE_IDS) assert.match(source, new RegExp(`\\b${pageId}: \\[`));
  for (const namespace of ['planning/', 'mps/', 'sop/', 'treasury/', 'intercompany/', 'consolidation/']) {
    assert.ok(source.includes(namespace), `query namespace ${namespace} is represented`);
  }
  for (const action of ['forecast:publish', 'mps:proposal_approve', 'sop:review_approve',
    'treasury:proposal_approve', 'intercompany:reconcile', 'consolidation:run_calculate',
    'consolidation:finalize']) {
    assert.ok(source.includes(action), `governed action ${action} is exposed`);
  }
  assert.match(source, /__BUILD08_FORCE_READ_ONLY__/);
  assert.match(source, /db_write/);
  assert.match(source, /credentials: 'same-origin'/);
  assert.match(source, /payload\.success === false/);
});

test('workspace styling covers RTL, LTR, keyboard focus, and mobile tables', () => {
  const css = fs.readFileSync(path.join(ROOT, 'modules/build08-workspaces.css'), 'utf8');
  assert.match(css, /html\[dir=rtl\]/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /content:attr\(data-label\)/);
  assert.match(css, /\[data-phase=error\]/);
  assert.match(css, /\[data-phase=denied\]/);
});

test('workspace controller parses as browser JavaScript and publishes its API', () => {
  const source = fs.readFileSync(path.join(ROOT, 'modules/build08-workspaces.js'), 'utf8');
  const listeners = {};
  const document = {
    readyState: 'loading',
    documentElement: { dir: 'rtl', lang: 'ar' },
    addEventListener(name, handler) { listeners[name] = handler; }
  };
  const window = { document };
  vm.runInNewContext(source, { window, document, console, Blob, URL, Intl, Date, Map, Promise, JSON, String, Array, Object, encodeURIComponent });
  assert.ok(window.OctagonBuild08);
  assert.equal(Object.keys(window.OctagonBuild08.pages).length, 24);
  assert.equal(typeof window.OctagonBuild08.fetchRows, 'function');
  assert.equal(typeof listeners.DOMContentLoaded, 'function');
});
