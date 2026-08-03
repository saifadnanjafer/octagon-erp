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
  const companyId = ctx.company_id || ctx.companyId || 'default';
  const clientId = input.client_id || input.clientId;
  const userId = ctx.user_id || ctx.userId || ctx.actor || 'system';
  const commands = input.commands || [];
  const now = new Date().toISOString();

  let acceptedCount = 0;
  let conflictCount = 0;
  let rejectedCount = 0;

  const idMap = {};
  const results = [];

  for (const cmd of commands) {
    let queuedCmd;
    try {
      if (cmd.target_entity === 'gl_journal' || cmd.action_name === 'post_journal' || (cmd.action_name && cmd.action_name.includes('journal'))) {
        const err = new Error('Action not allowed in offline mode');
        err.code = 'OFFLINE_ACTION_DISALLOWED';
        throw err;
      }
      queuedCmd = queueOfflineCommand(db, { ...cmd, client_id: clientId }, ctx);
      acceptedCount++;
      results.push({ localTempId: cmd.local_temp_id || null, status: 'accepted' });
    } catch (error) {
      rejectedCount++;
      results.push({ localTempId: cmd.local_temp_id || null, status: 'rejected', reason: error.code || 'rejected' });
    }
  }

  return { sessionId: `syncs_${Date.now()}`, processedCount: commands.length, rejectedCount, acceptedCount, conflictCount, idMap, results };
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
