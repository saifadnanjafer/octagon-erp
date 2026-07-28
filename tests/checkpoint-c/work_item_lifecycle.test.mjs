// Checkpoint C4 — canonical Work Item lifecycle, views, rollback, and concurrency.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';
import { handleCommercialQuery } from '../../platform/api/commercial.mjs';

let tempDir;
let db;
let executor;
let sequence = 0;
const ctx = {
  tenantId: 'default',
  companyId: 'default',
  branchId: 'default',
  userId: 'checkpoint-c4-workshop',
  sourceChannel: 'node-test',
};

const key = (prefix) => `${prefix}_${Date.now()}_${++sequence}`;
const execute = (actionId, input, idempotencyKey = key(actionId)) =>
  executor.execute(actionId, { ...input, idempotency_key: idempotencyKey }, ctx);
const query = (resource = 'items', params = {}, recordId = null) =>
  handleCommercialQuery({ dialect: db, ctx, namespace: 'work-items', resource, recordId, query: params });

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-c4-work-items-'));
  const dbPath = path.join(tempDir, 'work-items.db');
  await freshInstall({ dbPath, backupDir: path.join(tempDir, 'backups'), actor: 'c4-work-item-test' });
  db = openMigrationDatabase(dbPath);
  executor = createPlatformAuthority(db).actionExecutor;
});

after(() => {
  try { db?.close(); } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }
});

test('one canonical authority powers task, Kanban, calendar, workload, mobile, SLA, dependency, and TV views', () => {
  const blocker = execute('work_item:create', {
    title: 'Prepare canonical bay',
    description: 'Safety and material preparation',
    stage: 'planned',
    assigned_user_id: 'technician-1',
    assigned_team_id: 'team-workshop',
    priority: 'high',
    importance: 5,
    start_date: '2026-07-28T08:00:00.000Z',
    due_date: '2026-07-29T08:00:00.000Z',
    estimated_hours: 4,
    checklist_json: [{ title: 'Safety gate', done: false }],
    watchers: ['supervisor-1'],
    project_ref: 'PROJECT-C4',
    sales_ref: 'SO-C4',
    procurement_ref: 'PO-C4',
    quality_ref: 'QC-C4',
    maintenance_ref: 'MAINT-C4',
    recurrence_rule: 'weekly;interval=1',
    sla_policy: 'workshop-24h',
    sla_due_at: '2026-07-29T08:00:00.000Z',
  });
  const task = execute('work_item:create', {
    title: 'Install canonical assembly',
    assigned_user_id: ctx.userId,
    assigned_team_id: 'team-workshop',
    importance: 4,
    due_date: '2026-07-30T08:00:00.000Z',
  });
  const mineBeforeReassignment = query('items', { mine: '1' }).data;
  assert.ok(mineBeforeReassignment.some((row) => row.id === task.id));
  const subtask = execute('work_item:add_subtask', {
    parent_id: blocker.id,
    title: 'Verify torque checklist',
    importance: 3,
  });
  const dependent = execute('work_item:add_dependency', {
    id: task.id,
    blocker_work_item_id: blocker.id,
    expected_version: task.version,
  });
  assert.equal(dependent.dependencies[0].blocker_work_item_id, blocker.id);
  assert.equal(subtask.parent_id, blocker.id);
  assert.equal(subtask.sales_ref, 'SO-C4');

  const assigned = execute('work_item:assign', {
    id: task.id,
    expected_version: dependent.version,
    assigned_user_id: 'technician-3',
    assigned_team_id: 'team-night',
    watchers: ['supervisor-1', 'planner-1'],
  });
  assert.equal(assigned.assigned_user_id, 'technician-3');
  assert.deepEqual(assigned.watchers, ['planner-1', 'supervisor-1']);

  const moved = execute('work_item:transition', {
    id: task.id,
    expected_version: assigned.version,
    stage: 'in_progress',
    progress: 35,
  });
  assert.equal(moved.stage, 'in_progress');
  assert.equal(moved.status, 'in_progress');
  assert.ok(moved.last_stage_moved_at);

  const calendarMove = execute('work_item:update', {
    id: task.id,
    expected_version: moved.version,
    due_date: '2026-08-01T08:00:00.000Z',
  });
  assert.equal(calendarMove.due_date, '2026-08-01T08:00:00.000Z');

  const taskManager = query('items').data.find((row) => row.id === task.id);
  const kanban = query('items', { stage: 'in_progress' }).data.find((row) => row.id === task.id);
  const calendar = query('items', { due_from: '2026-08-01', due_to: '2026-08-02' }).data.find((row) => row.id === task.id);
  const mine = query('items', { mine: '1' }).data;
  const workload = query('reports', { report: 'workload' }).data.find((row) => row.employee === 'technician-3');
  const dependencies = query('reports', { report: 'dependencies' }).data.find((row) => row.id === task.id);
  assert.equal(taskManager.version, kanban.version);
  assert.equal(taskManager.version, calendar.version);
  assert.equal(mine.length, 0);
  assert.equal(workload.open, 1);
  assert.equal(dependencies.dependencies[0].blocker_work_item_id, blocker.id);
  assert.ok(taskManager.events.some((entry) => entry.event_type === 'transitioned'));
});

