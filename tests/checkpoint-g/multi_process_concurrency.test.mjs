// Checkpoint G — REAL multi-process concurrency.
//
// Closes Checkpoint F blocker H3. Checkpoint F only had single-process
// Promise.all contention, which the synchronous SQLite driver serialises inside
// one event loop — it proves the dedup branch is taken but proves nothing about
// two OS processes writing the same database file.
//
// Here every contender is a separate `node` process (tests/checkpoint-g/
// concurrency-worker.mjs) with its own database connection, released against a
// shared wall-clock barrier so they actually collide instead of queueing behind
// each other's module-load time.
//
// WHAT COUNTS AS A CORRECT OUTCOME. Under real contention SQLite may reject a
// writer with SQLITE_BUSY, and the domain engine may reject with an
// insufficient-stock or duplicate error. Both are *deterministic rejections*
// and are acceptable. What is NOT acceptable, and what these tests assert
// against, is: oversubscription (more reserved than exists), duplicate posting,
// a duplicated idempotency key, or a corrupted database. The tests therefore
// assert on final server facts, never on which process happened to win.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test, before, after } from 'node:test';

import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';
import { products, uom } from '../../platform/commercial/index.mjs';
import { ledger } from '../../platform/inventory/index.mjs';
import { setApprovalAuthorityLimit } from '../../platform/finance/engine.mjs';
import { createCanonicalCutoverController } from '../../platform/cutover/canonical-cutover-controller.mjs';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.join(__dirname, 'concurrency-worker.mjs');

const ON_HAND = 10;
const CONTENDERS = 4;
const RESERVE_EACH = 4; // 4 x 4 = 16 demanded against 10 on hand

let tempDir;
let dbPath;
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
  userId: 'ckg-concurrency-parent',
  sourceChannel: 'node-test',
};

const execute = (actionId, input, key) => executor.execute(actionId, { ...input, idempotency_key: key }, ctx);

// Run N worker processes released against a common barrier.
async function race(jobs) {
  const barrierAt = Date.now() + 900; // enough for `node` + ESM graph to load
  const runs = jobs.map((job) =>
    execFileAsync(process.execPath, [WORKER, JSON.stringify({ ...job, dbPath, barrierAt })], {
      timeout: 60_000,
      maxBuffer: 8 * 1024 * 1024,
    })
      .then(({ stdout }) => JSON.parse(stdout.trim().split('\n').filter(Boolean).pop()))
      .catch((err) => ({ ok: false, harnessError: String(err?.message || err).slice(0, 300) })),
  );
  return Promise.all(runs);
}

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-ckg-concurrency-'));
  dbPath = path.join(tempDir, 'concurrency.db');
  await freshInstall({ dbPath, backupDir: path.join(tempDir, 'backups'), actor: 'checkpoint-g' });
  db = openMigrationDatabase(dbPath);
  executor = createPlatformAuthority(db).actionExecutor;

  setApprovalAuthorityLimit(db, ctx, {
    role_or_user: ctx.userId, limit_type: 'post', max_amount: 1_000_000_000, currency: 'IQD',
  });

  // Cutover activated on this disposable database so concurrency is exercised
  // under the same enforcement the release candidate targets.
  createCanonicalCutoverController({
    dialect: db, dbPath,
    env: { OCTAGON_DISPOSABLE_FIXTURE: '1', OCTAGON_RUNTIME_MODE: 'test' },
  }).activateAll({ actor: 'checkpoint-g-concurrency' });

  warehouse = execute('warehouse:create', { name: 'Concurrency WH', code: 'CCWH' }, 'ckg-wh');
  supplierLocation = execute('stock:location:create', { name: 'Concurrency Supplier', usage: 'supplier' }, 'ckg-supplier');
  const uomCategory = uom.createUomCategory(db, { name: 'CKG Units' });
  unit = uom.createUom(db, { category_id: uomCategory.id, name: 'Piece', symbol: 'pc' });
  const productCategory = products.createProductCategory(db, {
    company_id: 'default', name: 'CKG Parts', costing_method: 'avco',
    stock_account_id: 'acc_104000', stock_input_account_id: 'acc_201000',
    stock_output_account_id: 'acc_500000', expense_account_id: 'acc_501000',
  });
  const product = execute('product:template:create', {
    name: 'CKG Part', category_id: productCategory.id, uom_id: unit.id, sku: 'CKG-PART-001',
  }, 'ckg-product');
  productId = product.default_variant_id;

  execute('stock:move:post', {
    reference: 'CKG-RECEIPT', product_id: productId, uom_id: unit.id, product_qty: ON_HAND,
    location_id: supplierLocation.id, location_dest_id: warehouse.lot_stock_id, unit_cost: 25,
    source_document_type: 'inventory_adjustment', source_document_id: 'CKG-OPEN',
    source_line_id: 'CKG-OPEN-1',
  }, 'ckg-receipt');

  db.close(); // release the parent handle so workers contend with each other
});

