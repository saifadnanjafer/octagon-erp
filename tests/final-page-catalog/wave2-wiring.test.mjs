// tests/final-page-catalog/wave2-wiring.test.mjs
//
// Proves the Final Page Catalog foundation: the 16 Wave 2 domains are actually
// connected — action definitions exist, handlers execute, and every governed
// read is company-scoped, whitelisted, and secret-redacted.
//
// Runs entirely against a disposable database created under the OS temp dir.
// It never opens the operational database.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createActionExecutor } from '../../platform/kernel/actions/index.mjs';
import {
  registerWave2Actions,
  ensureWave2ActionDefinitions,
  verifyWave2ServiceBindings,
} from '../../platform/domains/wave2-actions.mjs';
import {
  WAVE2_DOMAINS, allActions, allPermissions, buildQueryIndex, REDACTED_COLUMNS,
} from '../../platform/domains/wave2-registry.mjs';
import { handleWave2Query, WAVE2_NAMESPACES, wave2ReadPermission } from '../../platform/api/wave2.mjs';
import { WAVE2_MODULES, WAVE2_PERMISSIONS } from '../../database/migrations/083_final_page_catalog_registry.mjs';

const COMPANY = 'company-alpha';
const OTHER_COMPANY = 'company-beta';
const USER = 'user-fpc-test';

function tmpPath(name) {
  return path.join(os.tmpdir(), `octagon-fpc-${name}-${Date.now()}-${process.pid}.db`);
}

async function setup(name) {
  const dbPath = tmpPath(name);
  await freshInstall({ dbPath });
  const db = openMigrationDatabase(dbPath);
  return { db, dbPath };
}

/**
 * Enable a Wave 2 module for execution.
 *
 * Migration 083 registers modules as 'installed', never 'enabled' — enabling is
 * a control-plane decision (Module & Pack Center), not a migration decision.
 * Tests that execute an action must therefore enable the module first, exactly
 * as an administrator would.
 */
