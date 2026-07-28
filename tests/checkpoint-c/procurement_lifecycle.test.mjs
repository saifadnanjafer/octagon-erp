// Checkpoint C2 — canonical procurement lifecycle, policy, atomicity, and reads.
// All tests operate on one disposable SQLite database under os.tmpdir().

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';
import { products, uom } from '../../platform/commercial/index.mjs';
import { setApprovalAuthorityLimit } from '../../platform/finance/engine.mjs';
import { getQuantBalance } from '../../platform/inventory/ledger.mjs';
import { handleCommercialQuery } from '../../platform/api/commercial.mjs';

let tempDir;
let db;
let executor;
let ctx;
let sequence = 0;

const key = (prefix) => `${prefix}_${Date.now()}_${++sequence}`;
const execute = (actionId, input, idempotencyKey = key(actionId)) =>
  executor.execute(actionId, { ...input, idempotency_key: idempotencyKey }, ctx);
const query = (resource, params = {}, recordId = null) =>
  handleCommercialQuery({ dialect: db, ctx, namespace: 'procurement', resource, recordId, query: params });

function seed(tag) {
  const warehouse = execute('warehouse:create', { name: `Purchase Warehouse ${tag}`, code: `PW${tag}` });
  const supplierA = execute('party:create', { name: `Supplier A ${tag}`, roles: ['supplier'] });
  const supplierB = execute('party:create', { name: `Supplier B ${tag}`, roles: ['supplier'] });
  const category = uom.createUomCategory(db, { name: `Purchase Units ${tag}` });
  const unit = uom.createUom(db, { category_id: category.id, name: `Piece ${tag}` });
  const productCategory = products.createProductCategory(db, {
    company_id: 'default',
    name: `Purchased Goods ${tag}`,
    costing_method: 'avco',
    income_account_id: 'acc_401000',
    expense_account_id: 'acc_501000',
    stock_account_id: 'acc_104000',
    stock_input_account_id: 'acc_201000',
    stock_output_account_id: 'acc_500000',
  });
  const product = execute('product:template:create', {
    name: `Purchased Product ${tag}`,
    category_id: productCategory.id,
    uom_id: unit.id,
    standard_price: 30,
    sku: `BUY-${tag}`,
  });
  return { warehouse, supplierA, supplierB, unit, product, variantId: product.default_variant_id };
}

