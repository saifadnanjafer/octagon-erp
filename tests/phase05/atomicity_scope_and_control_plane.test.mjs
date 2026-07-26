import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import {
  buildFixture, teardown, seedAccounts, seedUnit, seedProduct, receiveStock,
  seedFinanceAssetCategory, accountBalance, CTX,
} from './helpers.mjs';
import { orders } from '../../platform/manufacturing/index.mjs';
import {
  isModuleEnabled, setModuleEnabled, listModuleStates, getPolicy, setPolicy,
  PHASE05_MODULE_FLAGS,
} from '../../platform/control_plane/phase05.mjs';

let fx;
let accounts;
let unit;
let warehouse;
let supplier;
let component;
let finished;
let unmappedProduct;

const OTHER_COMPANY = 'company-b';

before(async () => {
  fx = await buildFixture('atomicity');
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
    name: 'Rod', sku: 'RM-ROD', unitId: unit.id, categoryName: 'Raw rods',
  });
  finished = seedProduct(fx.db, fx.execute, accounts, {
    name: 'Shaft', sku: 'FG-SHAFT', unitId: unit.id, categoryName: 'Finished shafts',
    stockAccountId: accounts.finishedGoods,
  });
  receiveStock(fx.execute, {
    warehouse, supplierLocation: supplier, productId: component.variantId,
    unitId: unit.id, quantity: 400, unitCost: 7, key: 'rods',
  });

  const bom = fx.execute('manufacturing:bom:create', {
    product_id: finished.variantId, quantity: 1, code: 'BOM-SHAFT',
    lines: [{ product_id: component.variantId, quantity: 2 }],
  }, 'bom');
  fx.execute('manufacturing:bom:approve', { bom_id: bom.id }, 'bom-approve');

  // This product starts fully mapped so its opening stock can be received; the
  // atomicity test removes the mapping afterwards to make the GL post fail
  // *after* the stock move has already been written inside the transaction.
  unmappedProduct = seedProduct(fx.db, fx.execute, accounts, {
    name: 'Unmapped Rod', sku: 'RM-UNMAPPED', unitId: unit.id, categoryName: 'Unmapped raw',
  });
  receiveStock(fx.execute, {
    warehouse, supplierLocation: supplier, productId: unmappedProduct.variantId,
    unitId: unit.id, quantity: 50, unitCost: 9, key: 'unmapped',
  });
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

function counts() {
  const one = (sql) => Number(fx.db.prepare(sql).get().n);
  return {
    stockMoves: one('SELECT COUNT(*) AS n FROM stock_moves'),
    valuationFacts: one('SELECT COUNT(*) AS n FROM stock_valuation_facts'),
    quants: one('SELECT COUNT(*) AS n FROM stock_quants'),
    journalEntries: one('SELECT COUNT(*) AS n FROM finance_journal_entries'),
    financeDocuments: one('SELECT COUNT(*) AS n FROM finance_documents'),
    costFacts: one('SELECT COUNT(*) AS n FROM production_cost_facts'),
    consumptions: one('SELECT COUNT(*) AS n FROM production_material_consumptions'),
    audit: one('SELECT COUNT(*) AS n FROM platform_audit_log'),
    outbox: one('SELECT COUNT(*) AS n FROM platform_outbox'),
    idempotency: one('SELECT COUNT(*) AS n FROM action_idempotency'),
  };
}

// --------------------------------------------------------------------------
// Atomicity
// --------------------------------------------------------------------------

