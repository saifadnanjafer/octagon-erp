// Checkpoint C — Sales lifecycle expansion tests.
//
// Every suite uses a DISPOSABLE database under os.tmpdir() (freshInstall of
// migrations 001-046). The operational database.db / database.json files in
// the repo root are never opened.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, before, after } from 'node:test';

import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';
import { products, uom } from '../../platform/commercial/index.mjs';
import {
  setApprovalAuthorityLimit,
  setCreditProfile,
  holdCredit,
  createTax,
} from '../../platform/finance/engine.mjs';
import { getQuantBalance } from '../../platform/inventory/ledger.mjs';
import { handleCommercialQuery } from '../../platform/api/commercial.mjs';

let tempDir;
let dbPath;
let db;
let executor;
let ctx;
let ikCount = 0;

function ik(prefix) {
  ikCount += 1;
  return `${prefix}_${Date.now()}_${ikCount}`;
}

const execute = (actionId, input, key) => executor.execute(actionId, { ...input, idempotency_key: key }, ctx);

function seedCatalog(tag, { stockQty = 20, unitCost = 40, price = 100 } = {}) {
  const warehouse = execute('warehouse:create', { name: `Warehouse ${tag}`, code: `W${tag}` }, ik(`wh${tag}`));
  const supplier = execute('stock:location:create', { name: `Supplier ${tag}`, usage: 'supplier' }, ik(`sup${tag}`));
  const customer = execute('party:create', { name: `Customer ${tag}`, roles: ['customer'] }, ik(`cust${tag}`));
  const uomCategory = uom.createUomCategory(db, { name: `Units ${tag}` });
  const unit = uom.createUom(db, { category_id: uomCategory.id, name: `Piece ${tag}` });
  const productCategory = products.createProductCategory(db, {
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
    category_id: productCategory.id,
    uom_id: unit.id,
    list_price: price,
    standard_price: unitCost,
    sku: `SKU-${tag}`,
  }, ik(`prod${tag}`));
  if (stockQty > 0) {
    execute('stock:move:post', {
      reference: `OPEN-${tag}`,
      product_id: product.default_variant_id,
      uom_id: unit.id,
      product_qty: stockQty,
      location_id: supplier.id,
      location_dest_id: warehouse.lot_stock_id,
      unit_cost: unitCost,
      source_document_type: 'inventory_adjustment',
      source_document_id: `OPEN-${tag}`,
    }, ik(`open${tag}`));
  }
  return { warehouse, supplier, customer, unit, product, variantId: product.default_variant_id };
}

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-checkpoint-c-sales-'));
  dbPath = path.join(tempDir, 'checkpoint-c-sales.db');
  await freshInstall({ dbPath, backupDir: path.join(tempDir, 'backups'), actor: 'checkpoint-c-sales-test' });
  db = openMigrationDatabase(dbPath);
  executor = createPlatformAuthority(db).actionExecutor;
  ctx = {
    tenantId: 'default',
    companyId: 'default',
    branchId: 'default',
    userId: 'checkpoint-c-sales-test',
    sourceChannel: 'node-test',
  };
  setApprovalAuthorityLimit(db, ctx, {
    role_or_user: ctx.userId,
    limit_type: 'post',
    max_amount: 1_000_000_000,
  });
});

after(() => {
  try { db?.close(); } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }
});

