// Checkpoint D2 — Engineering, BOM, Routings, Work Centers, and MRP.
//
// Every suite uses a DISPOSABLE database under os.tmpdir() (freshInstall of
// migrations 001-053). The operational database.db / database.json files in
// the repo root are never opened.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, before, after } from 'node:test';

import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';
import { products, uom } from '../../platform/commercial/index.mjs';
import { setApprovalAuthorityLimit } from '../../platform/finance/engine.mjs';
import { mrp } from '../../platform/engineering/index.mjs';

let tempDir;
let db;
let executor;
let ctx;
let ctxApprover;
let ikCount = 0;
let seed;

function ik(prefix) {
  ikCount += 1;
  return `${prefix}_${Date.now()}_${ikCount}`;
}

const execute = (actionId, input, key) => executor.execute(actionId, { ...input, idempotency_key: key }, ctx);
// A distinct approver, because submit and approve may not be the same actor.
const approve = (actionId, input, key) => executor.execute(actionId, { ...input, idempotency_key: key }, ctxApprover);

function makeProduct(tag, { stockQty = 0, unitCost = 10 } = {}) {
  const uomCategory = uom.createUomCategory(db, { name: `Units ${tag}` });
  const unit = uom.createUom(db, { category_id: uomCategory.id, name: `Piece ${tag}` });
  const category = products.createProductCategory(db, {
    company_id: 'default',
    name: `Goods ${tag}`,
    costing_method: 'avco',
    income_account_id: 'acc_401000',
    expense_account_id: 'acc_501000',
    stock_account_id: 'acc_104000',
    stock_input_account_id: 'acc_201000',
    stock_output_account_id: 'acc_500000',
  });
  const product = execute('product:template:create', {
    name: `Product ${tag}`,
    category_id: category.id,
    uom_id: unit.id,
    list_price: unitCost * 2,
    standard_price: unitCost,
    sku: `SKU-${tag}`,
  }, ik(`prod${tag}`));

  if (stockQty > 0) {
    execute('stock:move:post', {
      reference: `OPEN-${tag}`,
      product_id: product.default_variant_id,
      uom_id: unit.id,
      product_qty: stockQty,
      location_id: seed.supplierLocation.id,
      location_dest_id: seed.warehouse.lot_stock_id,
      unit_cost: unitCost,
      source_document_type: 'inventory_adjustment',
      source_document_id: `OPEN-${tag}`,
    }, ik(`open${tag}`));
  }
  return { variantId: product.default_variant_id, uomId: unit.id, product };
}

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-checkpoint-d2-'));
  const dbPath = path.join(tempDir, 'checkpoint-d2.db');
  await freshInstall({ dbPath, backupDir: path.join(tempDir, 'backups'), actor: 'checkpoint-d2-test' });
  db = openMigrationDatabase(dbPath);
  executor = createPlatformAuthority(db).actionExecutor;
  ctx = {
    tenantId: 'default', companyId: 'default', branchId: 'default',
    userId: 'checkpoint-d2-engineer', sourceChannel: 'node-test',
  };
  ctxApprover = { ...ctx, userId: 'checkpoint-d2-approver' };
  setApprovalAuthorityLimit(db, ctx, { role_or_user: ctx.userId, limit_type: 'post', max_amount: 1_000_000_000 });

  const warehouse = execute('warehouse:create', { name: 'D2 Warehouse', code: 'WD2' }, ik('wh'));
  const supplierLocation = execute('stock:location:create', { name: 'D2 Supplier', usage: 'supplier' }, ik('sup'));
  seed = { warehouse, supplierLocation };
});

