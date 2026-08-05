import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMyWork } from '../../platform/workshop/my-work.mjs';
import { openWorkshopFixture, insertWorkItem } from './fixture.mjs';

const allowAll = () => true;

test('My Work returns only records actually assigned to the signed-in actor', async (t) => {
  const { dialect, ctx } = await openWorkshopFixture(t, 'my-work-actor');
  insertWorkItem(dialect, { id: 'assigned-me', assignedUserId: 'operator-a', title: 'Assigned to me' });
  insertWorkItem(dialect, { id: 'assigned-other', assignedUserId: 'operator-b', title: 'Not mine' });
  const result = buildMyWork({ dialect, ctx, can: allowAll });
  assert.equal(result.error, undefined);
  assert.equal(result.data.page, 'my_work');
  assert.deepEqual(result.data.items.filter((item) => item.source === 'canonical_work').map((item) => item.id), ['assigned-me']);
  assert.ok(result.data.items.every((item) => item.assigneeId === 'operator-a'));
});

test('My Work never lets an actor filter expand beyond the signed-in actor', async (t) => {
  const { dialect, ctx } = await openWorkshopFixture(t, 'my-work-escalation');
  const result = buildMyWork({ dialect, ctx, query: { actor_id: 'operator-b' }, can: allowAll });
  assert.equal(result.status, 403);
  assert.match(result.error, /signed-in actor/i);
});

test('My Work summary separates waiting, due, overdue, blocked, and recent work', async (t) => {
  const { dialect, ctx } = await openWorkshopFixture(t, 'my-work-summary');
  const yesterday = new Date(Date.now() - 86400000).toISOString();
  const today = new Date().toISOString();
  insertWorkItem(dialect, { id: 'wait-me', status: 'waiting', stage: 'waiting', dueDate: today });
  insertWorkItem(dialect, { id: 'late-me', status: 'todo', dueDate: yesterday });
  insertWorkItem(dialect, { id: 'blocked-me', status: 'blocked', stage: 'blocked', dueDate: null });
  insertWorkItem(dialect, { id: 'done-me', status: 'completed', stage: 'done', dueDate: yesterday });
  const result = buildMyWork({ dialect, ctx, can: allowAll });
  assert.equal(result.data.summary.assigned, 3);
  assert.equal(result.data.summary.waiting, 1);
  assert.ok(result.data.summary.dueToday >= 1);
  assert.ok(result.data.summary.overdue >= 1);
  assert.equal(result.data.summary.blocked, 1);
  assert.equal(result.data.summary.recent, 1);
});

test('My Work applies task family, status, priority, and due filters server-side', async (t) => {
  const { dialect, ctx } = await openWorkshopFixture(t, 'my-work-filters');
  const yesterday = new Date(Date.now() - 86400000).toISOString();
  insertWorkItem(dialect, { id: 'urgent-late', sourceType: 'quality', status: 'todo', priority: 'urgent', dueDate: yesterday });
  insertWorkItem(dialect, { id: 'normal-future', sourceType: 'task', status: 'todo', priority: 'medium' });
  const result = buildMyWork({ dialect, ctx, query: { task_family: 'quality', status: 'todo', priority: 'urgent', due: 'overdue' }, can: allowAll });
  assert.equal(result.meta.total, 1);
  assert.equal(result.data.items[0].id, 'urgent-late');
});

test('My Work recent view returns closed work while assigned view excludes it', async (t) => {
  const { dialect, ctx } = await openWorkshopFixture(t, 'my-work-recent');
  insertWorkItem(dialect, { id: 'open-item', status: 'todo' });
  insertWorkItem(dialect, { id: 'closed-item', status: 'completed', stage: 'done' });
  const assigned = buildMyWork({ dialect, ctx, query: { view: 'assigned' }, can: allowAll });
  const recent = buildMyWork({ dialect, ctx, query: { view: 'recent' }, can: allowAll });
  assert.ok(assigned.data.items.some((item) => item.id === 'open-item'));
  assert.ok(assigned.data.items.every((item) => item.id !== 'closed-item'));
  assert.ok(recent.data.items.some((item) => item.id === 'closed-item'));
  assert.ok(recent.data.items.every((item) => item.flags.closed));
});

test('My Work sorts overdue and blocked work before normal future work', async (t) => {
  const { dialect, ctx } = await openWorkshopFixture(t, 'my-work-sort');
  insertWorkItem(dialect, { id: 'future-high', priority: 'high', dueDate: new Date(Date.now() + 86400000).toISOString() });
  insertWorkItem(dialect, { id: 'overdue-low', priority: 'low', dueDate: new Date(Date.now() - 86400000).toISOString() });
  const result = buildMyWork({ dialect, ctx, can: allowAll });
  assert.equal(result.data.items[0].id, 'overdue-low');
});

test('My Work exposes denied assignment sources without returning their records', async (t) => {
  const { dialect, ctx } = await openWorkshopFixture(t, 'my-work-permissions');
  insertWorkItem(dialect, { id: 'visible-work' });
  const result = buildMyWork({ dialect, ctx, can: (permission) => permission === 'platform:db:read' });
  assert.equal(result.data.sources.find((source) => source.source === 'canonical_work').state, 'ready');
  assert.ok(result.data.sources.filter((source) => source.source !== 'canonical_work').every((source) => source.state === 'permission_denied'));
  assert.ok(result.data.items.every((item) => item.source === 'canonical_work'));
});

test('My Work pagination is bounded to one hundred rows', async (t) => {
  const { dialect, ctx } = await openWorkshopFixture(t, 'my-work-pagination');
  for (let i = 0; i < 112; i += 1) insertWorkItem(dialect, { id: `many-${i}`, title: `Work ${i}` });
  const result = buildMyWork({ dialect, ctx, query: { limit: '999' }, can: allowAll });
  assert.equal(result.meta.limit, 100);
  assert.equal(result.data.items.length, 100);
  assert.ok(result.meta.total >= 112);
});

