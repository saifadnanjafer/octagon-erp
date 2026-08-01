import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import test from 'node:test';
import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';

test('BUILD-05 registers governed notification commands with idempotency, audit, and outbox', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-build05-runtime-'));
  try {
    const dbPath = path.join(dir, 'runtime.db'); await freshInstall({ dbPath, backupDir: path.join(dir, 'backups'), actor: 'build-05-test' });
    const db = openMigrationDatabase(dbPath);
    try {
      const now = new Date().toISOString();
      db.prepare("INSERT INTO notifications (id,recipient_id,event_key,category,body,created_at) VALUES (?,?,?,?,?,?)").run('ntf_build05', 'build-05-test', 'build05.test', 'informational', 'test', now);
      const authority = createPlatformAuthority(db); const ctx = { companyId: 'default', branchId: 'default', userId: 'build-05-test', sourceChannel: 'node-test' };
      assert.ok(authority.platformSearch.search('sale').some((row) => row.type === 'entity' || row.type === 'action'));
      const result = authority.actionExecutor.execute('notification:mark_read', { notification_id: 'ntf_build05', idempotency_key: 'build05-read' }, ctx);
      const replay = authority.actionExecutor.execute('notification:mark_read', { notification_id: 'ntf_build05', idempotency_key: 'build05-read' }, ctx);
      assert.deepEqual(result, replay); assert.equal(db.prepare('SELECT read_at FROM notifications WHERE id = ?').get('ntf_build05').read_at !== null, true);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM platform_audit_log WHERE action = 'action.execute.notification:mark_read'").get().n, 1);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM platform_outbox WHERE event_type = 'action.execute'").get().n >= 1, true);
    } finally { db.close(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('BUILD-05 saves scoped views through the governed action authority', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-build05-views-'));
  try {
    const dbPath = path.join(dir, 'views.db'); await freshInstall({ dbPath, backupDir: path.join(dir, 'backups'), actor: 'build-05-test' });
    const db = openMigrationDatabase(dbPath);
    try {
      const authority = createPlatformAuthority(db); const ctx = { companyId: 'default', branchId: 'default', userId: 'build-05-test', sourceChannel: 'node-test' };
      const input = { entity: 'sale_contract', name: 'Open contracts', filters: { status: { op: 'eq', value: 'active' } }, columns: ['name', 'status'], idempotency_key: 'build05-view' };
      const view = authority.actionExecutor.execute('saved_view:save', input, ctx);
      const replay = authority.actionExecutor.execute('saved_view:save', input, ctx);
      assert.equal(view.id, replay.id); assert.equal(view.ownerId, 'build-05-test');
      assert.equal(authority.configuration.listViews('sale_contract', { actorId: 'build-05-test', activeCompanyId: 'default' }).length, 1);
    } finally { db.close(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('BUILD-05 schedules reports as durable jobs and stages in-app delivery', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-build05-reports-'));
  try {
    const dbPath = path.join(dir, 'reports.db'); await freshInstall({ dbPath, backupDir: path.join(dir, 'backups'), actor: 'build-05-test' });
    const db = openMigrationDatabase(dbPath);
    try {
      const authority = createPlatformAuthority(db); const ctx = { companyId: 'default', branchId: 'default', userId: 'build-05-test', sourceChannel: 'node-test' };
      const schedule = authority.actionExecutor.execute('scheduled_report:create', { name: 'Daily sales', report_key: 'sales.daily', schedule: '0 8 * * *', audience: ['build-05-test'], idempotency_key: 'build05-schedule' }, ctx);
      assert.equal(authority.scheduledReports.list(ctx).length, 1);
      const queued = authority.jobs.tick({ jobDefinitionIds: [`scheduled_report_${schedule.id}`] });
      assert.equal(queued.length, 1); assert.equal(authority.jobs.drain().succeeded, 1);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE event_key = 'report.scheduled.ready'").get().n, 1);
      const paused = authority.actionExecutor.execute('scheduled_report:pause', { schedule_id: schedule.id, idempotency_key: 'build05-pause' }, ctx);
      assert.equal(paused.active, false);
    } finally { db.close(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