function requestToConfirmedOrder(seedData, tag, { quantity = 5, unitPrice = 28, qualityRequired = true } = {}) {
  const request = execute('procurement:request:create', {
    name: `Purchase Request ${tag}`,
    needed_by: '2030-01-31',
    justification: 'Checkpoint C2 demand',
    attachments: ['request.pdf'],
    lines: [{
      product_id: seedData.variantId,
      quantity,
      uom_id: seedData.unit.id,
      estimated_unit_cost: 30,
      quality_required: qualityRequired,
    }],
  });
  execute('procurement:request:submit', { request_id: request.id });
  const conversion = execute('procurement:request:approve', { request_id: request.id });
  const requisition = execute('procurement:requisition:approve', { requisition_id: conversion.requisition.id });
  const rfq = execute('procurement:rfq:create', {
    name: `RFQ ${tag}`,
    requisition_id: requisition.id,
    supplier_ids: [seedData.supplierA.id, seedData.supplierB.id],
    deadline: '2030-01-15',
    attachments: ['rfq-spec.pdf'],
    comments: 'Compare price, tax, and delivery',
  });
  const quoteA = execute('procurement:supplier_quotation:record', {
    rfq_id: rfq.id,
    supplier_id: seedData.supplierA.id,
    currency_id: 'IQD',
    total_amount: 1,
    tax_amount: 999,
    lead_time_days: 7,
    attachments: ['quote-a.pdf'],
    lines: [{
      rfq_line_id: rfq.lines[0].id,
      quantity,
      unit_price: unitPrice,
      tax_amount: 0,
      lead_time_days: 7,
    }],
  });
  assert.equal(quoteA.total_amount, quantity * unitPrice, 'quotation total must derive from line facts');
  assert.equal(quoteA.tax_amount, 0, 'quotation tax must derive from line facts');
  execute('procurement:supplier_quotation:record', {
    rfq_id: rfq.id,
    supplier_id: seedData.supplierB.id,
    currency_id: 'IQD',
    lead_time_days: 4,
    lines: [{
      rfq_line_id: rfq.lines[0].id,
      quantity,
      unit_price: unitPrice + 4,
      tax_amount: 0,
      lead_time_days: 4,
    }],
  });
  const comparison = query('comparison', { rfq_id: rfq.id });
  assert.equal(comparison.data.length, 2);
  assert.equal(comparison.data[0].supplier_id, seedData.supplierA.id);
  assert.equal(comparison.data[0].comparison_rank, 1);
  const awarded = execute('procurement:supplier_quotation:award', { quotation_id: quoteA.id });
  const po = execute('procurement:order:create', {
    supplier_id: awarded.supplier_id,
    rfq_id: rfq.id,
    selected_quotation_id: awarded.id,
    expected_date: '2030-01-20',
    attachments: awarded.attachments,
    comments: 'Awarded from line comparison',
    lines: awarded.lines.map((line) => ({
      product_id: line.product_id,
      product_qty: line.quantity,
      product_uom: seedData.unit.id,
      price_unit: line.unit_price,
      tax_amount: line.tax_amount,
    })),
  });
  const approved = execute('procurement:order:approve', { order_id: po.id });
  assert.equal(approved.state, 'approved');
  const confirmed = execute('procurement:order:confirm', { order_id: po.id, warehouse_id: seedData.warehouse.id });
  return { request, requisition, rfq, quoteA, po: confirmed.order, pickingId: confirmed.receipt_picking_id };
}

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-c2-procurement-'));
  const dbPath = path.join(tempDir, 'procurement.db');
  await freshInstall({ dbPath, backupDir: path.join(tempDir, 'backups'), actor: 'c2-procurement-test' });
  db = openMigrationDatabase(dbPath);
  executor = createPlatformAuthority(db).actionExecutor;
  ctx = {
    tenantId: 'default',
    companyId: 'default',
    branchId: 'default',
    userId: 'checkpoint-c2-procurement',
    sourceChannel: 'node-test',
  };
  setApprovalAuthorityLimit(db, ctx, { role_or_user: ctx.userId, limit_type: 'post', max_amount: 1_000_000_000 });
});

after(() => {
  try { db?.close(); } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }
});

