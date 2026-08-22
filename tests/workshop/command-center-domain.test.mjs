import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWorkshopCommandCenter } from '../../platform/workshop/command-center.mjs';
import { openWorkshopFixture, insertWorkItem } from './fixture.mjs';

const allowAll = () => true;

test('Workshop Command Center returns five required sections and at least sixteen real KPI cards', async (t) => {
  const { dialect, ctx } = await openWorkshopFixture(t, 'command-shape');
  insertWorkItem(dialect);
  const result = buildWorkshopCommandCenter({ dialect, ctx, can: allowAll });
  assert.equal(result.error, undefined);
  assert.equal(result.data.page, 'workshop_command_center');
  assert.deepEqual(result.data.sections.map((section) => section.id), [
    'today', 'urgent', 'operational_queues', 'system_health', 'my_work',
  ]);
  assert.ok(result.data.summary.total >= 16);
  assert.equal(result.data.sections.flatMap((section) => section.cards).length, result.data.summary.total);
  assert.match(result.data.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('Command Center counts only the active company and current actor assignments', async (t) => {
  const { dialect, ctx } = await openWorkshopFixture(t, 'command-scope');
  insertWorkItem(dialect, { id: 'mine-open', companyId: 'default', assignedUserId: 'operator-a' });
  insertWorkItem(dialect, { id: 'other-actor', companyId: 'default', assignedUserId: 'operator-b' });
  insertWorkItem(dialect, { id: 'other-company', companyId: 'other-company', assignedUserId: 'operator-a' });
  const result = buildWorkshopCommandCenter({ dialect, ctx, can: allowAll });
  const cards = new Map(result.data.sections.flatMap((section) => section.cards).map((card) => [card.id, card]));
  assert.equal(cards.get('today_open_work').value, 2);
  assert.equal(cards.get('mine_assigned').value, 1);
  assert.equal(result.data.scope.companyId, 'default');
  assert.equal(result.data.scope.actorId, 'operator-a');
});

test('permission denied cards are explicit and never execute their underlying query', async (t) => {
  const { dialect, ctx } = await openWorkshopFixture(t, 'command-permission');
  const denied = new Set(['wms:receiving:view', 'quality:checkpoint:view', 'iot:telemetry:view']);
  const result = buildWorkshopCommandCenter({ dialect, ctx, can: (permission) => !denied.has(permission) });
  const cards = result.data.sections.flatMap((section) => section.cards);
  const restricted = cards.filter((card) => denied.has(card.permission));
  assert.ok(restricted.length >= 3);
  assert.ok(restricted.every((card) => card.state === 'permission_denied'));
  assert.ok(restricted.every((card) => card.value === null));
  assert.equal(result.data.summary.denied, restricted.length);
});

test('one metric failure is isolated as a partial failure and other sections stay usable', async (t) => {
  const { dialect, ctx } = await openWorkshopFixture(t, 'command-partial');
  dialect.exec('DROP TABLE iot_device_alerts');
  const result = buildWorkshopCommandCenter({ dialect, ctx, can: allowAll });
  const cards = result.data.sections.flatMap((section) => section.cards);
  const deviceAlerts = cards.find((card) => card.id === 'health_devices');
  const openWork = cards.find((card) => card.id === 'today_open_work');
  assert.equal(deviceAlerts.state, 'unavailable');
  assert.equal(openWork.state, 'ready');
  assert.equal(result.data.summary.partial, true);
  assert.ok(result.meta.partial_failures >= 1);
  assert.equal(result.meta.partial_failures, cards.filter((card) => card.state === 'unavailable').length);
});

test('missing company scope is rejected before any operational query', async (t) => {
  const { dialect, ctx } = await openWorkshopFixture(t, 'command-company');
  const result = buildWorkshopCommandCenter({ dialect, ctx: { ...ctx, companyId: '', activeCompanyId: '' }, can: allowAll });
  assert.equal(result.status, 403);
  assert.match(result.error, /company scope/i);
});

test('invalid warehouse does not leak another scope and reports isolated unavailable metrics', async (t) => {
  const { dialect, ctx } = await openWorkshopFixture(t, 'command-warehouse');
  const result = buildWorkshopCommandCenter({ dialect, ctx: { ...ctx, warehouseId: 'outside-scope' }, can: allowAll });
  assert.equal(result.data.scope.warehouseValid, false);
  const warehouseCards = result.data.sections.flatMap((section) => section.cards)
    .filter((card) => ['today_receiving', 'urgent_shortages', 'urgent_quality'].includes(card.id));
  assert.ok(warehouseCards.every((card) => card.state === 'unavailable'));
  assert.ok(result.data.summary.available > 0);
});

test('Command Center briefing covers every signal with accountable response guidance', async (t) => {
  const { dialect, ctx } = await openWorkshopFixture(t, 'command-briefing');
  insertWorkItem(dialect, { id: 'briefing-urgent', priority: 'urgent' });
  const result = buildWorkshopCommandCenter({ dialect, ctx, can: allowAll });
  const briefing = result.data.briefing;
  assert.equal(briefing.coverage.registered, 18);
  assert.equal(briefing.coverage.visible, 18);
  assert.equal(briefing.signals.length, 18);
  assert.equal(briefing.mutationPolicy, 'ADVISORY_ONLY_CANONICAL_TARGETS');
  assert.ok(briefing.signals.every((signal) => signal.ownerRole));
  assert.ok(briefing.signals.every((signal) => signal.response.length >= 3));
  assert.ok(briefing.signals.every((signal) => signal.evidence.length >= 2));
  assert.equal(briefing.attention.total, briefing.attention.immediate.length + briefing.attention.review.length);
  assert.ok(briefing.nextRoute.target);
});

test('briefing preserves permission-hidden signals without exposing metric values', async (t) => {
  const { dialect, ctx } = await openWorkshopFixture(t, 'command-briefing-denied');
  const result = buildWorkshopCommandCenter({ dialect, ctx, can: (permission) => permission === 'platform:db:read' });
  const denied = result.data.briefing.signals.filter((signal) => signal.state === 'permission_denied');
  assert.ok(denied.length > 0);
  assert.ok(denied.every((signal) => signal.value === null));
  assert.equal(result.data.briefing.coverage.permissionDenied, denied.length);
  assert.equal(result.data.briefing.coverage.complete, false);
});
