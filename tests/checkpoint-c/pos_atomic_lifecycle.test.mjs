// Checkpoint C3 — canonical POS lifecycle, rollback, concurrency, and reads.
// All writes target a disposable SQLite database.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';
import { products, uom } from '../../platform/commercial/index.mjs';
import { createTax, setApprovalAuthorityLimit } from '../../platform/finance/engine.mjs';
import { getQuantBalance } from '../../platform/inventory/ledger.mjs';
import { handleCommercialQuery } from '../../platform/api/commercial.mjs';

let tempDir;
let db;
let executor;
let ctx;
let sequence = 0;
let catalog;

const key = (prefix) => `${prefix}_${Date.now()}_${++sequence}`;
const execute = (actionId, input, idempotencyKey = key(actionId)) =>
  executor.execute(actionId, { ...input, idempotency_key: idempotencyKey }, ctx);
const query = (resource, params = {}, recordId = null) =>
  handleCommercialQuery({ dialect: db, ctx, namespace: 'pos', resource, recordId, query: params });

function seedCatalog() {
  const warehouse = execute('warehouse:create', { name: 'C3 POS Warehouse', code: 'C3POS' });
  const supplierLocation = execute('stock:location:create', { name: 'C3 POS Supplier', usage: 'supplier' });
  const customer = execute('party:create', { name: 'C3 Walk-in Customer', roles: ['customer'] });
  const category = uom.createUomCategory(db, { name: 'C3 POS Units' });
  const unit = uom.createUom(db, { category_id: category.id, name: 'Piece' });
  const productCategory = products.createProductCategory(db, {
    company_id: 'default',
    name: 'C3 POS Goods',
    costing_method: 'avco',
    income_account_id: 'acc_401000',
    expense_account_id: 'acc_501000',
    stock_account_id: 'acc_104000',
    stock_input_account_id: 'acc_201000',
    stock_output_account_id: 'acc_500000',
  });
  const product = execute('product:template:create', {
    name: 'C3 Barcode Product',
    category_id: productCategory.id,
    uom_id: unit.id,
    list_price: 10,
    standard_price: 4,
    sku: 'C3-POS-001',
    barcode: '629000000001',
  });
  execute('stock:move:post', {
    reference: 'C3-POS-OPENING',
    product_id: product.default_variant_id,
    uom_id: unit.id,
    product_qty: 10,
    location_id: supplierLocation.id,
    location_dest_id: warehouse.lot_stock_id,
    unit_cost: 4,
    source_document_type: 'inventory_adjustment',
    source_document_id: 'C3-POS-OPENING',
  });
  const tax = createTax(db, ctx, {
    code: 'C3POS10',
    name: 'C3 POS Tax 10%',
    amount_type: 'percent',
    amount: 10,
  });
  db.prepare(`
    INSERT INTO pos_product_tax_configs (company_id, product_id, tax_id, updated_at)
    VALUES ('default', ?, ?, ?)
  `).run(product.default_variant_id, tax.id, new Date().toISOString());
  const terminal = execute('pos:terminal:configure', {
    name: 'C3 Main Terminal',
    warehouse_id: warehouse.id,
    cash_account_id: 'acc_101000',
  });
  execute('pos:payment_method:configure', {
    payment_method_id: 'card',
    gl_account_id: 'acc_102000',
  });
  return { warehouse, supplierLocation, customer, unit, product, terminal, tax };
}

function openSession(label = 'main', openingCash = 50) {
  return execute('pos:session:open', {
    name: `C3 Session ${label}`,
    terminal_id: catalog.terminal.id,
    opening_cash: openingCash,
  });
}

