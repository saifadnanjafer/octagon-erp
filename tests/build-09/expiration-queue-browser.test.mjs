import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createLot } from '../../platform/inventory/traceability.mjs';
import { postStockMove } from '../../platform/inventory/ledger.mjs';
import { createWarehouse } from '../../platform/inventory/warehouses.mjs';
import * as traceability from '../../platform/wms/traceability-ops.mjs';
import { browserAction, clickStable, openBuild09Browser } from './browser-harness.mjs';

const FIXED_NOW = '2026-08-05T00:00:00.000Z';

function seedExpiringLot(dialect, seed, { key, expires, locationId, lotNumber = `EXP-${key}` }) {
  const lot = createLot(dialect, {
    company_id: seed.companyId, product_id: seed.productId, lot_number: lotNumber,
    manufactured_at: '2026-01-01', expires_at: expires,
  });
  postStockMove(dialect, {
    company_id: seed.companyId, branch_id: 'branch-a', reference: `EXPIRY/${key}`,
    product_id: seed.productId, uom_id: 'unit', product_qty: 1,
    location_id: seed.supplier.id, location_dest_id: locationId, lot_id: lot.id,
    source_document_type: 'purchase_receipt', source_document_id: `expiry-${key}`,
    idempotency_key: `expiry-move-${key}`,
  });
  traceability.upsertTraceProfile(dialect, {
    company_id: seed.companyId, lot_id: lot.id, expiry_date: expires,
    quality_status: 'released', actor: 'profile-writer',
  });
  return lot;
}

async function reopen(page) {
  await page.evaluate((fixedNow) => { window.__BUILD09_NOW__ = fixedNow; window.switchPage('expiration_queue'); }, FIXED_NOW);
  await page.waitForFunction(() => document.querySelector('[data-role="ex-body"]')?.innerText && !document.querySelector('[data-role="ex-body"] [data-phase="loading"]'));
}

const rowCount = (page) => page.$$eval('[data-role="ex-list"] .b09r-queue-row', (rows) => rows.length);

