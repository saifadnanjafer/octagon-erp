import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import {
  buildFixture, teardown, seedAccounts, seedUnit, seedProduct, receiveStock,
  accountBalance, unbalancedEntries, CTX,
} from './helpers.mjs';
import { orders, completion, reports, subcontracting } from '../../platform/manufacturing/index.mjs';

let fx;
let accounts;
let unit;
let warehouse;
let supplier;
let finished;
let component;
let scrapProduct;

before(async () => {
  fx = await buildFixture('wip');
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
    name: 'Bar Stock', sku: 'RM-BAR', unitId: unit.id, categoryName: 'Raw bar',
  });
  scrapProduct = component;
  finished = seedProduct(fx.db, fx.execute, accounts, {
    name: 'Bracket', sku: 'FG-BRK', unitId: unit.id, categoryName: 'Finished brackets',
    stockAccountId: accounts.finishedGoods,
  });

  receiveStock(fx.execute, {
    warehouse, supplierLocation: supplier, productId: component.variantId,
    unitId: unit.id, quantity: 1000, unitCost: 4, key: 'bar',
  });

  const bom = fx.execute('manufacturing:bom:create', {
    product_id: finished.variantId, quantity: 1, code: 'BOM-BRK',
    lines: [{ product_id: component.variantId, quantity: 5 }],
  }, 'bom');
  fx.execute('manufacturing:bom:approve', { bom_id: bom.id }, 'bom-approve');
});

after(() => teardown(fx));

function releasedOrder(quantity, key) {
  const order = fx.execute('manufacturing:order:create', {
    product_id: finished.variantId, planned_quantity: quantity, warehouse_id: warehouse.id,
  }, `mo-${key}`);
  fx.execute('manufacturing:order:approve', { order_id: order.id }, `mo-${key}-approve`);
  fx.execute('manufacturing:order:release', { order_id: order.id }, `mo-${key}-release`);
  return order;
}

test('material issue moves canonical stock and posts Dr WIP / Cr Inventory', () => {
  const inventoryBefore = accountBalance(fx.db, accounts.inventory);
  const wipBefore = accountBalance(fx.db, accounts.wip);

  const order = releasedOrder(10, 'issue');
  const issue = fx.execute('manufacturing:material:issue', {
    order_id: order.id, product_id: component.variantId, quantity: 50,
  }, 'issue-1');

  assert.equal(issue.quantity, 50);
  assert.equal(issue.value, 200, '50 units at the 4.00 average cost');
  assert.ok(issue.finance_document_id, 'the issue must produce a finance document');

  // Quantity authority is the Phase 04 stock engine.
  const move = fx.db.prepare('SELECT * FROM stock_moves WHERE id = ?').get(issue.stock_move_id);
  assert.equal(move.product_qty, 50);
  assert.equal(move.location_dest_id, orders.getProductionOrder(fx.db, order.id, CTX.companyId).production_location_id);

  // Lineage row, not a ledger.
  const consumption = fx.db.prepare('SELECT * FROM production_material_consumptions WHERE stock_move_id = ?').get(issue.stock_move_id);
  assert.equal(consumption.movement_type, 'issue');
  assert.equal(consumption.value, 200);

  assert.equal(accountBalance(fx.db, accounts.wip), wipBefore + 200);
  assert.equal(accountBalance(fx.db, accounts.inventory), inventoryBefore - 200);
  assert.equal(orders.getWipBalance(fx.db, CTX.companyId, order.id).balance, 200);
});

test('issuing more than the requirement is refused unless explicitly allowed', () => {
  const order = releasedOrder(2, 'over');
  assert.throws(
    () => fx.execute('manufacturing:material:issue', {
      order_id: order.id, product_id: component.variantId, quantity: 30,
    }, 'over-issue'),
    /exceeds the outstanding requirement/,
  );
  const allowed = fx.execute('manufacturing:material:issue', {
    order_id: order.id, product_id: component.variantId, quantity: 30, allow_over_issue: true,
  }, 'over-issue-allowed');
  assert.equal(allowed.quantity, 30);
});

