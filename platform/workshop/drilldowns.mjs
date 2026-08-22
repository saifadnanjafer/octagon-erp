'use strict';

import { WORKSHOP_DRILLDOWNS } from './drilldown-catalog.mjs';
import { boundedText, requireCompany, scopedContext, tableExists, validateWarehouse } from './query-utils.mjs';

function normalizeRow(row, definition) {
  return {
    id: row.id,
    title: boundedText(row.title || row.reference || row.id, 160),
    type: row.type || definition.id,
    status: row.status || 'unknown',
    priority: row.priority || 'normal',
    dueAt: row.due_at || null,
    ownerId: row.owner_id || null,
    updatedAt: row.updated_at || null,
    reference: row.reference || null,
    target: definition.target,
  };
}
export function buildWorkshopDrilldown({ dialect, ctx, query = {}, can = () => false, now = () => new Date() }) {
  const scope = scopedContext(ctx, query);
  const invalid = requireCompany(scope);
  if (invalid) return invalid;
  const metricId = String(query.metric_id || '').trim();
  const definition = WORKSHOP_DRILLDOWNS[metricId];
  if (!definition) return { error: 'unknown command-center metric', status: 404 };
  if (!can(definition.permission)) return { error: 'permission denied for command-center drilldown', status: 403 };
  if (!tableExists(dialect, definition.table)) return { error: `${definition.table} authority is unavailable`, status: 404 };
  if (definition.warehouseRequired) {
    const warehouse = validateWarehouse(dialect, scope);
    if (!warehouse.valid) return { error: warehouse.reason, status: 403 };
  }
  const limit = Math.min(50, Math.max(1, Number(query.limit) || 20));
  try {
    const rows = dialect.prepare(definition.sql).all(...definition.params({ scope, query, limit })).map((row) => normalizeRow(row, definition));
    const generatedAt = now().toISOString();
    return {
      data: {
        metricId, target: definition.target, permission: definition.permission,
        description: definition.description, generatedAt,
        scope: { companyId: scope.companyId, branchId: scope.branchId || null, warehouseId: scope.warehouseId || null, actorId: scope.actorId || null },
        rows,
      },
      meta: { total: rows.length, limit, generated_at: generatedAt, bounded: true },
    };
  } catch (error) {
    return { error: error?.message || 'drilldown query failed', status: 422, code: error?.code || 'WORKSHOP_DRILLDOWN_FAILED' };
  }
}
