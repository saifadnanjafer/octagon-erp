import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import {
  buildFixture, teardown, seedAccounts, seedUnit, seedProduct, receiveStock, CTX,
} from './helpers.mjs';
import { planning } from '../../platform/manufacturing/index.mjs';

let fx;
let accounts;
let unit;
let warehouse;
let supplier;
let finished;
let component;

before(async () => {
  fx = await buildFixture('mrp');
  accounts = seedAccounts(fx.db);
  unit = seedUnit(fx.db);
  warehouse = fx.execute('warehouse:create', { name: 'Main', code: 'MAIN' }, 'wh');
  supplier = fx.execute('stock:location:create', { name: 'Supplier', usage: 'supplier' }, 'sup');
  fx.execute('manufacturing:account_mapping:set', {
    wip_account_id: accounts.wip,
    labor_absorption_account_id: accounts.laborAbsorption,
    overhead_absorption_account_id: accounts.overheadAbsorption,
    scrap_account_id: accounts.scrap,
    variance_account_id: accounts.variance,
  }, 'mapping');

  component = seedProduct(fx.db, fx.execute, accounts, {
    name: 'Bearing', sku: 'RM-BEAR', unitId: unit.id, categoryName: 'Raw bearings',
  });
  finished = seedProduct(fx.db, fx.execute, accounts, {
    name: 'Gearbox', sku: 'FG-GEAR', unitId: unit.id, categoryName: 'Finished gearboxes',
    stockAccountId: accounts.finishedGoods,
  });

  const bom = fx.execute('manufacturing:bom:create', {
    product_id: finished.variantId, quantity: 1, code: 'BOM-GEAR',
    lines: [{ product_id: component.variantId, quantity: 4 }],
  }, 'bom');
  fx.execute('manufacturing:bom:approve', { bom_id: bom.id }, 'bom-approve');
});

after(() => teardown(fx));

test('a planning run with no demand produces no proposals', () => {
  const run = fx.execute('manufacturing:planning:run', {}, 'mrp-empty');
  assert.equal(run.demand_count, 0);
  assert.equal(run.proposal_count, 0);
});

test('a component shortage on a released order becomes a dependent-demand proposal', () => {
  // No stock at all: releasing 10 gearboxes creates a 40-bearing shortage.
  const order = fx.execute('manufacturing:order:create', {
    product_id: finished.variantId, planned_quantity: 10, warehouse_id: warehouse.id,
  }, 'mo-1');
  fx.execute('manufacturing:order:approve', { order_id: order.id }, 'mo-1-approve');
  const released = fx.execute('manufacturing:order:release', { order_id: order.id }, 'mo-1-release');
  assert.equal(released.materials[0].shortage_quantity, 40);

  const run = fx.execute('manufacturing:planning:run', {}, 'mrp-1');
  const proposal = run.proposals.find((row) => row.product_id === component.variantId);
  assert.ok(proposal, 'the shortage must produce a proposal');
  assert.equal(proposal.net_requirement, 40);
  assert.equal(proposal.proposal_type, 'buy', 'the default reorder policy is buy');

  const stored = fx.db.prepare('SELECT * FROM planning_proposals WHERE id = ?').get(proposal.id);
  assert.equal(stored.demand_source_type, 'production_order');
  assert.equal(stored.demand_source_id, order.id, 'the proposal keeps its demand lineage');
  assert.equal(stored.status, 'proposed');
});

test('planning proposes but never commits: no order or reservation is created by the run', () => {
  const purchaseOrders = fx.db.prepare('SELECT COUNT(*) AS n FROM purchase_orders').get().n;
  const requisitions = fx.db.prepare('SELECT COUNT(*) AS n FROM purchase_requisitions').get().n;
  fx.execute('manufacturing:planning:run', {}, 'mrp-nocommit');
  assert.equal(fx.db.prepare('SELECT COUNT(*) AS n FROM purchase_orders').get().n, purchaseOrders);
  assert.equal(fx.db.prepare('SELECT COUNT(*) AS n FROM purchase_requisitions').get().n, requisitions);
});

test('safety stock, lot sizing and multiples shape the proposed quantity', () => {
  fx.execute('manufacturing:planning:policy', {
    product_id: component.variantId,
    reorder_policy: 'buy',
    safety_stock: 25,
    minimum_order_quantity: 100,
    order_multiple: 50,
    lead_time_days: 7,
  }, 'policy-bearing');

  const run = fx.execute('manufacturing:planning:run', {}, 'mrp-lot');
  const proposal = run.proposals.find((row) => row.product_id === component.variantId);
  // Net = 40 demand + 25 safety − 0 stock − 0 supply = 65 → min 100 → multiple 50 → 100
  assert.equal(proposal.net_requirement, 65);
  assert.equal(proposal.quantity, 100);
});

