import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';
import * as contracts from '../../platform/sales/contracts.mjs';

test('BUILD-02 registers one canonical contract authority and guarded lifecycle', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-build02-contract-'));
  try {
    const dbPath = path.join(dir, 'contracts.db');
    await freshInstall({ dbPath, backupDir: path.join(dir, 'backups'), actor: 'build-02-test' });
    const db = openMigrationDatabase(dbPath);
    try {
      assert.ok(db.prepare("SELECT 1 FROM schema_migrations WHERE migration_id = '065_commercial_contract_authority'").get());
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='contracts'").get().n, 0);
      assert.deepEqual(db.prepare("SELECT id FROM platform_actions WHERE id LIKE 'sales:contract:%' ORDER BY id").all().map((r) => r.id), ['sales:contract:activate', 'sales:contract:create', 'sales:contract:suspend', 'sales:contract:terminate']);
      const executor = createPlatformAuthority(db).actionExecutor;
      const ctx = { companyId: 'default', branchId: 'default', userId: 'build-02-test', sourceChannel: 'node-test' };
      const exec = (action, input, key) => executor.execute(action, { ...input, idempotency_key: key || `${action}-${Math.random()}` }, ctx);
      const party = exec('party:create', { name: 'Contract Customer', roles: ['customer'] }, 'party-contract');
      const first = contracts.createContract(db, { company_id: 'default', name: 'Annual Support', partner_id: party.id, recurring_amount: 1000, idempotency_key: 'contract-1' });
      const replay = contracts.createContract(db, { company_id: 'default', name: 'Changed Name', partner_id: party.id, idempotency_key: 'contract-1' });
      assert.equal(first.contract.id, replay.contract.id);
      assert.equal(replay.replay, true);
      exec('sales:contract:activate', { contract_id: first.contract.id }, 'contract-activate');
      exec('sales:contract:suspend', { contract_id: first.contract.id }, 'contract-suspend');
      const terminated = exec('sales:contract:terminate', { contract_id: first.contract.id }, 'contract-terminate');
      assert.equal(terminated.contract.state, 'terminated');
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sale_contracts').get().n, 1);
    } finally { db.close(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
