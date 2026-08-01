import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';

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
