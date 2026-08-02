import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createWarehouse } from '../../platform/inventory/warehouses.mjs';
import * as topology from '../../platform/wms/topology.mjs';
import * as putaway from '../../platform/wms/putaway.mjs';
import * as replenishment from '../../platform/wms/replenishment.mjs';

async function fixture(t) {
  const file = path.join(os.tmpdir(), `octagon-b09-wms-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  t.after(() => { try { fs.unlinkSync(file); } catch {} });
  await freshInstall({ dbPath: file });
  const db = openMigrationDatabase(file);
  t.after(() => db.close());
  const warehouse = createWarehouse(db, { company_id: 'company-a', name: 'Central DC', code: 'CDC' });
  const stamp = new Date().toISOString();
  db.prepare(`INSERT INTO product_templates(id,company_id,name,code,type,category_id,uom_id,purchase_uom_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run('tmpl-a', 'company-a', 'Product A', 'A', 'storable', 'cat-a', 'unit', 'unit', stamp);
  db.prepare(`INSERT INTO product_variants(id,template_id,company_id,sku,name,created_at) VALUES(?,?,?,?,?,?)`).run('product-a', 'tmpl-a', 'company-a', 'SKU-A', 'Product A', stamp);
  const ctx = { company_id: 'company-a', warehouse_id: warehouse.id, actor: 'operator-a' };
  const zone = topology.createZone(db, { ...ctx, code: 'FAST', name: 'Fast Pick', zone_type: 'storage' });
  const source = topology.createLocation(db, { ...ctx, zone_id: zone.id, parent_id: warehouse.lot_stock_id, name: 'Reserve', location_code: 'RES-01', capacity_units: 200, putaway_priority: 20 });
  const destination = topology.createLocation(db, { ...ctx, zone_id: zone.id, parent_id: warehouse.lot_stock_id, name: 'Pick Face', location_code: 'PICK-01', barcode: 'PICK-01', capacity_units: 20, putaway_priority: 1, fixed_product_id: 'product-a' });
  return { db, warehouse, ctx, zone, source, destination };
}

test('warehouse topology is scoped, capacity-aware and refuses unsafe retirement', async (t) => {
  const { db, warehouse, ctx, zone, destination } = await fixture(t);
  const tree = topology.hierarchy(db, ctx);
  assert.equal(tree[0].id, zone.id);
  assert.equal(topology.capacityUtilization(db, ctx).length, 2);
  assert.throws(() => topology.listLocations(db, { ...ctx, company_id: 'company-b' }), /outside active company scope/i);
  db.prepare(`INSERT INTO stock_quants(id,company_id,product_id,location_id,quantity,reserved_quantity,updated_at) VALUES(?,?,?,?,?,?,?)`).run('quant-a', 'company-a', 'product-a', destination.locationId, 3, 0, new Date().toISOString());
  assert.throws(() => topology.retireLocation(db, { ...ctx, location_id: destination.locationId }), (error) => error.code === 'LOCATION_NOT_EMPTY');
  const capacity = topology.capacityUtilization(db, ctx).find((row) => row.locationId === destination.locationId);
  assert.equal(capacity.availableUnits, 17);
  assert.equal(capacity.utilizationPercent, 15);
  assert.equal(warehouse.company_id, 'company-a');
});

test('putaway recommendation creates scan-driven request-only tasks', async (t) => {
  const { db, warehouse, ctx, zone, source, destination } = await fixture(t);
  const rule = putaway.createPutawayRule(db, { ...ctx, name: 'Fast product bins', product_id: 'product-a', destination_zone_id: zone.id, strategy: 'priority' });
  const recommendation = putaway.recommendPutaway(db, { ...ctx, source_location_id: source.locationId, product_id: 'product-a', quantity: 8, idempotency_key: 'receipt-a' });
  assert.equal(recommendation.selectedRuleId, rule.id);
  assert.equal(recommendation.lines[0].destinationLocationId, destination.locationId);
  const accepted = putaway.acceptPutaway(db, { ...ctx, branch_id: 'branch-a', recommendation_id: recommendation.id });
  assert.equal(accepted.tasks.length, 1);
  let task = putaway.scanTaskSource(db, { ...ctx, task_id: accepted.tasks[0].id, barcode: source.locationCode });
  assert.equal(task.status, 'source_scanned');
  task = putaway.scanTaskDestination(db, { ...ctx, task_id: task.id, barcode: 'PICK-01' });
  assert.equal(task.status, 'destination_scanned');
  const request = putaway.requestCanonicalMovement(db, { ...ctx, task_id: task.id });
  assert.equal(request.inventoryWritten, false);
  assert.equal(request.executionBoundary, 'REQUEST_ONLY');
  assert.equal(request.canonicalAction, 'stock:move:post');
  assert.equal(db.prepare('SELECT COUNT(*) count FROM stock_moves').get().count, 0);
  assert.equal(warehouse.id, request.warehouseId);
});

test('replenishment proposes partial availability and enforces maker-checker approval', async (t) => {
  const { db, ctx, source, destination } = await fixture(t);
  const stamp = new Date().toISOString();
  db.prepare(`INSERT INTO stock_quants(id,company_id,product_id,location_id,quantity,reserved_quantity,updated_at) VALUES(?,?,?,?,?,?,?)`).run('source-quant', 'company-a', 'product-a', source.locationId, 6, 1, stamp);
  db.prepare(`INSERT INTO stock_quants(id,company_id,product_id,location_id,quantity,reserved_quantity,updated_at) VALUES(?,?,?,?,?,?,?)`).run('dest-quant', 'company-a', 'product-a', destination.locationId, 1, 0, stamp);
  const rule = replenishment.createReplenishmentRule(db, { ...ctx, product_id: 'product-a', source_location_id: source.locationId, destination_location_id: destination.locationId, minimum_quantity: 2, reorder_point: 3, target_quantity: 10, maximum_quantity: 12 });
  const calculated = replenishment.calculateReplenishment(db, { ...ctx, rule_id: rule.id, idempotency_key: 'calc-a' });
  assert.equal(calculated.proposals.length, 1);
  assert.equal(calculated.proposals[0].requestedQuantity, 9);
  assert.equal(calculated.proposals[0].proposedQuantity, 5);
  assert.equal(calculated.proposals[0].status, 'partial');
  assert.throws(() => replenishment.approveReplenishment(db, { ...ctx, proposal_id: calculated.proposals[0].id }), (error) => error.code === 'MAKER_CHECKER_REQUIRED');
  const approved = replenishment.approveReplenishment(db, { ...ctx, actor: 'supervisor-b', proposal_id: calculated.proposals[0].id });
  assert.equal(approved.task.taskType, 'replenishment');
  assert.equal(approved.task.canonicalAction, 'stock:move:post');
  assert.equal(approved.inventoryWritten, false);
  assert.equal(db.prepare('SELECT quantity FROM stock_quants WHERE id=?').get('source-quant').quantity, 6);
});