test('a component return reverses value out of WIP', () => {
  const order = releasedOrder(4, 'return');
  fx.execute('manufacturing:material:issue', {
    order_id: order.id, product_id: component.variantId, quantity: 20,
  }, 'return-issue');
  assert.equal(orders.getWipBalance(fx.db, CTX.companyId, order.id).balance, 80);

  const wipBefore = accountBalance(fx.db, accounts.wip);
  const returned = fx.execute('manufacturing:material:return', {
    order_id: order.id, product_id: component.variantId, quantity: 5,
  }, 'return-1');
  assert.equal(returned.value, 20);
  assert.equal(orders.getWipBalance(fx.db, CTX.companyId, order.id).balance, 60);
  assert.equal(accountBalance(fx.db, accounts.wip), wipBefore - 20);
});

test('returning more than is in WIP is refused', () => {
  const order = releasedOrder(2, 'overreturn');
  fx.execute('manufacturing:material:issue', {
    order_id: order.id, product_id: component.variantId, quantity: 10,
  }, 'overreturn-issue');
  assert.throws(
    () => fx.execute('manufacturing:material:return', {
      order_id: order.id, product_id: component.variantId, quantity: 11,
    }, 'overreturn-return'),
    /only 10 of this component is in work in progress/,
  );
});

test('scrap out of WIP posts Dr Scrap / Cr WIP and leaves stock reconciled', () => {
  const order = releasedOrder(4, 'scrap');
  fx.execute('manufacturing:material:issue', {
    order_id: order.id, product_id: component.variantId, quantity: 20,
  }, 'scrap-issue');

  const wipAccountBefore = accountBalance(fx.db, accounts.wip);
  const scrapAccountBefore = accountBalance(fx.db, accounts.scrap);

  const scrapped = fx.execute('manufacturing:material:scrap', {
    order_id: order.id, product_id: scrapProduct.variantId, quantity: 3,
  }, 'scrap-1');

  assert.equal(scrapped.value, 12, '3 units at 4.00');
  assert.ok(scrapped.finance_document_id, 'a WIP scrap must post');
  assert.equal(accountBalance(fx.db, accounts.scrap), scrapAccountBefore + 12);
  assert.equal(accountBalance(fx.db, accounts.wip), wipAccountBefore - 12);
  assert.equal(orders.getWipBalance(fx.db, CTX.companyId, order.id).balance, 80 - 12);

  // The quantity really left the production location.
  const scrapLocation = fx.db.prepare(
    'SELECT id FROM stock_locations WHERE company_id = ? AND is_scrap = 1',
  ).get(CTX.companyId);
  const quant = fx.db.prepare(
    'SELECT quantity FROM stock_quants WHERE company_id = ? AND product_id = ? AND location_id = ?',
  ).get(CTX.companyId, component.variantId, scrapLocation.id);
  assert.equal(Number(quant.quantity), 3);
});

test('final completion capitalises the whole WIP balance and leaves WIP at exactly zero', () => {
  const order = releasedOrder(10, 'complete');
  fx.execute('manufacturing:material:issue', {
    order_id: order.id, product_id: component.variantId, quantity: 50,
  }, 'complete-issue');

  const finishedBefore = accountBalance(fx.db, accounts.finishedGoods);
  const wipAccountBefore = accountBalance(fx.db, accounts.wip);

  const result = fx.execute('manufacturing:order:complete', {
    order_id: order.id, quantity: 10,
  }, 'complete-1');

  assert.equal(result.state, 'completed');
  assert.equal(result.unit_cost, 20, '200 of WIP over 10 units');
  assert.equal(result.value, 200);
  assert.equal(result.wip_balance_after, 0, 'a fully completed order must clear its WIP');
  assert.ok(result.finance_document_id);

  assert.equal(accountBalance(fx.db, accounts.finishedGoods), finishedBefore + 200);
  assert.equal(accountBalance(fx.db, accounts.wip), wipAccountBefore - 200);

  const output = fx.db.prepare('SELECT * FROM production_outputs WHERE order_id = ?').get(order.id);
  assert.equal(output.output_type, 'finished');
  assert.equal(output.quantity, 10);
  assert.equal(output.unit_cost, 20);
});

