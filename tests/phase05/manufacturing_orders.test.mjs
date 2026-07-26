import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import {
  buildFixture, teardown, seedAccounts, seedUnit, seedProduct, receiveStock, CTX,
} from './helpers.mjs';
import { orders, execution } from '../../platform/manufacturing/index.mjs';

let fx;
let accounts;
let unit;
let warehouse;
let supplier;
let finished;
let component;
let workCenter;
let routing;

before(async () => {
  fx = await buildFixture('mo');
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
    subcontract_stock_account_id: accounts.subcontractStock,
    subcontract_expense_account_id: accounts.subcontractExpense,
  }, 'mapping');

  component = seedProduct(fx.db, fx.execute, accounts, {
    name: 'Steel Plate', sku: 'RM-PLATE', unitId: unit.id, categoryName: 'Raw materials',
  });
  finished = seedProduct(fx.db, fx.execute, accounts, {
    name: 'Frame', sku: 'FG-FRAME', unitId: unit.id, categoryName: 'Finished goods',
    stockAccountId: accounts.finishedGoods,
  });

  receiveStock(fx.execute, {
    warehouse, supplierLocation: supplier, productId: component.variantId,
    unitId: unit.id, quantity: 200, unitCost: 5, key: 'plates',
  });

  workCenter = fx.execute('manufacturing:work_center:create', {
    code: 'WC-WELD', name: 'Welding bay',
    labor_cost_per_hour: 30, machine_cost_per_hour: 18, overhead_cost_per_hour: 6,
    calendar: [{ weekday: 1, start_minute: 480, end_minute: 960 }],
  }, 'wc');

  routing = fx.execute('manufacturing:routing:create', {
    name: 'Frame routing', code: 'RT-FRAME',
    operations: [
      { name: 'Cut', sequence: 10, work_center_id: workCenter.id, setup_minutes: 20, run_minutes_per_unit: 3 },
      { name: 'Weld', sequence: 20, work_center_id: workCenter.id, run_minutes_per_unit: 6 },
    ],
  }, 'rt');
  fx.execute('manufacturing:routing:approve', { routing_id: routing.id }, 'rt-approve');

  const bom = fx.execute('manufacturing:bom:create', {
    product_id: finished.variantId, quantity: 1, code: 'BOM-FRAME',
    routing_id: routing.id,
    lines: [{ product_id: component.variantId, quantity: 4 }],
  }, 'bom');
  fx.execute('manufacturing:bom:approve', { bom_id: bom.id }, 'bom-approve');
});

after(() => teardown(fx));

/**
 * Top up raw material. Earlier tests deliberately consume the free stock (the
 * shortage cases depend on it), so each later test states the stock it needs
 * rather than relying on what a previous test happened to leave behind.
 */
function topUp(quantity, key) {
  return receiveStock(fx.execute, {
    warehouse, supplierLocation: supplier, productId: component.variantId,
    unitId: unit.id, quantity, unitCost: 5, key,
  });
}

function newOrder(quantity, key, extra = {}) {
  const order = fx.execute('manufacturing:order:create', {
    product_id: finished.variantId, planned_quantity: quantity, warehouse_id: warehouse.id, ...extra,
  }, `mo-create-${key}`);
  fx.execute('manufacturing:order:approve', { order_id: order.id }, `mo-approve-${key}`);
  return order;
}

test('an order cannot be released before it is approved', () => {
  const draft = fx.execute('manufacturing:order:create', {
    product_id: finished.variantId, planned_quantity: 1, warehouse_id: warehouse.id,
  }, 'mo-draft');
  assert.throws(
    () => fx.execute('manufacturing:order:release', { order_id: draft.id }, 'mo-draft-release'),
    /does not allow this transition/,
  );
});

