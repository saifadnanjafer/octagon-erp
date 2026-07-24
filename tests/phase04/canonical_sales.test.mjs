import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';
import { products, uom } from '../../platform/commercial/index.mjs';
import { setApprovalAuthorityLimit } from '../../platform/finance/engine.mjs';

test('canonical sales lifecycle reserves, delivers, values, posts GL, and invoices actual fulfilment', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-phase04-sales-'));
  const dbPath = path.join(tempDir, 'sales.db');
  let db;
  try {
    await freshInstall({ dbPath, backupDir: path.join(tempDir, 'backups'), actor: 'phase04-sales-test' });
    db = openMigrationDatabase(dbPath);
    const executor = createPlatformAuthority(db).actionExecutor;
    const ctx = {
      tenantId: 'default',
      companyId: 'default',
      branchId: 'default',
      userId: 'phase04-sales-test',
      sourceChannel: 'node-test',
    };
    setApprovalAuthorityLimit(db, ctx, {
      role_or_user: ctx.userId,
      limit_type: 'post',
      max_amount: 1_000_000_000,
    });
    const execute = (actionId, input, key) => executor.execute(actionId, { ...input, idempotency_key: key }, ctx);

    const warehouse = execute('warehouse:create', { name: 'Sales Warehouse', code: 'SWH' }, 'sales-wh');
    const supplier = execute('stock:location:create', { name: 'Sales Test Supplier', usage: 'supplier' }, 'sales-supplier-loc');
    const customer = execute('party:create', { name: 'Canonical Customer', roles: ['customer'] }, 'sales-customer');
    const uomCategory = uom.createUomCategory(db, { name: 'Sales Units' });
    const unit = uom.createUom(db, { category_id: uomCategory.id, name: 'Piece' });
    const productCategory = products.createProductCategory(db, {
      company_id: 'default',
      name: 'Sales Goods',
      costing_method: 'avco',
      income_account_id: 'acc_401000',
      expense_account_id: 'acc_501000',
      stock_account_id: 'acc_104000',
      stock_input_account_id: 'acc_201000',
      stock_output_account_id: 'acc_500000',
    });
    const product = execute('product:template:create', {
      name: 'Canonical Sales Product',
      category_id: productCategory.id,
      uom_id: unit.id,
      list_price: 100,
      standard_price: 40,
      sku: 'SALE-CAN-001',
    }, 'sales-product');
    execute('stock:move:post', {
      reference: 'SALES-OPENING-STOCK',
      product_id: product.default_variant_id,
      uom_id: unit.id,
      product_qty: 20,
      location_id: supplier.id,
      location_dest_id: warehouse.lot_stock_id,
      unit_cost: 40,
      source_document_type: 'inventory_adjustment',
      source_document_id: 'SALES-OPENING',
    }, 'sales-opening-stock');

    const quotation = execute('sales:quotation:create', {
      partner_id: customer.id,
      lines: [{
        product_id: product.default_variant_id,
        product_uom_qty: 4,
        price_unit: 100,
      }],
    }, 'sales-quotation');
    const confirmation = execute('sales:order:confirm', {
      order_id: quotation.id,
      warehouse_id: warehouse.id,
    }, 'sales-confirm');
    assert.equal(confirmation.order.state, 'sale');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sale_fulfilment_demands WHERE sale_order_id = ? AND status = 'reserved'").get(quotation.id).n, 1);

    const delivery = execute('wms:picking:validate', {
      picking_id: confirmation.delivery_picking_id,
      moves: [{
        product_id: product.default_variant_id,
        uom_id: unit.id,
        product_qty: 4,
      }],
    }, 'sales-delivery');
    assert.equal(delivery.state, 'done');
    const fulfilment = db.prepare(`
      SELECT * FROM sale_order_line_fulfilment
      WHERE order_id = ?
    `).get(quotation.id);
    assert.equal(fulfilment.delivered_quantity, 4);
    assert.equal(fulfilment.invoiced_quantity, 0);

    const invoice = execute('sales:invoice_request:create', { order_id: quotation.id }, 'sales-invoice');
    assert.equal(invoice.status, 'posted');
    assert.ok(invoice.finance_document_id);
    assert.equal(db.prepare("SELECT state FROM finance_documents WHERE id = ?").get(invoice.finance_document_id).state, 'posted');
    const afterInvoice = db.prepare(`
      SELECT * FROM sale_order_line_fulfilment
      WHERE order_id = ?
    `).get(quotation.id);
    assert.equal(afterInvoice.invoiced_quantity, 4);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM commercial_fiscal_requests WHERE source_document_id = ? AND status = 'posted'").get(quotation.id).n, 1);
  } finally {
    try { db?.close(); } catch (_) {}
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