function enableModule(db, moduleId) {
  db.prepare("UPDATE platform_modules SET status = 'enabled', updated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), moduleId);
}

function cleanup(env) {
  try { env.db.close(); } catch (_) { /* already closed */ }
  for (const suffix of ['', '-wal', '-shm']) {
    try { if (fs.existsSync(env.dbPath + suffix)) fs.unlinkSync(env.dbPath + suffix); } catch (_) { /* best effort */ }
  }
}

// ---------------------------------------------------------------------------
// 1. Registry integrity
// ---------------------------------------------------------------------------

test('1. every declared Wave 2 action resolves to a real service function', () => {
  const broken = verifyWave2ServiceBindings();
  assert.deepEqual(broken, [], `broken service bindings: ${JSON.stringify(broken)}`);
});

test('2. all 16 Wave 2 domains are declared with actions and queries', () => {
  assert.equal(WAVE2_DOMAINS.length, 16);
  for (const domain of WAVE2_DOMAINS) {
    assert.ok(domain.actions.length > 0, `${domain.key} declares no actions`);
    assert.ok(domain.queries.length > 0, `${domain.key} declares no queries`);
    assert.ok(domain.permissions.length > 0, `${domain.key} declares no permissions`);
    assert.ok(domain.module.id, `${domain.key} has no module id`);
  }
});

test('3. action ids are unique and match the kernel id grammar', () => {
  const seen = new Set();
  const grammar = /^[a-z][a-z0-9_]*(?::[a-z][a-z0-9_]*)+$/;
  for (const action of allActions()) {
    assert.ok(grammar.test(action.id), `action id rejected by kernel grammar: ${action.id}`);
    assert.ok(!seen.has(action.id), `duplicate action id: ${action.id}`);
    seen.add(action.id);
  }
  assert.ok(seen.size >= 100, `expected the full Wave 2 action surface, got ${seen.size}`);
});

test('4. query resource keys are unique across all domains', () => {
  const index = buildQueryIndex();
  const declared = WAVE2_DOMAINS.reduce((n, d) => n + d.queries.length, 0);
  assert.equal(index.size, declared, 'a query resource key collided');
});

test('5. migration 083 module list matches the runtime registry', () => {
  const migrationIds = new Set(WAVE2_MODULES.map((m) => m.id));
  const runtimeIds = new Set(WAVE2_DOMAINS.map((d) => d.module.id));
  assert.equal(migrationIds.size, 16);
  for (const id of runtimeIds) {
    assert.ok(migrationIds.has(id), `module ${id} is in the runtime registry but not migration 083`);
  }
  for (const id of migrationIds) {
    assert.ok(runtimeIds.has(id), `module ${id} is in migration 083 but not the runtime registry`);
  }
});

test('6. migration 083 permission list matches the runtime registry', () => {
  const migrationPerms = new Set(Object.values(WAVE2_PERMISSIONS).flat());
  for (const permission of allPermissions()) {
    assert.ok(
      migrationPerms.has(permission.id),
      `permission ${permission.id} is declared at runtime but never registered by migration 083`,
    );
  }
});

// ---------------------------------------------------------------------------
// 2. Control-plane registration (migration 083)
// ---------------------------------------------------------------------------

test('7. migration 083 registers all 16 modules, their permissions and platform_pages', async () => {
  const env = await setup('registry');
  try {
    const modules = env.db.prepare(
      `SELECT id, status FROM platform_modules WHERE id IN (${WAVE2_MODULES.map(() => '?').join(',')})`,
    ).all(...WAVE2_MODULES.map((m) => m.id));
    assert.equal(modules.length, 16, 'all 16 Wave 2 modules must have a platform_modules row');
    for (const row of modules) {
      assert.equal(row.status, 'installed', `${row.id} should be installed, not enabled, by a migration`);
    }

    const expansion = env.db.prepare("SELECT COUNT(*) n FROM module_expansion_registry WHERE wave = 'wave-2'").get();
    assert.equal(expansion.n, 16);

    const wanted = Object.values(WAVE2_PERMISSIONS).flat();
    const have = new Set(env.db.prepare('SELECT id FROM authorization_permissions').all().map((r) => r.id));
    const missing = wanted.filter((id) => !have.has(id));
    assert.deepEqual(missing, [], `unregistered Wave 2 permissions: ${missing.join(', ')}`);

    const pages = env.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='platform_pages'").get();
    assert.ok(pages, 'platform_pages registry table must exist');
  } finally {
    cleanup(env);
  }
});

test('8. migration 083 is idempotent', async () => {
  const env = await setup('idempotent');
  try {
    const { migration } = await import('../../database/migrations/083_final_page_catalog_registry.mjs');
    await migration.up(env.db);
    await migration.up(env.db);
    const n = env.db.prepare("SELECT COUNT(*) n FROM module_expansion_registry WHERE wave='wave-2'").get().n;
    assert.equal(n, 16, 're-running 083 must not duplicate module rows');
  } finally {
    cleanup(env);
  }
});

// ---------------------------------------------------------------------------
// 3. Action registration + execution
// ---------------------------------------------------------------------------

test('9. every Wave 2 action gets a platform_actions definition row', async () => {
  const env = await setup('actiondefs');
  try {
    const written = ensureWave2ActionDefinitions(env.db);
    assert.ok(written >= 100, `expected the full action surface, wrote ${written}`);

    for (const action of allActions()) {
      const row = env.db.prepare('SELECT * FROM platform_actions WHERE id = ?').get(action.id);
      assert.ok(row, `no platform_actions row for ${action.id}`);
      assert.equal(row.required_permission, action.permission);
      assert.equal(row.module_id, action.moduleId);
      assert.equal(row.required_scope, 'company');
      assert.equal(row.idempotency_policy, 'required');
      assert.equal(row.audit_policy, 'required');
    }
  } finally {
    cleanup(env);
  }
});

test('10. a Wave 2 action executes through the canonical ActionExecutor', async () => {
  const env = await setup('exec');
  try {
    enableModule(env.db, 'treasury');
    const executor = createActionExecutor(env.db);
    const registered = registerWave2Actions(executor);
    assert.ok(registered >= 100, `expected all handlers registered, got ${registered}`);

    const ctx = { companyId: COMPANY, userId: USER, branchId: null, permissions: ['*'] };
    const result = executor.execute('treasury:bank_account_create', {
      account_number: 'IQ-TEST-0001',
      bank_name: 'Test Bank of Baghdad',
      gl_account_code: '1010',
      idempotency_key: 'fpc-test-bank-1',
    }, ctx);

    assert.ok(result, 'action returned nothing');
    const stored = env.db.prepare('SELECT * FROM bank_accounts WHERE account_number = ?').get('IQ-TEST-0001');
    assert.ok(stored, 'the action did not write a canonical fact');
    assert.equal(stored.company_id, COMPANY, 'company scope must come from the session, not the payload');
  } finally {
    cleanup(env);
  }
});

test('11. an action refuses a payload that asserts a different company', async () => {
  const env = await setup('scope');
  try {
    enableModule(env.db, 'treasury');
    const executor = createActionExecutor(env.db);
    registerWave2Actions(executor);
    const ctx = { companyId: COMPANY, userId: USER, branchId: null, permissions: ['*'] };

    assert.throws(
      () => executor.execute('treasury:bank_account_create', {
        company_id: OTHER_COMPANY,
        account_number: 'IQ-SPOOF-0001',
        bank_name: 'Spoof Bank',
        gl_account_code: '1010',
        idempotency_key: 'fpc-test-spoof-1',
      }, ctx),
      (error) => /UNTRUSTED_ACTION_SCOPE|company scope/i.test(String(error && error.message)),
      'a body-supplied company_id must be refused, not honoured',
    );

    const leaked = env.db.prepare('SELECT * FROM bank_accounts WHERE account_number = ?').get('IQ-SPOOF-0001');
    assert.equal(leaked, undefined, 'the refused action must not have written anything');
  } finally {
    cleanup(env);
  }
});

// ---------------------------------------------------------------------------
// 4. Governed reads
// ---------------------------------------------------------------------------

test('12. a governed read returns only the session company rows', async () => {
  const env = await setup('read');
  try {
    enableModule(env.db, 'treasury');
    const executor = createActionExecutor(env.db);
    registerWave2Actions(executor);
    const now = new Date().toISOString();

    env.db.prepare(`
      INSERT INTO bank_accounts (id, company_id, account_number, bank_name, currency, gl_account_code, current_balance, is_active, created_at, updated_at)
      VALUES ('bnk-a', ?, 'ACC-A', 'Bank A', 'IQD', '1010', 100, 1, ?, ?)
    `).run(COMPANY, now, now);
    env.db.prepare(`
      INSERT INTO bank_accounts (id, company_id, account_number, bank_name, currency, gl_account_code, current_balance, is_active, created_at, updated_at)
      VALUES ('bnk-b', ?, 'ACC-B', 'Bank B', 'IQD', '1010', 200, 1, ?, ?)
    `).run(OTHER_COMPANY, now, now);

    const mine = handleWave2Query({
      dialect: env.db, ctx: { companyId: COMPANY }, namespace: 'treasury', resource: 'bank-accounts', query: {},
    });
    assert.equal(mine.error, undefined);
    assert.equal(mine.data.length, 1, 'cross-company rows leaked into a governed read');
    assert.equal(mine.data[0].id, 'bnk-a');

    const theirs = handleWave2Query({
      dialect: env.db, ctx: { companyId: OTHER_COMPANY }, namespace: 'treasury', resource: 'bank-accounts', query: {},
    });
    assert.equal(theirs.data.length, 1);
    assert.equal(theirs.data[0].id, 'bnk-b');
  } finally {
    cleanup(env);
  }
});

test('13. an undeclared filter is ignored, not injected', async () => {
  const env = await setup('filter');
  try {
    const now = new Date().toISOString();
    env.db.prepare(`
      INSERT INTO bank_accounts (id, company_id, account_number, bank_name, currency, gl_account_code, current_balance, is_active, created_at, updated_at)
      VALUES ('bnk-f', ?, 'ACC-F', 'Bank F', 'IQD', '1010', 100, 1, ?, ?)
    `).run(COMPANY, now, now);

    // `bank_name` is NOT a declared filter for this resource, and the value is
    // a SQL fragment. It must be ignored entirely.
    const result = handleWave2Query({
      dialect: env.db,
      ctx: { companyId: COMPANY },
      namespace: 'treasury',
      resource: 'bank-accounts',
      query: { bank_name: "x' OR '1'='1", is_active: '1' },
    });
    assert.equal(result.error, undefined, 'an undeclared filter must not raise');
    assert.equal(result.data.length, 1, 'the declared filter should still apply');
  } finally {
    cleanup(env);
  }
});

test('14. secret columns are redacted from every governed read', async () => {
  const env = await setup('redact');
  try {
    const now = new Date().toISOString();
    env.db.prepare(`
      INSERT INTO api_keys (id, company_id, key_number, client_name, key_prefix, key_hash, scopes, rate_limit_quota, status, created_at)
      VALUES ('key-1', ?, 'KEY-0001', 'Test Client', 'oct_live_', 'THIS-IS-THE-SECRET-HASH', '[]', 1000, 'active', ?)
    `).run(COMPANY, now);

    const result = handleWave2Query({
      dialect: env.db, ctx: { companyId: COMPANY }, namespace: 'integration', resource: 'api-keys', query: {},
    });
    assert.equal(result.data.length, 1);
    assert.equal(result.data[0].key_hash, null, 'key_hash must never leave the server');
    assert.equal(result.data[0].key_prefix, 'oct_live_', 'the displayable prefix should survive');
    assert.ok(REDACTED_COLUMNS.includes('key_hash'));
  } finally {
    cleanup(env);
  }
});

test('15. a parent-scoped resource cannot read another company rows', async () => {
  const env = await setup('parentscope');
  try {
    const now = new Date().toISOString();
    // contracts.type_id is a foreign key into contract_types.
    for (const company of [COMPANY, OTHER_COMPANY]) {
      env.db.prepare(`
        INSERT INTO contract_types (id, company_id, code, name_ar, name_en, category, requires_approval, default_notice_period_days, is_active, created_at, updated_at)
        VALUES (?, ?, 'FPC-TEST', 'نوع اختبار', 'Test Type', 'service', 0, 30, 1, ?, ?)
      `).run(`type-${company}`, company, now, now);
    }
    env.db.prepare(`
      INSERT INTO contracts (id, company_id, contract_number, title_ar, title_en, type_id, owner_user_id, status, contract_value, version, created_by, updated_by, created_at, updated_at)
      VALUES ('cnt-a', ?, 'CNT-A', 'عقد أ', 'Contract A', ?, ?, 'draft', 0, 1, ?, ?, ?, ?)
    `).run(COMPANY, `type-${COMPANY}`, USER, USER, USER, now, now);
    env.db.prepare(`
      INSERT INTO contracts (id, company_id, contract_number, title_ar, title_en, type_id, owner_user_id, status, contract_value, version, created_by, updated_by, created_at, updated_at)
      VALUES ('cnt-b', ?, 'CNT-B', 'عقد ب', 'Contract B', ?, ?, 'draft', 0, 1, ?, ?, ?, ?)
    `).run(OTHER_COMPANY, `type-${OTHER_COMPANY}`, USER, USER, USER, now, now);

    env.db.prepare(`
      INSERT INTO contract_milestones (id, contract_id, title_ar, title_en, due_date, amount, status, created_at)
      VALUES ('ms-a', 'cnt-a', 'مرحلة أ', 'Milestone A', '2026-09-01', 500, 'pending', ?)
    `).run(now);
    env.db.prepare(`
      INSERT INTO contract_milestones (id, contract_id, title_ar, title_en, due_date, amount, status, created_at)
      VALUES ('ms-b', 'cnt-b', 'مرحلة ب', 'Milestone B', '2026-09-01', 900, 'pending', ?)
    `).run(now);

    // contract_milestones has no company_id; it is scoped through its parent.
    const result = handleWave2Query({
      dialect: env.db, ctx: { companyId: COMPANY }, namespace: 'contracts', resource: 'milestones', query: {},
    });
    assert.equal(result.data.length, 1, 'parent scoping failed — another company milestone leaked');
    assert.equal(result.data[0].id, 'ms-a');
  } finally {
    cleanup(env);
  }
});

test('16. a read without company scope is refused', async () => {
  const env = await setup('noscope');
  try {
    const result = handleWave2Query({
      dialect: env.db, ctx: {}, namespace: 'treasury', resource: 'bank-accounts', query: {},
    });
    assert.equal(result.status, 403);
    assert.match(result.error, /COMPANY_SCOPE_REQUIRED/);
  } finally {
    cleanup(env);
  }
});

test('17. global reference data is readable without a company', async () => {
  const env = await setup('global');
  try {
    const result = handleWave2Query({
      dialect: env.db, ctx: {}, namespace: 'iraq_localization', resource: 'governorates', query: {},
    });
    assert.equal(result.error, undefined, 'reference lookups must not require a company');
    assert.ok(Array.isArray(result.data));
  } finally {
    cleanup(env);
  }
});

test('18. an unknown resource is a 404, never a table guess', async () => {
  const env = await setup('unknown');
  try {
    const result = handleWave2Query({
      dialect: env.db, ctx: { companyId: COMPANY }, namespace: 'treasury', resource: 'employees', query: {},
    });
    assert.equal(result.status, 404);
    assert.match(result.error, /unknown wave2 resource/);
  } finally {
    cleanup(env);
  }
});

test('19. _meta describes the domain so a page can render a truthful state', async () => {
  const env = await setup('meta');
  try {
    const result = handleWave2Query({
      dialect: env.db, ctx: { companyId: COMPANY }, namespace: 'hse', resource: '_meta', query: {},
    });
    assert.equal(result.error, undefined);
    assert.equal(result.data.module_id, 'hse');
    assert.ok(result.data.resources.includes('incidents'));
    assert.ok(result.data.actions.includes('hse:incident_report'));
    assert.ok(result.data.permissions.includes('hse.view'));
  } finally {
    cleanup(env);
  }
});

test('20. every namespace exposes a read permission for the router gate', () => {
  assert.equal(WAVE2_NAMESPACES.length, 16);
  for (const namespace of WAVE2_NAMESPACES) {
    const permission = wave2ReadPermission(namespace);
    assert.ok(permission, `${namespace} has no read permission`);
    assert.match(permission, /\.view$/, `${namespace} read permission should be a .view permission`);
  }
});

test('22. an action on an installed-but-not-enabled module is refused', async () => {
  const env = await setup('disabled');
  try {
    // hse is registered by 083 as 'installed'. It is deliberately NOT enabled.
    // This is the state a page must render as "module disabled", and the server
    // must refuse the mutation regardless of what the page shows.
    const executor = createActionExecutor(env.db);
    registerWave2Actions(executor);
    const ctx = { companyId: COMPANY, userId: USER, branchId: null, permissions: ['*'] };

    assert.throws(
      () => executor.execute('hse:incident_report', {
        incident_date: '2026-07-31',
        location: 'Workshop Bay 3',
        category: 'near_miss',
        severity: 'low',
        title: 'Test incident',
        idempotency_key: 'fpc-test-hse-1',
      }, ctx),
      (error) => error && error.code === 'MODULE_NOT_ENABLED',
      'a disabled module must refuse its actions with MODULE_NOT_ENABLED',
    );

    const rows = env.db.prepare('SELECT COUNT(*) n FROM hse_incidents').get();
    assert.equal(rows.n, 0, 'a refused action must not write');
  } finally {
    cleanup(env);
  }
});

test('21. every read result is capped, so no page can pull an unbounded table', async () => {
  const env = await setup('cap');
  try {
    const result = handleWave2Query({
      dialect: env.db,
      ctx: { companyId: COMPANY },
      namespace: 'treasury',
      resource: 'bank-accounts',
      query: { limit: '999999' },
    });
    assert.equal(result.meta.limit, 500, 'limit must be clamped to the server maximum');
  } finally {
    cleanup(env);
  }
});
