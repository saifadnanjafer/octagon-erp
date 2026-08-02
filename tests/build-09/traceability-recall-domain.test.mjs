import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileFixture } from './mobile-fixture.mjs';
import { createLot } from '../../platform/inventory/traceability.mjs';
import { postStockMove } from '../../platform/inventory/ledger.mjs';
import * as traceability from '../../platform/wms/traceability-ops.mjs';

test('lot genealogy follows canonical movements and recall produces governed hold and communication proposals only', async (t) => {
  const { db, companyId, ctx, productId, source, destination, staging } = await mobileFixture(t, 'trace-recall');
  const lot = createLot(db, { company_id: companyId, product_id: productId, lot_number: 'SUP-LOT-900', manufactured_at: '2026-07-01', expires_at: '2026-08-15' });
  postStockMove(db, {
    company_id: companyId, reference: 'RECEIPT/900', product_id: productId, uom_id: 'unit', product_qty: 3,
    location_id: source.locationId, location_dest_id: destination.locationId, lot_id: lot.id,
    source_document_type: 'purchase_receipt', source_document_id: 'receipt-900', idempotency_key: 'trace-receipt-900',
  });
  postStockMove(db, {
    company_id: companyId, reference: 'DELIVERY/900', product_id: productId, uom_id: 'unit', product_qty: 2,
    location_id: destination.locationId, location_dest_id: staging.locationId, lot_id: lot.id,
    source_document_type: 'sale_delivery', source_document_id: 'delivery-900', idempotency_key: 'trace-delivery-900',
  });
  const profile = traceability.upsertTraceProfile(db, {
    ...ctx, lot_id: lot.id, supplier_lot: 'SUP-LOT-900', internal_lot: 'INT-LOT-900',
    source_receipt_type: 'purchase_receipt', source_receipt_id: 'receipt-900', quality_status: 'inspection',
    retest_date: '2026-08-10', metadata: { certificate: 'COA-900' },
  });
  assert.equal(profile.productId, productId);
  assert.throws(() => traceability.setTraceQualityStatus(db, { ...ctx, lot_id: lot.id, quality_status: 'hold', reason: 'suspect' }), (error) => error.code === 'MAKER_CHECKER_REQUIRED');
  const held = traceability.setTraceQualityStatus(db, { ...ctx, actor: 'quality-b', lot_id: lot.id, quality_status: 'hold', reason: 'supplier alert' });
  assert.equal(held.qualityStatus, 'hold');
  assert.equal(held.canonicalQualityWritten, false);

  const trace = traceability.queryTrace(db, { company_id: companyId, lot_id: lot.id });
  assert.equal(trace.movements.length, 2);
  assert.equal(trace.backwardTrace.length, 2);
  assert.equal(trace.forwardTrace.length, 2);
  assert.equal(trace.sourceReceipts[0].source_document_id, 'receipt-900');
  assert.equal(trace.customerExposure[0].sourceDocumentId, 'delivery-900');
  assert.equal(trace.currentLocation, staging.locationId);
  assert.equal(traceability.expirationQueue(db, { company_id: companyId, through_date: '2026-08-31' }).length, 1);
  assert.equal(traceability.recallCandidates(db, { company_id: companyId }).length, 1);

  const recall = traceability.identifyRecall(db, { ...ctx, lot_id: lot.id, reference: 'RECALL-900', reason: 'Supplier contamination alert' });
  assert.equal(recall.status, 'identified');
  const analyzed = traceability.analyzeRecall(db, { ...ctx, recall_case_id: recall.id });
  assert.equal(analyzed.status, 'analyzed');
  assert.equal(analyzed.externalMessagesSent, false);
  assert.equal(analyzed.workItemsCreated, false);
  assert.ok(analyzed.impacts.some((impact) => impact.impact_type === 'supplier'));
  assert.ok(analyzed.impacts.some((impact) => impact.impact_type === 'delivery'));
  assert.throws(() => traceability.proposeRecallHolds(db, { ...ctx, recall_case_id: recall.id }), (error) => error.code === 'MAKER_CHECKER_REQUIRED');
  const proposed = traceability.proposeRecallHolds(db, { ...ctx, actor: 'recall-approver-b', recall_case_id: recall.id });
  assert.equal(proposed.status, 'hold_proposed');
  assert.equal(proposed.canonicalStockWritten, false);
  assert.equal(proposed.canonicalQualityWritten, false);
  assert.ok(proposed.holdRequests.every((request) => request.executionBoundary === 'REQUEST_ONLY'));
  assert.equal(traceability.closeRecall(db, { ...ctx, actor: 'recall-closer-c', recall_case_id: recall.id }).status, 'closed');
});
