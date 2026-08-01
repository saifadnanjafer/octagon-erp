import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import test from 'node:test';
import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';

test('BUILD-03 registers one warranty authority and guarded case lifecycle', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-build03-warranty-'));
  try {
    const dbPath = path.join(dir, 'warranty.db'); await freshInstall({ dbPath, backupDir: path.join(dir, 'backups'), actor: 'build-03-test' });
    const db = openMigrationDatabase(dbPath);
    try {
      assert.ok(db.prepare("SELECT 1 FROM schema_migrations WHERE migration_id = '066_commercial_warranty_registry'").get());
      assert.deepEqual(db.prepare("SELECT id FROM platform_actions WHERE id LIKE 'sales:warranty:%' ORDER BY id").all().map((r) => r.id), ['sales:warranty:approve','sales:warranty:close','sales:warranty:create','sales:warranty:submit']);
      const executor = createPlatformAuthority(db).actionExecutor; const ctx = { companyId: 'default', branchId: 'default', userId: 'build-03-test', sourceChannel: 'node-test' };
      const exec = (action, input, key) => executor.execute(action, { ...input, idempotency_key: key }, ctx);
      const party = exec('party:create', { name: 'Warranty Customer', roles: ['customer'] }, 'build03-party');
      const now = new Date().toISOString(); const orderId = 'build03-order';
      db.prepare("INSERT INTO sale_orders (id,company_id,name,partner_id,state,amount_untaxed,amount_tax,amount_total,order_date,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(orderId, 'default', 'BUILD03', party.id, 'confirmed', 0, 0, 0, now.slice(0,10), now);
      const first = exec('sales:warranty:create', { sale_order_id: orderId, issue: 'Device failure' }, 'build03-warranty');
      const replay = exec('sales:warranty:create', { sale_order_id: orderId, issue: 'Device failure' }, 'build03-warranty');
      assert.equal(first.warranty.id, replay.warranty.id); exec('sales:warranty:submit', { warranty_id: first.warranty.id }, 'build03-submit'); exec('sales:warranty:approve', { warranty_id: first.warranty.id }, 'build03-approve');
      const closed = exec('sales:warranty:close', { warranty_id: first.warranty.id, resolution: 'Replacement authorized' }, 'build03-close'); assert.equal(closed.warranty.state, 'closed');
    } finally { db.close(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
