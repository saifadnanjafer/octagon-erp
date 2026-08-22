import assert from 'node:assert/strict';
import test from 'node:test';
import { browserAction, clickStable, latinDigits, openBuild09Browser } from './browser-harness.mjs';

// BUILD-09R-2 Group G: real Chromium drives Dock Schedule, Dock Check-In, Staging Board and
// Cross-Dock (modules/build09-dock-workspace.js) through visible controls only.
//
// These four pages are one physical flow, so the tests follow it: schedule a vehicle against a
// dock, check it in late enough to accrue detention, assign and service it, stage its stock into
// a capacity-bounded lane, and cross-dock part of it onto an outbound appointment.
//
// Three server verdicts are asserted as rendered denials rather than assumed: a dock time
// collision, a staging lane capacity overrun, and the cross-dock maker-checker rule.

const DOCK_MODULES = ['build09r-shared.js', 'build09-dock-workspace.js'];

const DAY = '2026-08-05';
const at = (hour) => `${DAY}T${String(hour).padStart(2, '0')}:00:00.000Z`;
/** datetime-local inputs take a local, zone-less value; the workspace re-serialises to ISO. */
const localAt = (hour) => `${DAY}T${String(hour).padStart(2, '0')}:00`;

async function seedDocks(page, seed) {
  const inbound = await browserAction(page, 'wms:dock_create', { warehouse_id: seed.warehouse.id, code: 'D1', name: 'Inbound One', dock_type: 'inbound', capacity_units: 50, staging_location_id: seed.staging.locationId });
  const outbound = await browserAction(page, 'wms:dock_create', { warehouse_id: seed.warehouse.id, code: 'D2', name: 'Outbound Two', dock_type: 'outbound', capacity_units: 50, staging_location_id: seed.staging.locationId });
  return { inbound, outbound };
}

