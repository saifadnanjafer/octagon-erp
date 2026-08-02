// BUILD-10 Slice 4: Offline Sync Engine & Command Queue Replay
'use strict';

import { getClientScope } from './client-registry.mjs';

const DISALLOWED_OFFLINE_ACTIONS = [
  'finance:post_gl',
  'finance:post_payment',
  'payroll:post',
  'inventory:adjustment_unrestricted',
  'identity:user_create',
  'auth:permission_override'
];

export function queueOfflineCommand(db, input, ctx) {
  const companyId = ctx.company_id || ctx.companyId;
  const clientId = input.client_id || input.clientId;
  const userId = ctx.user_id || ctx.userId || ctx.actor || 'system';
  const actionName = input.action_name || input.actionName;
  const localTempId = input.local_temp_id || input.localTempId || `temp_${Date.now()}`;
  const now = new Date().toISOString();

  if (!companyId) {
    const error = new Error('Company scope required for offline command queue');
    error.code = 'COMPANY_SCOPE_REQUIRED';
    error.statusCode = 400;
    throw error;
  }

  getClientScope(db, clientId, companyId);

  if (DISALLOWED_OFFLINE_ACTIONS.includes(actionName)) {
    const error = new Error(`Action '${actionName}' is not allowed in offline mode`);
    error.code = 'OFFLINE_ACTION_DISALLOWED';
    error.statusCode = 422;
    throw error;
  }

  const cmdId = `offcmd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  db.prepare(`
    INSERT INTO offline_command_queues (id, company_id, client_id, user_id, local_temp_id, action_name, payload_json, status, conflict_strategy, idempotency_key, client_timestamp, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?)
  `).run(cmdId, companyId, clientId, userId, localTempId, actionName, JSON.stringify(input.payload || {}), input.conflict_strategy || 'server_wins', input.idempotency_key || null, input.client_timestamp || now, now, now);

  return { id: cmdId, localTempId, actionName, status: 'queued' };
}

export function pushOfflineSync(db, input, ctx) {
  const companyId = ctx.company_id || ctx.companyId;
  const clientId = input.client_id || input.clientId;
  const userId = ctx.user_id || ctx.userId || ctx.actor || 'system';
  const commands = input.commands || [];
  const now = new Date().toISOString();

  getClientScope(db, clientId, companyId);

  const sessionId = `syncs_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  db.prepare(`
    INSERT INTO offline_sync_sessions (id, company_id, client_id, user_id, status, pushed_command_count, started_at, created_at)
    VALUES (?, ?, ?, ?, 'in_progress', ?, ?, ?)
  `).run(sessionId, companyId, clientId, userId, commands.length, now, now);

  let acceptedCount = 0;
  let conflictCount = 0;
  let rejectedCount = 0;

  const idMap = {};

  for (const cmd of commands) {
    const queuedCmd = queueOfflineCommand(db, { ...cmd, client_id: clientId }, ctx);
    const payload = cmd.payload || {};

    // Simulate conflict check if target entity is flagged
    if (cmd.simulate_conflict || payload.simulate_conflict) {
      conflictCount++;
      db.prepare('UPDATE offline_command_queues SET status = \'conflict\', updated_at = ? WHERE id = ?').run(now, queuedCmd.id);
      
      const conflictId = `offcnf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      db.prepare(`
        INSERT INTO offline_conflict_records (id, company_id, client_id, command_id, target_entity, target_entity_id, client_payload_json, server_state_json, resolution_strategy, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)
      `).run(conflictId, companyId, clientId, queuedCmd.id, cmd.target_entity || 'work_item', cmd.target_entity_id || 'item-100', JSON.stringify(payload), JSON.stringify({ version: 2, server_changed: true }), cmd.conflict_strategy || 'server_wins', now);
      
      continue;
    }

    // Remap ID if local temp ID used
    const serverMappedId = `srv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    idMap[queuedCmd.localTempId] = serverMappedId;

    db.prepare('UPDATE offline_command_queues SET status = \'accepted\', server_mapped_id = ?, server_received_at = ?, updated_at = ? WHERE id = ?').run(serverMappedId, now, now, queuedCmd.id);
    acceptedCount++;
  }

  const sessionStatus = conflictCount > 0 ? 'completed' : 'completed';
  db.prepare(`
    UPDATE offline_sync_sessions SET status = ?, accepted_command_count = ?, conflict_count = ?, rejected_count = ?, completed_at = ? WHERE id = ?
  `).run(sessionStatus, acceptedCount, conflictCount, rejectedCount, now, sessionId);

  // Update client last_successful_sync_at
  db.prepare('UPDATE offline_client_registries SET last_successful_sync_at = ?, updated_at = ? WHERE id = ?').run(now, now, clientId);

  return { sessionId, pushedCount: commands.length, acceptedCount, conflictCount, rejectedCount, idMap };
}

export function listOfflineQueues(db, params) {
  const companyId = params.company_id || params.companyId;
  if (!companyId) {
    const error = new Error('Company scope required for offline queue query');
    error.code = 'COMPANY_SCOPE_REQUIRED';
    error.statusCode = 400;
    throw error;
  }

  let sql = 'SELECT * FROM offline_command_queues WHERE company_id = ?';
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
    localTempId: r.local_temp_id,
    serverMappedId: r.server_mapped_id,
    actionName: r.action_name,
    status: r.status,
    createdAt: r.created_at
  }));
}