test('partial completion absorbs only its share and the last one clears the rest', () => {
  const order = releasedOrder(10, 'partial');
  fx.execute('manufacturing:material:issue', {
    order_id: order.id, product_id: component.variantId, quantity: 50,
  }, 'partial-issue');

  const first = fx.execute('manufacturing:order:complete', { order_id: order.id, quantity: 4 }, 'partial-1');
  assert.equal(first.state, 'partially_completed');
  assert.equal(first.value, 80, '200 × 4/10');
  assert.equal(first.wip_balance_after, 120);

  const second = fx.execute('manufacturing:order:complete', { order_id: order.id, quantity: 6 }, 'partial-2');
  assert.equal(second.state, 'completed');
  assert.equal(second.value, 120, 'the final completion absorbs the remaining balance');
  assert.equal(second.wip_balance_after, 0);
});

test('completing beyond the planned quantity is refused unless a tolerance is given', () => {
  const order = releasedOrder(5, 'toler');
  fx.execute('manufacturing:material:issue', {
    order_id: order.id, product_id: component.variantId, quantity: 25,
  }, 'toler-issue');
  assert.throws(
    () => fx.execute('manufacturing:order:complete', { order_id: order.id, quantity: 6 }, 'toler-over'),
    /exceed the planned quantity/,
  );
  const allowed = fx.execute('manufacturing:order:complete', {
    order_id: order.id, quantity: 6, overproduction_tolerance_percent: 25,
  }, 'toler-ok');
  assert.equal(allowed.quantity, 6);
});

test('completing with no WIP value is refused rather than capitalising zero', () => {
  const order = releasedOrder(1, 'nowip');
  assert.throws(
    () => fx.execute('manufacturing:order:complete', { order_id: order.id, quantity: 1 }, 'nowip-complete'),
    /no work-in-progress value/,
  );
});

test('a by-product credit leaves WIP before the finished goods share is computed', () => {
  const order = releasedOrder(10, 'byprod');
  fx.execute('manufacturing:material:issue', {
    order_id: order.id, product_id: component.variantId, quantity: 50,
  }, 'byprod-issue');

  const result = fx.execute('manufacturing:order:complete', {
    order_id: order.id,
    quantity: 10,
    by_products: [{ product_id: component.variantId, quantity: 5, unit_cost: 4 }],
  }, 'byprod-complete');

  assert.equal(result.by_product_credit, 20, '5 units at 4.00 credited out of WIP');
  assert.equal(result.value, 180, '200 WIP less the 20 by-product credit');
  assert.equal(result.wip_balance_after, 0);
});

test('a residual WIP balance is posted as a variance, not left on the balance sheet', () => {
  const order = releasedOrder(10, 'variance');
  fx.execute('manufacturing:material:issue', {
    order_id: order.id, product_id: component.variantId, quantity: 50,
  }, 'variance-issue');
  fx.execute('manufacturing:order:complete', { order_id: order.id, quantity: 4 }, 'variance-complete');

  // Scrap the rest instead of producing it: WIP now holds unabsorbed value.
  const wipResidual = orders.getWipBalance(fx.db, CTX.companyId, order.id).balance;
  assert.ok(wipResidual > 0);

  assert.throws(
    () => fx.execute('manufacturing:order:close', { order_id: order.id }, 'variance-close-early'),
    /still carries WIP balance/,
  );

  const varianceBefore = accountBalance(fx.db, accounts.variance);
  const posted = fx.execute('manufacturing:order:variance', { order_id: order.id }, 'variance-post');
  assert.equal(posted.posted, true);
  assert.equal(posted.amount, wipResidual);
  assert.equal(posted.wip_balance, 0);
  assert.equal(accountBalance(fx.db, accounts.variance), varianceBefore + wipResidual);

  const closed = fx.execute('manufacturing:order:close', { order_id: order.id }, 'variance-close');
  assert.equal(closed.state, 'closed');
});