test('a finance-port failure during material issue leaves no partial state anywhere', () => {
  const order = releasedOrder(4, 'atomic');
  // Point the requirement at the unmapped product so the GL post fails after
  // the stock move has already been written inside the transaction.
  fx.db.prepare('UPDATE production_order_materials SET product_id = ? WHERE order_id = ?')
    .run(unmappedProduct.variantId, order.id);
  // Break the account mapping now that the stock is already on hand.
  fx.db.prepare(`
    UPDATE product_categories SET stock_account_id = NULL
    WHERE id = (SELECT category_id FROM product_templates WHERE id =
      (SELECT template_id FROM product_variants WHERE id = ?))
  `).run(unmappedProduct.variantId);

  const before = counts();
  assert.throws(
    () => fx.execute('manufacturing:material:issue', {
      order_id: order.id, product_id: unmappedProduct.variantId, quantity: 4,
      ignore_reservation: true,
    }, 'atomic-issue'),
    /account mapping is required/,
  );
  const after = counts();

  assert.deepEqual(after, before, 'a failed issue must leave stock, valuation, GL, audit, outbox and idempotency untouched');
  assert.equal(orders.getWipBalance(fx.db, CTX.companyId, order.id).balance, 0);
});

test('a failed action does not consume its idempotency key', () => {
  const order = releasedOrder(2, 'idem-fail');
  const key = 'idem-reused-after-failure';
  assert.throws(
    () => fx.execute('manufacturing:material:issue', {
      order_id: order.id, product_id: component.variantId, quantity: 999,
    }, key),
    /exceeds the outstanding requirement/,
  );
  assert.equal(
    fx.db.prepare('SELECT COUNT(*) AS n FROM action_idempotency WHERE idempotency_key = ?').get(key).n,
    0,
  );
  // The same key now works for a valid call.
  const issued = fx.execute('manufacturing:material:issue', {
    order_id: order.id, product_id: component.variantId, quantity: 4,
  }, key);
  assert.equal(issued.quantity, 4);
});

test('replaying an idempotency key returns the first result without repeating the effects', () => {
  const order = releasedOrder(3, 'idem-replay');
  const before = counts();
  const first = fx.execute('manufacturing:material:issue', {
    order_id: order.id, product_id: component.variantId, quantity: 6,
  }, 'idem-replay-key');
  const afterFirst = counts();
  assert.ok(afterFirst.stockMoves > before.stockMoves);

  const replay = fx.execute('manufacturing:material:issue', {
    order_id: order.id, product_id: component.variantId, quantity: 6,
  }, 'idem-replay-key');
  const afterReplay = counts();

  assert.deepEqual(replay, first, 'a replay must return the original result');
  assert.equal(afterReplay.stockMoves, afterFirst.stockMoves, 'a replay must not move stock again');
  assert.equal(afterReplay.journalEntries, afterFirst.journalEntries, 'a replay must not post again');
});

test('the same key with a different payload is rejected, not silently replayed', () => {
  const order = releasedOrder(3, 'idem-mismatch');
  fx.execute('manufacturing:material:issue', {
    order_id: order.id, product_id: component.variantId, quantity: 2,
  }, 'idem-mismatch-key');
  assert.throws(
    () => fx.execute('manufacturing:material:issue', {
      order_id: order.id, product_id: component.variantId, quantity: 4,
    }, 'idem-mismatch-key'),
    /idempotency key reused with different payload/,
  );
});

test('a duplicate manufacturing release is refused by the state machine', () => {
  const order = releasedOrder(2, 'dup-release');
  assert.throws(
    () => fx.execute('manufacturing:order:release', { order_id: order.id }, 'dup-release-2'),
    /does not allow this transition/,
  );
  assert.equal(
    fx.db.prepare('SELECT COUNT(*) AS n FROM production_order_materials WHERE order_id = ?').get(order.id).n,
    1,
    'a refused second release must not duplicate requirement rows',
  );
});

