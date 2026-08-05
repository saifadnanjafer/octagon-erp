import assert from 'node:assert/strict';
import test from 'node:test';
import { createLot } from '../../platform/inventory/traceability.mjs';
import { postStockMove } from '../../platform/inventory/ledger.mjs';
import { browserAction, clickStable, openBuild09Browser } from './browser-harness.mjs';

// BUILD-09R-2 Group C: real Chromium drives Lot/Serial Traceability and Recall Analysis
// (modules/build09-trace-workspace.js) through visible controls only - including the governed
// lot picker, which had to be repaired first (it pointed at /api/v1/wms/lots, which does not
// exist) and is exercised here by typing a lot number and selecting the returned row.
//
// The recall assertions deliberately check what did NOT happen: no customer was messaged, no
// work item was created, and no stock was held. A recall screen that appears to have already
// notified customers is more dangerous than no screen at all.

const TRACE_MODULES = ['build09r-shared.js', 'build09-trace-workspace.js'];

function seedTracedLot(dialect, seed) {
  const lot = createLot(dialect, { company_id: seed.companyId, product_id: seed.productId, lot_number: 'UI-LOT-4200', manufactured_at: '2026-07-01', expires_at: '2026-09-30' });
  postStockMove(dialect, {
    company_id: seed.companyId, branch_id: 'branch-a', reference: 'RECEIPT/UI-4200', product_id: seed.productId, uom_id: 'unit', product_qty: 6,
    location_id: seed.source.locationId, location_dest_id: seed.destination.locationId, lot_id: lot.id,
    source_document_type: 'purchase_receipt', source_document_id: 'receipt-ui-4200', idempotency_key: 'trace-ui-receipt-4200',
  });
  postStockMove(dialect, {
    company_id: seed.companyId, branch_id: 'branch-a', reference: 'DELIVERY/UI-4200', product_id: seed.productId, uom_id: 'unit', product_qty: 4,
    location_id: seed.destination.locationId, location_dest_id: seed.staging.locationId, lot_id: lot.id,
    source_document_type: 'sale_delivery', source_document_id: 'delivery-ui-4200', idempotency_key: 'trace-ui-delivery-4200',
  });
  return lot;
}

async function pickLot(page, host, lotId) {
  await page.type(`${host} [data-lookup-resource="lots"] .b09-lookup-query`, 'UI-LOT-4200');
  await page.waitForFunction((selector) => {
    const node = document.querySelector(selector);
    return node && node.options.length > 1;
  }, { timeout: 8000 }, `${host} [data-lookup-resource="lots"] .b09-lookup-select`);
  // The repaired lookup must render a readable lot number, not a bare UUID.
  const label = await page.$eval(`${host} [data-lookup-resource="lots"] .b09-lookup-select`, (node) => node.options[1].textContent);
  assert.equal(label, 'UI-LOT-4200');
  await page.select(`${host} [data-lookup-resource="lots"] .b09-lookup-select`, lotId);
}