test('complete procurement lifecycle: request to comparison, PO, partial receipts, match, bill, return, and score', () => {
  const catalog = seed('A');
  const chain = requestToConfirmedOrder(catalog, 'A');
  assert.equal(chain.request.state, 'draft');
  assert.equal(chain.requisition.state, 'approved');
  assert.equal(chain.po.state, 'purchase');
  assert.equal(chain.po.quality_required, 1, 'quality requirement must flow from request through RFQ into the order');
  assert.throws(
    () => execute('procurement:order:create', {
      supplier_id: catalog.supplierB.id,
      rfq_id: chain.rfq.id,
      selected_quotation_id: chain.quoteA.id,
      lines: [],
    }),
    /does not belong to the purchase-order supplier/,
  );
  const nonAwardedQuote = db.prepare(`
    SELECT id FROM supplier_quotations WHERE rfq_id = ? AND supplier_id = ?
  `).get(chain.rfq.id, catalog.supplierB.id);
  assert.throws(
    () => execute('procurement:order:create', {
      supplier_id: catalog.supplierB.id,
      rfq_id: chain.rfq.id,
      selected_quotation_id: nonAwardedQuote.id,
      lines: [],
    }),
    /must be awarded/,
  );
  assert.throws(
    () => execute('procurement:order:create', {
      supplier_id: catalog.supplierA.id,
      lines: [{
        product_id: catalog.variantId,
        product_qty: 1,
        product_uom: catalog.unit.id,
        price_unit: 10,
        tax_amount: -1,
      }],
    }),
    /quantity, price, and tax are invalid/,
  );
  assert.equal(db.prepare('SELECT state FROM purchase_commitments WHERE purchase_order_id = ?').get(chain.po.id).state, 'open');
  const line = chain.po.lines[0];

  const partial = execute('procurement:receipt:post', {
    purchase_order_id: chain.po.id,
    picking_id: chain.pickingId,
    lines: [{
      purchase_order_line_id: line.id,
      quantity: 3,
      accepted_quantity: 3,
      rejected_quantity: 0,
      quality_notes: 'Accepted',
    }],
  });
  assert.equal(partial.receipt_event.state, 'partial');
  assert.ok(partial.backorder);
  assert.equal(partial.remaining_lines[0].remaining_quantity, 2);
  assert.equal(partial.quality_checks[0].status, 'passed');

  const finalReceipt = execute('procurement:receipt:post', {
    purchase_order_id: chain.po.id,
    picking_id: partial.backorder.id,
    lines: [{ purchase_order_line_id: line.id, quantity: 2, accepted_quantity: 2, rejected_quantity: 0 }],
  });
  assert.equal(finalReceipt.receipt_event.state, 'received');
  assert.equal(finalReceipt.remaining_lines.length, 0);

  const match = execute('procurement:threewaymatch:perform', {
    purchase_order_id: chain.po.id,
    receipt_picking_id: finalReceipt.picking.id,
    supplier_invoice_number: `SUP-A-${Date.now()}`,
    bill_lines: [{
      purchase_order_line_id: line.id,
      quantity: 5,
      unit_price: 28,
      currency: 'IQD',
    }],
  });
  assert.equal(match.match_status, 'matched');
  assert.equal(match.exceptions.length, 0);
  const bill = execute('procurement:bill_request:create', { purchase_order_id: chain.po.id });
  assert.equal(bill.status, 'posted');
  assert.ok(bill.finance_document_id);
  assert.equal(db.prepare('SELECT state FROM purchase_commitments WHERE purchase_order_id = ?').get(chain.po.id).state, 'closed');

  const purchaseReturn = execute('procurement:return:create', {
    purchase_order_id: chain.po.id,
    warehouse_id: catalog.warehouse.id,
    reason: 'Supplier quality return',
    lines: [{ purchase_order_line_id: line.id, quantity: 1 }],
  });
  assert.equal(purchaseReturn.purchase_return.state, 'done');
  assert.ok(purchaseReturn.debit_note?.finance_document_id);
  assert.equal(
    db.prepare('SELECT move_type FROM finance_documents WHERE id = ?').get(purchaseReturn.debit_note.finance_document_id).move_type,
    'supplier_credit_note',
  );
  assert.equal(getQuantBalance(db, { company_id: 'default', product_id: catalog.variantId, location_id: catalog.warehouse.lot_stock_id }).quantity, 4);

  const score = execute('procurement:score:record', {
    supplier_id: catalog.supplierA.id,
    purchase_order_id: chain.po.id,
    on_time_score: 95,
    notes: 'C2 score',
  });
  assert.ok(score.overall_score > 90);
  assert.throws(
    () => execute('procurement:score:record', {
      supplier_id: catalog.supplierA.id,
      purchase_order_id: chain.po.id,
      on_time_score: 101,
    }),
    /between 0 and 100/,
  );

  assert.equal(query('requests').data.some((row) => row.id === chain.request.id), true);
  assert.equal(query('requisitions').data.some((row) => row.id === chain.requisition.id), true);
  assert.equal(query('rfqs').data.some((row) => row.id === chain.rfq.id), true);
  assert.equal(query('receipts', { purchase_order_id: chain.po.id }).data.length, 2);
  assert.equal(query('quality-checks', { purchase_order_id: chain.po.id }).data.length, 2);
  assert.equal(query('matches', { purchase_order_id: chain.po.id }).data[0].match_status, 'matched');
  assert.equal(query('bill-requests').data.some((row) => row.source_document_id === chain.po.id), true);
  assert.equal(query('returns', { purchase_order_id: chain.po.id }).data.length, 1);
  assert.equal(query('supplier-performance').data.some((row) => row.id === score.id), true);
  for (const report of ['by-supplier', 'open-commitments', 'overdue-receipts', 'supplier-price-comparison', 'match-variances', 'supplier-performance', 'return-rates']) {
    assert.ok(Array.isArray(query('reports', { report }).data), `${report} must return rows`);
  }
});

