import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';
import { products, uom } from '../../platform/commercial/index.mjs';
import { setApprovalAuthorityLimit } from '../../platform/finance/engine.mjs';

test('canonical procurement lifecycle receives, matches line by line, and posts the supplier bill', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-phase04-procurement-'));
  const dbPath = path.join(tempDir, 'procurement.db');
  let db;
  try {
    await freshInstall({ dbPath, backupDir: path.join(tempDir, 'backups'), actor: 'phase04-procurement-test' });
    db = openMigrationDatabase(dbPath);
    const executor = createPlatformAuthority(db).actionExecutor;
    const ctx = {
      tenantId: 'default',
      companyId: 'default',
      branchId: 'default',
      userId: 'phase04-procurement-test',
      sourceChannel: 'node-test',
    };
    setApprovalAuthorityLimit(db, ctx, {
      role_or_user: ctx.userId,
      limit_type: 'post',
      max_amount: 1_000_000_000,
    });
    const execute = (actionId, input, key) => executor.execute(actionId, { ...input, idempotency_key: key }, ctx);

    const warehouse = execute('warehouse:create', { name: 'Procurement Warehouse', code: 'PWH' }, 'proc-wh');
    const supplier = execute('party:create', { name: 'Canonical Supplier', roles: ['supplier'] }, 'proc-supplier');
    const uomCategory = uom.createUomCategory(db, { name: 'Procurement Units' });
    const unit = uom.createUom(db, { category_id: uomCategory.id, name: 'Piece' });
    const productCategory = products.createProductCategory(db, {
      company_id: 'default',
      name: 'Procured Goods',
      costing_method: 'fifo',
      income_account_id: 'acc_401000',
      expense_account_id: 'acc_501000',
      stock_account_id: 'acc_104000',
      stock_input_account_id: 'acc_201000',
      stock_output_account_id: 'acc_500000',
    });
    const product = execute('product:template:create', {
      name: 'Canonical Purchased Product',
      category_id: productCategory.id,
      uom_id: unit.id,
      standard_price: 30,
      sku: 'BUY-CAN-001',
    }, 'proc-product');

    const po = execute('procurement:order:create', {
      supplier_id: supplier.id,
      lines: [{
        product_id: product.default_variant_id,
        product_qty: 5,
        price_unit: 30,
      }],
    }, 'proc-order');
    const confirmation = execute('procurement:order:confirm', {
      order_id: po.id,
      warehouse_id: warehouse.id,
    }, 'proc-confirm');
    assert.equal(confirmation.order.state, 'purchase');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM purchase_fulfilment_demands WHERE purchase_order_id = ? AND status = 'awaiting_receipt'").get(po.id).n, 1);

    const receipt = execute('wms:picking:validate', {
      picking_id: confirmation.receipt_picking_id,
      moves: [{
        product_id: product.default_variant_id,
        uom_id: unit.id,
        product_qty: 5,
        unit_cost: 30,
      }],
    }, 'proc-receipt');
    assert.equal(receipt.state, 'done');
    const line = db.prepare('SELECT * FROM purchase_order_lines WHERE order_id = ?').get(po.id);
    const fulfilment = db.prepare(`
      SELECT * FROM purchase_order_line_fulfilment
      WHERE purchase_order_line_id = ?
    `).get(line.id);
    assert.equal(fulfilment.received_quantity, 5);

    const match = execute('procurement:threewaymatch:perform', {
      purchase_order_id: po.id,
      receipt_picking_id: confirmation.receipt_picking_id,
      supplier_invoice_number: 'SUP-INV-001',
      bill_lines: [{
        purchase_order_line_id: line.id,
        quantity: 5,
        unit_price: 30,
        currency: 'IQD',
      }],
    }, 'proc-match');
    assert.equal(match.match_status, 'matched');
    assert.equal(match.exceptions.length, 0);
    assert.equal(match.lines.length, 1);

    const bill = execute('procurement:bill_request:create', {
      purchase_order_id: po.id,
    }, 'proc-bill');
    assert.equal(bill.status, 'posted');
    assert.ok(bill.finance_document_id);
    assert.equal(db.prepare('SELECT state FROM finance_documents WHERE id = ?').get(bill.finance_document_id).state, 'posted');
    const afterBill = db.prepare(`
      SELECT * FROM purchase_order_line_fulfilment
      WHERE purchase_order_line_id = ?
    `).get(line.id);
    assert.equal(afterBill.billed_quantity, 5);
  } finally {
    try { db?.close(); } catch (_) {}
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
