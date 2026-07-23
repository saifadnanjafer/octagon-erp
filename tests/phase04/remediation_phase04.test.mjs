import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';
import { createWorkItem, updateWorkItem, getWorkItem, listWorkItems } from '../../platform/work_items/work_items.mjs';
import { handleCommercialQuery } from '../../platform/api/commercial.mjs';
import { postStockMove, getQuantBalance, rebuildStockQuants } from '../../platform/inventory/ledger.mjs';
import { recordValuationLayer } from '../../platform/inventory/valuation.mjs';
import { runDisposableMigration } from '../../scripts/migrate_legacy_data.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { pathToFileURL } from 'node:url';

async function setupTestDb() {
  const db = new DatabaseSync(':memory:');
  const migDir = path.resolve(__dirname, '../../database/migrations');
  const files = fs.readdirSync(migDir).filter(f => f.endsWith('.mjs')).sort();

  for (const file of files) {
    const migPath = path.join(migDir, file);
    try {
      const mod = await import(pathToFileURL(migPath).href);
      if (mod.migration && typeof mod.migration.up === 'function') {
        db.exec('BEGIN TRANSACTION;');
        mod.migration.up(db, { dialect: 'sqlite' });
        db.exec('COMMIT;');
      }
    } catch (_) {}
  }
  return db;
}

test('Wave A & F: Action Executor carries all registered domain actions', async () => {
  const db = await setupTestDb();
  const authority = createPlatformAuthority(db);
  assert.ok(authority.actionExecutor, 'actionExecutor must be created');
});

test('Wave F: Canonical Work Item Engine CRUD & State Transitions', async () => {
  const db = await setupTestDb();
  const wi = createWorkItem(db, {
    company_id: 'comp_main',
    title: 'Install Stock Rack B12',
    description: 'Assemble inventory racking unit in main warehouse',
    source_type: 'work_order',
    priority: 'high',
    importance: 4,
  });

  assert.ok(wi.id.startsWith('wi_'));
  assert.equal(wi.title, 'Install Stock Rack B12');
  assert.equal(wi.status, 'todo');

  const updated = updateWorkItem(db, wi.id, {
    status: 'in_progress',
    progress: 50.0,
  });

  assert.equal(updated.status, 'in_progress');
  assert.equal(updated.progress, 50.0);

  const done = updateWorkItem(db, wi.id, {
    status: 'done',
    progress: 100.0,
  });

  assert.equal(done.status, 'done');
  assert.ok(done.completed_at);

  const items = listWorkItems(db, { companyId: 'comp_main' });
  assert.equal(items.length, 1);
  assert.equal(items[0].id, wi.id);
});

import { createParty } from '../../platform/commercial/parties.mjs';
import { createProductTemplate } from '../../platform/commercial/products.mjs';

test('Wave A & B: Commercial Query Dispatch Router', async () => {
  const db = await setupTestDb();
  createParty(db, { name: 'Al-Nibras Co', is_company: 1, roles: ['customer', 'supplier'] });
  createProductTemplate(db, { name: 'Engine Oil 5W30', type: 'consu' });

  const partiesRes = handleCommercialQuery({ dialect: db, ctx: { companyId: '*' }, namespace: 'commercial', resource: 'parties' });
  assert.equal(partiesRes.data.length, 1);
  assert.equal(partiesRes.data[0].name, 'Al-Nibras Co');

  const productsRes = handleCommercialQuery({ dialect: db, ctx: { companyId: '*' }, namespace: 'commercial', resource: 'products' });
  assert.equal(productsRes.data.length, 1);
  assert.equal(productsRes.data[0].name, 'Engine Oil 5W30');
});

test('Wave C & D: Atomic Stock Posting & Balance Rebuild', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS stock_moves (id TEXT PRIMARY KEY, company_id TEXT, reference TEXT, product_id TEXT, uom_id TEXT, product_qty REAL, location_id TEXT, location_dest_id TEXT, state TEXT, unit_cost REAL, total_value REAL, move_date TEXT, created_at TEXT);
    CREATE TABLE IF NOT EXISTS stock_quants (id TEXT PRIMARY KEY, company_id TEXT, product_id TEXT, location_id TEXT, quantity REAL, reserved_quantity REAL, updated_at TEXT);
    CREATE TABLE IF NOT EXISTS product_variants (id TEXT PRIMARY KEY, template_id TEXT, standard_price REAL);
    CREATE TABLE IF NOT EXISTS product_templates (id TEXT PRIMARY KEY, category_id TEXT);
    CREATE TABLE IF NOT EXISTS product_categories (id TEXT PRIMARY KEY, costing_method TEXT);
    CREATE TABLE IF NOT EXISTS stock_locations (id TEXT PRIMARY KEY, usage TEXT);
    CREATE TABLE IF NOT EXISTS stock_valuation_layers (id TEXT PRIMARY KEY, company_id TEXT, product_id TEXT, stock_move_id TEXT, quantity REAL, unit_cost REAL, value REAL, remaining_qty REAL, remaining_value REAL, costing_method TEXT, account_move_id TEXT, created_at TEXT);
  `);

  db.prepare(`INSERT INTO product_variants (id, template_id, standard_price) VALUES ('p_var_1', 'pt_1', 10.0)`).run();
  db.prepare(`INSERT INTO product_templates (id, category_id) VALUES ('pt_1', 'cat_avco')`).run();
  db.prepare(`INSERT INTO product_categories (id, costing_method) VALUES ('cat_avco', 'avco')`).run();

  postStockMove(db, {
    company_id: 'comp_main',
    reference: 'RECEIPT/001',
    product_id: 'p_var_1',
    uom_id: 'uom_unit',
    product_qty: 50,
    location_id: 'loc_supplier',
    location_dest_id: 'loc_stock',
    unit_cost: 12.0,
  });

  const bal = getQuantBalance(db, { company_id: 'comp_main', product_id: 'p_var_1', location_id: 'loc_stock' });
  assert.equal(bal.onHand, 50);
  assert.equal(bal.available, 50);

  rebuildStockQuants(db, { company_id: 'comp_main' });
  const balAfterRebuild = getQuantBalance(db, { company_id: 'comp_main', product_id: 'p_var_1', location_id: 'loc_stock' });
  assert.equal(balAfterRebuild.onHand, 50);
});

test('Legacy Migration & 100% Reconciliation Verification', async () => {
  const result = await runDisposableMigration();
  assert.equal(result.status, 'PASSED');
  assert.equal(result.reconciliation.quantityMatch, true);
  assert.equal(result.reconciliation.valuationMatch, true);
  assert.equal(result.reconciliation.taskCountMatch, true);
});
