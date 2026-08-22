import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const source = read('modules/build10-workspaces.js');
const styles = read('modules/build10-workspaces.css');
const index = read('index.html');
const permissions = read('services/permissionService.js');
const legacyRenderers = [
  'modules/build10/components.js',
  'modules/build10/renderers/devices.js',
  'modules/build10/renderers/telemetry.js',
  'modules/build10/renderers/fleet.js',
  'modules/build10/renderers/offline.js',
  'modules/build10/renderers/kiosks.js',
  'modules/build10/renderers/boards.js',
].map(read).join('\n');

const expectedPages = [
  'device_registry', 'device_detail', 'device_enrollment', 'gateway_management',
  'sensor_management', 'telemetry_explorer', 'device_health_center', 'device_alerts',
  'firmware_catalogue', 'rollout_simulator', 'configuration_profiles', 'device_command_center',
  'fleet_device_mapping', 'fleet_live_map_simulator', 'vehicle_trip_timeline',
  'geofence_management', 'geofence_events', 'speed_and_driver_events', 'fuel_telemetry',
  'suspected_fuel_loss_queue', 'maintenance_triggers', 'offline_client_registry',
  'offline_queue', 'sync_sessions', 'sync_conflicts', 'conflict_resolution',
  'offline_capability_policies', 'kiosk_device_registry', 'employee_kiosk',
  'warehouse_kiosk', 'shop_floor_kiosk', 'service_kiosk', 'fleet_operations_board',
  'device_health_board', 'warehouse_large_screen', 'production_large_screen',
  'service_queue_board', 'alert_board',
];

test('BUILD-10 publishes exactly 38 configured and reachable functional workspaces', () => {
  const catalogBlock = source.match(/const PAGES = \{([\s\S]*?)\n  \};/)?.[1] || '';
  const configured = [...catalogBlock.matchAll(/^\s{4}([a-z0-9_]+):/gm)].map((match) => match[1]);
  assert.deepEqual(configured, expectedPages);
  assert.equal(new Set(configured).size, 38);

  for (const page of expectedPages) {
    assert.match(index, new RegExp(`data-page=["']${page}["']`), `${page} must be reachable from navigation`);
    assert.match(permissions, new RegExp(`\\b${page}: \\{[^\\n]+phase: 'build10'`), `${page} needs metadata`);
    assert.match(permissions, new RegExp(`\\b${page}: \\[`), `${page} needs a page permission entry`);
  }
});

test('BUILD-10 workspace shell exposes scoped read models, state, and export behavior', () => {
  assert.match(index, /modules\/build10-workspaces\.css/);
  assert.match(index, /modules\/build10-workspaces\.js/);
  assert.match(source, /\/api\/v1\/build10\//);
  assert.match(source, /activeCompany/);
  assert.match(source, /activeWarehouse/);
  // The shell must expose a governed-state node (data-role="status" with a
  // data-phase attribute), not any specific literal text. A prior version of
  // this test asserted the literal placeholder string "Loading · empty ·
  // error · denied" -- that string was a real bug: dead debug/legend text
  // hardcoded into every b10-status node and never replaced with the actual
  // phase label (unlike the working setStatus() pattern in Build08/09/11).
  // Real users saw the literal list of all possible states instead of their
  // current one. Fixed at the source; this assertion now checks the
  // structural contract the fix must preserve, not the bug's exact wording.
  assert.match(source, /data-role="status" data-phase="[a-z]+"/);
  assert.doesNotMatch(source, /Loading · empty · error · denied/, 'the dead placeholder legend must not return');
  assert.match(source, /exportCsv/);
  assert.match(source, /refreshRecords/);
  assert.doesNotMatch(source, /mockDataForPage|REF-10001|TRIP-101|CONF-201/, 'workspace rows must come only from the scoped read model');
  assert.match(source, /PermissionService\.checkPage/);
  assert.match(source, /octagon:language-changed/);
});

test('BUILD-10 supports kiosk boards, RTL, responsive tables, and read-only workspaces', () => {
  assert.match(source, /b10-board/);
  assert.match(source, /document\.documentElement\.dir === 'rtl'/);
  assert.doesNotMatch(source, /data-action=/, 'the read-only shell must not expose placeholder mutation controls');
  assert.match(styles, /@media\(max-width:760px\)/);
  assert.match(styles, /html\[dir=rtl\]/);
  assert.match(styles, /\.b10-table-wrap/);
  assert.match(styles, /\.b10-board-grid/);
  assert.match(styles, /\.b10-status\[data-phase=error\]/);
});

test('BUILD-10 legacy renderers do not fabricate fallback business records or commands', () => {
  assert.doesNotMatch(legacyRenderers, /openActionDialog|sampleRows\s*=\s*\[/);
  assert.doesNotMatch(legacyRenderers, /TRIP-1001|DEV-1001|PWA-BROWSER-99|KIOSK-BROWSER-1/);
});
