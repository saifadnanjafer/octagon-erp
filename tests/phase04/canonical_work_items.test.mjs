import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';
import { handleCommercialQuery } from '../../platform/api/commercial.mjs';

test('all task views share one versioned Work Item authority with relations and approval', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-phase04-work-items-'));
  const dbPath = path.join(tempDir, 'work-items.db');
  let db;
  try {
    await freshInstall({ dbPath, backupDir: path.join(tempDir, 'backups'), actor: 'phase04-work-item-test' });
    db = openMigrationDatabase(dbPath);
    const executor = createPlatformAuthority(db).actionExecutor;
    const ctx = {
      tenantId: 'default',
      companyId: 'default',
      branchId: 'default',
      userId: 'phase04-work-item-test',
      sourceChannel: 'node-test',
    };
    const execute = (actionId, input, key) => executor.execute(actionId, { ...input, idempotency_key: key }, ctx);

    const blocker = execute('work_item:create', {
      title: 'Prepare work area',
      source_type: 'work_order',
      source_id: 'WO-001',
      source_line_id: 'STEP-001',
      assigned_user_id: 'technician-1',
      due_date: '2026-07-30',
      watchers: ['supervisor-1'],
      transparency_projection: { views: ['task_manager', 'kanban', 'mobile', 'workshop_tv'] },
    }, 'work-item-blocker');
    const task = execute('work_item:create', {
      title: 'Install canonical component',
      source_type: 'work_order',
      source_id: 'WO-001',
      source_line_id: 'STEP-002',
      parent_id: blocker.id,
      dependencies: [blocker.id],
      assigned_user_id: 'technician-1',
      assigned_team_id: 'team-workshop',
      watchers: ['supervisor-1', 'planner-1'],
      priority: 'high',
      importance: 5,
      approvals: [{ approver_id: 'supervisor-1', reason: 'Safety gate' }],
      recurrence_rule: 'none',
    }, 'work-item-task');

    assert.equal(task.dependencies[0].blocker_work_item_id, blocker.id);
    assert.deepEqual(task.watchers, ['planner-1', 'supervisor-1']);
    assert.equal(task.approvals.length, 1);
    assert.equal(task.stable_source_key, 'work_order:WO-001:STEP-002');
    assert.equal(task.version, 1);

    const updated = execute('work_item:update', {
      id: task.id,
      expected_version: 1,
      status: 'waiting_approval',
      progress: 40,
      due_date: '2026-07-29',
    }, 'work-item-update');
    assert.equal(updated.status, 'waiting_approval');
    assert.equal(updated.progress, 40);
    assert.equal(updated.version, 2);

    assert.throws(
      () => execute('work_item:update', {
        id: task.id,
        expected_version: 1,
        progress: 90,
      }, 'work-item-stale-update'),
      /version conflict/,
    );

    const approved = execute('work_item:approve', {
      approval_id: task.approvals[0].id,
      decision: 'approved',
    }, 'work-item-approval');
    assert.equal(approved.status, 'in_progress');
    assert.equal(approved.approvals[0].status, 'approved');

    const taskManagerView = handleCommercialQuery({
      dialect: db,
      ctx,
      namespace: 'work-items',
      resource: 'items',
      query: { assigned_user_id: 'technician-1' },
    });
    const kanbanView = handleCommercialQuery({
      dialect: db,
      ctx,
      namespace: 'work_items',
      resource: 'items',
      query: { status: 'in_progress' },
    });
    const taskManagerItem = taskManagerView.data.find((item) => item.id === task.id);
    const kanbanItem = kanbanView.data.find((item) => item.id === task.id);
    assert.ok(taskManagerItem);
    assert.ok(kanbanItem);
    assert.equal(taskManagerItem.status, kanbanItem.status);
    assert.equal(taskManagerItem.due_date, kanbanItem.due_date);
    assert.equal(taskManagerItem.assigned_user_id, kanbanItem.assigned_user_id);

    const archived = execute('work_item:delete', { id: task.id }, 'work-item-archive');
    assert.equal(archived.status, 'archived');
    assert.ok(archived.archived_at);
  } finally {
    try { db?.close(); } catch (_) {}
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
