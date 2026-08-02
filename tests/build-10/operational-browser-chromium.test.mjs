import assert from 'node:assert/strict';
import test from 'node:test';
import { browserAction, browserQuery, openBuild10Browser } from './browser-harness.mjs';

test('real Chromium completes telematics location tracking, trip calculation, geofence exit breach, and responsive view', async (t) => {
  const { consoleErrors, dialect, page, seed } = await openBuild10Browser(t, { name: 'telematics', initialPage: 'fleet_live_map_simulator' });

  // 1. Ingest location points via browser action
  const t0 = new Date(Date.now() - 1800000).toISOString();
  const t1 = new Date().toISOString();
  await browserAction(page, 'iot:record_location_point', { device_id: seed.deviceId, latitude: 33.3152, longitude: 44.3661, speed_kmh: 0, timestamp: t0 });
  await browserAction(page, 'iot:record_location_point', { device_id: seed.deviceId, latitude: 33.4000, longitude: 44.4500, speed_kmh: 90, timestamp: t1 });

  // 2. Define Geofence & evaluate breach
  const gf = await browserAction(page, 'iot:define_geofence', { code: 'GF-BROWSER-HQ', name: 'Browser HQ Depot', fence_type: 'circular', center_lat: 33.3152, center_lng: 44.3661, radius_m: 300 });
  const breach = await browserAction(page, 'iot:evaluate_geofence_breach', { device_id: seed.deviceId, geofence_id: gf.id, latitude: 33.4000, longitude: 44.4500, event_type: 'exit' });
  assert.equal(breach.breaches.length, 1);

  // 3. Project trip
  const trip = await browserAction(page, 'iot:start_or_project_trip', { vehicle_id: seed.vehicleId, device_id: seed.deviceId, start_time: t0, end_time: t1, distance_km: 15, max_speed_kmh: 90 });
  assert.equal(trip.status, 'completed');

  // 4. Switch to trip timeline page and test mobile viewport & layout
  await page.evaluate(() => window.switchPage('vehicle_trip_timeline'));
  await page.waitForFunction(() => document.querySelector('[data-build10-page="vehicle_trip_timeline"] tbody tr[data-record-id]'));
  await page.setViewport({ width: 390, height: 844 });
  assert.equal(await page.$eval('[data-build10-page="vehicle_trip_timeline"] .b10-table td', (element) => getComputedStyle(element).display), 'grid');

  assert.equal(consoleErrors.length, 0, consoleErrors.join('\n'));
});

test('real Chromium completes offline PWA batch push, conflict resolution, LTR/RTL toggle, and read-only enforcement', async (t) => {
  const { consoleErrors, dialect, page, seed } = await openBuild10Browser(t, { name: 'offline', initialPage: 'offline_queue' });

  // 1. Push batch queue items via browser action
  const batch = await browserAction(page, 'offline:push_queue_batch', {
    client_id: seed.clientId,
    session_uuid: 'SYNC-BROWSER-101',
    queue_items: [
      { queue_item_uuid: 'BITEM-1', entity_name: 'inventory_scan', action_type: 'record_scan', payload: { barcode: 'BC-1' }, client_timestamp: new Date().toISOString() },
      { queue_item_uuid: 'BITEM-2', entity_name: 'gl_journal', action_type: 'post_journal', payload: { amount: 100 }, client_timestamp: new Date().toISOString() }
    ]
  });
  assert.equal(batch.processedCount, 2);
  assert.equal(batch.rejectedCount, 1);

  // 2. Record & resolve conflict
  const conflict = await browserAction(page, 'offline:record_sync_conflict', {
    client_id: seed.clientId,
    session_id: 'SYNC-BROWSER-101',
    entity_name: 'inventory_count',
    entity_id: 'quant-99',
    server_version: { qty: 10 },
    client_version: { qty: 12 },
    conflict_type: 'version_mismatch'
  });
  const res = await browserAction(page, 'offline:resolve_sync_conflict', { conflict_id: conflict.id, strategy: 'server_wins', notes: 'Browser test resolved' });
  assert.equal(res.status, 'resolved');

  // 3. Test LTR/RTL toggle & DOM switch
  await page.evaluate(() => { document.documentElement.lang = 'en'; document.documentElement.dir = 'ltr'; window.switchPage('sync_conflicts'); });
  await page.waitForFunction(() => document.querySelector('[data-build10-page="sync_conflicts"] tbody tr[data-record-id]'));
  assert.equal(await page.$eval('html', (element) => element.dir), 'ltr');

  // 4. Test read-only mode override
  await page.evaluate(() => { window.__BUILD10_FORCE_READ_ONLY__ = true; window.OctagonBuild10.renderPage('sync_conflicts'); });
  assert.ok(await page.$eval('[data-build10-page="sync_conflicts"] [data-action]', (button) => button.disabled));

  assert.equal(consoleErrors.length, 0, consoleErrors.join('\n'));
});

test('real Chromium renders kiosk operational boards and enforces kiosk role restrictions', async (t) => {
  const { consoleErrors, dialect, page, seed } = await openBuild10Browser(t, { name: 'kiosk', initialPage: 'fleet_operations_board' });

  // 1. Verify large-screen board layout
  await page.waitForFunction(() => document.querySelector('[data-build10-page="fleet_operations_board"] .b10-board-grid'));
  const cardsCount = await page.$$eval('[data-build10-page="fleet_operations_board"] .b10-board-card', (cards) => cards.length);
  assert.ok(cardsCount >= 4);

  // 2. Switch to Employee Kiosk page
  await page.evaluate(() => window.switchPage('employee_kiosk'));
  await page.waitForFunction(() => document.querySelector('[data-build10-page="employee_kiosk"]'));

  // 3. Test restricted action permission evaluation
  const restricted = await browserAction(page, 'kiosk:evaluate_kiosk_permission', { kiosk_id: seed.kioskId, action_name: 'override_system_settings' });
  assert.equal(restricted.allowed, false);
  assert.equal(restricted.reason, 'restricted_kiosk_role');

  // 4. Test query permissions for unauthorized user
  assert.equal((await browserQuery(page, 'iot', 'devices', { user: 'viewer-user' })).status, 403);

  assert.equal(consoleErrors.filter((message) => !message.includes('403 (Forbidden)')).length, 0, consoleErrors.join('\n'));
});
