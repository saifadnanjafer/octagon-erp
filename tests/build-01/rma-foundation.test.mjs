import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';
import { products, uom } from '../../platform/commercial/index.mjs';
import { setApprovalAuthorityLimit } from '../../platform/finance/engine.mjs';

test('BUILD-01 migration registers RMA case authority on a disposable database', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-build01-rma-'));
  const dbPath = path.join(dir, 'rma.db');
  try {
    await freshInstall({ dbPath, backupDir: path.join(dir, 'backups'), actor: 'build-01-test' });
    const db = openMigrationDatabase(dbPath);
    try {
      assert.ok(db.prepare("SELECT 1 FROM schema_migrations WHERE migration_id = '064_commercial_rma_foundation'").get());
      assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='commercial_rma_cases'").get());
      assert.deepEqual(
        db.prepare("SELECT id FROM platform_actions WHERE id LIKE 'sales:rma:%' ORDER BY id").all().map((row) => row.id),
        ['sales:rma:approve', 'sales:rma:create', 'sales:rma:post_return', 'sales:rma:submit'],
      );
    } finally { db.close(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('BUILD-01 RMA lifecycle delegates the posted return to sales authority', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-build01-flow-'));
  const dbPath = path.join(dir, 'flow.db');
  try {
    await freshInstall({ dbPath, backupDir: path.join(dir, 'backups'), actor: 'build-01-flow' });
    const db = openMigrationDatabase(dbPath);
    try {
      const executor = createPlatformAuthority(db).actionExecutor;
      const ctx = { companyId: 'default', branchId: 'default', userId: 'build-01-flow', sourceChannel: 'node-test' };
      let seq = 0;
      const exec = (action, input) => executor.execute(action, { ...input, idempotency_key: `${action}-${++seq}` }, ctx);
      setApprovalAuthorityLimit(db, ctx, { role_or_user: ctx.userId, limit_type: 'post', max_amount: 1_000_000_000 });
      const warehouse = exec('warehouse:create', { name: 'RMA Warehouse', code: 'RMA01' });
      const supplier = exec('stock:location:create', { name: 'RMA Supplier', usage: 'supplier' });
      const customer = exec('party:create', { name: 'RMA Customer', roles: ['customer'] });
      const category = products.createProductCategory(db, { company_id: 'default', name: 'RMA Goods', costing_method: 'avco', income_account_id: 'acc_401000', expense_account_id: 'acc_501000', stock_account_id: 'acc_104000', stock_input_account_id: 'acc_201000', stock_output_account_id: 'acc_500000' });
      const unit = uom.createUom(db, { category_id: uom.createUomCategory(db, { name: 'RMA Units' }).id, name: 'RMA Piece' });
      const product = exec('product:template:create', { name: 'RMA Product', category_id: category.id, uom_id: unit.id, list_price: 100, standard_price: 40, sku: 'RMA-SKU' });
      exec('stock:move:post', { reference: 'RMA-OPEN', product_id: product.default_variant_id, uom_id: unit.id, product_qty: 5, location_id: supplier.id, location_dest_id: warehouse.lot_stock_id, unit_cost: 40, source_document_type: 'inventory_adjustment', source_document_id: 'RMA-OPEN' });
      const quote = exec('sales:quotation:create', { partner_id: customer.id, lines: [{ product_id: product.default_variant_id, product_uom_qty: 2, price_unit: 100 }] });
      exec('sales:quotation:submit', { order_id: quote.id });
      exec('sales:quotation:approve', { order_id: quote.id });
      exec('sales:quotation:accept', { order_id: quote.id });
      const confirmed = exec('sales:order:confirm', { order_id: quote.id, warehouse_id: warehouse.id });
      const lineId = quote.lines[0].id;
      exec('sales:delivery:post', { order_id: quote.id, picking_id: confirmed.delivery_picking_id, lines: [{ sale_order_line_id: lineId, quantity: 1 }] });
      const rma = exec('sales:rma:create', { order_id: quote.id, reason: 'defective', lines: [{ sale_order_line_id: lineId, quantity: 1 }] });
      exec('sales:rma:submit', { rma_id: rma.rma.id });
      exec('sales:rma:approve', { rma_id: rma.rma.id });
      const posted = exec('sales:rma:post_return', { rma_id: rma.rma.id, warehouse_id: warehouse.id });
      assert.equal(posted.rma.state, 'returned');
      assert.equal(posted.sale_return.sale_return.state, 'done');
      assert.equal(posted.sale_return.lines.length, 1);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sale_returns WHERE sale_order_id = ?').get(quote.id).n, 1);
    } finally { db.close(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