after(() => {
  try { db?.close(); } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// BOM lifecycle and immutability
// ---------------------------------------------------------------------------

test('BOM lifecycle: draft -> review -> approved, with separation of duties', () => {
  const finished = makeProduct('FG1');
  const component = makeProduct('C1');

  const bom = execute('engineering:bom:create', {
    product_id: finished.variantId, name_en: 'Chair', quantity: 1,
    lines: [{ component_id: component.variantId, quantity: 4 }],
  }, ik('bom1'));

  const version = bom.versions[0];
  assert.equal(version.state, 'draft');
  assert.equal(version.revision, 1);
  assert.equal(version.lines.length, 1);

  execute('engineering:bom:submit', { bom_version_id: version.id }, ik('sub1'));

  // The submitter cannot also approve.
  assert.throws(
    () => execute('engineering:bom:approve', { bom_version_id: version.id }, ik('selfapp1')),
    (error) => error.code === 'BOM_SELF_APPROVAL_DENIED',
  );

  const approved = approve('engineering:bom:approve', { bom_version_id: version.id }, ik('app1'));
  assert.equal(approved.state, 'approved');
  assert.equal(approved.superseded_version_id, null);
});

test('an empty BOM version cannot be submitted', () => {
  const fg = makeProduct('FG2');
  const bom = execute('engineering:bom:create', { product_id: fg.variantId }, ik('bom2'));
  assert.throws(
    () => execute('engineering:bom:submit', { bom_version_id: bom.versions[0].id }, ik('sub2')),
    (error) => error.code === 'BOM_VERSION_EMPTY',
  );
});

test('an approved BOM version cannot be edited — only revised', () => {
  const fg = makeProduct('FG3');
  const c = makeProduct('C3');
  const bom = execute('engineering:bom:create', {
    product_id: fg.variantId, lines: [{ component_id: c.variantId, quantity: 2 }],
  }, ik('bom3'));
  const v1 = bom.versions[0];
  execute('engineering:bom:submit', { bom_version_id: v1.id }, ik('sub3'));
  approve('engineering:bom:approve', { bom_version_id: v1.id }, ik('app3'));

  assert.throws(
    () => execute('engineering:bom:add_line', { bom_version_id: v1.id, component_id: c.variantId, quantity: 1 }, ik('edit3')),
    (error) => error.code === 'BOM_VERSION_NOT_DRAFT',
  );

  const v2 = execute('engineering:bom:new_revision', { bom_id: bom.id }, ik('rev3'));
  assert.equal(v2.revision, 2);
  assert.equal(v2.state, 'draft');

  // A revision copies the previous bill rather than starting empty.
  const copied = db.prepare('SELECT COUNT(*) AS c FROM bom_lines WHERE bom_version_id = ?').get(v2.id).c;
  assert.equal(copied, 1);

  // Only one open revision at a time.
  assert.throws(
    () => execute('engineering:bom:new_revision', { bom_id: bom.id }, ik('rev3b')),
    (error) => error.code === 'BOM_REVISION_ALREADY_OPEN',
  );
});

test('approving a new revision automatically supersedes the previous one', () => {
  const fg = makeProduct('FG4');
  const c = makeProduct('C4');
  const bom = execute('engineering:bom:create', {
    product_id: fg.variantId, lines: [{ component_id: c.variantId, quantity: 1 }],
  }, ik('bom4'));
  const v1 = bom.versions[0];
  execute('engineering:bom:submit', { bom_version_id: v1.id }, ik('sub4'));
  approve('engineering:bom:approve', { bom_version_id: v1.id }, ik('app4'));

  const v2 = execute('engineering:bom:new_revision', { bom_id: bom.id }, ik('rev4'));
  execute('engineering:bom:submit', { bom_version_id: v2.id }, ik('sub4b'));
  const approved2 = approve('engineering:bom:approve', { bom_version_id: v2.id }, ik('app4b'));

  assert.equal(approved2.superseded_version_id, v1.id);
  const old = db.prepare('SELECT state, superseded_by_id FROM bom_versions WHERE id = ?').get(v1.id);
  assert.equal(old.state, 'superseded');
  assert.equal(old.superseded_by_id, v2.id);

  // Exactly one approved version is effective.
  const approvedCount = db.prepare("SELECT COUNT(*) AS c FROM bom_versions WHERE bom_id = ? AND state = 'approved'").get(bom.id).c;
  assert.equal(approvedCount, 1);
});

test('a consumed BOM version is immutable and cannot be rejected', async () => {
  const { bom: bomModule } = await import('../../platform/engineering/index.mjs');
  const fg = makeProduct('FG5');
  const c = makeProduct('C5');
  const bom = execute('engineering:bom:create', {
    product_id: fg.variantId, lines: [{ component_id: c.variantId, quantity: 1 }],
  }, ik('bom5'));
  const v1 = bom.versions[0];
  execute('engineering:bom:submit', { bom_version_id: v1.id }, ik('sub5'));
  approve('engineering:bom:approve', { bom_version_id: v1.id }, ik('app5'));

  // Simulate a production order consuming this bill.
  bomModule.markBomConsumed(db, 'default', v1.id);
  const consumed = db.prepare('SELECT consumed_at FROM bom_versions WHERE id = ?').get(v1.id);
  assert.ok(consumed.consumed_at, 'consumption must be stamped');

  const v2 = execute('engineering:bom:new_revision', { bom_id: bom.id }, ik('rev5'));
  execute('engineering:bom:submit', { bom_version_id: v2.id }, ik('sub5b'));
  approve('engineering:bom:approve', { bom_version_id: v2.id }, ik('app5b'));

  // v1 is now superseded but its consumed content is untouched.
  const after = db.prepare('SELECT state, consumed_at FROM bom_versions WHERE id = ?').get(v1.id);
  assert.equal(after.state, 'superseded');
  assert.ok(after.consumed_at);
});

test('a BOM cannot consume its own product, and a phantom line needs a child BOM', () => {
  const fg = makeProduct('FG6');
  const bom = execute('engineering:bom:create', { product_id: fg.variantId }, ik('bom6'));
  const v = bom.versions[0];

  assert.throws(
    () => execute('engineering:bom:add_line', { bom_version_id: v.id, component_id: fg.variantId, quantity: 1 }, ik('self6')),
    (error) => error.code === 'BOM_SELF_REFERENCE',
  );

  const c = makeProduct('C6');
  assert.throws(
    () => execute('engineering:bom:add_line', {
      bom_version_id: v.id, component_id: c.variantId, quantity: 1, is_phantom: true,
    }, ik('phantom6')),
    (error) => error.code === 'BOM_PHANTOM_CHILD_REQUIRED',
  );
});

// ---------------------------------------------------------------------------
// Work centers and routings
// ---------------------------------------------------------------------------

test('a work center mirrors its machine rate into the single standard-cost authority', () => {
  const wc = execute('engineering:work_center:create', {
    code: 'WC-CUT', name: 'Cutting', machine_cost_per_hour: 25, labor_cost_per_hour: 7,
  }, ik('wc1'));
  assert.equal(wc.machine_cost_per_hour, 25);

  const rate = db.prepare(
    "SELECT hourly_cost FROM project_cost_rates WHERE rate_scope = 'work_center' AND rate_key = ?",
  ).get(wc.id);
  assert.ok(rate, 'work center rate must exist in project_cost_rates');
  assert.equal(rate.hourly_cost, 25);

  execute('engineering:work_center:update', { work_center_id: wc.id, machine_cost_per_hour: 30 }, ik('wc1u'));
  const updated = db.prepare(
    "SELECT hourly_cost FROM project_cost_rates WHERE rate_scope = 'work_center' AND rate_key = ?",
  ).get(wc.id);
  assert.equal(updated.hourly_cost, 30, 'the single standard-cost authority must stay in sync');
});

test('routing lifecycle enforces operations, times, and separation of duties', () => {
  const fg = makeProduct('FG7');
  const wc = execute('engineering:work_center:create', { code: 'WC-ASM', name: 'Assembly', machine_cost_per_hour: 12 }, ik('wc2'));

  const routing = execute('engineering:routing:create', { product_id: fg.variantId, name_en: 'Chair routing' }, ik('rt1'));
  const rv = routing.versions[0];

  assert.throws(
    () => execute('engineering:routing:submit', { routing_version_id: rv.id }, ik('rsub0')),
    (error) => error.code === 'ROUTING_VERSION_EMPTY',
  );

  // An operation must define some time.
  assert.throws(
    () => execute('engineering:routing:add_operation', {
      routing_version_id: rv.id, work_center_id: wc.id, name: 'No time', setup_minutes: 0, cycle_minutes_per_unit: 0,
    }, ik('rop0')),
    (error) => error.code === 'ROUTING_OPERATION_TIME_REQUIRED',
  );

  const op = execute('engineering:routing:add_operation', {
    routing_version_id: rv.id, work_center_id: wc.id, name: 'Assemble',
    setup_minutes: 10, cycle_minutes_per_unit: 5, sequence: 10,
  }, ik('rop1'));
  // The operation inherits the work centre's configured standard rate.
  assert.equal(op.machine_rate_per_hour, 12);

  // Duplicate sequence is rejected.
  assert.throws(
    () => execute('engineering:routing:add_operation', {
      routing_version_id: rv.id, work_center_id: wc.id, name: 'Dup', setup_minutes: 1, sequence: 10,
    }, ik('rop2')),
    (error) => error.code === 'ROUTING_OPERATION_SEQUENCE_DUPLICATE',
  );

  execute('engineering:routing:submit', { routing_version_id: rv.id }, ik('rsub1'));
  assert.throws(
    () => execute('engineering:routing:approve', { routing_version_id: rv.id }, ik('rselfapp')),
    (error) => error.code === 'ROUTING_SELF_APPROVAL_DENIED',
  );
  const approved = approve('engineering:routing:approve', { routing_version_id: rv.id }, ik('rapp1'));
  assert.equal(approved.state, 'approved');

  assert.throws(
    () => execute('engineering:routing:add_operation', {
      routing_version_id: rv.id, work_center_id: wc.id, name: 'Late', setup_minutes: 1, sequence: 20,
    }, ik('rop3')),
    (error) => error.code === 'ROUTING_VERSION_NOT_DRAFT',
  );
});

test('a subcontract operation requires a supplier party', () => {
  const fg = makeProduct('FG8');
  const wc = execute('engineering:work_center:create', { code: 'WC-SUB', name: 'Subcon', is_subcontract: true }, ik('wc3'));
  const routing = execute('engineering:routing:create', { product_id: fg.variantId }, ik('rt2'));
  assert.throws(
    () => execute('engineering:routing:add_operation', {
      routing_version_id: routing.versions[0].id, work_center_id: wc.id, name: 'Plating',
      setup_minutes: 5, is_subcontract: true,
    }, ik('rop4')),
    (error) => error.code === 'ROUTING_SUBCONTRACT_PARTY_REQUIRED',
  );
});

// ---------------------------------------------------------------------------
// Engineering change orders
// ---------------------------------------------------------------------------

test('an approved ECO opens a governed revision instead of editing in place', () => {
  const fg = makeProduct('FG9');
  const c = makeProduct('C9');
  const bom = execute('engineering:bom:create', {
    product_id: fg.variantId, lines: [{ component_id: c.variantId, quantity: 3 }],
  }, ik('bom9'));
  const v1 = bom.versions[0];
  execute('engineering:bom:submit', { bom_version_id: v1.id }, ik('sub9'));
  approve('engineering:bom:approve', { bom_version_id: v1.id }, ik('app9'));

  const eco = execute('engineering:eco:create', {
    title: 'Thicker frame', change_type: 'bom', bom_id: bom.id, reason: 'Customer complaint',
  }, ik('eco1'));
  assert.match(eco.eco_number, /^ECO-\d{4}$/);

  const approvedEco = approve('engineering:eco:approve', { eco_id: eco.id }, ik('ecoapp1'));
  assert.equal(approvedEco.state, 'approved');
  assert.ok(approvedEco.resulting_bom_version, 'ECO approval must open a new draft revision');
  assert.equal(approvedEco.resulting_bom_version.revision, 2);
  assert.equal(approvedEco.resulting_bom_version.state, 'draft');

  // The originally approved version is untouched by the ECO itself.
  const original = db.prepare('SELECT state FROM bom_versions WHERE id = ?').get(v1.id);
  assert.equal(original.state, 'approved');

  assert.throws(
    () => approve('engineering:eco:approve', { eco_id: eco.id }, ik('ecoapp2')),
    (error) => error.code === 'ECO_CLOSED',
  );
});

// ---------------------------------------------------------------------------
// MRP
// ---------------------------------------------------------------------------

test('a make policy requires an approved BOM', () => {
  const fg = makeProduct('FG10');
  assert.throws(
    () => execute('mrp:policy:set', { product_id: fg.variantId, sourcing: 'make' }, ik('pol10')),
    (error) => error.code === 'MRP_MAKE_REQUIRES_APPROVED_BOM',
  );
});

test('lot sizing applies fixed lots, minimum order quantity, and multiples', () => {
  assert.equal(mrp.applyLotSizing(7, { lot_sizing: 'fixed', fixed_lot_size: 5 }), 10);
  assert.equal(mrp.applyLotSizing(3, { lot_sizing: 'lot_for_lot', minimum_order_quantity: 10 }), 10);
  assert.equal(mrp.applyLotSizing(11, { lot_sizing: 'lot_for_lot', multiple_of: 4 }), 12);
  assert.equal(mrp.applyLotSizing(0, { lot_sizing: 'lot_for_lot' }), 0);
});

test('MRP explodes a multi-level BOM and nets against real on-hand stock', () => {
  // FG <- 2x SUB <- 3x RAW.  RAW has 10 on hand.
  const fg = makeProduct('MFG');
  const sub = makeProduct('MSUB');
  const raw = makeProduct('MRAW', { stockQty: 10, unitCost: 5 });

  const subBom = execute('engineering:bom:create', {
    product_id: sub.variantId, lines: [{ component_id: raw.variantId, quantity: 3 }],
  }, ik('bomsub'));
  execute('engineering:bom:submit', { bom_version_id: subBom.versions[0].id }, ik('subsub'));
  approve('engineering:bom:approve', { bom_version_id: subBom.versions[0].id }, ik('appsub'));

  const fgBom = execute('engineering:bom:create', {
    product_id: fg.variantId, lines: [{ component_id: sub.variantId, quantity: 2 }],
  }, ik('bomfg'));
  execute('engineering:bom:submit', { bom_version_id: fgBom.versions[0].id }, ik('subfg'));
  approve('engineering:bom:approve', { bom_version_id: fgBom.versions[0].id }, ik('appfg'));

  execute('mrp:policy:set', { product_id: fg.variantId, sourcing: 'make' }, ik('polfg'));
  execute('mrp:policy:set', { product_id: sub.variantId, sourcing: 'make' }, ik('polsub'));
  execute('mrp:policy:set', { product_id: raw.variantId, sourcing: 'buy', lead_time_days: 5 }, ik('polraw'));

  execute('mrp:demand:record', { product_id: fg.variantId, quantity: 5, demand_type: 'manual' }, ik('dem1'));

  const run = execute('mrp:run:execute', {}, ik('run1'));
  assert.equal(run.state, 'completed');
  assert.equal(run.created_financial_commitment, false, 'MRP must never create a commitment');
  assert.equal(run.created_stock_movement, false, 'MRP must never move stock');

  const byProduct = (id) => run.requirements.find((r) => r.product_id === id);
  assert.equal(byProduct(fg.variantId).gross_requirement, 5);
  assert.equal(byProduct(sub.variantId).gross_requirement, 10, '5 FG x 2 SUB');
  // 10 SUB x 3 RAW = 30 gross; 10 on hand -> 20 net.
  assert.equal(byProduct(raw.variantId).gross_requirement, 30);
  assert.equal(byProduct(raw.variantId).on_hand, 10);
  assert.equal(byProduct(raw.variantId).net_requirement, 20);

  const rawProposal = run.proposals.find((p) => p.product_id === raw.variantId);
  assert.equal(rawProposal.proposal_type, 'purchase');
  assert.equal(rawProposal.quantity, 20);
  const fgProposal = run.proposals.find((p) => p.product_id === fg.variantId);
  assert.equal(fgProposal.proposal_type, 'manufacture');
  assert.ok(fgProposal.bom_version_id, 'a manufacture proposal must name the approved BOM version');

  // Absolutely no purchase order or stock move was created.
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM purchase_orders').get().c, 0);
});

test('safety stock reduces availability and creates a shortage', () => {
  const item = makeProduct('SAFE', { stockQty: 10, unitCost: 2 });
  execute('mrp:policy:set', { product_id: item.variantId, sourcing: 'buy', safety_stock: 8 }, ik('polsafe'));
  execute('mrp:demand:record', { product_id: item.variantId, quantity: 5 }, ik('demsafe'));

  const run = execute('mrp:run:execute', {}, ik('runsafe'));
  const req = run.requirements.find((r) => r.product_id === item.variantId);
  // 10 on hand - 8 safety = 2 available; 5 gross -> 3 net.
  assert.equal(req.safety_stock, 8);
  assert.equal(req.available, 2);
  assert.equal(req.net_requirement, 3);
  assert.equal(req.is_shortage, 1);
});

test('MRP refuses to run when there is no open demand', () => {
  assert.throws(
    () => execute('mrp:run:execute', {}, ik('runempty')),
    (error) => error.code === 'MRP_NO_OPEN_DEMAND',
  );
});

test('proposal approval authorises a hand-off but creates no commitment', () => {
  const item = makeProduct('PROP');
  execute('mrp:policy:set', { product_id: item.variantId, sourcing: 'buy' }, ik('polprop'));
  execute('mrp:demand:record', { product_id: item.variantId, quantity: 4 }, ik('demprop'));
  const run = execute('mrp:run:execute', {}, ik('runprop'));
  const proposal = run.proposals.find((p) => p.product_id === item.variantId);

  const approved = execute('mrp:proposal:approve', { proposal_id: proposal.id }, ik('appprop'));
  assert.equal(approved.state, 'approved');
  assert.equal(approved.hand_off_authority, 'platform.procurement');
  assert.equal(approved.created_financial_commitment, false);

  assert.throws(
    () => execute('mrp:proposal:approve', { proposal_id: proposal.id }, ik('appprop2')),
    (error) => error.code === 'MRP_PROPOSAL_CLOSED',
  );
});

test('MRP reports return canonical rows', () => {
  for (const report of ['shortages', 'proposals', 'planner_worklist', 'runs', 'demand']) {
    assert.ok(Array.isArray(mrp.mrpReport(db, ctx, report)), `${report} must return an array`);
  }
  assert.throws(
    () => mrp.mrpReport(db, ctx, 'nope'),
    (error) => error.code === 'MRP_REPORT_UNKNOWN',
  );
});

// ---------------------------------------------------------------------------
// Scope and idempotency
// ---------------------------------------------------------------------------

test('a caller cannot assert its own company scope on engineering actions', () => {
  assert.throws(
    () => executor.execute('engineering:work_center:create', {
      code: 'WC-SPOOF', name: 'Spoof', company_id: 'other-co', idempotency_key: ik('spoof'),
    }, ctx),
    (error) => error.code === 'UNTRUSTED_ACTION_SCOPE',
  );
});

test('repeating an idempotency key does not create a duplicate work center', () => {
  const key = ik('idemwc');
  const first = execute('engineering:work_center:create', { code: 'WC-IDEM', name: 'Idem' }, key);
  const second = execute('engineering:work_center:create', { code: 'WC-IDEM', name: 'Idem' }, key);
  assert.equal(first.id, second.id);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM work_centers WHERE code = 'WC-IDEM'").get().c, 1);
});
