import assert from 'node:assert/strict';
import test from 'node:test';
import { openBuild09Browser } from './browser-harness.mjs';
import { createProductionOrder } from '../../platform/manufacturing/manufacturing-orders.mjs';
import * as inspection from '../../platform/quality/inspection.mjs';

function seedProductionAndQuality(dialect, seed) {
  const stamp = new Date().toISOString();
  dialect.prepare(`INSERT INTO boms(id,company_id,code,product_id,name_en,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run('bom-b09-pq', seed.companyId, 'BOM-B09-PQ', seed.productId, 'BUILD-09R Product BOM', 'planner-a', stamp, stamp);
  dialect.prepare(`INSERT INTO bom_versions(id,company_id,bom_id,revision,state,approved_by,approved_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`)
    .run('bomv-b09-pq', seed.companyId, 'bom-b09-pq', 1, 'approved', 'approver-b', stamp, stamp, stamp);
  const order = createProductionOrder(dialect, {
    company_id: seed.companyId, product_id: seed.productId, planned_quantity: 10, bom_version_id: 'bomv-b09-pq',
    warehouse_id: seed.warehouse.id, wip_location_id: seed.destination.locationId, finished_location_id: seed.staging.locationId, actor: 'planner-a',
  });
  dialect.prepare(`INSERT INTO work_centers(id,company_id,code,name_ar,name_en,warehouse_id,wip_location_id,capacity_per_hour,efficiency_percent,working_hours_per_day,is_active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('wc-b09-pq', seed.companyId, 'WC-B09-PQ', 'تجميع', 'Assembly', seed.warehouse.id, seed.destination.locationId, 12, 95, 8, 1, stamp, stamp);
  dialect.prepare(`INSERT INTO mfg_work_orders(id,company_id,production_order_id,operation_sequence,work_center_id,name,planned_setup_minutes,planned_run_minutes,quantity_to_produce,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('wo-b09-pq', seed.companyId, order.id, 10, 'wc-b09-pq', 'Assembly operation', 5, 60, 10, 'ready', stamp, stamp);
  dialect.prepare(`UPDATE mfg_production_orders SET state='released',planned_start_date=?,planned_end_date=?,updated_at=? WHERE id=?`)
    .run('2026-08-03T08:00:00.000Z', '2026-08-03T09:00:00.000Z', stamp, order.id);
  const plan = inspection.createQualityPlan(dialect, { company_id: seed.companyId, name: 'BUILD-09R In-process Plan', code: 'QP-B09-PQ', product_id: seed.productId, points: [{ title: 'Torque', test_type: 'pass_fail' }] });
  const canonicalInspection = inspection.createQualityInspection(dialect, { company_id: seed.companyId, plan_id: plan.id, inspection_type: 'in_process', source_type: 'work_order', source_id: 'wo-b09-pq', product_id: seed.productId, sample_size: 2, actor: 'inspector-a' });
  return { orderId: order.id, workOrderId: 'wo-b09-pq', workCenterId: 'wc-b09-pq', inspectionId: canonicalInspection.id };
}

// Real Chromium flow 5 (production + quality): opens a shop-floor session through the real
// dialog, runs it to completion, then opens a quality checkpoint - the last of the required
// lifecycle flows, proving the shopfloor:* and quality:* action forms (not just wms:*).
test('real Chromium runs a shop-floor session to completion and opens a quality checkpoint', async (t) => {
  const { consoleErrors, dialect, page, seed } = await openBuild09Browser(t, { name: 'prodqual', initialPage: 'shopfloor_terminal' });
  const fixture = seedProductionAndQuality(dialect, seed);

  await page.waitForSelector('[data-build09-page="shopfloor_terminal"] [data-action="shopfloor:session_open"]:not([disabled])', { timeout: 15000 });
  await page.click('[data-build09-page="shopfloor_terminal"] [data-action="shopfloor:session_open"]');
  await page.waitForSelector('#build09ActionDialog[open] [data-lookup-resource="workOrders"] .b09-lookup-query', { timeout: 5000 });
  await page.type('#build09ActionDialog [data-lookup-resource="workOrders"] .b09-lookup-query', 'Assembly');
  await page.waitForFunction(() => document.querySelector('#build09ActionDialog [data-lookup-resource="workOrders"] .b09-lookup-select')?.options.length > 1, { timeout: 5000 });
  await page.select('#build09ActionDialog [data-lookup-resource="workOrders"] .b09-lookup-select', fixture.workOrderId);
  await page.click('#build09ActionDialog [data-command="submit"]');
  await page.waitForFunction(() => !document.getElementById('build09ActionDialog').open, { timeout: 10000 });

  const sessionRow = dialect.prepare('SELECT id, status FROM mfg_shopfloor_sessions WHERE company_id=? AND work_order_id=?').get(seed.companyId, fixture.workOrderId);
  assert.ok(sessionRow, 'shop-floor session was not created through the real dialog form');

  await page.click('[data-build09-page="shopfloor_terminal"] [data-action="shopfloor:operation_start"]');
  await page.waitForSelector('#build09ActionDialog[open] [data-lookup-resource="shopfloorSessions"] .b09-lookup-query', { timeout: 5000 });
  await page.type('#build09ActionDialog [data-lookup-resource="shopfloorSessions"] .b09-lookup-query', 'Assembly');
  await page.waitForFunction(() => document.querySelector('#build09ActionDialog [data-lookup-resource="shopfloorSessions"] .b09-lookup-select')?.options.length > 1, { timeout: 5000 });
  await page.select('#build09ActionDialog [data-lookup-resource="shopfloorSessions"] .b09-lookup-select', sessionRow.id);
  await page.click('#build09ActionDialog [data-command="submit"]');
  await page.waitForFunction(() => !document.getElementById('build09ActionDialog').open, { timeout: 10000 });

  const runningRow = dialect.prepare('SELECT status FROM mfg_shopfloor_sessions WHERE id=?').get(sessionRow.id);
  assert.notEqual(runningRow.status, 'open', 'operation_start through the real dialog did not advance the session');

  await page.evaluate(() => window.switchPage('quality_hold_queue'));
  await page.waitForFunction(() => document.querySelector('[data-build09-page="quality_hold_queue"]')?.classList.contains('page-active'));
  await page.waitForSelector('[data-build09-page="quality_hold_queue"] [data-action="quality:checkpoint_open"]:not([disabled])', { timeout: 15000 });
  await page.click('[data-build09-page="quality_hold_queue"] [data-action="quality:checkpoint_open"]');
  await page.waitForSelector('#build09ActionDialog[open] #b09f-source_type', { timeout: 5000 });
  await page.select('#b09f-source_type', 'work_order');
  await page.type('#b09f-source_id', fixture.workOrderId);
  await page.type('#build09ActionDialog [data-lookup-resource="products"] .b09-lookup-query', 'Browser Product');
  await page.waitForFunction(() => document.querySelector('#build09ActionDialog [data-lookup-resource="products"] .b09-lookup-select')?.options.length > 1, { timeout: 5000 });
  await page.select('#build09ActionDialog [data-lookup-resource="products"] .b09-lookup-select', seed.productId);
  await page.select('#b09f-checkpoint_type', 'in_process');
  await page.type('#b09f-inspection_id', fixture.inspectionId);
  await page.click('#build09ActionDialog [data-command="submit"]');
  try {
    await page.waitForFunction(() => !document.getElementById('build09ActionDialog').open, { timeout: 10000 });
  } catch (waitError) {
    const dialogError = await page.$eval('#build09ActionDialog [data-role="dialog-error"]', (el) => el.textContent).catch(() => '(no error text)');
    throw new Error(`checkpoint_open dialog did not close: ${dialogError}`);
  }

  const checkpointRow = dialect.prepare('SELECT id, source_type, checkpoint_type FROM quality_operational_checkpoints WHERE company_id=? AND inspection_id=?').get(seed.companyId, fixture.inspectionId);
  assert.ok(checkpointRow, 'quality checkpoint was not created through the real dialog form');
  assert.equal(checkpointRow.checkpoint_type, 'in_process');

  assert.equal(consoleErrors.length, 0, consoleErrors.join('\n'));
});