test('full lifecycle: lead -> opportunity -> quotation -> approve -> confirm -> deliver -> invoice -> return', () => {
  const seed = seedCatalog('A', { stockQty: 10 });

  const lead = execute('crm:lead:create', { name: 'Lead A', expected_revenue: 1000, probability: 40 }, ik('leadA'));
  const converted = execute('crm:lead:convert', {
    id: lead.id,
    partner_id: seed.customer.id,
    expected_value: 1000,
    probability: 60,
  }, ik('convA'));
  assert.equal(converted.opportunity.status, 'open');
  assert.equal(converted.lead.stage, 'won');
  const opportunityId = converted.opportunity.id;

  const staged = execute('crm:opportunity:update_stage', { id: opportunityId, stage: 'negotiation' }, ik('stageA'));
  assert.equal(staged.stage, 'negotiation');
  assert.ok(staged.activities.length >= 2, 'stage change must be logged as an activity');
  const followedUp = execute('crm:opportunity:add_activity', {
    id: opportunityId,
    summary: 'Call customer before approval',
    due_date: '2030-01-15',
  }, ik('activityA'));
  assert.ok(followedUp.activities.some((row) => row.summary === 'Call customer before approval' && row.done === 0));

  const closed = execute('crm:opportunity:close', {
    id: opportunityId,
    outcome: 'won',
    spawn_quotation: true,
    lines: [{ product_id: seed.variantId, product_uom_qty: 4, price_unit: 100 }],
  }, ik('closeA'));
  assert.equal(closed.opportunity.status, 'won');
  const quotation = closed.quotation;
  assert.equal(quotation.state, 'draft');
  assert.equal(quotation.quotation_state, 'draft');
  assert.equal(quotation.source_opportunity_id, opportunityId);
  assert.equal(quotation.amount_total, 400);

  const sent = execute('sales:quotation:submit', { order_id: quotation.id }, ik('submitA'));
  assert.equal(sent.quotation_state, 'sent');

  const approved = execute('sales:quotation:approve', { order_id: quotation.id }, ik('approveA'));
  assert.equal(approved.quotation_state, 'approved');
  assert.equal(approved.approved_by, ctx.userId);
  assert.ok(approved.approved_at);

  const accepted = execute('sales:quotation:accept', { order_id: quotation.id }, ik('acceptA'));
  assert.equal(accepted.quotation_state, 'accepted');
  assert.ok(accepted.accepted_at);

  const confirmation = execute('sales:order:confirm', {
    order_id: quotation.id,
    warehouse_id: seed.warehouse.id,
  }, ik('confirmA'));
  assert.equal(confirmation.order.state, 'sale');
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM sale_fulfilment_demands WHERE sale_order_id = ? AND status = 'reserved'").get(quotation.id).n,
    1,
  );

  // Re-reserve is a no-op when coverage is complete.
  const reservation = execute('sales:order:reserve', { order_id: quotation.id, warehouse_id: seed.warehouse.id }, ik('reserveA'));
  assert.equal(reservation.lines[0].status, 'reserved');
  assert.equal(reservation.lines[0].shortage, 0);

  const orderLineId = quotation.lines[0].id;

  // Partial delivery of 2 of 4 creates an explicit backorder lineage.
  const delivery = execute('sales:delivery:post', {
    order_id: quotation.id,
    picking_id: confirmation.delivery_picking_id,
    lines: [{ sale_order_line_id: orderLineId, quantity: 2 }],
  }, ik('deliverA'));
  assert.equal(delivery.delivery_event.state, 'partial');
  assert.equal(delivery.picking.state, 'done');
  assert.ok(delivery.backorder);
  assert.equal(delivery.remaining_lines[0].remaining_quantity, 2);
  const fulfilment = db.prepare('SELECT * FROM sale_order_line_fulfilment WHERE order_id = ?').get(quotation.id);
  assert.equal(fulfilment.delivered_quantity, 2);

  // Invoice the delivered quantity only.
  const invoice = execute('sales:invoice_request:create', { order_id: quotation.id }, ik('invoiceA'));
  assert.equal(invoice.status, 'posted');
  assert.equal(invoice.amount_total, 200);
  const afterInvoice = db.prepare('SELECT * FROM sale_order_line_fulfilment WHERE order_id = ?').get(quotation.id);
  assert.equal(afterInvoice.invoiced_quantity, 2);

  // Return 1 of the 2 delivered units: incoming stock + posted credit note.
  const returned = execute('sales:return:create', {
    order_id: quotation.id,
    warehouse_id: seed.warehouse.id,
    lines: [{ sale_order_line_id: orderLineId, quantity: 1, reason: 'defective' }],
    reason: 'defective units',
  }, ik('returnA'));
  assert.equal(returned.sale_return.state, 'done');
  assert.equal(returned.lines.length, 1);
  assert.ok(returned.picking_id);
  assert.ok(returned.credit_note, 'credit note must be posted when the original invoice exists');
  assert.equal(returned.credit_note.amount_total, 100);
  assert.equal(
    db.prepare("SELECT move_type, state FROM finance_documents WHERE id = ?").get(returned.credit_note.finance_document_id).move_type,
    'customer_credit_note',
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM commercial_fiscal_requests WHERE request_type = 'customer_credit_note' AND source_document_id = ? AND status = 'posted'").get(returned.sale_return.id).n,
    1,
  );

  // Deliver the remaining backorder and retain both delivery events.
  const completedBackorder = execute('sales:delivery:post', {
    order_id: quotation.id,
    picking_id: delivery.backorder.id,
    lines: [{ sale_order_line_id: orderLineId, quantity: 2 }],
  }, ik('deliverA2'));
  assert.equal(completedBackorder.delivery_event.state, 'done');
  assert.equal(completedBackorder.backorder, null);
  assert.equal(completedBackorder.remaining_lines.length, 0);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM sale_delivery_events WHERE sale_order_id = ?').get(quotation.id).n,
    2,
  );

  // Stock: 10 - 4 delivered + 1 returned = 7.
  const balance = getQuantBalance(db, { company_id: 'default', product_id: seed.variantId, location_id: seed.warehouse.lot_stock_id });
  assert.equal(balance.quantity, 7);

  // Over-return is refused.
  assert.throws(
    () => execute('sales:return:create', {
      order_id: quotation.id,
      warehouse_id: seed.warehouse.id,
      lines: [{ sale_order_line_id: orderLineId, quantity: 99 }],
    }, ik('returnA2')),
    (err) => err.code === 'RETURN_QTY_EXCEEDS_DELIVERED',
  );
});

