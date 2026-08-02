import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileFixture } from './mobile-fixture.mjs';
import * as docks from '../../platform/wms/docks.mjs';
import * as crossdock from '../../platform/wms/crossdock.mjs';

test('dock scheduling enforces direction conflicts capacity staging and governed cross-dock requests', async (t) => {
  const { db, ctx, productId, staging, destination } = await mobileFixture(t, 'dock-crossdock');
  const inboundDock = docks.createDock(db, { ...ctx, code: 'IN-01', name: 'Inbound One', dock_type: 'inbound', capacity_units: 20, staging_location_id: staging.locationId });
  const outboundDock = docks.createDock(db, { ...ctx, code: 'OUT-01', name: 'Outbound One', dock_type: 'outbound', capacity_units: 20, staging_location_id: staging.locationId });
  const inbound = docks.createDockAppointment(db, {
    ...ctx, appointment_type: 'inbound', dock_id: inboundDock.id, source_document_type: 'purchase_order',
    source_document_id: 'po-crossdock-1', expected_arrival: '2026-08-03T08:00:00.000Z',
    expected_departure: '2026-08-03T09:00:00.000Z', expected_units: 12, carrier_name: 'Test Carrier',
    idempotency_key: 'dock-inbound-1',
  });
  assert.equal(inbound.status, 'scheduled');
  assert.throws(() => docks.createDockAppointment(db, {
    ...ctx, appointment_type: 'inbound', dock_id: inboundDock.id,
    expected_arrival: '2026-08-03T08:30:00.000Z', expected_departure: '2026-08-03T09:30:00.000Z',
  }), (error) => error.code === 'DOCK_APPOINTMENT_CONFLICT');
  assert.throws(() => docks.createDockAppointment(db, {
    ...ctx, appointment_type: 'outbound', dock_id: inboundDock.id,
    expected_arrival: '2026-08-03T10:00:00.000Z', expected_departure: '2026-08-03T11:00:00.000Z',
  }), (error) => error.code === 'DOCK_DIRECTION_MISMATCH');

  const outbound = docks.createDockAppointment(db, {
    ...ctx, appointment_type: 'outbound', dock_id: outboundDock.id, source_document_type: 'sale_order',
    source_document_id: 'so-crossdock-1', expected_arrival: '2026-08-03T09:15:00.000Z',
    expected_departure: '2026-08-03T11:00:00.000Z', expected_units: 8,
  });
  const checkedIn = docks.checkInDockAppointment(db, { ...ctx, appointment_id: inbound.id, actual_arrival: '2026-08-03T08:10:00.000Z', vehicle_reference: 'TRUCK-09' });
  assert.equal(checkedIn.status, 'checked_in');
  assert.ok(checkedIn.detentionStartedAt);
  const assigned = docks.assignDock(db, { ...ctx, appointment_id: inbound.id, dock_id: inboundDock.id });
  assert.equal(assigned.status, 'dock_assigned');
  assert.equal(docks.startDockService(db, { ...ctx, appointment_id: inbound.id }).status, 'unloading');

  const allocation = docks.allocateStaging(db, { ...ctx, staging_location_id: staging.locationId, source_type: 'dock_appointment', source_id: inbound.id, product_id: productId, quantity: 10 });
  assert.equal(allocation.status, 'occupied');
  assert.throws(() => docks.allocateStaging(db, { ...ctx, staging_location_id: staging.locationId, source_type: 'overflow', source_id: 'overflow-1', product_id: productId, quantity: 95 }), (error) => error.code === 'STAGING_CAPACITY_EXCEEDED');
  assert.equal(docks.releaseStaging(db, { ...ctx, allocation_id: allocation.id, quantity: 4 }).status, 'partially_released');

  const candidate = crossdock.evaluateCrossDock(db, {
    ...ctx, inbound_appointment_id: inbound.id, outbound_appointment_id: outbound.id,
    inbound_source_type: 'receiving_session', inbound_source_id: 'receipt-crossdock-1',
    outbound_source_type: 'sale_order', outbound_source_id: 'so-crossdock-1', product_id: productId,
    available_quantity: 8, demand_quantity: 8, staging_location_id: staging.locationId,
    outbound_location_id: destination.locationId, quality_status: 'released', idempotency_key: 'crossdock-match-1',
  });
  assert.equal(candidate.status, 'candidate');
  assert.throws(() => crossdock.approveCrossDock(db, { ...ctx, match_id: candidate.id }), (error) => error.code === 'MAKER_CHECKER_REQUIRED');
  const approved = crossdock.approveCrossDock(db, { ...ctx, actor: 'supervisor-b', match_id: candidate.id, assigned_to: 'picker-c' });
  assert.equal(approved.taskGenerated, true);
  assert.equal(approved.inventoryWritten, false);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM wms_warehouse_tasks WHERE source_record_type='crossdock_match'").get().count, 1);
  assert.throws(() => docks.departDockAppointment(db, { ...ctx, appointment_id: inbound.id }), (error) => error.code === 'CROSSDOCK_TASKS_OPEN');
  const requested = crossdock.requestCrossDockPost(db, { ...ctx, actor: 'picker-c', match_id: candidate.id });
  assert.equal(requested.executionBoundary, 'REQUEST_ONLY');
  assert.equal(requested.inventoryWritten, false);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM stock_moves').get().count, 0);
});
