import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileFixture } from './mobile-fixture.mjs';
import { createPicking } from '../../platform/wms/operations.mjs';
import * as receiving from '../../platform/wms/receiving.mjs';

test('mobile receiving controls partial damage discrepancy and delegates canonical receipt posting', async (t) => {
  const { db, warehouse, ctx, productId, destination, quarantine } = await mobileFixture(t, 'receiving');
  const started = receiving.startReceiving(db, {
    ...ctx, receipt_type: 'purchase_order', reference: 'PO-MOBILE-1', source_document_id: 'po-mobile-1',
    expected_line_count: 1, over_receipt_tolerance: 5, quarantine_location_id: quarantine.locationId,
    idempotency_key: 'receiving-mobile-1',
  });
  assert.equal(started.status, 'started');
  const scannedReference = receiving.scanReceivingReference(db, { ...ctx, session_id: started.id, reference: 'PO-MOBILE-1' });
  assert.equal(scannedReference.status, 'scanning');
  const scanned = receiving.scanReceivingProduct(db, {
    ...ctx, session_id: started.id, product_id: productId, barcode: 'MOB-BC-A', uom_id: 'unit',
    expected_quantity: 10, quantity: 8, damaged: true, quality_required: true,
    lot_code: 'LOT-MOB-1', manufacture_date: '2026-07-01', expiry_date: '2027-07-01',
    evidence: [{ fileId: 'photo-evidence-1', mediaType: 'image/jpeg' }], discrepancy_reason: 'Two units short and carton damaged',
  });
  assert.equal(scanned.session.status, 'discrepancy_review');
  assert.equal(scanned.line.destinationLocationId, quarantine.locationId);
  assert.equal(scanned.session.discrepancies.length, 2);
  for (const discrepancy of scanned.session.discrepancies) {
    assert.throws(() => receiving.approveReceivingDiscrepancy(db, { ...ctx, session_id: started.id, discrepancy_id: discrepancy.id, decision: 'approved' }), (error) => error.code === 'MAKER_CHECKER_REQUIRED');
    receiving.approveReceivingDiscrepancy(db, { ...ctx, actor: 'supervisor-b', session_id: started.id, discrepancy_id: discrepancy.id, decision: 'approved', reason: 'Controlled partial receipt accepted' });
  }
  const reviewed = receiving.reviewReceiving(db, { ...ctx, actor: 'reviewer-c', session_id: started.id });
  assert.equal(reviewed.status, 'ready');
  const picking = createPicking(db, { company_id: 'company-a', picking_type_id: 'incoming-mobile', reference: 'PO-MOBILE-1', location_id: warehouse.input_location_id, location_dest_id: destination.locationId });
  const requested = receiving.requestReceivingPost(db, { ...ctx, actor: 'reviewer-c', session_id: started.id, picking_id: picking.id });
  assert.equal(requested.status, 'awaiting_canonical');
  assert.equal(requested.executionBoundary, 'REQUEST_ONLY');
  assert.equal(requested.inventoryWritten, false);
  assert.equal(requested.canonicalAction, 'wms:picking:validate');
  assert.equal(db.prepare('SELECT COUNT(*) count FROM stock_moves').get().count, 0);
});
