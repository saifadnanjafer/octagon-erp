import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';

async function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-b10-governance-'));
  const dbPath = path.join(dir, 'iot.db');
  await freshInstall({ dbPath, backupDir: path.join(dir, 'backups') });
  const db = openMigrationDatabase(dbPath);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const authority = createPlatformAuthority(db);
  const ctx = { companyId: 'company-a', tenantId: 'default', branchId: 'branch-a', userId: 'iot-manager', actorId: 'iot-manager', actorType: 'user', correlationId: 'build10-governance' };
  return { db, authority, ctx };
}

test('IoT actions use the platform transaction, idempotency, audit and outbox authority', async (t) => {
  const { db, authority, ctx } = await setup(t);
  const input = { external_ref: 'GOV-001', device_type: 'tracker', model: 'GovTrack', idempotency_key: 'device-gov-001' };
  const first = authority.actionExecutor.execute('iot:device_register', input, ctx);
  const replay = authority.actionExecutor.execute('iot:device_register', input, ctx);
  assert.deepEqual(replay, first);
  assert.equal(first.companyId, 'company-a');
  assert.equal(first.lifecycleState, 'draft');
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM iot_devices WHERE external_ref='GOV-001'`).get().count, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM action_idempotency WHERE operation_type='iot:device_register'`).get().count, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM platform_audit_log WHERE action='action.execute.iot:device_register'`).get().count, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM platform_outbox WHERE event_type='action.execute'`).get().count, 1);
  assert.throws(() => authority.actionExecutor.execute('iot:device_register', { ...input, company_id: 'company-b', idempotency_key: 'spoofed-company' }, ctx), (error) => error.code === 'UNTRUSTED_ACTION_SCOPE');
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM iot_devices WHERE company_id='company-b'`).get().count, 0);
});

test('IoT action permissions fail closed and the action route evaluates required_permission', async (t) => {
  const { db, authority, ctx } = await setup(t);
  db.prepare(`INSERT INTO authorization_role_assignments (id, user_id, actor_type, role_id, company_id, status, created_at, created_by)
    VALUES ('asg_iot_manager_owner', 'iot-manager', 'user', 'role_default_owner', NULL, 'active', ?, 'build10-test')`).run(new Date().toISOString());
  const decisionCtx = { ...ctx, activeCompanyId: ctx.companyId, now: new Date().toISOString() };
  const unknown = authority.evaluator.evaluate({ permission: 'iot:device:bogus', ctx: decisionCtx });
  assert.equal(unknown.allowed, false);
  const known = authority.evaluator.evaluate({ permission: 'iot:device:write', ctx: decisionCtx });
  assert.equal(known.allowed, true);
  const apiSource = fs.readFileSync(path.join(process.cwd(), 'platform', 'api', 'index.mjs'), 'utf8');
  assert.match(apiSource, /namespace === 'action' && resource && req\.method === 'POST'[\s\S]{0,500}required_permission/);
});
