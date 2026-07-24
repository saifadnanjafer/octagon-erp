import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';
import { products, uom } from '../../platform/commercial/index.mjs';
import { ledger } from '../../platform/inventory/index.mjs';
import { setApprovalAuthorityLimit } from '../../platform/finance/engine.mjs';

test('canonical POS commits payment, stock, fiscal GL, cashbox, and close as one governed flow', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-phase04-pos-'));
  const dbPath = path.join(tempDir, 'pos.db');
  let db;
  try {
    await freshInstall({ dbPath, backupDir: path.join(tempDir, 'backups'), actor: 'phase04-pos-test' });
    db = openMigrationDatabase(dbPath);
    const executor = createPlatformAuthority(db).actionExecutor;
    const ctx = {
      tenantId: 'default',
      companyId: 'default',
      branchId: 'default',
      userId: 'phase04-pos-test',
      sourceChannel: 'node-test',
    };
    setApprovalAuthorityLimit(db, ctx, {
      role_or_user: ctx.userId,
      limit_type: 'post',
      max_amount: 1_000_000_000,
    });
    const execute = (actionId, input, key) => executor.execute(actionId, { ...input, idempotency_key: key }, ctx);

    const cashbox = execute('finance_cashbox:create', {
      name: 'POS Cashbox',
      gl_account_id: 'acc_101000',
      branch_id: 'default',
    }, 'pos-cashbox');
    const shift = execute('finance_cash_shift:open', {
      cashbox_id: cashbox.id,
      opening_balance: 0,
    }, 'pos-cash-shift');
    const session = execute('pos:session:open', {
      name: 'POS Terminal 1',
      cash_shift_id: shift.id,
    }, 'pos-session');
    const warehouse = execute('warehouse:create', { name: 'POS Warehouse', code: 'POSWH' }, 'pos-wh');
    const supplierLocation = execute('stock:location:create', { name: 'POS Supplier', usage: 'supplier' }, 'pos-supplier-loc');
    const customer = execute('party:create', { name: 'POS Walk-in Customer', roles: ['customer'] }, 'pos-customer');
    const uomCategory = uom.createUomCategory(db, { name: 'POS Units' });
    const unit = uom.createUom(db, { category_id: uomCategory.id, name: 'Piece' });
    const productCategory = products.createProductCategory(db, {
      company_id: 'default',
      name: 'POS Goods',
      costing_method: 'avco',
      income_account_id: 'acc_401000',
      expense_account_id: 'acc_501000',
      stock_account_id: 'acc_104000',
      stock_input_account_id: 'acc_201000',
      stock_output_account_id: 'acc_500000',
    });
    const product = execute('product:template:create', {
      name: 'POS Canonical Product',
      category_id: productCategory.id,
      uom_id: unit.id,
      list_price: 12,
      standard_price: 5,
      sku: 'POS-CAN-001',
    }, 'pos-product');
    execute('stock:move:post', {
      reference: 'POS-OPENING-STOCK',
      product_id: product.default_variant_id,
      uom_id: unit.id,
      product_qty: 10,
      location_id: supplierLocation.id,
      location_dest_id: warehouse.lot_stock_id,
      unit_cost: 5,
      source_document_type: 'inventory_adjustment',
      source_document_id: 'POS-OPENING',
    }, 'pos-opening-stock');

    assert.throws(
      () => execute('pos:order:process', {
        session_id: session.id,
        partner_id: customer.id,
        warehouse_id: warehouse.id,
        lines: [{ product_id: product.default_variant_id, qty: 2 }],
        payments: [{ payment_method_id: 'cash', amount: 20 }],
      }, 'pos-sale-bad-payment'),
      /does not equal fiscal total/,
    );
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pos_orders WHERE name LIKE 'POS/%'").get().n, 0);
    assert.equal(
      ledger.getQuantBalance(db, { company_id: 'default', product_id: product.default_variant_id, location_id: warehouse.lot_stock_id }).onHand,
      10,
    );

    const order = execute('pos:order:process', {
      session_id: session.id,
      partner_id: customer.id,
      warehouse_id: warehouse.id,
      lines: [{ product_id: product.default_variant_id, qty: 2 }],
      payments: [{ payment_method_id: 'cash', amount: 24 }],
    }, 'pos-sale-good');
    assert.equal(order.state, 'paid');
    assert.equal(order.amount_total, 24);
    assert.ok(order.finance?.finance_document_id);
    assert.equal(db.prepare('SELECT state FROM finance_documents WHERE id = ?').get(order.finance.finance_document_id).state, 'posted');
    assert.equal(
      ledger.getQuantBalance(db, { company_id: 'default', product_id: product.default_variant_id, location_id: warehouse.lot_stock_id }).onHand,
      8,
    );

    const close = execute('pos:session:close', {
      session_id: session.id,
      counted_amount: 24,
    }, 'pos-session-close');
    assert.equal(close.session.state, 'closed');
    assert.equal(close.cash_shift.status, 'closed');
    assert.equal(close.cash_shift.variance, 0);
  } finally {
    try { db?.close(); } catch (_) {}
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
