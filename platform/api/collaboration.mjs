// platform/api/collaboration.mjs — Governed collaboration read queries.
//
// Exposes HistoryService and ChatterService read queries.

'use strict';

export const COLLABORATION_NAMESPACES = Object.freeze([
  'collaboration',
  'chatter',
  'history',
]);

export function handleCollaborationQuery({ dialect, ctx, deps = {}, resource, recordId = null, query = {} }) {
  const chatterService = deps.chatterService;
  const historyService = deps.historyService;

  if (!chatterService || !historyService) {
    return { error: 'collaboration services not initialized', status: 500 };
  }

  try {
    if (resource === 'messages') {
      const entity = query.entity;
      const recId = query.record_id || recordId;
      if (!entity || !recId) return { error: 'entity and record_id required', status: 400 };
      const rows = chatterService.messages(entity, recId, ctx, {
        readPermission: query.read_permission,
        limit: Number(query.limit) || 100,
      });
      return { data: rows, meta: { total: rows.length } };
    }

    if (resource === 'followers') {
      const entity = query.entity;
      const recId = query.record_id || recordId;
      if (!entity || !recId) return { error: 'entity and record_id required', status: 400 };
      const rows = chatterService.followers(entity, recId);
      return { data: rows, meta: { total: rows.length } };
    }

    if (resource === 'activities') {
      if (recordId) {
        const item = chatterService.getActivity(recordId);
        if (!item) return { error: 'activity not found', status: 404 };
        return { data: item };
      }
      const entity = query.entity;
      const recId = query.record_id;
      if (entity && recId) {
        // Query activities for a specific record
        const rows = dialect.prepare("SELECT id FROM activities WHERE entity = ? AND record_id = ? ORDER BY due_at")
          .all(entity, recId)
          .map((r) => chatterService.getActivity(r.id));
        return { data: rows, meta: { total: rows.length } };
      }
      const rows = chatterService.myActivities(ctx, { overdueOnly: query.overdue === 'true' || query.overdue === '1' });
      return { data: rows, meta: { total: rows.length } };
    }

    if (resource === 'my-activities' || resource === 'my_activities') {
      const rows = chatterService.myActivities(ctx, { overdueOnly: query.overdue === 'true' || query.overdue === '1' });
      return { data: rows, meta: { total: rows.length } };
    }

    if (resource === 'history') {
      const entity = query.entity;
      const recId = query.record_id || recordId;
      if (!entity || !recId) return { error: 'entity and record_id required', status: 400 };
      const rows = historyService.read(entity, recId, ctx, { limit: Number(query.limit) || 200 });
      return { data: rows, meta: { total: rows.length } };
    }

    if (resource === 'snapshots') {
      const entity = query.entity;
      const recId = query.record_id || recordId;
      if (!entity || !recId) return { error: 'entity and record_id required', status: 400 };
      const rows = historyService.snapshots(entity, recId);
      return { data: rows, meta: { total: rows.length } };
    }

    if (resource === 'snapshot-verify' || resource === 'snapshot_verify') {
      const targetId = recordId || query.id;
      if (!targetId) return { error: 'snapshot id required', status: 400 };
      const result = historyService.verifySnapshot(targetId);
      return { data: result };
    }

    if (resource === 'lineage') {
      const entity = query.entity;
      const recId = query.record_id || recordId;
      if (!entity || !recId) return { error: 'entity and record_id required', status: 400 };
      const rows = historyService.lineage(entity, recId);
      return { data: rows, meta: { total: rows.length } };
    }

    return { error: 'collaboration query resource not found', status: 404 };
  } catch (err) {
    if (err.name === 'AuthorizationError' || err.code === 'PERMISSION_DENIED') {
      return { error: err.message, status: 403 };
    }
    return { error: err.message || 'collaboration query error', status: 500 };
  }
}
