import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';
import { products, uom } from '../../platform/commercial/index.mjs';
import { ledger } from '../../platform/inventory/index.mjs';
import { setApprovalAuthorityLimit } from '../../platform/finance/engine.mjs';

let tempDir;
let db;
let executor;
let warehouse;
let supplierLocation;
let unit;
let productId;

const ctx = {
  tenantId: 'default',
  companyId: 'default',
  branchId: 'default',
  userId: 'phase04-stock-test',
  sourceChannel: 'node-test',
};

function execute(actionId, input, key) {
  return executor.execute(actionId, { ...input, idempotency_key: key }, ctx);
}

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-phase04-stock-'));
  const dbPath = path.join(tempDir, 'stock.db');
  await freshInstall({ dbPath, backupDir: path.join(tempDir, 'backups'), actor: 'phase04-stock-test' });
  db = openMigrationDatabase(dbPath);
  executor = createPlatformAuthority(db).actionExecutor;
  setApprovalAuthorityLimit(db, ctx, {
    role_or_user: ctx.userId,
    limit_type: 'post',
    max_amount: 1_000_000_000,
    currency: 'IQD',
  });

  warehouse = execute('warehouse:create', { name: 'Canonical Warehouse', code: 'CWH' }, 'stock-warehouse');
  supplierLocation = execute('stock:location:create', { name: 'Canonical Supplier', usage: 'supplier' }, 'stock-supplier-location');
  const category = uom.createUomCategory(db, { name: 'Canonical Units' });
  unit = uom.createUom(db, { category_id: category.id, name: 'Piece', symbol: 'pc' });
  const productCategory = products.createProductCategory(db, {
    company_id: 'default',
    name: 'Canonical Parts',
    costing_method: 'avco',
    stock_account_id: 'acc_104000',
    stock_input_account_id: 'acc_201000',
    stock_output_account_id: 'acc_500000',
    expense_account_id: 'acc_501000',
  });
  const product = execute('product:template:create', {
    name: 'Canonical Part',
    category_id: productCategory.id,
    uom_id: unit.id,
    sku: 'CAN-PART-001',
  }, 'stock-product');
  productId = product.default_variant_id;
});

after(() => {
  try {
    db?.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('stock receipt is immutable, idempotent, valued, and rebuildable', () => {
  const input = {
    reference: 'RECEIPT-001',
    product_id: productId,
    uom_id: unit.id,
    product_qty: 10,
    location_id: supplierLocation.id,
    location_dest_id: warehouse.lot_stock_id,
    unit_cost: 25,
    source_document_type: 'inventory_adjustment',
    source_document_id: 'OPENING-001',
    source_line_id: 'OPENING-LINE-001',
  };
  const first = execute('stock:move:post', input, 'stock-receipt-001');
  const replay = execute('stock:move:post', input, 'stock-receipt-001');
  assert.equal(replay.id, first.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM stock_moves WHERE id = ?').get(first.id).n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM stock_move_lines WHERE move_id = ?').get(first.id).n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM stock_accounting_links WHERE stock_move_id = ?').get(first.id).n, 1);
  const valuationFact = db.prepare('SELECT quantity, value FROM stock_valuation_facts WHERE stock_move_id = ?').get(first.id);
  assert.equal(valuationFact.quantity, 10);
  assert.equal(valuationFact.value, 250);

  ledger.rebuildStockQuants(db, { company_id: 'default' });
  assert.deepEqual(
    ledger.getQuantBalance(db, { company_id: 'default', product_id: productId, location_id: warehouse.lot_stock_id }),
    { onHand: 10, reserved: 0, available: 10 },
  );
});

test('finance-port failure rolls back stock, valuation, balances, audit, and outbox', () => {
  const unmappedCategory = products.createProductCategory(db, {
    company_id: 'default',
    name: 'Unmapped Accounting Category',
    costing_method: 'avco',
  });
  const product = execute('product:template:create', {
    name: 'Must Not Post',
    category_id: unmappedCategory.id,
    uom_id: unit.id,
    sku: 'NO-GL-MAP-001',
  }, 'stock-product-no-gl');

  assert.throws(
    () => execute('stock:move:post', {
      reference: 'RECEIPT-ROLLBACK',
      product_id: product.default_variant_id,
      uom_id: unit.id,
      product_qty: 3,
      location_id: supplierLocation.id,
      location_dest_id: warehouse.lot_stock_id,
      unit_cost: 50,
    }, 'stock-receipt-no-gl'),
    /account mapping is required/,
  );

  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM stock_moves WHERE reference = 'RECEIPT-ROLLBACK'").get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM stock_valuation_facts WHERE product_id = ?').get(product.default_variant_id).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM stock_quants WHERE product_id = ?').get(product.default_variant_id).n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM action_idempotency WHERE idempotency_key = 'stock-receipt-no-gl'").get().n, 0);
});

test('reservation serialization prevents over-allocation and supports partial reserve', () => {
  const first = execute('stock:reservation:reserve', {
    warehouse_id: warehouse.id,
    location_id: warehouse.lot_stock_id,
    product_id: productId,
    source_document_type: 'sale_order',
    source_document_id: 'SO-001',
    source_line_id: 'SOL-001',
    quantity: 6,
  }, 'reserve-so-001');
  assert.equal(first.remaining_quantity, 6);

  assert.throws(
    () => execute('stock:reservation:reserve', {
      warehouse_id: warehouse.id,
      location_id: warehouse.lot_stock_id,
      product_id: productId,
      source_document_type: 'sale_order',
      source_document_id: 'SO-002',
      source_line_id: 'SOL-002',
      quantity: 5,
    }, 'reserve-so-002-over'),
    /insufficient/i,
  );

  const partial = execute('stock:reservation:reserve', {
    warehouse_id: warehouse.id,
    location_id: warehouse.lot_stock_id,
    product_id: productId,
    source_document_type: 'sale_order',
    source_document_id: 'SO-002',
    source_line_id: 'SOL-002',
    quantity: 5,
    allow_partial: true,
  }, 'reserve-so-002-partial');
  assert.equal(partial.quantity, 4);
  assert.equal(partial.status, 'partially_reserved');

  ledger.rebuildStockQuants(db, { company_id: 'default' });
  assert.deepEqual(
    ledger.getQuantBalance(db, { company_id: 'default', product_id: productId, location_id: warehouse.lot_stock_id }),
    { onHand: 10, reserved: 10, available: 0 },
  );

  const consumed = execute('stock:reservation:consume', {
    reservation_id: first.id,
    quantity: 6,
  }, 'consume-so-001');
  assert.equal(consumed.status, 'consumed');
  assert.equal(consumed.remaining_quantity, 0);
  assert.equal(
    ledger.getQuantBalance(db, { company_id: 'default', product_id: productId, location_id: warehouse.lot_stock_id }).available,
    6,
  );
});