test('real Chromium traces a lot backward and forward through the governed lot picker', async (t) => {
  const { consoleErrors, dialect, page, seed } = await openBuild09Browser(t, { name: 'trace-ui', initialPage: 'lot_serial_traceability', extraModules: TRACE_MODULES });
  const host = '[data-build09-page="lot_serial_traceability"]';
  const lot = seedTracedLot(dialect, seed);

  await page.waitForSelector(`${host} [data-role="tr-form"]`, { timeout: 15000 });
  await pickLot(page, host, lot.id);
  await page.click(`${host} [data-role="tr-form"] button[type="submit"]`);

  await page.waitForSelector(`${host} [data-role="tr-backward"]`, { timeout: 15000 });
  const backward = await page.$eval(`${host} [data-role="tr-backward"]`, (node) => node.textContent);
  const forward = await page.$eval(`${host} [data-role="tr-forward"]`, (node) => node.textContent);
  assert.match(backward, /purchase_receipt/, 'the backward chain reaches the supplier receipt');
  assert.match(forward, /sale_delivery/, 'the forward chain reaches the customer delivery');

  const documents = await page.$eval(`${host} [data-role="tr-documents"]`, (node) => node.textContent);
  assert.match(documents, /receipt-ui-4200/);
  assert.match(documents, /delivery-ui-4200/);

  const identity = await page.$eval(`${host} [data-role="tr-identity"]`, (node) => node.textContent);
  assert.match(identity, /UI-LOT-4200/, 'the identity strip names the lot, not its id');
  assert.match(identity, new RegExp(seed.staging.locationId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'the current location is the last destination');

  const locations = await page.$eval(`${host} [data-role="tr-locations"]`, (node) => node.textContent);
  for (const location of [seed.source.locationId, seed.destination.locationId, seed.staging.locationId]) {
    assert.match(locations, new RegExp(location.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'every touched location is listed');
  }

  assert.equal(consoleErrors.filter((message) => !/403/.test(message)).length, 0, consoleErrors.join('\n'));
});

test('real Chromium runs a recall case and proves it only ever proposes', async (t) => {
  const { consoleErrors, dialect, page, seed } = await openBuild09Browser(t, { name: 'recall-ui', initialPage: 'recall_analysis', extraModules: TRACE_MODULES });
  const host = '[data-build09-page="recall_analysis"]';
  const lot = seedTracedLot(dialect, seed);
  const stockBefore = dialect.prepare('SELECT id,quantity FROM stock_quants WHERE company_id=? ORDER BY id').all(seed.companyId);

  await page.waitForSelector(`${host} [data-role="rc-identify-form"]`, { timeout: 15000 });
  await page.type(`${host} [data-role="rc-identify-form"] [name="reference"]`, 'RECALL-UI-4200');
  await page.type(`${host} [data-role="rc-identify-form"] [name="reason"]`, 'Supplier contamination alert');
  await pickLot(page, `${host} [data-role="rc-identity-slot"]`, lot.id);
  await page.click(`${host} [data-role="rc-identify-form"] button[type="submit"]`);

  await page.waitForSelector(`${host} [data-role="rc-analyze"]`, { timeout: 15000 });
  const identified = dialect.prepare('SELECT * FROM wms_recall_cases WHERE reference=?').get('RECALL-UI-4200');
  assert.equal(identified.status, 'identified');
  assert.equal(identified.lot_id, lot.id);

  await clickStable(page, `${host} [data-role="rc-analyze"]`);
  await page.waitForSelector(`${host} [data-role="rc-impacts"]`, { timeout: 15000 });
  const impacts = await page.$eval(`${host} [data-role="rc-impacts"]`, (node) => node.textContent);
  assert.match(impacts, /receipt-ui-4200/, 'the supplier receipt is an impacted record');
  assert.match(impacts, /delivery-ui-4200/, 'the customer delivery is an impacted record');
  assert.match(impacts, /proposed/, 'every impact is in the proposed hold state');

  const proposals = await page.$eval(`${host} [data-role="rc-proposals"]`, (node) => node.textContent);
  assert.match(proposals, /not sent|لم تُرسل/, 'notification proposals are explicitly marked not sent');
  assert.match(proposals, /not created|لم تُنشأ/, 'work item proposals are explicitly marked not created');

  const analyzed = dialect.prepare('SELECT status,notification_proposals_json FROM wms_recall_cases WHERE id=?').get(identified.id);
  assert.equal(analyzed.status, 'analyzed');
  assert.ok(JSON.parse(analyzed.notification_proposals_json).every((proposal) => proposal.sendAuthorized === false));

  // Proposing holds is a maker-checker boundary: whoever identified the recall cannot approve it.
  await clickStable(page, `${host} [data-role="rc-propose-holds"]`);
  await page.waitForFunction((selector) => document.querySelector(selector)?.dataset.phase === 'denied', { timeout: 10000 }, `${host} [data-role="rc-alert"]`);
  assert.match(await page.$eval(`${host} [data-role="rc-alert"]`, (node) => node.textContent), /maker-checker/i);
  assert.equal(dialect.prepare('SELECT status FROM wms_recall_cases WHERE id=?').get(identified.id).status, 'analyzed');

  const holds = await browserAction(page, 'wms:recall_propose_holds', { warehouse_id: seed.warehouse.id, recall_case_id: identified.id }, { user: 'recall-supervisor' });
  assert.equal(holds.status, 'hold_proposed');
  assert.equal(holds.canonicalStockWritten, false);
  assert.equal(holds.canonicalQualityWritten, false);
  assert.ok(holds.holdRequests.every((request) => request.executionBoundary === 'REQUEST_ONLY'));

  // The decisive proof: a full identify -> analyze -> propose-holds cycle moved no stock at all.
  const stockAfter = dialect.prepare('SELECT id,quantity FROM stock_quants WHERE company_id=? ORDER BY id').all(seed.companyId);
  assert.deepEqual(stockAfter, stockBefore, 'a recall case must not move or hold canonical stock by itself');

  assert.equal(consoleErrors.filter((message) => !/403/.test(message)).length, 0, consoleErrors.join('\n'));
});