test('simultaneous reservation cannot over-allocate the same stock', () => {
  const free = fx.db.prepare(`
    SELECT COALESCE(SUM(quantity - reserved_quantity), 0) AS available
    FROM stock_quants q JOIN stock_locations l ON l.id = q.location_id
    WHERE q.company_id = ? AND q.product_id = ? AND l.usage = 'internal'
  `).get(CTX.companyId, component.variantId).available;

  const first = fx.execute('stock:reservation:reserve', {
    warehouse_id: warehouse.id, location_id: warehouse.lot_stock_id,
    product_id: component.variantId, source_document_type: 'production_order',
    source_document_id: 'CONCURRENT-A', quantity: free,
  }, 'reserve-a');
  assert.equal(first.quantity, free);

  assert.throws(
    () => fx.execute('stock:reservation:reserve', {
      warehouse_id: warehouse.id, location_id: warehouse.lot_stock_id,
      product_id: component.variantId, source_document_type: 'production_order',
      source_document_id: 'CONCURRENT-B', quantity: 1,
    }, 'reserve-b'),
    /insufficient/i,
  );
  fx.execute('stock:reservation:release', { reservation_id: first.id }, 'reserve-a-release');
});

test('duplicate asset capitalization cannot post twice', () => {
  const financeCategory = seedFinanceAssetCategory(fx.db, accounts);
  const category = fx.execute('asset:category:create', {
    code: 'MACH', name: 'Machinery', finance_category_id: financeCategory.id,
  }, 'atomic-cat');
  const asset = fx.execute('asset:create', {
    name: 'Duplicate probe', category_id: category.id, acquisition_value: 1_000,
  }, 'atomic-asset');

  const before = accountBalance(fx.db, accounts.assetGross);
  fx.execute('asset:capitalize', {
    asset_id: asset.id, source_account_id: accounts.assetClearing,
  }, 'atomic-cap');
  assert.throws(
    () => fx.execute('asset:capitalize', {
      asset_id: asset.id, source_account_id: accounts.assetClearing,
    }, 'atomic-cap-2'),
    /already capitalized/,
  );
  assert.equal(accountBalance(fx.db, accounts.assetGross), before + 1_000, 'the asset account moved exactly once');
});

test('duplicate preventive maintenance generation cannot create a second order', () => {
  const financeCategory = fx.db.prepare('SELECT id FROM finance_asset_categories LIMIT 1').get();
  const category = fx.db.prepare("SELECT id FROM asset_categories WHERE code = 'MACH'").get();
  const asset = fx.execute('asset:create', {
    name: 'PM probe', category_id: category.id, acquisition_value: 500,
  }, 'pm-probe-asset');
  fx.execute('asset:capitalize', {
    asset_id: asset.id, source_account_id: accounts.assetClearing,
  }, 'pm-probe-cap');
  const plan = fx.execute('maintenance:plan:create', {
    name: 'Weekly', code: 'PM-W', asset_id: asset.id, trigger_type: 'calendar',
    interval_days: 7, next_due_date: '2026-01-01',
  }, 'pm-probe-plan');

  const runs = [1, 2, 3].map((n) =>
    fx.execute('maintenance:plan:generate', { plan_id: plan.id, as_of: '2026-01-05' }, `pm-probe-gen-${n}`));
  assert.equal(runs[0].generated, 1);
  assert.equal(runs[1].generated, 0);
  assert.equal(runs[2].generated, 0);
  assert.equal(
    fx.db.prepare('SELECT COUNT(*) AS n FROM maintenance_orders WHERE plan_id = ?').get(plan.id).n,
    1,
  );
});

test('a duplicate fuel transaction reference is rejected', () => {
  const vehicle = fx.execute('fleet:vehicle:create', {
    name: 'Probe truck', plate_number: 'PRB-1', expected_consumption_per_100: 20,
  }, 'fuel-veh');
  fx.execute('fleet:fuel:record', {
    vehicle_id: vehicle.id, quantity: 40, unit_price: 1, external_reference: 'CARD-77',
  }, 'fuel-a');
  assert.throws(
    () => fx.execute('fleet:fuel:record', {
      vehicle_id: vehicle.id, quantity: 40, unit_price: 1, external_reference: 'CARD-77',
    }, 'fuel-b'),
    /already been recorded/,
  );
  assert.equal(
    fx.db.prepare("SELECT COUNT(*) AS n FROM fleet_fuel_transactions WHERE external_reference = 'CARD-77'").get().n,
    1,
  );
});