test('release explodes the BOM, reserves material, snapshots versions and creates work items', () => {
  const order = newOrder(10, 'main');
  const released = fx.execute('manufacturing:order:release', { order_id: order.id }, 'mo-main-release');

  assert.equal(released.state, 'released');
  assert.equal(released.materials.length, 1);
  assert.equal(released.materials[0].required_quantity, 40, '4 per unit × 10');
  assert.equal(released.shortages.length, 0);

  // The exact engineering versions used are frozen onto the order.
  assert.equal(released.bom_version, 1);
  assert.equal(released.routing_version, 1);

  // Reservation is a canonical Phase 04 reservation, not a manufacturing one.
  const reservationId = released.materials[0].reservation_id;
  assert.ok(reservationId);
  const reservation = fx.db.prepare('SELECT * FROM stock_reservations WHERE id = ?').get(reservationId);
  assert.equal(reservation.source_document_type, 'production_order');
  assert.equal(reservation.quantity, 40);

  // One work order per routing operation, each with a canonical Work Item.
  assert.equal(released.work_orders.length, 2);
  for (const workOrder of released.work_orders) {
    assert.equal(workOrder.state, 'ready');
    assert.ok(workOrder.work_item_id, 'every work order must carry a canonical Work Item');
    const item = fx.db.prepare('SELECT * FROM work_items WHERE id = ?').get(workOrder.work_item_id);
    assert.equal(item.source_type, 'manufacturing_work_order');
    assert.equal(item.work_order_ref, order.id);
  }

  // No manufacturing task table exists.
  const taskTables = fx.db.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table'
      AND (name LIKE '%_tasks' OR name = 'manufacturing_tasks' OR name = 'production_tasks')
  `).all();
  assert.deepEqual(taskTables, [], 'Phase 05 must not create a second task table');
});

test('a partial shortage still releases, records the gap and blocks the work orders', () => {
  // 200 received, 40 already reserved → 160 free. Ask for 60 units = 240 needed.
  const order = newOrder(60, 'short');
  const released = fx.execute('manufacturing:order:release', { order_id: order.id }, 'mo-short-release');

  assert.equal(released.state, 'released');
  assert.equal(released.shortages.length, 1);
  assert.equal(released.materials[0].required_quantity, 240);
  assert.equal(released.materials[0].shortage_quantity, 80, '240 required, 160 available');
  for (const workOrder of released.work_orders) {
    assert.equal(workOrder.state, 'waiting_material');
    const item = fx.db.prepare('SELECT status FROM work_items WHERE id = ?').get(workOrder.work_item_id);
    assert.equal(item.status, 'blocked');
  }
});

test('require_full_material turns a shortage into a hard release failure', () => {
  const order = newOrder(500, 'strict');
  assert.throws(
    () => fx.execute('manufacturing:order:release', {
      order_id: order.id, require_full_material: true,
    }, 'mo-strict-release'),
    /material shortage/,
  );
  const after = orders.getProductionOrder(fx.db, order.id, CTX.companyId);
  assert.equal(after.state, 'approved', 'a failed release must not leave the order half-released');
  assert.equal(after.materials.length, 0, 'no requirement rows may survive a failed release');
  assert.equal(
    fx.db.prepare("SELECT COUNT(*) AS n FROM stock_reservations WHERE source_document_id = ?").get(order.id).n,
    0,
    'no reservation may survive a failed release',
  );
});

test('work orders enforce operation sequence unless explicitly overlapped', () => {
  topUp(40, 'seq');
  const order = newOrder(2, 'seq');
  const released = fx.execute('manufacturing:order:release', { order_id: order.id }, 'mo-seq-release');
  const [first, second] = released.work_orders;

  assert.throws(
    () => fx.execute('manufacturing:work_order:start', { work_order_id: second.id }, 'wo-seq-second-early'),
    /must finish before/,
  );

  fx.execute('manufacturing:work_order:start', { work_order_id: first.id }, 'wo-seq-first-start');
  assert.equal(execution.getWorkOrder(fx.db, first.id, CTX.companyId).state, 'in_progress');
  assert.equal(
    orders.getProductionOrder(fx.db, order.id, CTX.companyId).state,
    'in_progress',
    'starting the first work order moves the order to in_progress',
  );

  fx.execute('manufacturing:work_order:pause', { work_order_id: first.id, reason: 'tea break' }, 'wo-seq-pause');
  assert.equal(execution.getWorkOrder(fx.db, first.id, CTX.companyId).state, 'paused');
  fx.execute('manufacturing:work_order:resume', { work_order_id: first.id }, 'wo-seq-resume');

  const completed = fx.execute('manufacturing:work_order:complete', {
    work_order_id: first.id, output_quantity: 2,
  }, 'wo-seq-first-complete');
  assert.equal(completed.state, 'completed');
  assert.equal(completed.open_work_orders, 1);

  // Now the second is startable.
  fx.execute('manufacturing:work_order:start', { work_order_id: second.id, allow_parallel: false }, 'wo-seq-second-start');
  assert.equal(execution.getWorkOrder(fx.db, second.id, CTX.companyId).state, 'in_progress');

  // The Work Item mirrors the work-order state.
  const item = fx.db.prepare('SELECT status FROM work_items WHERE id = ?').get(second.work_item_id);
  assert.equal(item.status, 'in_progress');
});

test('labour and machine time absorb into WIP at the work-centre rate', () => {
  topUp(40, 'time');
  const order = newOrder(4, 'time');
  const released = fx.execute('manufacturing:order:release', { order_id: order.id }, 'mo-time-release');
  const workOrder = released.work_orders[0];
  fx.execute('manufacturing:work_order:start', { work_order_id: workOrder.id }, 'wo-time-start');

  const labour = fx.execute('manufacturing:work_order:time_entry', {
    work_order_id: workOrder.id, entry_type: 'labor', duration_minutes: 120,
  }, 'wo-time-labour');
  assert.equal(labour.amount, 60, '2 hours at 30/hour');
  assert.equal(labour.overhead_amount, 12, '2 hours at 6/hour overhead');
  assert.ok(labour.finance_document_id);

  const machine = fx.execute('manufacturing:work_order:time_entry', {
    work_order_id: workOrder.id, entry_type: 'machine', duration_minutes: 60,
  }, 'wo-time-machine');
  assert.equal(machine.amount, 18, '1 hour at 18/hour');

  // Downtime is measured but never capitalised into product cost.
  const downtime = fx.execute('manufacturing:work_order:time_entry', {
    work_order_id: workOrder.id, entry_type: 'downtime', duration_minutes: 45,
  }, 'wo-time-downtime');
  assert.equal(downtime.amount, 0);
  assert.equal(downtime.finance_document_id, null);

  // Overhead is absorbed per capitalised entry, not once per operation: the
  // machine hour carries its own 6/hour as well. 60 + 12 + 18 + 6 = 96.
  assert.equal(machine.overhead_amount, 6);

  const wip = orders.getWipBalance(fx.db, CTX.companyId, order.id);
  assert.equal(wip.balance, 96, '60 labour + 12 labour-overhead + 18 machine + 6 machine-overhead');

  // Effort flows onto the canonical Work Item.
  const item = fx.db.prepare('SELECT actual_hours FROM work_items WHERE id = ?').get(workOrder.work_item_id);
  assert.equal(Math.round(Number(item.actual_hours) * 100) / 100, 3.75, '2h + 1h + 0.75h downtime');
});

test('a time entry without a rate or a work centre fails closed', () => {
  topUp(20, 'norate');
  const order = newOrder(1, 'norate');
  const released = fx.execute('manufacturing:order:release', { order_id: order.id }, 'mo-norate-release');
  const workOrder = released.work_orders[0];
  fx.db.prepare('UPDATE production_work_orders SET work_center_id = NULL WHERE id = ?').run(workOrder.id);
  fx.execute('manufacturing:work_order:start', { work_order_id: workOrder.id }, 'wo-norate-start');
  assert.throws(
    () => fx.execute('manufacturing:work_order:time_entry', {
      work_order_id: workOrder.id, entry_type: 'labor', duration_minutes: 30,
    }, 'wo-norate-entry'),
    /rate_per_hour is required/,
  );
});

test('cancelling an order releases its reservations and cancels its work items', () => {
  topUp(40, 'cancel');
  const order = newOrder(3, 'cancel');
  const released = fx.execute('manufacturing:order:release', { order_id: order.id }, 'mo-cancel-release');
  const reservationId = released.materials[0].reservation_id;

  const cancelled = fx.execute('manufacturing:order:cancel', {
    order_id: order.id, reason: 'customer withdrew',
  }, 'mo-cancel');
  assert.equal(cancelled.state, 'cancelled');

  const reservation = fx.db.prepare('SELECT status FROM stock_reservations WHERE id = ?').get(reservationId);
  assert.equal(reservation.status, 'released');
  for (const workOrder of released.work_orders) {
    assert.equal(execution.getWorkOrder(fx.db, workOrder.id, CTX.companyId).state, 'cancelled');
    const item = fx.db.prepare('SELECT status FROM work_items WHERE id = ?').get(workOrder.work_item_id);
    assert.equal(item.status, 'cancelled');
  }
});

test('an order with issued material cannot be cancelled without returning it', () => {
  topUp(40, 'cancelwip');
  const order = newOrder(2, 'cancelwip');
  fx.execute('manufacturing:order:release', { order_id: order.id }, 'mo-cancelwip-release');
  fx.execute('manufacturing:material:issue', {
    order_id: order.id, product_id: component.variantId, quantity: 8,
  }, 'mo-cancelwip-issue');

  assert.throws(
    () => fx.execute('manufacturing:order:cancel', { order_id: order.id }, 'mo-cancelwip-cancel'),
    /material is still issued/,
  );

  fx.execute('manufacturing:material:return', {
    order_id: order.id, product_id: component.variantId, quantity: 8,
  }, 'mo-cancelwip-return');
  const cancelled = fx.execute('manufacturing:order:cancel', { order_id: order.id }, 'mo-cancelwip-cancel-2');
  assert.equal(cancelled.state, 'cancelled');
});