test('three-way match exposes quantity and price variance in the mismatch worklist', () => {
  const catalog = seed('B');
  const chain = requestToConfirmedOrder(catalog, 'B', { quantity: 2, unitPrice: 30, qualityRequired: false });
  const line = chain.po.lines[0];
  const receipt = execute('procurement:receipt:post', {
    purchase_order_id: chain.po.id,
    picking_id: chain.pickingId,
    lines: [{ purchase_order_line_id: line.id, quantity: 2 }],
  });
  const match = execute('procurement:threewaymatch:perform', {
    purchase_order_id: chain.po.id,
    receipt_picking_id: receipt.picking.id,
    supplier_invoice_number: `SUP-B-${Date.now()}`,
    bill_lines: [{ purchase_order_line_id: line.id, quantity: 1, unit_price: 35, currency: 'IQD' }],
  });
  assert.equal(match.match_status, 'exception');
  assert.ok(match.exceptions.some((row) => row.exception_code === 'BILLED_QUANTITY_MISMATCH'));
  assert.ok(match.exceptions.some((row) => row.exception_code === 'UNIT_PRICE_MISMATCH'));
  const worklist = query('mismatch-worklist').data.filter((row) => row.purchase_order_id === chain.po.id);
  assert.ok(worklist.length >= 2);
  assert.throws(
    () => execute('procurement:bill_request:create', { purchase_order_id: chain.po.id }),
    /clean line-level three-way match/,
  );
});

test('receipt failure injection rolls back stock, fulfilment, picking, event, audit, and idempotency', () => {
  const catalog = seed('C');
  const chain = requestToConfirmedOrder(catalog, 'C', { quantity: 2 });
  const line = chain.po.lines[0];
  const before = {
    quant: getQuantBalance(db, { company_id: 'default', product_id: catalog.variantId, location_id: catalog.warehouse.lot_stock_id }),
    picking: db.prepare('SELECT * FROM stock_pickings WHERE id = ?').get(chain.pickingId),
    fulfilment: db.prepare('SELECT * FROM purchase_order_line_fulfilment WHERE purchase_order_line_id = ?').get(line.id),
    events: db.prepare('SELECT COUNT(*) AS n FROM purchase_receipt_events WHERE purchase_order_id = ?').get(chain.po.id).n,
    audit: db.prepare('SELECT COUNT(*) AS n FROM platform_audit_log').get().n,
    idem: db.prepare('SELECT COUNT(*) AS n FROM action_idempotency').get().n,
  };
  db.exec(`
    CREATE TRIGGER checkpoint_c2_fail_receipt_outbox
    BEFORE INSERT ON platform_outbox
    WHEN NEW.payload LIKE '%procurement:receipt:post%'
    BEGIN SELECT RAISE(ABORT, 'injected receipt outbox failure'); END;
  `);
  try {
    assert.throws(() => execute('procurement:receipt:post', {
      purchase_order_id: chain.po.id,
      picking_id: chain.pickingId,
      lines: [{ purchase_order_line_id: line.id, quantity: 2 }],
    }), /injected receipt outbox failure/);
  } finally {
    db.exec('DROP TRIGGER IF EXISTS checkpoint_c2_fail_receipt_outbox');
  }
  assert.deepEqual(getQuantBalance(db, { company_id: 'default', product_id: catalog.variantId, location_id: catalog.warehouse.lot_stock_id }), before.quant);
  assert.deepEqual(db.prepare('SELECT * FROM stock_pickings WHERE id = ?').get(chain.pickingId), before.picking);
  assert.deepEqual(db.prepare('SELECT * FROM purchase_order_line_fulfilment WHERE purchase_order_line_id = ?').get(line.id), before.fulfilment);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM purchase_receipt_events WHERE purchase_order_id = ?').get(chain.po.id).n, before.events);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_audit_log').get().n, before.audit);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM action_idempotency').get().n, before.idem);
});

test('purchase order approval outbox failure leaves no approval or commitment', () => {
  const catalog = seed('D');
  const po = execute('procurement:order:create', {
    supplier_id: catalog.supplierA.id,
    lines: [{ product_id: catalog.variantId, product_qty: 1, product_uom: catalog.unit.id, price_unit: 30 }],
  });
  db.exec(`
    CREATE TRIGGER checkpoint_c2_fail_approval_outbox
    BEFORE INSERT ON platform_outbox
    WHEN NEW.payload LIKE '%procurement:order:approve%'
    BEGIN SELECT RAISE(ABORT, 'injected approval outbox failure'); END;
  `);
  try {
    assert.throws(() => execute('procurement:order:approve', { order_id: po.id }), /injected approval outbox failure/);
  } finally {
    db.exec('DROP TRIGGER IF EXISTS checkpoint_c2_fail_approval_outbox');
  }
  assert.equal(db.prepare('SELECT state FROM purchase_orders WHERE id = ?').get(po.id).state, 'draft');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM purchase_commitments WHERE purchase_order_id = ?').get(po.id).n, 0);
});

