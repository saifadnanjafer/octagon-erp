// BUILD-10 Slice 4: Offline Conflict Resolution Service
'use strict';

export function resolveConflict(db, input, ctx) {
  const companyId = ctx.company_id || ctx.companyId;
  const conflictId = input.conflict_id || input.conflictId;
  const strategy = input.resolution_strategy || input.resolutionStrategy || 'server_wins';
  const note = input.resolution_note || input.resolutionNote || 'Resolved via governed conflict resolution';
  const actor = ctx.actor || ctx.actorId || ctx.userId || 'system';
  const now = new Date().toISOString();

  if (!companyId) {
    const error = new Error('Company scope required for conflict resolution');
    error.code = 'COMPANY_SCOPE_REQUIRED';
    error.statusCode = 400;
    throw error;
  }

  const conflict = db.prepare('SELECT * FROM offline_conflict_records WHERE id = ? AND company_id = ?').get(conflictId, companyId);
  if (!conflict) {
    const error = new Error('Conflict record not found or scope denied');
    error.code = 'CONFLICT_NOT_FOUND';
    error.statusCode = 404;
    throw error;
  }

  db.prepare(`
    UPDATE offline_conflict_records SET resolution_strategy = ?, status = 'resolved', resolved_by = ?, resolved_at = ?, resolution_note = ? WHERE id = ?
  `).run(strategy, actor, now, note, conflictId);

  db.prepare('UPDATE offline_command_queues SET status = \'accepted\', updated_at = ? WHERE id = ?').run(now, conflict.command_id);

  return { id: conflictId, commandId: conflict.command_id, resolutionStrategy: strategy, status: 'resolved', resolvedBy: actor, resolvedAt: now };
}

export function listConflicts(db, params) {
  const companyId = params.company_id || params.companyId;
  if (!companyId) {
    const error = new Error('Company scope required for conflicts query');
    error.code = 'COMPANY_SCOPE_REQUIRED';
    error.statusCode = 400;
    throw error;
  }

  let sql = 'SELECT * FROM offline_conflict_records WHERE company_id = ?';
  const args = [companyId];

  if (params.client_id || params.clientId) {
    sql += ' AND client_id = ?';
    args.push(params.client_id || params.clientId);
  }
  if (params.status) {
    sql += ' AND status = ?';
    args.push(params.status);
  }

  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  args.push(params.limit || 50, params.offset || 0);

  return db.prepare(sql).all(...args).map(r => ({
    id: r.id,
    companyId: r.company_id,
    clientId: r.client_id,
    commandId: r.command_id,
    targetEntity: r.target_entity,
    targetEntityId: r.target_entity_id,
    resolutionStrategy: r.resolution_strategy,
    status: r.status,
    createdAt: r.created_at
  }));
}