function processSale(session, { qty = 2, payments = [{ payment_method_id: 'cash', amount: 10 }, { payment_method_id: 'card', amount: 12 }] } = {}) {
  return execute('pos:order:process', {
    session_id: session.id,
    partner_id: catalog.customer.id,
    warehouse_id: catalog.warehouse.id,
    lines: [{ product_id: catalog.product.default_variant_id, qty }],
    payments,
  });
}

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-c3-pos-'));
  const dbPath = path.join(tempDir, 'pos.db');
  await freshInstall({ dbPath, backupDir: path.join(tempDir, 'backups'), actor: 'c3-pos-test' });
  db = openMigrationDatabase(dbPath);
  executor = createPlatformAuthority(db).actionExecutor;
  ctx = {
    tenantId: 'default',
    companyId: 'default',
    branchId: 'default',
    userId: 'checkpoint-c3-pos',
    sourceChannel: 'node-test',
  };
  setApprovalAuthorityLimit(db, ctx, { role_or_user: ctx.userId, limit_type: 'post', max_amount: 1_000_000_000 });
  catalog = seedCatalog();
});

after(() => {
  try { db?.close(); } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }
});

test('terminal, split payment sale, fiscal receipt, partial refund, stock return, and reconciliation are canonical', () => {
  const session = openSession();
  const sale = processSale(session);
  assert.equal(sale.state, 'paid');
  assert.equal(sale.order_kind, 'sale');
  assert.equal(sale.amount_untaxed, 20);
  assert.equal(sale.amount_tax, 2);
  assert.equal(sale.amount_total, 22);
  assert.match(sale.receipt_number, /^20\d\d-/);
  assert.deepEqual(sale.payments.map((payment) => payment.payment_method_id).sort(), ['card', 'cash']);
  assert.equal(getQuantBalance(db, {
    company_id: 'default',
    product_id: catalog.product.default_variant_id,
    location_id: catalog.warehouse.lot_stock_id,
  }).onHand, 8);

  const returned = execute('pos:order:refund', {
    session_id: session.id,
    original_order_id: sale.id,
    reason: 'Customer returned one item',
    lines: [{ original_order_line_id: sale.lines[0].id, qty: 1 }],
    payments: [{ payment_method_id: 'cash', amount: 11, reference: 'CASH-REFUND-1' }],
  });
  assert.equal(returned.order.state, 'refunded');
  assert.equal(returned.order.order_kind, 'refund');
  assert.equal(returned.order.amount_total, 11);
  assert.equal(returned.refund.original_order_id, sale.id);
  assert.equal(getQuantBalance(db, {
    company_id: 'default',
    product_id: catalog.product.default_variant_id,
    location_id: catalog.warehouse.lot_stock_id,
  }).onHand, 9);
  assert.throws(() => execute('pos:order:refund', {
    session_id: session.id,
    original_order_id: sale.id,
    reason: 'Excess return',
    lines: [{ original_order_line_id: sale.lines[0].id, qty: 2 }],
    payments: [{ payment_method_id: 'cash', amount: 22 }],
  }), /exceeds the remaining sold quantity/);

  const closed = execute('pos:session:close', { session_id: session.id, counted_amount: 49 });
  assert.equal(closed.session.state, 'closed');
  assert.equal(closed.reconciliation.status, 'balanced');
  assert.equal(closed.reconciliation.sales_amount, 22);
  assert.equal(closed.reconciliation.refunds_amount, 11);
  assert.equal(closed.reconciliation.expected_amount, 49);
  assert.equal(closed.reconciliation.variance, 0);
  assert.ok(closed.session.events.some((event) => event.event_type === 'sale'));
  assert.ok(closed.session.events.some((event) => event.event_type === 'refund'));

  assert.equal(query('orders').data.length, 2);
  assert.equal(query('sessions').data.length, 1);
  assert.equal(query('refunds').data.length, 1);
  assert.equal(query('reconciliations').data.length, 1);
  assert.equal(query('payment-methods').data[0].payment_method_id, 'card');
  assert.equal(query('reports', { report: 'daily-sales' }).data[0].net_sales, 11);
});

