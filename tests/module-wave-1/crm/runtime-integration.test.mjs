import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { freshInstall, openMigrationDatabase } from '../../../database/migration-runner/index.mjs';
import { createPlatformAuthority } from '../../../platform-runtime-bridge.mjs';

function dbPath(name) {
  return path.join(os.tmpdir(), `octagon-crm-runtime-${name}-${Date.now()}-${process.pid}.db`);
}

function cleanup(env) {
  try { env.db.close(); } catch {}
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(env.path + suffix); } catch {}
  }
}

test('runtime bridge registers Wave 1 CRM handlers without forcing the module enabled', async () => {
  const p = dbPath('bridge');
  await freshInstall({ dbPath: p });
  const db = openMigrationDatabase(p);
  const env = { path: p, db };
  try {
    const authority = createPlatformAuthority(db);
    const ctx = { companyId: 'cmp_runtime', branchId: 'br_runtime', userId: 'usr_runtime' };
    const input = { name: 'Runtime CRM lead', idempotency_key: 'runtime-lead-1' };

    assert.throws(
      () => authority.actionExecutor.execute('crm:lead:create', input, ctx),
      (error) => error.code === 'MODULE_NOT_ENABLED',
      'runtime registration must preserve fail-closed module disablement',
    );

    db.prepare("UPDATE platform_modules SET status='enabled' WHERE id='crm'").run();
    const result = authority.actionExecutor.execute('crm:lead:create', input, ctx);
    assert.equal(result.lead.company_id, ctx.companyId);
    assert.match(result.lead.reference, /^LEAD-/);

    const action = db.prepare("SELECT required_permission FROM platform_actions WHERE id='crm:lead:create'").get();
    assert.equal(action.required_permission, 'perm_crm_create');
  } finally {
    cleanup(env);
  }
});

test('CRM activity query filters use canonical state and assignee columns', async () => {
  const p = dbPath('activity-query');
  await freshInstall({ dbPath: p });
  const db = openMigrationDatabase(p);
  const env = { path: p, db };
  try {
    const authority = createPlatformAuthority(db);
    db.prepare("UPDATE platform_modules SET status='enabled' WHERE id='crm'").run();
    const ctx = { companyId: 'cmp_runtime', branchId: 'br_runtime', userId: 'usr_runtime' };
    const lead = authority.actionExecutor.execute('crm:lead:create', {
      name: 'Activity query lead',
      idempotency_key: 'activity-query-lead',
    }, ctx).lead;
    const activity = authority.actionExecutor.execute('crm:activity:create', {
      activity_type: 'call',
      subject: 'Runtime query call',
      lead_id: lead.id,
      assigned_user_id: 'usr_runtime',
      due_at: '2026-08-01T09:00:00.000Z',
      idempotency_key: 'activity-query-create',
    }, ctx).activity;

    const { listActivities } = await import('../../../platform/domains/crm/query-service.mjs');
    const result = listActivities(db, {
      company_id: ctx.companyId,
      state: 'planned',
      assigned_user_id: 'usr_runtime',
    });
    assert.equal(result.total, 1);
    assert.equal(result.rows[0].id, activity.id);
  } finally {
    cleanup(env);
  }
});