test('quotation approve enforces credit limit and credit hold, fail closed', () => {
  const seed = seedCatalog('B');
  setCreditProfile(db, ctx, { partner_id: seed.customer.id, credit_limit: 100 });

  const quotation = execute('sales:quotation:create', {
    partner_id: seed.customer.id,
    lines: [{ product_id: seed.variantId, product_uom_qty: 4, price_unit: 100 }],
  }, ik('quoteB'));
  execute('sales:quotation:submit', { order_id: quotation.id }, ik('submitB'));
  assert.throws(
    () => execute('sales:quotation:approve', { order_id: quotation.id }, ik('approveB')),
    (err) => err.code === 'CREDIT_LIMIT_EXCEEDED',
  );

  // Raising the limit lets the approval through.
  setCreditProfile(db, ctx, { partner_id: seed.customer.id, credit_limit: 10_000 });
  const approved = execute('sales:quotation:approve', { order_id: quotation.id }, ik('approveB2'));
  assert.equal(approved.quotation_state, 'approved');

  // An active credit hold blocks a new approval outright.
  const hold = holdCredit(db, ctx, { partner_id: seed.customer.id, reason: 'collections review' });
  assert.equal(hold.status, 'held');
  const second = execute('sales:quotation:create', {
    partner_id: seed.customer.id,
    lines: [{ product_id: seed.variantId, product_uom_qty: 1, price_unit: 100 }],
  }, ik('quoteB2'));
  execute('sales:quotation:submit', { order_id: second.id }, ik('submitB2'));
  assert.throws(
    () => execute('sales:quotation:approve', { order_id: second.id }, ik('approveB3')),
    (err) => err.code === 'CREDIT_HOLD_ACTIVE',
  );
});

test('quotation accept is denied when the validity date has expired', () => {
  const seed = seedCatalog('C');
  const quotation = execute('sales:quotation:create', {
    partner_id: seed.customer.id,
    validity_date: '2020-01-01',
    lines: [{ product_id: seed.variantId, product_uom_qty: 2, price_unit: 100 }],
  }, ik('quoteC'));
  execute('sales:quotation:submit', { order_id: quotation.id }, ik('submitC'));
  execute('sales:quotation:approve', { order_id: quotation.id }, ik('approveC'));
  assert.throws(
    () => execute('sales:quotation:accept', { order_id: quotation.id }, ik('acceptC')),
    (err) => err.code === 'QUOTATION_EXPIRED',
  );
});

test('quotation revision supersedes the prior revision and keeps the audit trail', () => {
  const seed = seedCatalog('D');
  const quotation = execute('sales:quotation:create', {
    partner_id: seed.customer.id,
    lines: [{ product_id: seed.variantId, product_uom_qty: 4, price_unit: 100 }],
  }, ik('quoteD'));
  execute('sales:quotation:submit', { order_id: quotation.id }, ik('submitD'));

  const revision = execute('sales:quotation:revise', { order_id: quotation.id }, ik('reviseD'));
  assert.equal(revision.superseded_order_id, quotation.id);
  assert.equal(revision.quotation.revision_no, 1);
  assert.equal(revision.quotation.quotation_state, 'draft');
  assert.equal(revision.quotation.lines.length, 1);
  assert.equal(revision.quotation.lines[0].price_subtotal, 400);

  const superseded = db.prepare('SELECT quotation_state, superseded_by FROM sale_orders WHERE id = ?').get(quotation.id);
  assert.equal(superseded.quotation_state, 'superseded');
  assert.equal(superseded.superseded_by, revision.quotation.id);

  // The superseded revision is frozen.
  assert.throws(
    () => execute('sales:quotation:approve', { order_id: quotation.id }, ik('approveD0')),
    (err) => err.code === 'QUOTATION_STATE_INVALID',
  );

  // The new revision completes the lifecycle.
  execute('sales:quotation:submit', { order_id: revision.quotation.id }, ik('submitD2'));
  execute('sales:quotation:approve', { order_id: revision.quotation.id }, ik('approveD'));
  execute('sales:quotation:accept', { order_id: revision.quotation.id }, ik('acceptD'));
  const confirmation = execute('sales:order:confirm', {
    order_id: revision.quotation.id,
    warehouse_id: seed.warehouse.id,
  }, ik('confirmD'));
  assert.equal(confirmation.order.state, 'sale');
});

test('order cancel releases reservations and cancels the open picking atomically', () => {
  const seed = seedCatalog('E', { stockQty: 4 });
  const quotation = execute('sales:quotation:create', {
    partner_id: seed.customer.id,
    lines: [{ product_id: seed.variantId, product_uom_qty: 4, price_unit: 100 }],
  }, ik('quoteE'));
  execute('sales:order:confirm', { order_id: quotation.id, warehouse_id: seed.warehouse.id }, ik('confirmE'));

  const reservedBefore = getQuantBalance(db, { company_id: 'default', product_id: seed.variantId, location_id: seed.warehouse.lot_stock_id });
  assert.equal(reservedBefore.reserved_quantity, 4);

  const cancelled = execute('sales:order:cancel', { order_id: quotation.id, reason: 'customer withdrew' }, ik('cancelE'));
  assert.equal(cancelled.state, 'cancel');
  assert.ok(cancelled.cancelled_at);
  assert.equal(cancelled.cancel_reason, 'customer withdrew');

  const reservedAfter = getQuantBalance(db, { company_id: 'default', product_id: seed.variantId, location_id: seed.warehouse.lot_stock_id });
  assert.equal(reservedAfter.reserved_quantity, 0);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM stock_pickings WHERE origin = ? AND state = 'cancelled'").get(cancelled.name).n,
    1,
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM sale_fulfilment_demands WHERE sale_order_id = ? AND status = 'cancelled'").get(quotation.id).n,
    1,
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM stock_reservations WHERE source_document_id = ? AND status = 'released'").get(quotation.id).n,
    1,
  );

  // Draft orders cancel directly.
  const draft = execute('sales:quotation:create', {
    partner_id: seed.customer.id,
    lines: [{ product_id: seed.variantId, product_uom_qty: 1, price_unit: 100 }],
  }, ik('quoteE2'));
  const cancelledDraft = execute('sales:order:cancel', { order_id: draft.id }, ik('cancelE2'));
  assert.equal(cancelledDraft.state, 'cancel');
});