test('available stock and open supply reduce the net requirement', () => {
  receiveStock(fx.execute, {
    warehouse, supplierLocation: supplier, productId: component.variantId,
    unitId: unit.id, quantity: 30, unitCost: 3, key: 'bearings',
  });
  const run = fx.execute('manufacturing:planning:run', {}, 'mrp-supply');
  const proposal = run.proposals.find((row) => row.product_id === component.variantId);
  // 40 demand + 25 safety − 30 on hand = 35 → min 100 → 100
  assert.equal(proposal.net_requirement, 35);
  assert.equal(proposal.available_stock, 30);
});

test('a lead time that has already passed raises a planning exception', () => {
  const run = fx.execute('manufacturing:planning:run', {
    demands: [{
      // Demand must exceed the 10 gearboxes already on an open manufacturing
      // order, otherwise open supply legitimately covers it and MRP proposes
      // nothing — which is the behaviour the previous test proved.
      product_id: finished.variantId,
      quantity: 25,
      need_date: new Date(Date.now() - 5 * 86_400_000).toISOString(),
      demand_source_type: 'forecast',
      demand_source_id: 'FCST-001',
    }],
  }, 'mrp-late');

  const proposal = run.proposals.find((row) => row.product_id === finished.variantId);
  assert.ok(proposal);
  assert.equal(proposal.exception_code, 'ORDER_DATE_IN_THE_PAST');
  assert.ok(run.exception_count >= 1);

  const worklist = planning.getPlannerWorklist(fx.db, { company_id: CTX.companyId, run_id: run.run_id });
  assert.ok(worklist.exceptions.length >= 1);
  assert.equal(worklist.exceptions[0].exception_code, 'ORDER_DATE_IN_THE_PAST');
});

test('accepting a make proposal creates a manufacturing order that keeps the lineage', () => {
  fx.execute('manufacturing:planning:policy', {
    product_id: finished.variantId, reorder_policy: 'make', lead_time_days: 2,
  }, 'policy-gearbox');

  const run = fx.execute('manufacturing:planning:run', {
    demands: [{
      product_id: finished.variantId, quantity: 30,
      demand_source_type: 'sale_order', demand_source_id: 'SO-DEMO-1',
    }],
  }, 'mrp-make');
  const proposal = run.proposals.find((row) => row.product_id === finished.variantId);
  assert.equal(proposal.proposal_type, 'make');

  const accepted = fx.execute('manufacturing:planning:accept', {
    proposal_id: proposal.id, warehouse_id: warehouse.id,
  }, 'mrp-make-accept');
  assert.equal(accepted.result_type, 'production_order');
  assert.equal(accepted.demand_source_type, 'sale_order');
  assert.equal(accepted.demand_source_id, 'SO-DEMO-1');

  const created = fx.db.prepare('SELECT * FROM production_orders WHERE id = ?').get(accepted.result_id);
  assert.equal(created.planning_proposal_id, proposal.id, 'the order points back at its proposal');
  assert.equal(created.demand_source_id, 'SO-DEMO-1');
  assert.equal(created.state, 'draft', 'an accepted proposal creates a draft order, not a released one');
});

test('accepting a buy proposal creates a purchase requisition', () => {
  const run = fx.execute('manufacturing:planning:run', {}, 'mrp-buy');
  const proposal = run.proposals.find((row) => row.product_id === component.variantId);
  const accepted = fx.execute('manufacturing:planning:accept', { proposal_id: proposal.id }, 'mrp-buy-accept');
  assert.equal(accepted.result_type, 'purchase_requisition');
  const requisition = fx.db.prepare('SELECT * FROM purchase_requisitions WHERE id = ?').get(accepted.result_id);
  assert.ok(requisition);
  const lines = fx.db.prepare('SELECT * FROM purchase_requisition_lines WHERE requisition_id = ?').all(accepted.result_id);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].product_id, component.variantId);
});

test('a proposal can only be decided once', () => {
  const run = fx.execute('manufacturing:planning:run', {}, 'mrp-twice');
  const proposal = run.proposals[0];
  fx.execute('manufacturing:planning:reject', { proposal_id: proposal.id }, 'mrp-reject');
  assert.throws(
    () => fx.execute('manufacturing:planning:accept', { proposal_id: proposal.id }, 'mrp-accept-after-reject'),
    /already rejected/,
  );
});