test('three-way match outbox failure rolls back match lines, exceptions, invoice registry, audit, and idempotency', () => {
  const catalog = seed('MATCH-ROLLBACK');
  const chain = requestToConfirmedOrder(catalog, 'MATCH-ROLLBACK', {
    quantity: 2,
    unitPrice: 30,
    qualityRequired: false,
  });
  const line = chain.po.lines[0];
  const receipt = execute('procurement:receipt:post', {
    purchase_order_id: chain.po.id,
    picking_id: chain.pickingId,
    lines: [{ purchase_order_line_id: line.id, quantity: 2 }],
  });
  const before = {
    matches: db.prepare('SELECT COUNT(*) AS n FROM three_way_matches').get().n,
    lines: db.prepare('SELECT COUNT(*) AS n FROM three_way_match_lines').get().n,
    exceptions: db.prepare('SELECT COUNT(*) AS n FROM three_way_match_exceptions').get().n,
    invoices: db.prepare('SELECT COUNT(*) AS n FROM supplier_invoice_registry').get().n,
    audit: db.prepare('SELECT COUNT(*) AS n FROM platform_audit_log').get().n,
    idempotency: db.prepare('SELECT COUNT(*) AS n FROM action_idempotency').get().n,
  };
  db.exec(`
    CREATE TRIGGER checkpoint_c6_fail_match_outbox
    BEFORE INSERT ON platform_outbox
    WHEN NEW.payload LIKE '%procurement:threewaymatch:perform%'
    BEGIN SELECT RAISE(ABORT, 'injected three-way match outbox failure'); END;
  `);
  try {
    assert.throws(
      () => execute('procurement:threewaymatch:perform', {
        purchase_order_id: chain.po.id,
        receipt_picking_id: receipt.picking.id,
        supplier_invoice_number: `SUP-MATCH-ROLLBACK-${Date.now()}`,
        bill_lines: [{
          purchase_order_line_id: line.id,
          quantity: 2,
          unit_price: 30,
          currency: 'IQD',
        }],
      }),
      /injected three-way match outbox failure/,
    );
  } finally {
    db.exec('DROP TRIGGER IF EXISTS checkpoint_c6_fail_match_outbox');
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM three_way_matches').get().n, before.matches);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM three_way_match_lines').get().n, before.lines);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM three_way_match_exceptions').get().n, before.exceptions);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM supplier_invoice_registry').get().n, before.invoices);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_audit_log').get().n, before.audit);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM action_idempotency').get().n, before.idempotency);
});

test('supplier-bill outbox failure rolls back fiscal, Finance, commitment, audit, and idempotency consequences', () => {
  const catalog = seed('BILL-ROLLBACK');
  const chain = requestToConfirmedOrder(catalog, 'BILL-ROLLBACK', {
    quantity: 2,
    unitPrice: 30,
    qualityRequired: false,
  });
  const line = chain.po.lines[0];
  const receipt = execute('procurement:receipt:post', {
    purchase_order_id: chain.po.id,
    picking_id: chain.pickingId,
    lines: [{ purchase_order_line_id: line.id, quantity: 2 }],
  });
  execute('procurement:threewaymatch:perform', {
    purchase_order_id: chain.po.id,
    receipt_picking_id: receipt.picking.id,
    supplier_invoice_number: `SUP-BILL-ROLLBACK-${Date.now()}`,
    bill_lines: [{
      purchase_order_line_id: line.id,
      quantity: 2,
      unit_price: 30,
      currency: 'IQD',
    }],
  });
  const before = {
    requests: db.prepare(`
      SELECT COUNT(*) AS n FROM commercial_fiscal_requests
      WHERE request_type = 'supplier_bill' AND source_document_id = ?
    `).get(chain.po.id).n,
    financeDocuments: db.prepare('SELECT COUNT(*) AS n FROM finance_documents').get().n,
    journalLines: db.prepare('SELECT COUNT(*) AS n FROM finance_journal_lines').get().n,
    commitment: db.prepare('SELECT * FROM purchase_commitments WHERE purchase_order_id = ?').get(chain.po.id),
    order: db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(chain.po.id),
    audit: db.prepare('SELECT COUNT(*) AS n FROM platform_audit_log').get().n,
    idempotency: db.prepare('SELECT COUNT(*) AS n FROM action_idempotency').get().n,
  };
  db.exec(`
    CREATE TRIGGER checkpoint_c6_fail_bill_outbox
    BEFORE INSERT ON platform_outbox
    WHEN NEW.payload LIKE '%procurement:bill_request:create%'
    BEGIN SELECT RAISE(ABORT, 'injected supplier bill outbox failure'); END;
  `);
  try {
    assert.throws(
      () => execute('procurement:bill_request:create', { purchase_order_id: chain.po.id }),
      /injected supplier bill outbox failure/,
    );
  } finally {
    db.exec('DROP TRIGGER IF EXISTS checkpoint_c6_fail_bill_outbox');
  }
  assert.equal(db.prepare(`
    SELECT COUNT(*) AS n FROM commercial_fiscal_requests
    WHERE request_type = 'supplier_bill' AND source_document_id = ?
  `).get(chain.po.id).n, before.requests);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM finance_documents').get().n, before.financeDocuments);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM finance_journal_lines').get().n, before.journalLines);
  assert.deepEqual(db.prepare('SELECT * FROM purchase_commitments WHERE purchase_order_id = ?').get(chain.po.id), before.commitment);
  assert.deepEqual(db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(chain.po.id), before.order);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_audit_log').get().n, before.audit);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM action_idempotency').get().n, before.idempotency);
});