test('partial reservation on confirm plus shortage handling and re-reserve', () => {
  const seed = seedCatalog('F', { stockQty: 4 });
  const quotation = execute('sales:quotation:create', {
    partner_id: seed.customer.id,
    lines: [{ product_id: seed.variantId, product_uom_qty: 10, price_unit: 100 }],
  }, ik('quoteF'));

  // Confirmation succeeds with a partial reservation instead of failing.
  const confirmation = execute('sales:order:confirm', { order_id: quotation.id, warehouse_id: seed.warehouse.id }, ik('confirmF'));
  assert.equal(confirmation.order.state, 'sale');
  assert.equal(
    db.prepare("SELECT status FROM sale_fulfilment_demands WHERE sale_order_id = ?").get(quotation.id).status,
    'partially_reserved',
  );

  // Re-reserve without new stock: shortage is reported, nothing double-reserved.
  const first = execute('sales:order:reserve', { order_id: quotation.id, warehouse_id: seed.warehouse.id }, ik('reserveF'));
  assert.equal(first.lines[0].status, 'partially_reserved');
  assert.equal(first.lines[0].reserved, 4);
  assert.equal(first.lines[0].shortage, 6);

  // Stock arrives; re-reserve closes the gap.
  execute('stock:move:post', {
    reference: 'OPEN-F-2',
    product_id: seed.variantId,
    uom_id: seed.unit.id,
    product_qty: 6,
    location_id: seed.supplier.id,
    location_dest_id: seed.warehouse.lot_stock_id,
    unit_cost: 40,
    source_document_type: 'inventory_adjustment',
    source_document_id: 'OPEN-F-2',
  }, ik('openF2'));
  const second = execute('sales:order:reserve', { order_id: quotation.id, warehouse_id: seed.warehouse.id }, ik('reserveF2'));
  assert.equal(second.lines[0].status, 'reserved');
  assert.equal(second.lines[0].reserved, 10);
  assert.equal(second.lines[0].shortage, 0);

  // A third attempt is an idempotent no-op: no additional reservations.
  const reservationCount = db.prepare(`
    SELECT COUNT(*) AS n FROM stock_reservations WHERE source_document_id = ? AND status IN ('reserved', 'partially_reserved')
  `).get(quotation.id).n;
  const third = execute('sales:order:reserve', { order_id: quotation.id, warehouse_id: seed.warehouse.id }, ik('reserveF3'));
  assert.equal(third.lines[0].shortage, 0);
  assert.equal(
    db.prepare(`
      SELECT COUNT(*) AS n FROM stock_reservations WHERE source_document_id = ? AND status IN ('reserved', 'partially_reserved')
    `).get(quotation.id).n,
    reservationCount,
  );
});