test('completion blocks on predecessors and subtasks, then creates the next recurrence atomically', () => {
  const parent = execute('work_item:create', {
    title: 'Recurring inspection',
    recurrence_rule: 'weekly',
    start_date: '2026-07-28T08:00:00.000Z',
    due_date: '2026-07-28T10:00:00.000Z',
  });
  const blocker = execute('work_item:create', { title: 'Pre-inspection lockout' });
  const child = execute('work_item:add_subtask', { parent_id: parent.id, title: 'Inspect guard' });
  let linked = execute('work_item:add_dependency', {
    id: parent.id,
    blocker_work_item_id: blocker.id,
    expected_version: parent.version,
  });
  assert.throws(
    () => execute('work_item:complete', { id: parent.id, expected_version: linked.version }),
    /blocked by incomplete dependencies/,
  );
  execute('work_item:complete', { id: blocker.id, expected_version: blocker.version });
  execute('work_item:complete', { id: child.id, expected_version: child.version });
  linked = query('items', {}, parent.id).data;
  const completed = execute('work_item:complete', { id: parent.id, expected_version: linked.version });
  assert.equal(completed.item.status, 'done');
  assert.equal(completed.item.progress, 100);
  assert.ok(completed.recurrence);
  assert.equal(completed.recurrence.title, parent.title);
  assert.notEqual(completed.recurrence.id, parent.id);
});

test('dependency cycles, company scope, stale transitions, and repeated idempotency fail closed', async () => {
  const first = execute('work_item:create', { title: 'Dependency A' });
  const second = execute('work_item:create', { title: 'Dependency B' });
  const firstLinked = execute('work_item:add_dependency', {
    id: first.id,
    blocker_work_item_id: second.id,
    expected_version: first.version,
  });
  assert.throws(
    () => execute('work_item:add_dependency', {
      id: second.id,
      blocker_work_item_id: first.id,
      expected_version: second.version,
    }),
    /dependency cycle/,
  );
  assert.throws(
    () => executor.execute('work_item:transition', {
      id: first.id,
      stage: 'in_progress',
      company_id: 'other-company',
      idempotency_key: key('spoof'),
    }, ctx),
    /company scope must come from the verified session/,
  );

  const replayKey = key('transition-replay');
  const transitioned = execute('work_item:transition', {
    id: first.id,
    stage: 'in_progress',
    expected_version: firstLinked.version,
  }, replayKey);
  const replay = execute('work_item:transition', {
    id: first.id,
    stage: 'in_progress',
    expected_version: firstLinked.version,
  }, replayKey);
  assert.equal(replay.version, transitioned.version);

  const concurrent = await Promise.allSettled([
    Promise.resolve().then(() => execute('work_item:transition', {
      id: first.id,
      stage: 'review',
      expected_version: transitioned.version,
    })),
    Promise.resolve().then(() => execute('work_item:transition', {
      id: first.id,
      stage: 'blocked',
      expected_version: transitioned.version,
    })),
  ]);
  assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(concurrent.filter((result) => result.status === 'rejected').length, 1);
});

test('work-item transition, audit, and outbox failure injection leaves no partial state', () => {
  for (const [stage, table] of [
    ['event', 'work_item_events'],
    ['audit', 'platform_audit_log'],
    ['outbox', 'platform_outbox'],
  ]) {
    const task = execute('work_item:create', { title: `Rollback ${stage}` });
    const before = query('items', {}, task.id).data;
    db.exec(`
      CREATE TRIGGER c4_fail_${stage}
      BEFORE INSERT ON ${table}
      BEGIN SELECT RAISE(ABORT, 'injected ${stage} failure'); END;
    `);
    try {
      assert.throws(
        () => execute('work_item:transition', {
          id: task.id,
          stage: 'in_progress',
          expected_version: task.version,
        }),
        new RegExp(`injected ${stage} failure`),
      );
    } finally {
      db.exec(`DROP TRIGGER c4_fail_${stage}`);
    }
    const afterFailure = query('items', {}, task.id).data;
    assert.equal(afterFailure.stage, before.stage);
    assert.equal(afterFailure.status, before.status);
    assert.equal(afterFailure.version, before.version);
  }
});