test('payment, stock, valuation, finance, audit, and outbox failures roll back the entire sale', () => {
  const stages = [
    ['payment', 'pos_payments'],
    ['stock', 'stock_moves'],
    ['valuation', 'stock_valuation_facts'],
    ['finance', 'finance_documents'],
    ['audit', 'platform_audit_log'],
    ['outbox', 'platform_outbox'],
  ];
  for (const [stage, table] of stages) {
    const session = openSession(stage, 0);
    const beforeOrders = db.prepare('SELECT COUNT(*) AS n FROM pos_orders').get().n;
    const beforeStock = getQuantBalance(db, {
      company_id: 'default',
      product_id: catalog.product.default_variant_id,
      location_id: catalog.warehouse.lot_stock_id,
    }).onHand;
    db.exec(`
      CREATE TRIGGER c3_fail_${stage}
      BEFORE INSERT ON ${table}
      BEGIN SELECT RAISE(ABORT, 'injected ${stage} failure'); END;
    `);
    try {
      assert.throws(() => processSale(session, {
        qty: 1,
        payments: [{ payment_method_id: 'cash', amount: 11 }],
      }), new RegExp(`injected ${stage} failure`));
    } finally {
      db.exec(`DROP TRIGGER c3_fail_${stage}`);
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pos_orders').get().n, beforeOrders);
    assert.equal(getQuantBalance(db, {
      company_id: 'default',
      product_id: catalog.product.default_variant_id,
      location_id: catalog.warehouse.lot_stock_id,
    }).onHand, beforeStock);
    execute('pos:session:close', { session_id: session.id, counted_amount: 0 });
  }
});

test('cashbox failure rolls session close back, while idempotency and limited-stock contention serialize safely', async () => {
  const session = openSession('cashbox', 0);
  const sale = processSale(session, { qty: 1, payments: [{ payment_method_id: 'cash', amount: 11 }] });
  db.exec(`
    CREATE TRIGGER c3_fail_cashbox
    BEFORE INSERT ON finance_cash_counts
    BEGIN SELECT RAISE(ABORT, 'injected cashbox failure'); END;
  `);
  try {
    assert.throws(
      () => execute('pos:session:close', { session_id: session.id, counted_amount: 11 }),
      /injected cashbox failure/,
    );
  } finally {
    db.exec('DROP TRIGGER c3_fail_cashbox');
  }
  assert.equal(db.prepare('SELECT state FROM pos_sessions WHERE id = ?').get(session.id).state, 'opened');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pos_reconciliations WHERE session_id = ?').get(session.id).n, 0);

  const replayKey = key('pos-replay');
  const input = {
    session_id: session.id,
    partner_id: catalog.customer.id,
    warehouse_id: catalog.warehouse.id,
    lines: [{ product_id: catalog.product.default_variant_id, qty: 1 }],
    payments: [{ payment_method_id: 'cash', amount: 11 }],
  };
  const first = execute('pos:order:process', input, replayKey);
  const replay = execute('pos:order:process', input, replayKey);
  assert.equal(replay.id, first.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pos_orders WHERE id = ?').get(first.id).n, 1);

  const available = getQuantBalance(db, {
    company_id: 'default',
    product_id: catalog.product.default_variant_id,
    location_id: catalog.warehouse.lot_stock_id,
  }).onHand;
  const results = await Promise.allSettled([
    Promise.resolve().then(() => processSale(session, { qty: available, payments: [{ payment_method_id: 'cash', amount: roundMoney(available * 11) }] })),
    Promise.resolve().then(() => processSale(session, { qty: available, payments: [{ payment_method_id: 'cash', amount: roundMoney(available * 11) }] })),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  assert.equal(getQuantBalance(db, {
    company_id: 'default',
    product_id: catalog.product.default_variant_id,
    location_id: catalog.warehouse.lot_stock_id,
  }).onHand, 0);
  assert.ok(sale.id);
});

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}
