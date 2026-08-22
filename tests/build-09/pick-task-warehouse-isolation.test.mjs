import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileFixture } from './mobile-fixture.mjs';
import { createWarehouse } from '../../platform/inventory/warehouses.mjs';
import * as topology from '../../platform/wms/topology.mjs';
import * as picking from '../../platform/wms/picking.mjs';

function pickInput(scope, locations, productId, key) {
  return { ...scope, picking_type: 'sales_delivery', source_document_id: `isolation-${key}`, source_line_id: `line-${key}`, product_id: productId, source_location_id: locations.source.locationId, staging_location_id: locations.staging.locationId, destination_location_id: locations.destination.locationId, quantity: 1, idempotency_key: `isolation-${key}` };
}

test('pick-task reads and mutations are isolated by authoritative warehouse scope', async (t) => {
  const { db, companyId, ctx, warehouse: warehouseA, productId, source, staging, destination } = await mobileFixture(t, 'pick-isolation');
  const warehouseB = createWarehouse(db, { company_id: companyId, name: 'Isolation B', code: 'ISOB' });
  const ctxB = { ...ctx, warehouse_id: warehouseB.id };
  const zoneB = topology.createZone(db, { ...ctxB, code: 'STO-B', name: 'Storage B', zone_type: 'storage' });
  const locationsB = {
    source: topology.createLocation(db, { ...ctxB, zone_id: zoneB.id, parent_id: warehouseB.lot_stock_id, name: 'Pick B', location_code: 'PICK-B', barcode: 'PICK-B', location_type: 'bin', capacity_units: 10 }),
    staging: topology.createLocation(db, { ...ctxB, zone_id: zoneB.id, parent_id: warehouseB.output_location_id, name: 'Stage B', location_code: 'STAGE-B', barcode: 'STAGE-B', location_type: 'staging', capacity_units: 10 }),
    destination: topology.createLocation(db, { ...ctxB, zone_id: zoneB.id, parent_id: warehouseB.lot_stock_id, name: 'Destination B', location_code: 'DEST-B', barcode: 'DEST-B', location_type: 'bin', capacity_units: 10 }),
  };
  db.prepare('INSERT INTO stock_quants(id,company_id,product_id,location_id,quantity,reserved_quantity,updated_at) VALUES(?,?,?,?,?,?,?)').run('isolation-quant-b', companyId, productId, locationsB.source.locationId, 5, 0, new Date().toISOString());
  const taskA = picking.createPickTask(db, pickInput(ctx, { source, staging, destination }, productId, 'a'));
  const taskB = picking.createPickTask(db, pickInput(ctxB, locationsB, productId, 'b'));

  const scopedA = { ...ctx, warehouse_id: warehouseA.id, localStorageWarehouseId: warehouseB.id };
  assert.deepEqual(picking.listPickTasks(db, scopedA).map((task) => task.id), [taskA.id]);
  assert.throws(() => picking.assignPickTask(db, { ...scopedA, task_id: taskB.id, assigned_to: 'picker-a' }), (error) => error.code === 'PICK_TASK_SCOPE_DENIED' && error.statusCode === 403);
  assert.throws(() => picking.scanPickSource(db, { ...scopedA, task_id: taskB.id, barcode: 'PICK-B', actor: 'picker-a' }), (error) => error.code === 'PICK_TASK_SCOPE_DENIED' && error.statusCode === 403);
  assert.equal(db.prepare('SELECT assigned_to,status FROM wms_pick_tasks_v2 WHERE id=?').get(taskB.id).assigned_to, null);
  assert.equal(db.prepare('SELECT assigned_to,status FROM wms_pick_tasks_v2 WHERE id=?').get(taskB.id).status, 'ready');
});
