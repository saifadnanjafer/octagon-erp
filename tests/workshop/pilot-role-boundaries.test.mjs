import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { openPilot, seedPilotWorkshop } from './pilot-fixture.mjs';
import { PILOT_ACTORS, PILOT_ROLE_SEQUENCE } from './pilot-actors.mjs';
import { buildMyWork } from '../../platform/workshop/my-work.mjs';
import { buildWorkshopCommandCenter } from '../../platform/workshop/command-center.mjs';
import { buildWorkshopReadiness } from '../../platform/workshop/readiness.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');

function permissionService() {
  const root = { console, omni: { roles: [] } };
  root.window = root;
  root.PentagonAuth = { getCurrentUser: () => root.__user || null };
  vm.createContext(root);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'services', 'permissionService.js'), 'utf8'), root, { filename: 'permissionService.js' });
  return root.PermissionService;
}

function insertRoleAssignments(db) {
  const stamp = '2026-08-05T06:30:00.000Z';
  for (const roleKey of PILOT_ROLE_SEQUENCE) {
    const actor = PILOT_ACTORS[roleKey];
    db.prepare(`INSERT INTO work_items(id,company_id,branch_id,title,source_type,status,stage,priority,assigned_user_id,due_date,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      `role-work-${roleKey}`, 'default', 'branch-pilot', `${actor.label} exact assignment`, `role_${roleKey}`,
      'todo', 'active', 'medium', actor.id, '2026-08-05T14:00:00.000Z', stamp, stamp,
    );
  }
}

test('seven pilot actors have explicit and non-overlapping My Work queues', async (t) => {
  const pilot = await openPilot(t, 'roles-my-work');
  seedPilotWorkshop(pilot);
  insertRoleAssignments(pilot.db);
  for (const roleKey of PILOT_ROLE_SEQUENCE) {
    const actor = PILOT_ACTORS[roleKey];
    const result = buildMyWork({ dialect: pilot.db, ctx: pilot.contexts[roleKey], can: () => true });
    assert.equal(result.error, undefined, `${actor.label} should receive My Work`);
    const canonical = result.data.items.filter((item) => item.source === 'canonical_work');
    assert.equal(canonical.length, 1, `${actor.label} should see exactly one canonical assignment`);
    assert.equal(canonical[0].id, `role-work-${roleKey}`);
    assert.equal(canonical[0].assigneeId, actor.id);
    assert.ok(result.data.items.every((item) => item.assigneeId === actor.id));
  }
});

test('actor filter cannot be used by any pilot role to inspect another role queue', async (t) => {
  const pilot = await openPilot(t, 'roles-escalation');
  seedPilotWorkshop(pilot);
  insertRoleAssignments(pilot.db);
  for (let index = 0; index < PILOT_ROLE_SEQUENCE.length; index += 1) {
    const current = PILOT_ROLE_SEQUENCE[index];
    const next = PILOT_ROLE_SEQUENCE[(index + 1) % PILOT_ROLE_SEQUENCE.length];
    const result = buildMyWork({
      dialect: pilot.db, ctx: pilot.contexts[current], query: { actor_id: PILOT_ACTORS[next].id }, can: () => true,
    });
    assert.equal(result.status, 403, `${current} must not inspect ${next}`);
    assert.match(result.error, /signed-in actor/i);
  }
});

test('page policy exposes daily work to finance and workshop roles but gates readiness to managers', () => {
  const service = permissionService();
  const users = Object.fromEntries(Object.entries(PILOT_ACTORS).map(([key, actor]) => [key, { id: actor.id, groups: actor.groups }]));
  for (const roleKey of PILOT_ROLE_SEQUENCE) assert.equal(service.checkPage('my_work', users[roleKey]), true, `${roleKey} needs My Work`);
  for (const roleKey of ['supervisor','planner']) assert.equal(service.checkPage('workshop_readiness', users[roleKey]), true);
  for (const roleKey of ['warehouseOperator','productionOperator','qualityInspector','deliveryClerk','financeUser']) {
    assert.equal(service.checkPage('workshop_readiness', users[roleKey]), false, `${roleKey} must not inspect setup readiness`);
  }
  assert.equal(service.checkPage('workshop_command_center', users.supervisor), true);
  assert.equal(service.checkPage('workshop_command_center', users.warehouseOperator), true);
  assert.equal(service.checkPage('workshop_command_center', users.financeUser), false);
});

test('command center permission filtering returns useful operator cards without leaking denied domains', async (t) => {
  const pilot = await openPilot(t, 'roles-command');
  const seed = seedPilotWorkshop(pilot);
  const operatorPermissions = new Set(['platform:db:read','wms:receiving:view','wms:picking:view','shopfloor:terminal:view','shopfloor:material:view']);
  const result = buildWorkshopCommandCenter({
    dialect: pilot.db, ctx: pilot.contexts.warehouseOperator, can: (permission) => operatorPermissions.has(permission),
  });
  const cards = result.data.sections.flatMap((category) => category.cards);
  assert.ok(cards.some((card) => card.state === 'ready'));
  assert.ok(cards.some((card) => card.state === 'permission_denied'));
  assert.equal(cards.find((card) => card.id === 'health_devices').value, null);
  assert.equal(cards.find((card) => card.id === 'health_devices').state, 'permission_denied');
  assert.equal(result.data.scope.companyId, seed.companyId);
  assert.equal(result.data.scope.warehouseId, seed.warehouse.id);
});

test('readiness denial is explicit per check and never treated as a pass', async (t) => {
  const pilot = await openPilot(t, 'roles-readiness');
  seedPilotWorkshop(pilot);
  const visible = new Set(['platform:db:read','wms:topology:view','wms:locations:view']);
  const result = buildWorkshopReadiness({
    dialect: pilot.db, ctx: pilot.contexts.warehouseOperator, can: (permission) => visible.has(permission),
  });
  const checks = result.data.categories.flatMap((category) => category.checks);
  const denied = checks.filter((check) => check.state === 'PERMISSION_DENIED');
  assert.ok(denied.length > 10);
  assert.ok(denied.every((check) => check.value === null));
  assert.equal(result.data.formula.excludedPermission, denied.filter((check) => check.mandatory).length);
  assert.ok(result.data.formula.denominator < checks.filter((check) => check.mandatory).length);
});

test('company scope isolation hides otherwise matching assignments', async (t) => {
  const pilot = await openPilot(t, 'roles-company');
  seedPilotWorkshop(pilot);
  insertRoleAssignments(pilot.db);
  const stamp = '2026-08-05T06:45:00.000Z';
  pilot.db.prepare(`INSERT INTO work_items(id,company_id,branch_id,title,source_type,status,stage,priority,assigned_user_id,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
    'foreign-company-work', 'company-outside', 'branch-pilot', 'Foreign assignment', 'task', 'todo', 'active', 'urgent',
    PILOT_ACTORS.supervisor.id, stamp, stamp,
  );
  const result = buildMyWork({ dialect: pilot.db, ctx: pilot.contexts.supervisor, can: () => true });
  assert.ok(result.data.items.some((item) => item.id === 'role-work-supervisor'));
  assert.ok(result.data.items.every((item) => item.id !== 'foreign-company-work'));
});