// --------------------------------------------------------------------------
// Scope and security
// --------------------------------------------------------------------------

test('a caller cannot claim a company scope the session does not carry', () => {
  assert.throws(
    () => fx.executor.execute('manufacturing:order:create', {
      product_id: finished.variantId, planned_quantity: 1,
      company_id: OTHER_COMPANY, idempotency_key: 'scope-claim',
    }, CTX),
    /company scope must come from the verified session/,
  );
});

test('a caller cannot claim an actor identity the session does not carry', () => {
  assert.throws(
    () => fx.executor.execute('manufacturing:order:create', {
      product_id: finished.variantId, planned_quantity: 1,
      actor: 'someone-else', idempotency_key: 'actor-claim',
    }, CTX),
    /actor identity must come from the verified session/,
  );
});

test('an action without a company scope is refused', () => {
  assert.throws(
    () => fx.executor.execute('manufacturing:order:create', {
      product_id: finished.variantId, planned_quantity: 1, idempotency_key: 'noscope',
    }, { ...CTX, companyId: null }),
    /an active company scope is required/,
  );
});

test('records from another company are invisible to this company scope', () => {
  const order = releasedOrder(1, 'isolation');
  fx.db.prepare('UPDATE production_orders SET company_id = ? WHERE id = ?').run(OTHER_COMPANY, order.id);
  assert.throws(
    () => fx.execute('manufacturing:material:issue', {
      order_id: order.id, product_id: component.variantId, quantity: 1,
    }, 'isolation-issue'),
    /outside the active company/,
  );
  assert.throws(
    () => orders.getProductionOrder(fx.db, order.id, CTX.companyId),
    /outside the active company/,
  );
  fx.db.prepare('UPDATE production_orders SET company_id = ? WHERE id = ?').run(CTX.companyId, order.id);
});

test('every Phase 05 action declares a permission, scope, transaction owner and error contract', () => {
  const rows = fx.db.prepare(`
    SELECT id, required_permission, required_scope, transaction_owner, idempotency_policy,
           audit_policy, outbox_policy, error_contract, input_schema
    FROM platform_actions
    WHERE module_id IN ('manufacturing_core','quality_core','manufacturing_planning',
                        'project_core','asset_core','maintenance_core','fleet_core')
  `).all();
  assert.ok(rows.length >= 100, `expected the full Phase 05 action set, got ${rows.length}`);
  for (const row of rows) {
    assert.ok(row.required_permission, `${row.id}: required_permission`);
    assert.equal(row.required_scope, 'company', `${row.id}: required_scope`);
    assert.equal(row.transaction_owner, 'platform_action_executor', `${row.id}: transaction_owner`);
    assert.equal(row.idempotency_policy, 'required', `${row.id}: idempotency_policy`);
    assert.equal(row.audit_policy, 'required', `${row.id}: audit_policy`);
    assert.equal(row.outbox_policy, 'required', `${row.id}: outbox_policy`);
    assert.ok(row.error_contract, `${row.id}: error_contract`);
    assert.ok(row.input_schema, `${row.id}: input_schema`);
  }
});

test('every Phase 05 action permission is registered with the evaluator', () => {
  const permissions = fx.db.prepare(`
    SELECT DISTINCT required_permission AS permission FROM platform_actions
    WHERE module_id IN ('manufacturing_core','quality_core','manufacturing_planning',
                        'project_core','asset_core','maintenance_core','fleet_core')
  `).all();
  for (const row of permissions) {
    assert.ok(
      fx.authority.registry.get(row.permission),
      `permission ${row.permission} must be registered, otherwise the evaluator fails closed on it`,
    );
  }
});