test('commission accrual from a configurable rule with approve and paid lifecycle', () => {
  const seed = seedCatalog('G');
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO sales_commission_rules (id, company_id, salesperson_id, rate, is_active, created_at, updated_at)
    VALUES ('rule_default_g', 'default', '*', 5, 1, ?, ?)
  `).run(now, now);

  const quotation = execute('sales:quotation:create', {
    partner_id: seed.customer.id,
    lines: [{ product_id: seed.variantId, product_uom_qty: 4, price_unit: 100 }],
  }, ik('quoteG'));
  execute('sales:order:confirm', { order_id: quotation.id, warehouse_id: seed.warehouse.id }, ik('confirmG'));

  const accrued = execute('sales:commission:accrue', { order_id: quotation.id, salesperson_id: 'sp_1' }, ik('commG'));
  assert.equal(accrued.commission.status, 'pending');
  assert.equal(accrued.commission.basis_amount, 400);
  assert.equal(accrued.commission.rate, 5);
  assert.equal(accrued.commission.amount, 20);

  // Replay-safe: accruing again returns the same event, never a duplicate.
  const replay = execute('sales:commission:accrue', { order_id: quotation.id, salesperson_id: 'sp_1' }, ik('commG2'));
  assert.equal(replay.commission.id, accrued.commission.id);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM sales_commission_events WHERE sale_order_id = ? AND salesperson_id = ?').get(quotation.id, 'sp_1').n,
    1,
  );

  const approved = execute('sales:commission:approve', { commission_id: accrued.commission.id }, ik('commApproveG'));
  assert.equal(approved.commission.status, 'approved');
  assert.equal(approved.commission.approved_by, ctx.userId);

  const paid = execute('sales:commission:mark_paid', { commission_id: accrued.commission.id }, ik('commPaidG'));
  assert.equal(paid.commission.status, 'paid');
  assert.ok(paid.commission.paid_at);

  assert.throws(
    () => execute('sales:commission:mark_paid', { commission_id: accrued.commission.id }, ik('commPaidG2')),
    (err) => err.code === 'COMMISSION_STATE_INVALID',
  );
});

test('idempotency replay returns the stored result and writes each record once', () => {
  const seed = seedCatalog('H');
  const key = ik('quoteH');
  const first = execute('sales:quotation:create', {
    partner_id: seed.customer.id,
    lines: [{ product_id: seed.variantId, product_uom_qty: 2, price_unit: 100 }],
  }, key);
  const second = execute('sales:quotation:create', {
    partner_id: seed.customer.id,
    lines: [{ product_id: seed.variantId, product_uom_qty: 2, price_unit: 100 }],
  }, key);
  assert.equal(second.id, first.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sale_orders WHERE id = ?').get(first.id).n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sale_order_lines WHERE order_id = ?').get(first.id).n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM action_idempotency WHERE idempotency_key = ?').get(key).n, 1);

  const lead = execute('crm:lead:create', { name: 'Lead H' }, ik('leadH'));
  const convertKey = ik('convH');
  const firstConvert = execute('crm:lead:convert', { id: lead.id, partner_id: seed.customer.id }, convertKey);
  const secondConvert = execute('crm:lead:convert', { id: lead.id, partner_id: seed.customer.id }, convertKey);
  assert.equal(secondConvert.opportunity.id, firstConvert.opportunity.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM crm_opportunities WHERE lead_id = ?').get(lead.id).n, 1);
});

test('failure injection: forced outbox failure leaves no partial sales state', () => {
  const seed = seedCatalog('I');
  const count = (sql, ...params) => db.prepare(sql).get(...params).n;
  const before = {
    orders: count('SELECT COUNT(*) AS n FROM sale_orders'),
    lines: count('SELECT COUNT(*) AS n FROM sale_order_lines'),
    idempotency: count('SELECT COUNT(*) AS n FROM action_idempotency'),
    audit: count('SELECT COUNT(*) AS n FROM platform_audit_log'),
  };

  db.exec(`
    CREATE TRIGGER checkpoint_c_fail_outbox
    BEFORE INSERT ON platform_outbox
    BEGIN
      SELECT RAISE(ABORT, 'injected outbox failure');
    END;
  `);
  try {
    assert.throws(
      () => execute('sales:quotation:create', {
        partner_id: seed.customer.id,
        lines: [{ product_id: seed.variantId, product_uom_qty: 2, price_unit: 100 }],
      }, ik('quoteI')),
      /injected outbox failure/,
    );
  } finally {
    db.exec('DROP TRIGGER IF EXISTS checkpoint_c_fail_outbox');
  }

  assert.equal(count('SELECT COUNT(*) AS n FROM sale_orders'), before.orders);
  assert.equal(count('SELECT COUNT(*) AS n FROM sale_order_lines'), before.lines);
  assert.equal(count('SELECT COUNT(*) AS n FROM action_idempotency'), before.idempotency);
  assert.equal(count('SELECT COUNT(*) AS n FROM platform_audit_log'), before.audit);
});

test('failure injection: delivery outbox failure rolls back stock, reservation, picking, and delivery event', () => {
  const seed = seedCatalog('IF', { stockQty: 4 });
  const quotation = execute('sales:quotation:create', {
    partner_id: seed.customer.id,
    lines: [{ product_id: seed.variantId, product_uom_qty: 4, price_unit: 100 }],
  }, ik('quoteIF'));
  const confirmation = execute('sales:order:confirm', {
    order_id: quotation.id,
    warehouse_id: seed.warehouse.id,
  }, ik('confirmIF'));
  const lineId = quotation.lines[0].id;
  const before = {
    quant: getQuantBalance(db, { company_id: 'default', product_id: seed.variantId, location_id: seed.warehouse.lot_stock_id }),
    reservation: db.prepare('SELECT * FROM stock_reservations WHERE source_document_id = ?').get(quotation.id),
    fulfilment: db.prepare('SELECT * FROM sale_order_line_fulfilment WHERE sale_order_line_id = ?').get(lineId),
    picking: db.prepare('SELECT * FROM stock_pickings WHERE id = ?').get(confirmation.delivery_picking_id),
    events: db.prepare('SELECT COUNT(*) AS n FROM sale_delivery_events WHERE sale_order_id = ?').get(quotation.id).n,
  };

  db.exec(`
    CREATE TRIGGER checkpoint_c_fail_delivery_outbox
    BEFORE INSERT ON platform_outbox
    WHEN NEW.payload LIKE '%sales:delivery:post%'
    BEGIN
      SELECT RAISE(ABORT, 'injected delivery outbox failure');
    END;
  `);
  try {
    assert.throws(
      () => execute('sales:delivery:post', {
        order_id: quotation.id,
        picking_id: confirmation.delivery_picking_id,
        lines: [{ sale_order_line_id: lineId, quantity: 2 }],
      }, ik('deliverIF')),
      /injected delivery outbox failure/,
    );
  } finally {
    db.exec('DROP TRIGGER IF EXISTS checkpoint_c_fail_delivery_outbox');
  }

  assert.deepEqual(
    getQuantBalance(db, { company_id: 'default', product_id: seed.variantId, location_id: seed.warehouse.lot_stock_id }),
    before.quant,
  );
  assert.deepEqual(db.prepare('SELECT * FROM stock_reservations WHERE source_document_id = ?').get(quotation.id), before.reservation);
  assert.deepEqual(db.prepare('SELECT * FROM sale_order_line_fulfilment WHERE sale_order_line_id = ?').get(lineId), before.fulfilment);
  assert.deepEqual(db.prepare('SELECT * FROM stock_pickings WHERE id = ?').get(confirmation.delivery_picking_id), before.picking);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sale_delivery_events WHERE sale_order_id = ?').get(quotation.id).n, before.events);
});

test('failure injection: confirmation outbox failure leaves no order, reservation, demand, or picking transition', () => {
  const seed = seedCatalog('CONFIRM-ROLLBACK', { stockQty: 3 });
  const quotation = execute('sales:quotation:create', {
    partner_id: seed.customer.id,
    lines: [{ product_id: seed.variantId, product_uom_qty: 3, price_unit: 100 }],
  }, ik('quoteConfirmRollback'));
  const before = {
    order: db.prepare('SELECT * FROM sale_orders WHERE id = ?').get(quotation.id),
    reservations: db.prepare('SELECT COUNT(*) AS n FROM stock_reservations WHERE source_document_id = ?').get(quotation.id).n,
    demands: db.prepare('SELECT COUNT(*) AS n FROM sale_fulfilment_demands WHERE sale_order_id = ?').get(quotation.id).n,
    pickings: db.prepare('SELECT COUNT(*) AS n FROM stock_pickings WHERE origin = ?').get(quotation.name).n,
    audit: db.prepare('SELECT COUNT(*) AS n FROM platform_audit_log').get().n,
    idempotency: db.prepare('SELECT COUNT(*) AS n FROM action_idempotency').get().n,
  };
  db.exec(`
    CREATE TRIGGER checkpoint_c6_fail_confirmation_outbox
    BEFORE INSERT ON platform_outbox
    WHEN NEW.payload LIKE '%sales:order:confirm%'
    BEGIN SELECT RAISE(ABORT, 'injected sales confirmation outbox failure'); END;
  `);
  try {
    assert.throws(
      () => execute('sales:order:confirm', {
        order_id: quotation.id,
        warehouse_id: seed.warehouse.id,
      }, ik('confirmRollback')),
      /injected sales confirmation outbox failure/,
    );
  } finally {
    db.exec('DROP TRIGGER IF EXISTS checkpoint_c6_fail_confirmation_outbox');
  }
  assert.deepEqual(db.prepare('SELECT * FROM sale_orders WHERE id = ?').get(quotation.id), before.order);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM stock_reservations WHERE source_document_id = ?').get(quotation.id).n, before.reservations);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sale_fulfilment_demands WHERE sale_order_id = ?').get(quotation.id).n, before.demands);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM stock_pickings WHERE origin = ?').get(quotation.name).n, before.pickings);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_audit_log').get().n, before.audit);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM action_idempotency').get().n, before.idempotency);
});

test('failure injection: invoice-request outbox failure rolls back fiscal and Finance consequences', () => {
  const seed = seedCatalog('INVOICE-ROLLBACK', { stockQty: 2 });
  const quotation = execute('sales:quotation:create', {
    partner_id: seed.customer.id,
    lines: [{ product_id: seed.variantId, product_uom_qty: 2, price_unit: 100 }],
  }, ik('quoteInvoiceRollback'));
  const confirmation = execute('sales:order:confirm', {
    order_id: quotation.id,
    warehouse_id: seed.warehouse.id,
  }, ik('confirmInvoiceRollback'));
  execute('sales:delivery:post', {
    order_id: quotation.id,
    picking_id: confirmation.delivery_picking_id,
    lines: [{ sale_order_line_id: quotation.lines[0].id, quantity: 2 }],
  }, ik('deliverInvoiceRollback'));
  const before = {
    requests: db.prepare(`
      SELECT COUNT(*) AS n FROM commercial_fiscal_requests
      WHERE request_type = 'customer_invoice' AND source_document_id = ?
    `).get(quotation.id).n,
    financeDocuments: db.prepare('SELECT COUNT(*) AS n FROM finance_documents').get().n,
    journalLines: db.prepare('SELECT COUNT(*) AS n FROM finance_journal_lines').get().n,
    fulfilment: db.prepare('SELECT * FROM sale_order_line_fulfilment WHERE sale_order_line_id = ?').get(quotation.lines[0].id),
    audit: db.prepare('SELECT COUNT(*) AS n FROM platform_audit_log').get().n,
    idempotency: db.prepare('SELECT COUNT(*) AS n FROM action_idempotency').get().n,
  };
  db.exec(`
    CREATE TRIGGER checkpoint_c6_fail_invoice_outbox
    BEFORE INSERT ON platform_outbox
    WHEN NEW.payload LIKE '%sales:invoice_request:create%'
    BEGIN SELECT RAISE(ABORT, 'injected sales invoice outbox failure'); END;
  `);
  try {
    assert.throws(
      () => execute('sales:invoice_request:create', { order_id: quotation.id }, ik('invoiceRollback')),
      /injected sales invoice outbox failure/,
    );
  } finally {
    db.exec('DROP TRIGGER IF EXISTS checkpoint_c6_fail_invoice_outbox');
  }
  assert.equal(db.prepare(`
    SELECT COUNT(*) AS n FROM commercial_fiscal_requests
    WHERE request_type = 'customer_invoice' AND source_document_id = ?
  `).get(quotation.id).n, before.requests);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM finance_documents').get().n, before.financeDocuments);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM finance_journal_lines').get().n, before.journalLines);
  assert.deepEqual(
    db.prepare('SELECT * FROM sale_order_line_fulfilment WHERE sale_order_line_id = ?').get(quotation.lines[0].id),
    before.fulfilment,
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_audit_log').get().n, before.audit);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM action_idempotency').get().n, before.idempotency);
});

test('concurrency: duplicate confirm and duplicate approve each have exactly one winner', async () => {
  const seed = seedCatalog('J', { stockQty: 4 });
  const quotation = execute('sales:quotation:create', {
    partner_id: seed.customer.id,
    lines: [{ product_id: seed.variantId, product_uom_qty: 4, price_unit: 100 }],
  }, ik('quoteJ'));

  const confirmResults = await Promise.allSettled([
    Promise.resolve().then(() => execute('sales:order:confirm', { order_id: quotation.id, warehouse_id: seed.warehouse.id }, ik('confirmJ1'))),
    Promise.resolve().then(() => execute('sales:order:confirm', { order_id: quotation.id, warehouse_id: seed.warehouse.id }, ik('confirmJ2'))),
  ]);
  assert.equal(confirmResults.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(confirmResults.filter((r) => r.status === 'rejected').length, 1);
  assert.equal(db.prepare('SELECT state FROM sale_orders WHERE id = ?').get(quotation.id).state, 'sale');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sale_fulfilment_demands WHERE sale_order_id = ?').get(quotation.id).n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM stock_pickings WHERE origin = ? AND state != 'cancelled'").get(quotation.name).n, 1);

  const second = execute('sales:quotation:create', {
    partner_id: seed.customer.id,
    lines: [{ product_id: seed.variantId, product_uom_qty: 1, price_unit: 100 }],
  }, ik('quoteJ2'));
  execute('sales:quotation:submit', { order_id: second.id }, ik('submitJ2'));
  const approveResults = await Promise.allSettled([
    Promise.resolve().then(() => execute('sales:quotation:approve', { order_id: second.id }, ik('approveJ1'))),
    Promise.resolve().then(() => execute('sales:quotation:approve', { order_id: second.id }, ik('approveJ2'))),
  ]);
  assert.equal(approveResults.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(approveResults.filter((r) => r.status === 'rejected').length, 1);
  const approvedRow = db.prepare('SELECT quotation_state, approved_by FROM sale_orders WHERE id = ?').get(second.id);
  assert.equal(approvedRow.quotation_state, 'approved');
  assert.equal(approvedRow.approved_by, ctx.userId);
});

test('quotation detail exposes project, attachments, profitability, payment link, and timeline', () => {
  const seed = seedCatalog('META', { stockQty: 2, unitCost: 40, price: 100 });
  const quotation = execute('sales:quotation:create', {
    partner_id: seed.customer.id,
    project_ref: 'PRJ-C1-001',
    attachments: ['proposal.pdf', { name: 'scope.txt', url: 'https://example.test/scope' }],
    notes: 'Checkpoint C metadata',
    lines: [{ product_id: seed.variantId, product_uom_qty: 2, price_unit: 100 }],
  }, ik('quoteMeta'));

  assert.equal(quotation.project_ref, 'PRJ-C1-001');
  assert.deepEqual(quotation.attachments, ['proposal.pdf', { name: 'scope.txt', url: 'https://example.test/scope' }]);
  assert.deepEqual(quotation.profitability, { revenue: 200, cost: 80, margin: 120 });
  assert.deepEqual(quotation.payment_balance_link, { page: 'finance', partner_id: seed.customer.id });
  assert.ok(Array.isArray(quotation.timeline));

  const detail = handleCommercialQuery({
    dialect: db,
    ctx: { companyId: 'default', branchId: 'default', userId: ctx.userId },
    namespace: 'sales',
    resource: 'orders',
    recordId: quotation.id,
    query: {},
  }).data;
  assert.equal(detail.project_ref, 'PRJ-C1-001');
  assert.equal(detail.attachments.length, 2);
  assert.equal(detail.profitability.margin, 120);
  assert.ok(detail.timeline.some((row) => row.action === 'action.execute.sales:quotation:create'));
});

test('quotation create computes per-line tax through the finance engine', () => {
  const seed = seedCatalog('K');
  const tax = createTax(db, ctx, { code: 'VAT15', name: 'VAT 15%', amount_type: 'percent', amount: 15 });

  const quotation = execute('sales:quotation:create', {
    partner_id: seed.customer.id,
    lines: [
      { product_id: seed.variantId, product_uom_qty: 2, price_unit: 100, tax_id: tax.id },
      { product_id: seed.variantId, product_uom_qty: 1, price_unit: 100, discount: 10, tax_id: tax.id },
    ],
  }, ik('quoteK'));

  assert.equal(quotation.lines[0].tax_amount, 30);
  assert.equal(quotation.lines[0].price_subtotal, 200);
  assert.equal(quotation.lines[0].price_total, 230);
  assert.equal(quotation.lines[1].tax_amount, 13.5);
  assert.equal(quotation.lines[1].price_subtotal, 90);
  assert.equal(quotation.lines[1].price_total, 103.5);
  assert.equal(quotation.amount_untaxed, 290);
  assert.equal(quotation.amount_tax, 43.5);
  assert.equal(quotation.tax_total, 43.5);
  assert.equal(quotation.amount_total, 333.5);
  assert.equal(quotation.discount_total, 10);
});

test('sales read surface serves lifecycle resources with company scoping', () => {
  const seed = seedCatalog('L', { stockQty: 5 });
  const readCtx = { companyId: 'default', branchId: 'default', userId: ctx.userId };

  const lead = execute('crm:lead:create', { name: 'Lead L' }, ik('leadL'));
  const converted = execute('crm:lead:convert', { id: lead.id, partner_id: seed.customer.id }, ik('convL'));
  const closed = execute('crm:opportunity:close', {
    id: converted.opportunity.id,
    outcome: 'won',
    spawn_quotation: true,
    lines: [{ product_id: seed.variantId, product_uom_qty: 2, price_unit: 100 }],
  }, ik('closeL'));
  execute('sales:order:confirm', { order_id: closed.quotation.id, warehouse_id: seed.warehouse.id }, ik('confirmL'));

  const query = (namespace, resource, params = {}, recordId = null) =>
    handleCommercialQuery({ dialect: db, ctx: readCtx, namespace, resource, recordId, query: params });

  const leads = query('sales', 'leads');
  assert.ok(leads.data.some((row) => row.id === lead.id));
  const leadDoc = query('sales', 'leads', {}, lead.id);
  assert.equal(leadDoc.data.id, lead.id);
  assert.ok(Array.isArray(leadDoc.data.activities));

  const opportunities = query('sales', 'opportunities', { status: 'won' });
  assert.ok(opportunities.data.some((row) => row.id === converted.opportunity.id));
  const opportunityDoc = query('sales', 'opportunities', {}, converted.opportunity.id);
  assert.ok(Array.isArray(opportunityDoc.data.activities));

  const orders = query('sales', 'orders', { state: 'sale' });
  assert.ok(orders.data.some((row) => row.id === closed.quotation.id));
  const orderDoc = query('sales', 'orders', {}, closed.quotation.id);
  assert.equal(orderDoc.data.quotation_state, 'draft');
  assert.equal(orderDoc.data.state, 'sale');
  assert.equal(orderDoc.data.revision_no, 0);

  const reservations = query('sales', 'reservations', { sale_order_id: closed.quotation.id });
  assert.equal(reservations.data.length, 1);
  const deliveries = query('sales', 'deliveries', { sale_order_id: closed.quotation.id });
  assert.equal(deliveries.data.length, 1);

  const pipeline = query('sales', 'reports', { report: 'pipeline' });
  assert.ok(pipeline.data.some((row) => row.state === 'sale'));
  const byCustomer = query('sales', 'reports', { report: 'by-customer' });
  assert.ok(byCustomer.data.some((row) => row.partner_id === seed.customer.id));
  const conversion = query('sales', 'reports', { report: 'conversion' });
  assert.ok(conversion.data.leads >= 1 && conversion.data.opportunities_won >= 1);

  const returns = query('sales', 'returns', { sale_order_id: closed.quotation.id });
  assert.equal(returns.data.length, 0);
  const invoiceRequests = query('sales', 'invoice-requests');
  assert.ok(Array.isArray(invoiceRequests.data));
  const balances = query('sales', 'customer-balances', { partner_id: seed.customer.id });
  assert.ok(Array.isArray(balances.data));
  const commissions = query('sales', 'commissions');
  assert.ok(Array.isArray(commissions.data));

  // Cross-company reads are refused.
  const foreign = handleCommercialQuery({
    dialect: db,
    ctx: { companyId: 'other_company', userId: 'x' },
    namespace: 'sales',
    resource: 'orders',
    query: {},
  });
  assert.equal(foreign.data.length, 0);
});
