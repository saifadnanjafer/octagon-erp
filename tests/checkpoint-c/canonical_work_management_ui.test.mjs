// Checkpoint C4 — visible canonical Work Management contract.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const moduleSource = fs.readFileSync(path.join(repoRoot, 'modules', 'canonical-work-management.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(repoRoot, 'modules', 'canonical-work-management.css'), 'utf8');
const indexSource = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
const clientSource = fs.readFileSync(path.join(repoRoot, 'services', 'canonicalClient.js'), 'utf8');

test('canonical Work Management owns Task Manager after the legacy task and Kanban renderers', () => {
  assert.match(indexSource, /canonical-work-management\.css/);
  assert.match(indexSource, /canonical-work-management\.js/);
  assert.ok(indexSource.lastIndexOf('canonical-work-management.js') > indexSource.lastIndexOf('app.js'));
  assert.match(moduleSource, /__canonicalWorkManagementAuthorityActive = true/);
  assert.match(moduleSource, /__canonicalWorkManagementFinalAuthority/);
  assert.match(moduleSource, /navKanban[\s\S]*hidden = true/);
  assert.match(moduleSource, /navWorkshopTv/);
});

test('all nine required Work Management views are separate bilingual tabs', () => {
  for (const key of ['task_manager', 'kanban', 'calendar', 'my_tasks', 'workload', 'workshop_tv', 'mobile', 'sla', 'dependencies']) {
    assert.match(moduleSource, new RegExp(`\\['${key}'`), `${key} tab missing`);
  }
  for (const label of ['Task Manager', 'Kanban', 'Calendar', 'My Tasks', 'Team Workload', 'Workshop TV', 'Mobile Tasks', 'SLA Worklist', 'Dependency View']) {
    assert.match(moduleSource, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${label} missing`);
  }
});

test('visible Work Management commands use exact registered action ids', () => {
  for (const action of [
    'work_item:create',
    'work_item:update',
    'work_item:assign',
    'work_item:transition',
    'work_item:add_subtask',
    'work_item:add_dependency',
    'work_item:complete',
    'work_item:cancel',
  ]) {
    assert.match(clientSource, new RegExp(action.replace(':', '\\:')), `${action} missing from canonical client`);
  }
  assert.match(moduleSource, /api\(\)\.create/);
  assert.match(moduleSource, /api\(\)\.assign/);
  assert.match(moduleSource, /api\(\)\.addSubtask/);
  assert.match(moduleSource, /api\(\)\.addDependency/);
  assert.match(moduleSource, /api\(\)\.transition/);
  assert.match(moduleSource, /api\(\)\.complete/);
});

test('canonical Work Management exposes required fields, links, filters, reports, and workshop behavior', () => {
  for (const token of [
    'description',
    'assigned_user_id',
    'assigned_team_id',
    'watchers',
    'priority',
    'importance',
    'start_date',
    'due_date',
    'estimated_hours',
    'actual_hours',
    'progress',
    'checklist_json',
    'attachments_json',
    'comments_json',
    'recurrence_rule',
    'sla_due_at',
    'project_ref',
    'sales_ref',
    'procurement_ref',
    'quality_ref',
    'maintenance_ref',
  ]) assert.match(moduleSource, new RegExp(token), `${token} missing`);
  assert.match(moduleSource, /cwm-overdue/);
  assert.match(moduleSource, /visual_opacity/);
  assert.match(moduleSource, /cwm-importance/);
  assert.match(moduleSource, /data-cwm-search/);
  assert.match(moduleSource, /data-cwm-group/);
  assert.match(moduleSource, /cwm-task-group/);
  assert.match(moduleSource, /mine: 1/);
  assert.match(moduleSource, /data-cwm-sort/);
  assert.match(moduleSource, /report\('workload'\)/);
  assert.match(moduleSource, /report\('completion'\)/);
});

test('Kanban drag/drop and calendar movement dispatch versioned canonical updates', () => {
  assert.match(moduleSource, /draggable=/);
  assert.match(moduleSource, /text\/work-item-id/);
  assert.match(moduleSource, /data-cwm-drop/);
  assert.match(moduleSource, /expected_version: row\.version/);
  assert.match(moduleSource, /data-cwm-form="due"/);
  assert.match(moduleSource, /api\(\)\.update\(input\)/);
});

test('visible Work Management writer has no local persistence or generic mutation fallback', () => {
  assert.doesNotMatch(moduleSource, /localStorage\.(setItem|removeItem)/);
  assert.doesNotMatch(moduleSource, /\bfetch\s*\(/);
  assert.doesNotMatch(moduleSource, /\/api\/x\//);
  assert.doesNotMatch(moduleSource, /saveData\s*\(/);
  assert.doesNotMatch(moduleSource, /omni\.kanban/);
  assert.doesNotMatch(moduleSource, /db\.(prepare|exec)/);
});

test('Work Management stylesheet is page-scoped, responsive, and supports RTL/LTR', () => {
  const selectorLines = cssSource.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith('@'));
  assert.ok(selectorLines.every((line) => line.trim().startsWith('#pageTaskManager') || /^[{}]/.test(line.trim())));
  assert.match(cssSource, /@media \(max-width:1100px\)/);
  assert.match(cssSource, /@media \(max-width:768px\)/);
  assert.match(cssSource, /@media \(max-width:420px\)/);
  assert.match(cssSource, /\[dir="ltr"\]/);
  assert.match(moduleSource, /dir="\$\{escapeHtml/);
});

test('module registers without needing legacy globals or mutable task state', () => {
  const listeners = new Map();
  const window = {
    addEventListener(type, handler) { listeners.set(type, handler); },
    setTimeout,
    currentPage: '',
    switchPage() {},
  };
  const document = {
    documentElement: { lang: 'ar' },
    addEventListener(type, handler) { listeners.set(type, handler); },
    getElementById() { return null; },
    querySelectorAll() { return []; },
  };
  vm.runInNewContext(moduleSource, { window, document, setTimeout, console });
  assert.equal(window.__canonicalWorkManagementAuthorityActive, true);
  assert.deepEqual(
    [...window.CanonicalWorkManagement.tabs],
    ['task_manager', 'kanban', 'calendar', 'my_tasks', 'workload', 'workshop_tv', 'mobile', 'sla', 'dependencies'],
  );
});