after(() => {
  try { db?.close(); } catch {}
  if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------

test('the workers really are separate OS processes', async () => {
  const results = await race(
    Array.from({ length: CONTENDERS }, (_, i) => ({
      actionId: 'party:create',
      input: { company_id: 'default', name: `Proc Probe ${i}`, legal_name: `Proc Probe ${i}`, roles: ['customer'] },
      idempotencyKey: `ckg_pid_probe_${i}`,
    })),
  );

  const pids = new Set(results.map((r) => r.pid).filter(Boolean));
  assert.equal(pids.size, CONTENDERS, `expected ${CONTENDERS} distinct pids, saw ${[...pids].join(',')}`);
  assert.ok(![...pids].includes(process.pid), 'a worker ran inside the parent process');
});

test('simultaneous stock reservation does not oversubscribe across processes', async () => {
  const results = await race(
    Array.from({ length: CONTENDERS }, (_, i) => ({
      actionId: 'stock:reservation:reserve',
      input: {
        warehouse_id: warehouse.id,
        location_id: warehouse.lot_stock_id,
        product_id: productId,
        source_document_type: 'sale_order',
        source_document_id: `CKG-SO-${i}`,
        source_line_id: `CKG-SOL-${i}`,
        quantity: RESERVE_EACH,
      },
      idempotencyKey: `ckg_reserve_${i}`,
    })),
  );

  const winners = results.filter((r) => r.ok);
  const losers = results.filter((r) => !r.ok);

  // Demand (16) exceeds supply (10), so somebody must lose.
  assert.ok(winners.length >= 1, `no process succeeded: ${JSON.stringify(results)}`);
  assert.ok(losers.length >= 1, 'every process won despite demand exceeding on-hand stock');
  assert.equal(
    losers.filter((r) => r.harnessError).length, 0,
    `harness (not domain) errors occurred: ${JSON.stringify(losers.filter((r) => r.harnessError))}`,
  );

  // The assertion that matters: the server-side balance, not who won.
  const check = openMigrationDatabase(dbPath);
  try {
    const balance = ledger.getQuantBalance(check, {
      company_id: 'default', product_id: productId, location_id: warehouse.lot_stock_id,
    });
    assert.equal(balance.onHand, ON_HAND, 'on-hand quantity changed during a reservation race');
    assert.ok(
      balance.reserved <= ON_HAND,
      `OVERSUBSCRIPTION: reserved ${balance.reserved} exceeds on-hand ${ON_HAND}`,
    );
    assert.ok(balance.available >= 0, `available went negative: ${balance.available}`);
    assert.equal(balance.reserved + balance.available, ON_HAND, 'reserved + available no longer equals on-hand');
  } finally {
    check.close();
  }
});

test('a repeated idempotency key across separate processes creates exactly one record', async () => {
  const key = 'ckg_cross_process_idem';
  const input = {
    company_id: 'default', name: 'Cross Process Party', legal_name: 'Cross Process Party', roles: ['customer'],
  };

  const results = await race(
    Array.from({ length: CONTENDERS }, () => ({ actionId: 'party:create', input, idempotencyKey: key })),
  );

  assert.equal(results.filter((r) => r.harnessError).length, 0, 'harness errors during the idempotency race');

  const check = openMigrationDatabase(dbPath);
  try {
    const rows = check.prepare('SELECT COUNT(*) AS c FROM parties WHERE legal_name = ?').get('Cross Process Party').c;
    assert.equal(rows, 1, `DUPLICATE POSTING: ${rows} parties created for one idempotency key across ${CONTENDERS} processes`);

    const ledgerRows = check.prepare('SELECT COUNT(*) AS c FROM action_idempotency WHERE idempotency_key = ?').get(key).c;
    assert.equal(ledgerRows, 1, `idempotency ledger holds ${ledgerRows} rows for one key`);

    // Every process that succeeded must have been handed the same record.
    const ids = new Set(results.filter((r) => r.ok && r.resultId).map((r) => r.resultId));
    assert.ok(ids.size <= 1, `processes received ${ids.size} different record ids for one idempotency key`);
  } finally {
    check.close();
  }
});

test('duplicate creation of the same warehouse code across processes yields one winner', async () => {
  const results = await race(
    Array.from({ length: CONTENDERS }, (_, i) => ({
      actionId: 'warehouse:create',
      input: { name: 'Race Warehouse', code: 'RACEWH' },
      idempotencyKey: `ckg_wh_race_${i}`, // distinct keys — genuine duplicate attempt
    })),
  );

  assert.equal(results.filter((r) => r.harnessError).length, 0, 'harness errors during the warehouse race');

  const check = openMigrationDatabase(dbPath);
  try {
    const rows = check.prepare('SELECT COUNT(*) AS c FROM warehouses WHERE code = ?').get('RACEWH').c;
    assert.ok(rows <= 1, `DUPLICATE POSTING: ${rows} warehouses created with code RACEWH`);
  } finally {
    check.close();
  }
});

test('the database is consistent and readable after all races', async () => {
  const check = openMigrationDatabase(dbPath);
  try {
    const integrity = check.prepare('PRAGMA integrity_check').get();
    const value = integrity ? Object.values(integrity)[0] : null;
    assert.equal(value, 'ok', `database integrity check failed: ${JSON.stringify(integrity)}`);

    // No deadlock residue: reservations must still reconcile to the quant.
    const balance = ledger.getQuantBalance(check, {
      company_id: 'default', product_id: productId, location_id: warehouse.lot_stock_id,
    });
    assert.equal(balance.reserved + balance.available, balance.onHand, 'quant no longer reconciles after concurrency');
  } finally {
    check.close();
  }
});