async function fillAppointment(page, host, { type, dockId, from, to, carrier, vehicle, units = '0' }) {
  await page.select(`${host} [data-role="ds-appointment-form"] [name="appointment_type"]`, type);
  await page.select(`${host} [data-role="ds-appointment-form"] [name="dock_id"]`, dockId || '');
  // datetime-local is a segmented widget - page.type() sends keystrokes its parser ignores and
  // leaves the field empty. Set the value directly, as a real date picker would.
  for (const [name, value] of [['expected_arrival', from], ['expected_departure', to]]) {
    await page.$eval(`${host} [data-role="ds-appointment-form"] [name="${name}"]`, (input, next) => {
      input.value = next;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
  }
  if (carrier) await page.type(`${host} [data-role="ds-appointment-form"] [name="carrier_name"]`, carrier);
  if (vehicle) await page.type(`${host} [data-role="ds-appointment-form"] [name="vehicle_reference"]`, vehicle);
  await page.$eval(`${host} [data-role="ds-appointment-form"] [name="expected_units"]`, (input) => { input.value = ''; });
  await page.type(`${host} [data-role="ds-appointment-form"] [name="expected_units"]`, units);
  await page.click(`${host} [data-role="ds-appointment-form"] button[type="submit"]`);
}

test('real Chromium schedules dock appointments onto a per-dock timeline and surfaces a collision', async (t) => {
  const { consoleErrors, dialect, page, seed } = await openBuild09Browser(t, { name: 'dock-schedule-ui', initialPage: 'dock_schedule', extraModules: DOCK_MODULES });
  const host = '[data-build09-page="dock_schedule"]';
  const docks = await seedDocks(page, seed);

  await page.evaluate(() => window.switchPage('dock_schedule'));
  await page.waitForSelector(`${host} [data-role="ds-appointment-form"]`, { timeout: 15000 });

  // Every configured dock gets a lane, plus one holding lane for unassigned appointments.
  const lanes = await page.$$eval(`${host} [data-role="ds-lane"]`, (nodes) => nodes.map((node) => node.dataset.dockId));
  assert.deepEqual(lanes, [docks.inbound.id, docks.outbound.id, 'unassigned']);

  await fillAppointment(page, host, { type: 'inbound', dockId: docks.inbound.id, from: localAt(9), to: localAt(11), carrier: 'ACME Freight', vehicle: 'TRK-100', units: '10' });
  await page.waitForFunction((selector, dockId) => document.querySelectorAll(`${selector} [data-role="ds-lane"][data-dock-id="${dockId}"] [data-role="ds-block"]`).length === 1, { timeout: 15000 }, host, docks.inbound.id);

  const booked = dialect.prepare("SELECT * FROM wms_dock_appointments_v2 WHERE vehicle_reference='TRK-100'").get();
  assert.equal(booked.dock_id, docks.inbound.id);
  assert.equal(booked.appointment_type, 'inbound');
  assert.equal(booked.status, 'scheduled', 'booking against a named dock schedules it outright');

  // The block must be positioned by its real time window, not merely present.
  const geometry = await page.$eval(`${host} [data-role="ds-lane"][data-dock-id="${docks.inbound.id}"] [data-role="ds-block"]`, (node) => ({
    start: node.style.getPropertyValue('inset-inline-start'), width: node.style.width, text: node.textContent.trim(),
  }));
  assert.match(geometry.text, /ACME Freight/);
  assert.equal(Math.round(parseFloat(geometry.start)), Math.round(9 / 24 * 100), 'a 09:00 arrival sits 9/24 across the day');
  assert.equal(Math.round(parseFloat(geometry.width)), Math.round(2 / 24 * 100), 'a two-hour window is 2/24 wide');

  // A colliding window on the same dock is refused by the server and rendered as a denial.
  await fillAppointment(page, host, { type: 'inbound', dockId: docks.inbound.id, from: localAt(10), to: localAt(12), carrier: 'Overlap Freight', vehicle: 'TRK-200' });
  await page.waitForFunction((selector) => document.querySelector(selector)?.dataset.phase != null, { timeout: 10000 }, `${host} [data-role="ds-alert"]`);
  assert.match(await page.$eval(`${host} [data-role="ds-alert"]`, (node) => node.textContent), /conflicting appointment/i);
  assert.equal(dialect.prepare("SELECT COUNT(*) c FROM wms_dock_appointments_v2 WHERE vehicle_reference='TRK-200'").get().c, 0);

  // An appointment booked with no dock is held in the unassigned lane until check-in assigns one.
  await fillAppointment(page, host, { type: 'outbound', dockId: '', from: localAt(14), to: localAt(15), carrier: 'Pending Freight', vehicle: 'TRK-300' });
  await page.waitForFunction((selector) => document.querySelectorAll(`${selector} [data-role="ds-lane"][data-dock-id="unassigned"] [data-role="ds-block"]`).length === 1, { timeout: 15000 }, host);
  assert.equal(dialect.prepare("SELECT status,dock_id FROM wms_dock_appointments_v2 WHERE vehicle_reference='TRK-300'").get().status, 'expected');

  assert.equal(consoleErrors.filter((message) => !/403|409/.test(message)).length, 0, consoleErrors.join('\n'));
});

test('real Chromium runs the gatehouse from check-in through departure and accrues detention', async (t) => {
  const { consoleErrors, dialect, page, seed } = await openBuild09Browser(t, { name: 'dock-checkin-ui', initialPage: 'dock_checkin', extraModules: DOCK_MODULES });
  const host = '[data-build09-page="dock_checkin"]';
  const docks = await seedDocks(page, seed);

  // The booked window must be unambiguously in the past so that checking in now is late and
  // detention genuinely starts - anchoring it to "today at 06:00" would flip depending on what
  // time of day the suite happens to run.
  const past = new Date(Date.now() - 48 * 3600 * 1000);
  const appointment = await browserAction(page, 'wms:dock_appointment_create', {
    warehouse_id: seed.warehouse.id, appointment_type: 'inbound',
    expected_arrival: past.toISOString(), expected_departure: new Date(past.getTime() + 3600 * 1000).toISOString(),
    carrier_name: 'Late Freight', expected_units: 5,
  });
  assert.equal(appointment.status, 'expected', 'no dock named yet');

  await page.evaluate(() => window.switchPage('dock_checkin'));
  await page.waitForFunction((selector) => document.querySelectorAll(`${selector} [data-role="dc-select"]`).length > 0, { timeout: 15000 }, host);
  await clickStable(page, `${host} [data-role="dc-select"][data-appointment-id="${appointment.id}"]`);

  await page.waitForSelector(`${host} [data-role="dc-checkin-form"]`, { timeout: 10000 });
  await page.type(`${host} [data-role="dc-checkin-form"] [name="vehicle_reference"]`, 'TRK-LATE');
  await page.click(`${host} [data-role="dc-checkin-form"] button[type="submit"]`);

  await page.waitForSelector(`${host} [data-role="dc-detention-note"]`, { timeout: 10000 });
  const checkedIn = dialect.prepare('SELECT * FROM wms_dock_appointments_v2 WHERE id=?').get(appointment.id);
  assert.equal(checkedIn.status, 'checked_in');
  assert.equal(checkedIn.vehicle_reference, 'TRK-LATE');
  assert.equal(checkedIn.checked_in_by, 'browser-manager');
  assert.ok(checkedIn.detention_started_at, 'arriving after the booked window starts detention');

  const clock = await page.$eval(`${host} [data-role="dc-detention"]`, (node) => node.dataset.since);
  assert.equal(clock, checkedIn.detention_started_at, 'the ticking clock is anchored to the real detention start');

  // Only docks matching the appointment direction are offered - the outbound dock must not be.
  const offered = await page.$$eval(`${host} [data-role="dc-assign-form"] [name="dock_id"] option`, (nodes) => nodes.map((node) => node.value));
  assert.deepEqual(offered, [docks.inbound.id], 'an inbound appointment is not offered an outbound dock');

  await page.select(`${host} [data-role="dc-assign-form"] [name="dock_id"]`, docks.inbound.id);
  await page.click(`${host} [data-role="dc-assign-form"] button[type="submit"]`);
  await page.waitForSelector(`${host} [data-role="dc-start"]`, { timeout: 10000 });
  assert.equal(dialect.prepare('SELECT status,dock_id FROM wms_dock_appointments_v2 WHERE id=?').get(appointment.id).dock_id, docks.inbound.id);

  await clickStable(page, `${host} [data-role="dc-start"]`);
  await page.waitForSelector(`${host} [data-role="dc-depart"]`, { timeout: 10000 });
  assert.equal(dialect.prepare('SELECT status FROM wms_dock_appointments_v2 WHERE id=?').get(appointment.id).status, 'unloading', 'an inbound appointment enters unloading, not loading');

  await clickStable(page, `${host} [data-role="dc-depart"]`);
  await page.waitForFunction((selector) => document.querySelectorAll(`${selector} [data-role="dc-select"]`).length === 0, { timeout: 15000 }, host);
  const departed = dialect.prepare('SELECT status,actual_departure,detention_ended_at FROM wms_dock_appointments_v2 WHERE id=?').get(appointment.id);
  assert.equal(departed.status, 'departed');
  assert.ok(departed.actual_departure);
  assert.ok(departed.detention_ended_at, 'detention stops when the vehicle leaves');

  assert.equal(consoleErrors.filter((message) => !/403|409/.test(message)).length, 0, consoleErrors.join('\n'));
});

test('real Chromium fills a staging lane to capacity and is refused the overrun', async (t) => {
  const { consoleErrors, dialect, page, seed } = await openBuild09Browser(t, { name: 'staging-board-ui', initialPage: 'staging_board', extraModules: DOCK_MODULES });
  const host = '[data-build09-page="staging_board"]';

  await page.waitForSelector(`${host} [data-role="sg-allocate-form"]`, { timeout: 15000 });
  const laneMeter = `${host} [data-role="sg-lane"][data-location-id="${seed.staging.locationId}"] [data-role="sg-meter"]`;
  assert.equal(await page.$eval(laneMeter, (node) => node.dataset.capacity), '100', 'the lane renders its configured capacity');
  assert.equal(await page.$eval(laneMeter, (node) => node.dataset.used), '0');

  const allocate = async (quantity, sourceId) => {
    await page.select(`${host} [data-role="sg-allocate-form"] [name="staging_location_id"]`, seed.staging.locationId);
    for (const [name, value] of [['source_type', 'dock_appointment'], ['source_id', sourceId], ['quantity', quantity]]) {
      await page.$eval(`${host} [data-role="sg-allocate-form"] [name="${name}"]`, (input) => { input.value = ''; });
      await page.type(`${host} [data-role="sg-allocate-form"] [name="${name}"]`, value);
    }
    await page.click(`${host} [data-role="sg-allocate-form"] button[type="submit"]`);
  };

  await allocate('60', 'appt-a');
  await page.waitForFunction((selector) => document.querySelector(selector)?.dataset.used === '60', { timeout: 15000 }, laneMeter);
  const fill = await page.$eval(`${host} [data-role="sg-lane"] .b09r-lane-fill`, (node) => node.style.width);
  assert.equal(Math.round(parseFloat(fill)), 60, 'the meter is drawn at the real 60/100 occupancy');

  // 60 + 60 exceeds the lane's configured 100 - the server refuses and the board says so.
  await allocate('60', 'appt-b');
  await page.waitForFunction((selector) => document.querySelector(selector)?.dataset.phase != null, { timeout: 10000 }, `${host} [data-role="sg-alert"]`);
  assert.match(await page.$eval(`${host} [data-role="sg-alert"]`, (node) => node.textContent), /capacity exceeded/i);
  assert.equal(dialect.prepare("SELECT COUNT(*) c FROM wms_staging_allocations WHERE source_id='appt-b'").get().c, 0, 'the refused allocation was not written');
  assert.equal(await page.$eval(laneMeter, (node) => node.dataset.used), '60', 'occupancy is unchanged by the refusal');

  // Releasing frees the lane for the allocation that was just refused.
  await clickStable(page, `${host} [data-role="sg-release"]`);
  await page.waitForFunction((selector) => document.querySelector(selector)?.dataset.used === '0', { timeout: 15000 }, laneMeter);
  assert.equal(dialect.prepare("SELECT status FROM wms_staging_allocations WHERE source_id='appt-a'").get().status, 'released');

  await allocate('60', 'appt-b');
  await page.waitForFunction((selector) => document.querySelector(selector)?.dataset.used === '60', { timeout: 15000 }, laneMeter);
  assert.equal(dialect.prepare("SELECT quantity FROM wms_staging_allocations WHERE source_id='appt-b'").get().quantity, 60);

  assert.equal(consoleErrors.filter((message) => !/403|409/.test(message)).length, 0, consoleErrors.join('\n'));
});

test('real Chromium cross-docks inbound stock onto an outbound appointment without moving it itself', async (t) => {
  const { consoleErrors, dialect, page, seed } = await openBuild09Browser(t, { name: 'crossdock-ui', initialPage: 'crossdock_workspace', extraModules: DOCK_MODULES });
  const host = '[data-build09-page="crossdock_workspace"]';
  const docks = await seedDocks(page, seed);

  const inbound = await browserAction(page, 'wms:dock_appointment_create', { warehouse_id: seed.warehouse.id, appointment_type: 'inbound', dock_id: docks.inbound.id, expected_arrival: at(8), expected_departure: at(10), vehicle_reference: 'TRK-IN', expected_units: 20 });
  const outbound = await browserAction(page, 'wms:dock_appointment_create', { warehouse_id: seed.warehouse.id, appointment_type: 'outbound', dock_id: docks.outbound.id, expected_arrival: at(12), expected_departure: at(14), vehicle_reference: 'TRK-OUT', expected_units: 20 });

  // The inbound vehicle's stock has to actually be in the staging lane for the cross-dock to have
  // anything to move; the harness only seeds the pick bin. Done before the snapshot below so the
  // "nothing moved yet" assertion measures the cross-dock alone.
  await browserAction(page, 'stock:move:post', {
    company_id: seed.companyId, branch_id: 'branch-a', reference: 'XDOCK-SEED', product_id: seed.productId,
    uom_id: 'unit', product_qty: 10, location_id: seed.supplier.id, location_dest_id: seed.staging.locationId,
    unit_cost: 10, idempotency_key: 'xdock-staging-seed',
  }, { user: 'browser-inventory' });
  const stockBefore = dialect.prepare('SELECT id,quantity FROM stock_quants WHERE company_id=? ORDER BY id').all(seed.companyId);

  await page.evaluate(() => window.switchPage('crossdock_workspace'));
  await page.waitForSelector(`${host} [data-role="xd-evaluate-form"]`, { timeout: 15000 });

  await page.select(`${host} [data-role="xd-evaluate-form"] [name="inbound_appointment_id"]`, inbound.id);
  await page.select(`${host} [data-role="xd-evaluate-form"] [name="outbound_appointment_id"]`, outbound.id);
  for (const [name, value] of [['inbound_source_type', 'purchase_order'], ['inbound_source_id', 'po-xd-1'], ['outbound_source_type', 'sale_order'], ['outbound_source_id', 'so-xd-1'], ['available_quantity', '8'], ['demand_quantity', '10']]) {
    await page.type(`${host} [data-role="xd-evaluate-form"] [name="${name}"]`, value);
  }

  // Governed lookups for the product and both locations.
  const pick = async (resource, name, query, value) => {
    const wrapper = `${host} [data-role="xd-evaluate-form"] [data-lookup-resource="${resource}"]:has([name="${name}"])`;
    await page.type(`${wrapper} .b09-lookup-query`, query);
    await page.waitForFunction((selector) => {
      const node = document.querySelector(selector);
      return node && node.options.length > 1;
    }, { timeout: 8000 }, `${wrapper} .b09-lookup-select`);
    await page.select(`${wrapper} .b09-lookup-select`, value);
  };
  await pick('products', 'product_id', 'Browser Product', seed.productId);
  await pick('locations', 'staging_location_id', 'Browser Staging', seed.staging.locationId);
  await pick('locations', 'outbound_location_id', 'Browser Putaway', seed.destination.locationId);
  await page.click(`${host} [data-role="xd-evaluate-form"] button[type="submit"]`);

  await page.waitForSelector(`${host} [data-role="xd-detail"]`, { timeout: 15000 });
  const match = dialect.prepare('SELECT * FROM wms_crossdock_matches ORDER BY created_at DESC LIMIT 1').get();
  assert.equal(Number(match.matched_quantity), 8, 'only the available 8 of the demanded 10 can cross-dock');
  assert.equal(match.status, 'partial', 'a short match is honestly partial, not a full candidate');
  const score = latinDigits(await page.$eval(`${host} [data-role="xd-score"]`, (node) => node.textContent));
  assert.equal(score, String(Math.round(Number(match.eligibility_score))), 'the rendered score is the server-computed eligibility');

  // Maker-checker: whoever proposed the match cannot approve it.
  await clickStable(page, `${host} [data-role="xd-approve"]`);
  await page.waitForFunction((selector) => document.querySelector(selector)?.dataset.phase === 'denied', { timeout: 10000 }, `${host} [data-role="xd-alert"]`);
  assert.match(await page.$eval(`${host} [data-role="xd-alert"]`, (node) => node.textContent), /maker-checker/i);
  assert.equal(dialect.prepare('SELECT status FROM wms_crossdock_matches WHERE id=?').get(match.id).status, 'partial');

  const approved = await browserAction(page, 'wms:crossdock_approve', { warehouse_id: seed.warehouse.id, match_id: match.id }, { user: 'crossdock-supervisor' });
  assert.equal(approved.taskGenerated, true);
  assert.equal(approved.inventoryWritten, false);

  // Evaluating already selected this match, and re-entering the page keeps that selection - so
  // the detail panel is open and must simply re-render at the new status. Clicking the row again
  // would toggle it closed.
  await page.evaluate(() => window.switchPage('crossdock_workspace'));
  await page.waitForSelector(`${host} [data-role="xd-canonical"]`, { timeout: 15000 });
  assert.match(await page.$eval(`${host} [data-role="xd-canonical"]`, (node) => node.textContent), /stock:move:post/);

  await clickStable(page, `${host} [data-role="xd-request"]`);
  await page.waitForSelector(`${host} [data-role="xd-ack-form"]`, { timeout: 10000 });
  assert.equal(dialect.prepare('SELECT status FROM wms_crossdock_matches WHERE id=?').get(match.id).status, 'awaiting_canonical');
  assert.deepEqual(dialect.prepare('SELECT id,quantity FROM stock_quants WHERE company_id=? ORDER BY id').all(seed.companyId), stockBefore, 'nothing has moved yet - the workspace only requested');

  const request = JSON.parse(dialect.prepare('SELECT canonical_request_json FROM wms_crossdock_matches WHERE id=?').get(match.id).canonical_request_json);
  const move = await browserAction(page, 'stock:move:post', { ...request, uom_id: 'unit' }, { user: 'browser-inventory' });
  assert.equal(move.state, 'done');

  await page.type(`${host} [data-role="xd-ack-form"] [name="canonical_result_id"]`, move.id);
  await page.click(`${host} [data-role="xd-ack-form"] button[type="submit"]`);
  await page.waitForSelector(`${host} [data-role="xd-completed"]`, { timeout: 10000 });
  assert.equal(dialect.prepare('SELECT status,canonical_result_id FROM wms_crossdock_matches WHERE id=?').get(match.id).canonical_result_id, move.id);
  assert.equal(dialect.prepare("SELECT status FROM wms_warehouse_tasks WHERE source_record_type='crossdock_match' AND source_record_id=?").get(match.id).status, 'completed');

  assert.equal(consoleErrors.filter((message) => !/403|409/.test(message)).length, 0, consoleErrors.join('\n'));
});
