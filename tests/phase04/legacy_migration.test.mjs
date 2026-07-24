import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { freshInstall } from '../../database/migration-runner/index.mjs';
import { runDisposableMigration } from '../../scripts/migrate_legacy_data.mjs';

test('disposable legacy migration preserves source, maps masters, and blocks invented stock lineage', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-phase04-legacy-test-'));
  const source = path.join(tempDir, 'source.db');
  const target = path.join(tempDir, 'target.db');
  try {
    await freshInstall({
      dbPath: source,
      backupDir: path.join(tempDir, 'backups'),
      actor: 'phase04-legacy-test',
    });
    const db = new DatabaseSync(source);
    const collectionInsert = db.prepare(`
      INSERT INTO collections (collection, id, data) VALUES (?, ?, ?)
    `);
    collectionInsert.run('finance.customers', 'cust_source', JSON.stringify({
      id: 'cust_source',
      name: 'عميل مصدر',
      phone: '000',
    }));
    collectionInsert.run('omni.suppliers', 'sup_source', JSON.stringify({
      id: 'sup_source',
      name: 'مورد مصدر',
      catalog: [{ materialId: 'mat_source', negotiatedPrice: 2500 }],
    }));
    collectionInsert.run('omni.warehouses', 'WH_SOURCE', JSON.stringify({
      id: 'WH_SOURCE',
      companyId: 'default',
      code: 'SOURCE',
      nameAr: 'مخزن المصدر',
    }));
    collectionInsert.run('locations', 'LOC_SOURCE', JSON.stringify({
      id: 'LOC_SOURCE',
      name: 'موقع المصدر',
      type: 'internal',
    }));
    collectionInsert.run('omni.materials', 'mat_source', JSON.stringify({
      id: 'mat_source',
      name: 'مادة مصدر',
      category: 'خام',
      unit: 'قطعة',
      stock: 10,
      cost: 2500,
      reservedQty: 3,
      reservations: [],
      movements: [],
    }));
    db.prepare(`
      INSERT INTO metadata (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run('omni.taskManager', JSON.stringify({
      spaces: [{
        id: 'space',
        name: 'مساحة',
        departments: [{
          id: 'department',
          name: 'ورشة',
          sections: [{
            id: 'section',
            name: 'تنفيذ',
            taskTypes: [{
              id: 'type',
              name: 'عمل',
              tasks: [{ id: 'task_source', title: 'مهمة مصدر', status: 'todo' }],
            }],
          }],
        }],
      }],
    }));
    db.prepare(`
      INSERT INTO metadata (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run('omni.kanban', JSON.stringify({ cards: [] }));
    db.prepare(`
      INSERT INTO metadata (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run('omni.warehouseStock', JSON.stringify({ mat_source: { LOC_SOURCE: 10 } }));
    db.close();

    const sourceBefore = fs.readFileSync(source);
    const result = await runDisposableMigration({
      sourceDbPath: source,
      targetDbPath: target,
      keepDisposable: true,
    });
    const sourceAfter = fs.readFileSync(source);

    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.source.unchanged, true);
    assert.deepEqual(sourceAfter, sourceBefore);
    assert.equal(result.idempotentRerun, true);
    assert.equal(result.rollbackVerified, true);
    assert.equal(result.reconciliation.parties.match, true);
    assert.equal(result.reconciliation.products.match, true);
    assert.equal(result.reconciliation.workItems.match, true);
    assert.equal(result.reconciliation.quantity.match, false);
    assert.equal(result.reconciliation.reservations.match, false);
    assert.equal(result.reconciliation.valuation.match, false);
    assert.equal(result.reconciliation.stockToGl.match, false);
    assert.equal(result.openQuarantine, 2);

    const migrated = new DatabaseSync(target, { readOnly: true });
    assert.equal(migrated.prepare("SELECT COUNT(*) AS n FROM parties WHERE company_id = 'default' AND id IN ('cust_source','sup_source')").get().n, 2);
    assert.equal(migrated.prepare("SELECT COUNT(*) AS n FROM product_variants WHERE id = 'mat_source'").get().n, 1);
    assert.equal(migrated.prepare("SELECT COUNT(*) AS n FROM work_items WHERE source_id = 'task_source'").get().n, 1);
    assert.equal(migrated.prepare("SELECT COUNT(*) AS n FROM stock_moves WHERE company_id = 'default'").get().n, 0);
    assert.equal(migrated.prepare("SELECT COUNT(*) AS n FROM stock_quants WHERE company_id = 'default'").get().n, 0);
    const reasons = migrated.prepare(`
      SELECT reason_code FROM phase04_legacy_quarantine ORDER BY reason_code
    `).all().map((row) => row.reason_code);
    assert.deepEqual(reasons, ['OPENING_STOCK_GL_POLICY_REQUIRED', 'RESERVATION_LINEAGE_MISSING']);
    migrated.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
