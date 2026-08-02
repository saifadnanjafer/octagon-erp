import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const source = read('modules/build09-workspaces.js');
const styles = read('modules/build09-workspaces.css');
const index = read('index.html');
const permissions = read('services/permissionService.js');

const expectedPages = [
  'warehouse_topology', 'zone_bin_management', 'putaway_rules', 'putaway_task_queue',
  'replenishment_rules', 'replenishment_proposals', 'mobile_receiving',
  'receiving_discrepancies', 'mobile_picking', 'pick_task_queue', 'wave_planning',
  'wave_execution', 'cycle_count_plans', 'count_session', 'variance_review',
  'dock_schedule', 'dock_checkin', 'staging_board', 'crossdock_workspace',
  'lot_serial_traceability', 'expiration_queue', 'recall_analysis', 'shopfloor_terminal',
  'workcenter_queue', 'production_material_requests', 'production_issue_return',
  'production_receipt', 'quality_hold_queue', 'rework_workspace', 'scrap_approval',
  'downtime_board', 'operational_performance',
];

test('BUILD-09 publishes exactly 32 configured and reachable functional workspaces', () => {
  const catalogBlock = source.match(/const PAGES = \{([\s\S]*?)\n  \};/)?.[1] || '';
  const configured = [...catalogBlock.matchAll(/^\s{4}([a-z0-9_]+):/gm)].map((match) => match[1]);
  assert.deepEqual(configured, expectedPages);
  assert.equal(new Set(configured).size, 32);

  for (const page of expectedPages) {
    assert.match(index, new RegExp(`data-page=["']${page}["']`), `${page} must be reachable from navigation`);
    assert.match(permissions, new RegExp(`\\b${page}: \\{[^\\n]+phase: 'build09'`), `${page} needs metadata`);
    assert.match(permissions, new RegExp(`\\b${page}: \\['workshop\\.(?:user|manager)'\\]`), `${page} needs a page permission`);
  }
});

test('BUILD-09 workspace shell exposes governed state, scope, actions, and export behavior', () => {
  assert.match(index, /modules\/build09-workspaces\.css/);
  assert.match(index, /modules\/build09-workspaces\.js/);
  assert.match(source, /\/api\/v1\/wms\//);
  assert.match(source, /\/api\/v1\/action\//);
  assert.match(source, /activeCompany/);
  assert.match(source, /activeWarehouse/);
  assert.match(source, /Loading · empty · error · denied/);
  assert.match(source, /exportCsv/);
  assert.match(source, /PermissionService\.checkPage/);
  assert.match(source, /octagon:language-changed/);
});

test('BUILD-09 supports mobile terminals, RTL, responsive tables, and action dialogs', () => {
  assert.match(source, /b09-mobile/);
  assert.match(source, /document\.documentElement\.dir === 'rtl'/);
  assert.match(source, /build09ActionDialog/);
  assert.match(styles, /@media\(max-width:760px\)/);
  assert.match(styles, /html\[dir=rtl\]/);
  assert.match(styles, /\.b09-table-wrap/);
  assert.match(styles, /\.b09-status\[data-phase=error\]/);
});
