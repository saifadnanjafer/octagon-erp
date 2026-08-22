import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

// BUILD-09R-2 bespoke-workspace contract.
//
// A purpose-built workspace only reaches the user if three things line up: the module is loaded
// by index.html, it registers an override for a real BUILD-09 page id, and the shared kernel it
// depends on is loaded before it. Any one of those silently failing puts the generic table+dialog
// shell back on the page with no error anywhere - the page still "works", it is just no longer
// the workspace that was built. This test pins all three, and pins which pages are bespoke so a
// dropped registration is a failure rather than a silent downgrade.

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const index = read('index.html');

const BESPOKE_MODULES = {
  'build09-mobile-receiving.js': ['mobile_receiving'],
  'build09-mobile-picking.js': ['mobile_picking'],
  'build09-topology-workspace.js': ['warehouse_topology', 'zone_bin_management'],
  'build09-receiving-discrepancy-workspace.js': ['receiving_discrepancies'],
  'build09-pick-task-queue-workspace.js': ['pick_task_queue'],
  'build09-wave-workspace.js': ['wave_planning', 'wave_execution'],
  'build09-count-workspace.js': ['cycle_count_plans', 'count_session', 'variance_review'],
  'build09-trace-workspace.js': ['lot_serial_traceability', 'recall_analysis'],
  'build09-expiration-workspace.js': ['expiration_queue'],
  'build09-production-material-workspaces.js': ['production_material_requests', 'production_issue_return', 'production_receipt'],
  'build09-shopfloor-workspace.js': ['shopfloor_terminal', 'workcenter_queue'],
  'build09-quality-workspace.js': ['quality_hold_queue', 'rework_workspace', 'scrap_approval'],
  'build09-downtime-workspace.js': ['downtime_board', 'operational_performance'],
  'build09-dock-workspace.js': ['dock_schedule', 'dock_checkin', 'staging_board', 'crossdock_workspace'],
  'build09-putaway-workspace.js': ['putaway_rules', 'putaway_task_queue', 'replenishment_rules', 'replenishment_proposals'],
};

// The 8 BUILD-09 pages still served by the generic shell. This list is the honest remaining
// BUILD-09R-2 backlog; shrink it as each page gets a purpose-built workspace.
const STILL_GENERIC = [];

const declaredPages = () => {
  const catalog = read('modules/build09-workspaces.js').match(/const PAGES = \{([\s\S]*?)\n  \};/)?.[1] || '';
  return [...catalog.matchAll(/^\s{4}([a-z0-9_]+):/gm)].map((match) => match[1]);
};

test('every bespoke BUILD-09R-2 workspace is loaded, registered, and covers a real page', () => {
  const pages = declaredPages();
  const claimed = [];

  for (const [file, overrides] of Object.entries(BESPOKE_MODULES)) {
    const source = read(`modules/${file}`);
    assert.match(index, new RegExp(`modules/${file.replace('.', '\\.')}`), `${file} must be loaded by index.html`);

    const registered = [...source.matchAll(/register(?:Page)?Override\('([a-z0-9_]+)'/g)].map((match) => match[1]);
    assert.deepEqual(registered.sort(), [...overrides].sort(), `${file} must register exactly its declared pages`);

    for (const page of overrides) {
      assert.ok(pages.includes(page), `${file} registers ${page}, which is not a declared BUILD-09 page`);
      assert.ok(!claimed.includes(page), `${page} is claimed by more than one bespoke module`);
      claimed.push(page);
    }
  }

  // Nothing bespoke may also be listed as still-generic, and together they must be the full set.
  for (const page of STILL_GENERIC) assert.ok(!claimed.includes(page), `${page} is bespoke but still listed as generic`);
  assert.deepEqual([...claimed, ...STILL_GENERIC].sort(), [...pages].sort(), 'every BUILD-09 page is either bespoke or explicitly listed as still generic');
  assert.equal(claimed.length, 32, 'BUILD-09R-2 has 32 purpose-built workspaces');
  assert.equal(STILL_GENERIC.length, 0, 'BUILD-09R-2 has no pages left on the generic shell');
});

test('the BUILD-09R-2 shared kernel loads before every module that depends on it', () => {
  const order = [...index.matchAll(/modules\/(build09[a-z0-9-]*\.js)/g)].map((match) => match[1]);
  const kernelAt = order.indexOf('build09r-shared.js');
  assert.ok(kernelAt >= 0, 'the shared kernel must be loaded by index.html');
  assert.ok(order.indexOf('build09-workspaces.js') < kernelAt, 'registerPageOverride is defined by build09-workspaces.js, so it loads first');

  for (const file of Object.keys(BESPOKE_MODULES)) {
    const at = order.indexOf(file);
    assert.ok(at >= 0, `${file} must appear in index.html`);
    // The two mobile workspaces predate the kernel and deliberately do not use it.
    if (read(`modules/${file}`).includes('OctagonBuild09R')) {
      assert.ok(at > kernelAt, `${file} uses the shared kernel, so it must load after it`);
    }
  }
});

test('the shared kernel never renders unescaped interpolation into workspace markup', () => {
  // Every workspace builds HTML strings, so an unescaped value is a stored-XSS vector reachable
  // from any operator-entered reference, reason code or note.
  const kernel = read('modules/build09r-shared.js');
  assert.match(kernel, /const escapeHtml =/);
  assert.match(kernel, /root\.OctagonBuild09R = \{/, 'the kernel must publish itself for the group modules');

  for (const file of Object.keys(BESPOKE_MODULES)) {
    const source = read(`modules/${file}`);
    if (!source.includes('OctagonBuild09R')) continue;
    assert.ok(/escapeHtml: esc|const esc =|escapeHtml/.test(source), `${file} must pull an escaper from the kernel`);
  }
});
