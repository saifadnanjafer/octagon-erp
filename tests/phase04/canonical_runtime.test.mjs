import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';

let tempDir;
let dialect;
let authority;

const ctx = {
  tenantId: 'default',
  companyId: 'default',
  branchId: 'default',
  userId: 'phase04-runtime-test',
  sourceChannel: 'node-test',
};

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-phase04-runtime-'));
  const dbPath = path.join(tempDir, 'runtime.db');
  await freshInstall({
    dbPath,
    backupDir: path.join(tempDir, 'migration-backups'),
    actor: 'phase04-runtime-test',
  });
  dialect = openMigrationDatabase(dbPath);
  authority = createPlatformAuthority(dialect);
});

after(() => {
  try {
    dialect?.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('fresh install registers the complete Phase 04 action contract and live handlers', () => {
  const rows = dialect.prepare(`
    SELECT id, kind, required_permission, required_scope, input_schema,
           transaction_owner, idempotency_policy, audit_policy,
           outbox_policy, error_contract
    FROM platform_actions
    WHERE transaction_owner = 'platform_action_executor'
    ORDER BY id
  `).all();

  assert.equal(rows.length, 42);
  for (const row of rows) {
    assert.equal(row.kind, 'domain');
    assert.ok(row.required_permission);
    assert.equal(row.required_scope, 'company');
    assert.ok(row.input_schema);
    assert.equal(row.idempotency_policy, 'required');
    assert.equal(row.audit_policy, 'required');
    assert.equal(row.outbox_policy, 'required');
    assert.ok(row.error_contract);
    assert.equal(authority.actionExecutor.handlers.has(row.id), true, `missing handler for ${row.id}`);
  }
});

test('session scope overrides are rejected before a domain mutation', () => {
  assert.throws(
    () => authority.actionExecutor.execute('party:create', {
      name: 'Spoofed Party',
      company_id: 'other-company',
      idempotency_key: 'scope-spoof-company',
    }, ctx),
    (error) => error.code === 'UNTRUSTED_ACTION_SCOPE' && error.statusCode === 403,
  );
  assert.equal(
    dialect.prepare("SELECT COUNT(*) AS n FROM parties WHERE name = 'Spoofed Party'").get().n,
    0,
  );
});

test('canonical command is idempotent and emits one atomic audit/outbox pair', () => {
  const input = {
    name: 'Canonical Runtime Party',
    roles: ['customer', 'supplier'],
    idempotency_key: 'party-runtime-proof',
  };
  const first = authority.actionExecutor.execute('party:create', input, ctx);
  const replay = authority.actionExecutor.execute('party:create', input, ctx);

  assert.equal(replay.id, first.id);
  assert.equal(first.company_id, 'default');
  assert.equal(dialect.prepare('SELECT COUNT(*) AS n FROM parties WHERE id = ?').get(first.id).n, 1);
  assert.equal(dialect.prepare(`
    SELECT COUNT(*) AS n FROM platform_audit_log
    WHERE action = 'action.execute.party:create' AND resource_id = ?
  `).get(first.id).n, 1);
  assert.equal(dialect.prepare(`
    SELECT COUNT(*) AS n FROM platform_outbox
    WHERE event_type = 'action.execute' AND aggregate_id = ?
  `).get(`party:${first.id}`).n, 1);
});

test('injected outbox failure rolls back business data, audit, and idempotency', () => {
  dialect.exec(`
    CREATE TRIGGER phase04_fail_outbox
    BEFORE INSERT ON platform_outbox
    WHEN NEW.event_type = 'action.execute'
    BEGIN
      SELECT RAISE(ABORT, 'injected outbox failure');
    END;
  `);

  assert.throws(
    () => authority.actionExecutor.execute('party:create', {
      name: 'Must Roll Back',
      idempotency_key: 'party-runtime-failure',
    }, ctx),
    /injected outbox failure/,
  );

  assert.equal(dialect.prepare("SELECT COUNT(*) AS n FROM parties WHERE name = 'Must Roll Back'").get().n, 0);
  assert.equal(dialect.prepare("SELECT COUNT(*) AS n FROM action_idempotency WHERE idempotency_key = 'party-runtime-failure'").get().n, 0);
  assert.equal(dialect.prepare(`
    SELECT COUNT(*) AS n FROM platform_audit_log
    WHERE action = 'action.execute.party:create'
      AND after_value LIKE '%Must Roll Back%'
  `).get().n, 0);
  dialect.exec('DROP TRIGGER phase04_fail_outbox;');
});