test('expiration queue uses deterministic governed windows filters scope and Quality proposal', { timeout: 90000 }, async (t) => {
  const { consoleErrors, dialect, page, seed } = await openBuild09Browser(t, {
    name: 'expiration', initialPage: 'expiration_queue',
    extraModules: ['build09r-shared.js', 'build09-expiration-workspace.js'],
  });
  const otherWarehouse = createWarehouse(dialect, { company_id: seed.companyId, name: 'Other Expiry DC', code: 'OEXP' });
  dialect.prepare('INSERT INTO warehouse_branch_scopes(warehouse_id,company_id,branch_id,created_at) VALUES(?,?,?,?)')
    .run(otherWarehouse.id, seed.companyId, 'branch-a', new Date().toISOString());
  const expired = seedExpiringLot(dialect, seed, { key: 'expired', expires: '2026-08-04T00:00:00.000Z', locationId: seed.source.locationId });
  const soon = seedExpiringLot(dialect, seed, { key: 'soon', expires: '2026-08-10T00:00:00.000Z', locationId: seed.destination.locationId });
  const month = seedExpiringLot(dialect, seed, { key: 'month', expires: '2026-08-25T00:00:00.000Z', locationId: seed.staging.locationId });
  const quarter = seedExpiringLot(dialect, seed, { key: 'quarter', expires: '2026-10-20T00:00:00.000Z', locationId: seed.source.locationId });
  seedExpiringLot(dialect, seed, { key: 'later', expires: '2027-01-01T00:00:00.000Z', locationId: seed.source.locationId });
  seedExpiringLot(dialect, seed, { key: 'other-wh', expires: '2026-08-08T00:00:00.000Z', locationId: otherWarehouse.lot_stock_id });
  const stockBefore = dialect.prepare('SELECT id,quantity,reserved_quantity FROM stock_quants ORDER BY id').all();
  const movesBefore = dialect.prepare('SELECT COUNT(*) count FROM stock_moves').get().count;

  await reopen(page);
  assert.equal(await rowCount(page), 3, '30-day window includes expired, soon, and month rows only');
  const initial = await page.$eval('[data-role="ex-list"]', (node) => node.innerText);
  assert.match(initial, /EXP-expired/);
  assert.match(initial, /1 overdue/i);
  assert.match(initial, /EXP-soon/);
  assert.match(initial, /5 days/i);
  assert.doesNotMatch(initial, /EXP-other-wh/, 'the other warehouse is excluded');

  await page.select('[data-role="ex-days"]', '7');
  await page.waitForFunction(() => document.querySelectorAll('[data-role="ex-list"] .b09r-queue-row').length === 2);
  assert.equal(await rowCount(page), 2);
  await page.select('[data-role="ex-days"]', '30');
  await page.waitForFunction(() => document.querySelectorAll('[data-role="ex-list"] .b09r-queue-row').length === 3);
  await page.select('[data-role="ex-days"]', '90');
  await page.waitForFunction(() => document.querySelectorAll('[data-role="ex-list"] .b09r-queue-row').length === 4);
  assert.match(await page.$eval('[data-role="ex-list"]', (node) => node.innerText), /EXP-quarter/);

  await page.$eval('[data-role="ex-product"]', (input) => { input.value = 'missing-product'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.equal(await rowCount(page), 0, 'Product filter removes non-matching rows');
  await page.$eval('[data-role="ex-product"]', (input) => { input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.equal(await rowCount(page), 4);
  await page.$eval('[data-role="ex-location"]', (input, value) => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); }, seed.destination.locationId);
  assert.equal(await rowCount(page), 1, 'Location filter selects the current canonical location');
  assert.match(await page.$eval('[data-role="ex-list"]', (node) => node.innerText), /EXP-soon/);
  await page.$eval('[data-role="ex-location"]', (input) => { input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); });

  await clickStable(page, `[data-role="ex-propose"][data-lot-id="${soon.id}"]`);
  await page.waitForFunction((lotId) => document.querySelector(`[data-role="ex-propose"][data-lot-id="${lotId}"]`) && !document.querySelector('[data-role="ex-alert"]'), {}, soon.id);
  assert.equal(dialect.prepare('SELECT quality_status FROM wms_trace_profiles WHERE lot_id=?').get(soon.id).quality_status, 'quarantine');
  assert.deepEqual(dialect.prepare('SELECT id,quantity,reserved_quantity FROM stock_quants ORDER BY id').all(), stockBefore, 'Quality proposal mutates no stock quantity');
  assert.equal(dialect.prepare('SELECT COUNT(*) count FROM stock_moves').get().count, movesBefore, 'Quality proposal performs no movement or automatic scrap');

  await clickStable(page, `[data-role="ex-trace"][data-lot-id="${expired.id}"]`);
  await page.waitForFunction(() => document.querySelector('[data-build09-page="lot_serial_traceability"]')?.classList.contains('page-active'));

  await assert.rejects(() => browserAction(page, 'wms:trace_quality_set', {
    warehouse_id: seed.warehouse.id, lot_id: month.id, quality_status: 'quarantine',
  }, { user: 'viewer-user', warehouse: seed.warehouse.id }), /403|Permission denied/i);
  assert.equal(dialect.prepare('SELECT quality_status FROM wms_trace_profiles WHERE lot_id=?').get(month.id).quality_status, 'released');

  const source = fs.readFileSync(new URL('../../modules/build09-expiration-workspace.js', import.meta.url), 'utf8');
  assert.match(source, /wms:trace_quality_set/);
  assert.match(source, /quality_status:\s*'quarantine'/);
  assert.doesNotMatch(source, /stock:move:post|wms:scrap|stock:scrap|INSERT\s+INTO\s+stock_|UPDATE\s+stock_/i);
  assert.equal(consoleErrors.filter((message) => !/403|Permission denied/i.test(message)).length, 0, consoleErrors.join('\n'));
});