test('idempotency and duplicate approval/receipt concurrency each produce one fact set', async () => {
  const catalog = seed('E');
  const po = execute('procurement:order:create', {
    supplier_id: catalog.supplierA.id,
    lines: [{ product_id: catalog.variantId, product_qty: 1, product_uom: catalog.unit.id, price_unit: 30 }],
  });
  const replayKey = key('approveReplay');
  const first = execute('procurement:order:approve', { order_id: po.id }, replayKey);
  const replay = execute('procurement:order:approve', { order_id: po.id }, replayKey);
  assert.equal(replay.id, first.id);
  assert.equal(replay.state, first.state);
  assert.equal(replay.approved_at, first.approved_at);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM purchase_commitments WHERE purchase_order_id = ?').get(po.id).n, 1);

  const second = execute('procurement:order:create', {
    supplier_id: catalog.supplierA.id,
    lines: [{ product_id: catalog.variantId, product_qty: 1, product_uom: catalog.unit.id, price_unit: 30 }],
  });
  const approvals = await Promise.allSettled([
    Promise.resolve().then(() => execute('procurement:order:approve', { order_id: second.id }, key('approve1'))),
    Promise.resolve().then(() => execute('procurement:order:approve', { order_id: second.id }, key('approve2'))),
  ]);
  assert.equal(approvals.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(approvals.filter((result) => result.status === 'rejected').length, 1);

  const confirmation = execute('procurement:order:confirm', { order_id: po.id, warehouse_id: catalog.warehouse.id });
  const line = confirmation.order.lines[0];
  const receipts = await Promise.allSettled([
    Promise.resolve().then(() => execute('procurement:receipt:post', {
      purchase_order_id: po.id,
      picking_id: confirmation.receipt_picking_id,
      lines: [{ purchase_order_line_id: line.id, quantity: 1 }],
    }, key('receipt1'))),
    Promise.resolve().then(() => execute('procurement:receipt:post', {
      purchase_order_id: po.id,
      picking_id: confirmation.receipt_picking_id,
      lines: [{ purchase_order_line_id: line.id, quantity: 1 }],
    }, key('receipt2'))),
  ]);
  assert.equal(receipts.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(receipts.filter((result) => result.status === 'rejected').length, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM purchase_receipt_events WHERE purchase_order_id = ?').get(po.id).n, 1);
});

test('company scope fails closed on requests, RFQs, orders, and reads', () => {
  const catalog = seed('F');
  const request = execute('procurement:request:create', {
    name: 'Scoped request',
    lines: [{ product_id: catalog.variantId, quantity: 1, uom_id: catalog.unit.id }],
  });
  const foreignCtx = { ...ctx, companyId: 'foreign-company', branchId: null };
  assert.throws(
    () => executor.execute('procurement:request:submit', { request_id: request.id, idempotency_key: key('foreign') }, foreignCtx),
    /not found/,
  );
  const foreignRead = handleCommercialQuery({
    dialect: db,
    ctx: foreignCtx,
    namespace: 'procurement',
    resource: 'requests',
    query: {},
  });
  assert.equal(foreignRead.data.length, 0);
});