test('a governed action writes audit and outbox evidence', () => {
  const order = releasedOrder(1, 'evidence');
  const audit = fx.db.prepare(`
    SELECT * FROM platform_audit_log
    WHERE action = 'action.execute.manufacturing:order:release' AND resource_id = ?
  `).get(order.id);
  assert.ok(audit, 'a governed action must write an audit row');
  assert.equal(audit.actor_id, CTX.userId);
  assert.equal(audit.company_id, CTX.companyId);

  const outbox = fx.db.prepare(`
    SELECT * FROM platform_outbox WHERE aggregate_id = ? ORDER BY created_at DESC LIMIT 1
  `).get(`production_order:${order.id}`);
  assert.ok(outbox, 'a governed action must write an outbox event');
  assert.equal(outbox.status, 'pending');
});

// --------------------------------------------------------------------------
// Control plane
// --------------------------------------------------------------------------

test('every Phase 05 module ships a server-side flag', () => {
  const states = listModuleStates(fx.db);
  assert.equal(states.length, Object.keys(PHASE05_MODULE_FLAGS).length);
  for (const state of states) {
    assert.equal(state.enabled, true, `${state.key} should ship enabled`);
  }
});

test('disabling a module denies its actions on the server, not just in the browser', () => {
  assert.equal(isModuleEnabled(fx.db, PHASE05_MODULE_FLAGS.fleet), true);
  setModuleEnabled(fx.db, { flag_key: PHASE05_MODULE_FLAGS.fleet, enabled: false });
  assert.equal(isModuleEnabled(fx.db, PHASE05_MODULE_FLAGS.fleet), false);

  assert.throws(
    () => fx.execute('fleet:vehicle:create', { name: 'Denied truck' }, 'flag-denied'),
    /Fleet is disabled for this deployment/,
  );

  setModuleEnabled(fx.db, { flag_key: PHASE05_MODULE_FLAGS.fleet, enabled: true });
  const allowed = fx.execute('fleet:vehicle:create', { name: 'Allowed truck' }, 'flag-allowed');
  assert.ok(allowed.id);
});

test('an unknown module flag is refused rather than silently created', () => {
  assert.throws(
    () => setModuleEnabled(fx.db, { flag_key: 'phase05.imaginary.enabled', enabled: false }),
    /unknown Phase 05 module flag/,
  );
});

test('operating policies are company-scoped and readable by the domains that need them', () => {
  assert.equal(getPolicy(fx.db, CTX.companyId, 'negative_material_policy'), 'deny');
  assert.equal(getPolicy(fx.db, CTX.companyId, 'bom_approval_required'), '1');
  assert.equal(getPolicy(fx.db, CTX.companyId, 'fleet_fuel_variance_tolerance_percent'), '10');
  assert.equal(getPolicy(fx.db, CTX.companyId, 'not_a_real_policy', 'fallback'), 'fallback');

  setPolicy(fx.db, {
    company_id: CTX.companyId, actor: CTX.userId,
    policy_key: 'fleet_fuel_variance_tolerance_percent', policy_value: '25',
  });
  assert.equal(getPolicy(fx.db, CTX.companyId, 'fleet_fuel_variance_tolerance_percent'), '25');

  // Another company keeps its own value; policies never leak across companies.
  assert.equal(getPolicy(fx.db, OTHER_COMPANY, 'fleet_fuel_variance_tolerance_percent', null), null);
});

test('manufacturing refuses to post when its account mapping is absent', () => {
  fx.db.prepare('DELETE FROM manufacturing_account_mappings WHERE company_id = ?').run(CTX.companyId);
  const order = releasedOrder(1, 'nomapping');
  assert.throws(
    () => fx.execute('manufacturing:material:issue', {
      order_id: order.id, product_id: component.variantId, quantity: 2,
    }, 'nomapping-issue'),
    /account mapping is not configured/,
  );
  // Restore for any later test in this file.
  fx.execute('manufacturing:account_mapping:set', {
    wip_account_id: accounts.wip,
    labor_absorption_account_id: accounts.laborAbsorption,
    overhead_absorption_account_id: accounts.overheadAbsorption,
    scrap_account_id: accounts.scrap,
    variance_account_id: accounts.variance,
  }, 'mapping-restore');
});
