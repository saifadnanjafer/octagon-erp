'use strict';

import { MY_WORK_SOURCES, CLOSED_STATUSES } from './my-work-sources.mjs';
import { boundedText, requireCompany, scopedContext, tableExists, validateWarehouse } from './query-utils.mjs';

const PRIORITY_ORDER = Object.freeze({ urgent: 0, critical: 0, high: 1, medium: 2, low: 3 });

function normalize(row, source) {
  const status = String(row.status || 'unknown').toLowerCase();
  const dueAt = row.due_date || null;
  const dueTime = dueAt ? new Date(dueAt).getTime() : Number.POSITIVE_INFINITY;
  const overdue = Number.isFinite(dueTime) && dueTime < Date.now() && !CLOSED_STATUSES.has(status);
  const blocked = ['blocked','short','exception','on_hold','quality_hold'].includes(status) || String(row.stage || '').toLowerCase() === 'blocked';
  const waiting = ['waiting','review','submitted','acknowledged','paused'].includes(status);
  return {
    id: row.id,
    source: source.id,
    sourceLabel: source.label,
    sourceLabelAr: source.labelAr,
    title: boundedText(row.title || `${source.label} item`, 160),
    description: boundedText(row.description || '', 220),
    taskFamily: row.task_family || source.id,
    status,
    stage: row.stage || null,
    priority: String(row.priority || 'medium').toLowerCase(),
    dueAt,
    updatedAt: row.updated_at || null,
    assigneeId: row.assignee_id,
    warehouseId: row.warehouse_id || null,
    reference: row.reference || null,
    target: source.target,
    flags: { overdue, blocked, waiting, closed: CLOSED_STATUSES.has(status) },
  };
}

function sourceRows(source, context) {
  if (!context.can(source.permission)) return { source: source.id, state: 'permission_denied', rows: [] };
  if (!tableExists(context.dialect, source.table)) return { source: source.id, state: 'not_supported', rows: [] };
  if (source.warehouseRequired) {
    const warehouse = validateWarehouse(context.dialect, context.scope);
    if (!warehouse.valid) return { source: source.id, state: 'missing_scope', detail: warehouse.reason, rows: [] };
  }
  try {
    const rows = context.dialect.prepare(source.sql).all(...source.params(context)).map((row) => normalize(row, source));
    return { source: source.id, state: 'ready', rows };
  } catch (error) {
    return { source: source.id, state: 'unavailable', detail: error?.message || 'Source unavailable', rows: [] };
  }
}

function matches(item, query) {
  if (query.task_family && item.taskFamily !== query.task_family) return false;
  if (query.status && item.status !== query.status) return false;
  if (query.priority && item.priority !== query.priority) return false;
  if (query.warehouse_id && item.warehouseId && item.warehouseId !== query.warehouse_id) return false;
  if (query.actor_id && item.assigneeId !== query.actor_id) return false;
  if (query.due === 'overdue' && !item.flags.overdue) return false;
  if (query.due === 'today' && (!item.dueAt || new Date(item.dueAt).toDateString() !== new Date().toDateString())) return false;
  if (query.due === 'none' && item.dueAt) return false;
  if (query.view === 'waiting' && !item.flags.waiting) return false;
  if (query.view === 'blocked' && !item.flags.blocked) return false;
  if (query.view === 'overdue' && !item.flags.overdue) return false;
  if (query.view === 'recent' && !item.flags.closed) return false;
  if (!query.view || ['assigned','active'].includes(query.view)) {
    if (item.flags.closed) return false;
  }
  return true;
}

function sortItems(a, b) {
  if (a.flags.overdue !== b.flags.overdue) return a.flags.overdue ? -1 : 1;
  if (a.flags.blocked !== b.flags.blocked) return a.flags.blocked ? -1 : 1;
  const priority = (PRIORITY_ORDER[a.priority] ?? 4) - (PRIORITY_ORDER[b.priority] ?? 4);
  if (priority) return priority;
  const dueA = a.dueAt ? new Date(a.dueAt).getTime() : Number.POSITIVE_INFINITY;
  const dueB = b.dueAt ? new Date(b.dueAt).getTime() : Number.POSITIVE_INFINITY;
  if (dueA !== dueB) return dueA - dueB;
  return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
}

function facets(items) {
  const unique = (key) => [...new Set(items.map((item) => item[key]).filter(Boolean))].sort();
  return { taskFamilies: unique('taskFamily'), statuses: unique('status'), priorities: unique('priority'), warehouses: unique('warehouseId') };
}

export function buildMyWork({ dialect, ctx, query = {}, can = () => false, now = () => new Date() }) {
  const scope = scopedContext(ctx, query);
  const invalid = requireCompany(scope);
  if (invalid) return invalid;
  if (!scope.userId) return { error: 'authenticated actor scope is required', status: 403 };
  if (query.actor_id && query.actor_id !== scope.userId) return { error: 'actor filter cannot exceed signed-in actor scope', status: 403 };

  const sourceResults = MY_WORK_SOURCES.map((source) => sourceRows(source, { dialect, ctx, query, scope, can }));
  const allItems = sourceResults.flatMap((source) => source.rows);
  const filtered = allItems.filter((item) => matches(item, query)).sort(sortItems);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 50));
  const offset = Math.max(0, Number(query.offset) || 0);
  const generatedAt = now().toISOString();

  return {
    data: {
      page: 'my_work', generatedAt,
      scope: { companyId: scope.companyId, branchId: scope.branchId || null, warehouseId: scope.warehouseId || null, actorId: scope.userId },
      summary: {
        assigned: allItems.filter((item) => !item.flags.closed).length,
        waiting: allItems.filter((item) => item.flags.waiting && !item.flags.closed).length,
        dueToday: allItems.filter((item) => item.dueAt && new Date(item.dueAt).toDateString() === new Date().toDateString() && !item.flags.closed).length,
        overdue: allItems.filter((item) => item.flags.overdue).length,
        blocked: allItems.filter((item) => item.flags.blocked && !item.flags.closed).length,
        recent: allItems.filter((item) => item.flags.closed).length,
      },
      filters: facets(allItems),
      sources: sourceResults.map(({ rows, ...result }) => ({ ...result, count: rows.length })),
      items: filtered.slice(offset, offset + limit),
    },
    meta: { total: filtered.length, limit, offset, generated_at: generatedAt, partial_failures: sourceResults.filter((source) => source.state === 'unavailable').length },
  };
}