test('manufacturing WIP ties exactly to the general ledger', () => {
  const derived = reports.wipReport(fx.db, { company_id: CTX.companyId });
  const gl = reports.financeWipBalance(fx.db, { company_id: CTX.companyId });
  assert.equal(gl.posted, true);
  assert.equal(
    derived.total_wip_balance,
    gl.balance,
    'the sum of per-order WIP must equal the WIP account balance in the GL',
  );
});

test('every posted journal entry balances', () => {
  assert.deepEqual(unbalancedEntries(fx.db), []);
});

test('supplied components at a subcontractor stay owned and reconcile to canonical stock', () => {
  const subcontractor = fx.execute('party:create', { name: 'Precision Coating Ltd', party_type: 'supplier' }, 'subco');
  const workCenter = fx.execute('manufacturing:work_center:create', {
    code: 'WC-SUB', name: 'Subcontracted coating', resource_type: 'subcontractor',
  }, 'wc-sub');
  const routing = fx.execute('manufacturing:routing:create', {
    name: 'Coating routing', code: 'RT-COAT',
    operations: [{
      name: 'Coat', sequence: 10, work_center_id: workCenter.id,
      is_subcontracted: true, subcontractor_party_id: subcontractor.id,
    }],
  }, 'rt-coat');
  fx.execute('manufacturing:routing:approve', { routing_id: routing.id }, 'rt-coat-approve');

  const order = fx.execute('manufacturing:order:create', {
    product_id: finished.variantId, planned_quantity: 10,
    warehouse_id: warehouse.id, routing_id: routing.id,
  }, 'mo-sub');
  fx.execute('manufacturing:order:approve', { order_id: order.id }, 'mo-sub-approve');
  const released = fx.execute('manufacturing:order:release', { order_id: order.id }, 'mo-sub-release');
  const operationId = released.operations[0].id;

  const subcontractBefore = accountBalance(fx.db, accounts.subcontractStock);
  const inventoryBefore = accountBalance(fx.db, accounts.inventory);

  const transfer = fx.execute('manufacturing:subcontract:transfer', {
    order_id: order.id, order_operation_id: operationId,
    product_id: component.variantId, quantity: 50,
  }, 'sub-transfer');

  assert.equal(transfer.ownership, 'retained_by_this_company');
  assert.equal(transfer.value, 200);
  // Reclassified, never expensed and never treated as a sale.
  assert.equal(accountBalance(fx.db, accounts.subcontractStock), subcontractBefore + 200);
  assert.equal(accountBalance(fx.db, accounts.inventory), inventoryBefore - 200);
  assert.equal(accountBalance(fx.db, accounts.stockOutput), 0, 'a subcontract transfer is not a sale');

  const ownership = subcontracting.getSubcontractOwnershipReport(fx.db, {
    company_id: CTX.companyId, order_id: order.id,
  });
  assert.equal(ownership.length, 1);
  assert.equal(ownership[0].outstanding_quantity, 50);
  assert.equal(ownership[0].reconciled, true, 'holdings must tie to the canonical stock balance');

  const receipt = fx.execute('manufacturing:subcontract:receive', {
    order_id: order.id, order_operation_id: operationId, quantity: 10,
    service_charge: 150,
    consumed_components: [{ product_id: component.variantId, quantity: 40 }],
  }, 'sub-receive');
  assert.equal(receipt.consumed_component_value, 160);
  assert.equal(receipt.service_charge, 150);
  assert.ok(receipt.service_document_id);

  const returned = fx.execute('manufacturing:subcontract:return', {
    order_id: order.id, order_operation_id: operationId,
    product_id: component.variantId, quantity: 10,
  }, 'sub-return');
  assert.equal(returned.outstanding_at_subcontractor, 0);

  const finalOwnership = subcontracting.getSubcontractOwnershipReport(fx.db, {
    company_id: CTX.companyId, order_id: order.id,
  });
  assert.equal(finalOwnership[0].outstanding_quantity, 0);
  assert.equal(finalOwnership[0].reconciled, true);
  assert.equal(
    accountBalance(fx.db, accounts.subcontractStock), subcontractBefore,
    'all supplied component value has left the subcontractor account',
  );
  assert.deepEqual(unbalancedEntries(fx.db), []);
});
