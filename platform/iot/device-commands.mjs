// BUILD-10 Slice 2: Provider-Neutral Simulated Device Commands Orchestration
'use strict';

const HIGH_RISK_COMMANDS = ['reboot_simulation', 'activate_simulated_output'];

export function requestCommand(db, input, ctx) {
  const companyId = ctx.company_id || ctx.companyId;
  const deviceId = input.device_id || input.deviceId;
  const commandType = input.command_type || input.commandType;
  const actor = ctx.actor || ctx.actorId || ctx.userId || 'system';
  const now = new Date().toISOString();

  if (!companyId) {
    const error = new Error('Company scope required for command request');
    error.code = 'COMPANY_SCOPE_REQUIRED';
    error.statusCode = 400;
    throw error;
  }

  const device = db.prepare('SELECT company_id, lifecycle_state FROM iot_devices WHERE id = ?').get(deviceId);
  if (!device || device.company_id !== companyId) {
    const error = new Error('Device not found or scope denied');
    error.code = 'DEVICE_SCOPE_DENIED';
    error.statusCode = 403;
    throw error;
  }
  if (['revoked', 'retired', 'lost'].includes(device.lifecycle_state)) {
    const error = new Error(`Cannot dispatch command to ${device.lifecycle_state} device`);
    error.code = 'DEVICE_STATE_INVALID';
    error.statusCode = 422;
    throw error;
  }

  const riskLevel = HIGH_RISK_COMMANDS.includes(commandType) ? 'high' : 'low';
  const requiresApproval = riskLevel === 'high' ? 1 : 0;
  const initialStatus = requiresApproval ? 'submitted' : 'queued';

  const cmdId = `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  db.prepare(`
    INSERT INTO iot_device_commands (id, company_id, device_id, command_type, parameters_json, risk_level, status, requires_approval, requested_by, correlation_id, idempotency_key, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(cmdId, companyId, deviceId, commandType, JSON.stringify(input.parameters || {}), riskLevel, initialStatus, requiresApproval, actor, input.correlation_id || null, input.idempotency_key || null, actor, now, now);

  return { id: cmdId, deviceId, commandType, riskLevel, status: initialStatus, requiresApproval: !!requiresApproval };
}

export function approveCommand(db, input, ctx) {
  const companyId = ctx.company_id || ctx.companyId;
  const cmdId = input.command_id || input.commandId;
  const actor = ctx.actor || ctx.actorId || ctx.userId || 'system';
  const now = new Date().toISOString();

  const cmd = db.prepare('SELECT * FROM iot_device_commands WHERE id = ? AND company_id = ?').get(cmdId, companyId);
  if (!cmd) {
    const error = new Error('Command not found or scope denied');
    error.code = 'COMMAND_NOT_FOUND';
    error.statusCode = 404;
    throw error;
  }
  if (cmd.status !== 'submitted') {
    const error = new Error(`Command in status ${cmd.status} cannot be approved`);
    error.code = 'COMMAND_STATE_INVALID';
    error.statusCode = 422;
    throw error;
  }
  if (cmd.requested_by === actor) {
    const error = new Error('Maker-checker rule: Command approver must differ from requester');
    error.code = 'MAKER_CHECKER_VIOLATION';
    error.statusCode = 403;
    throw error;
  }

  db.prepare(`
    UPDATE iot_device_commands SET status = 'queued', approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?
  `).run(actor, now, now, cmdId);

  return { id: cmdId, status: 'queued', approvedBy: actor, approvedAt: now };
}

export function dispatchSimulatedCommand(db, input, ctx) {
  const companyId = ctx.company_id || ctx.companyId;
  const cmdId = input.command_id || input.commandId;
  const now = new Date().toISOString();

  const cmd = db.prepare('SELECT * FROM iot_device_commands WHERE id = ? AND company_id = ?').get(cmdId, companyId);
  if (!cmd) {
    const error = new Error('Command not found or scope denied');
    error.code = 'COMMAND_NOT_FOUND';
    error.statusCode = 404;
    throw error;
  }
  if (cmd.status !== 'queued') {
    const error = new Error(`Command in status ${cmd.status} cannot be dispatched`);
    error.code = 'COMMAND_STATE_INVALID';
    error.statusCode = 422;
    throw error;
  }

  const result = { simulated: true, executed_at: now, command: cmd.command_type, status: 'success' };
  db.prepare(`
    UPDATE iot_device_commands SET status = 'completed', dispatched_at = ?, acknowledged_at = ?, completed_at = ?, result_json = ?, updated_at = ? WHERE id = ?
  `).run(now, now, now, JSON.stringify(result), now, cmdId);

  return { id: cmdId, status: 'completed', result };
}

export function listDeviceCommands(db, params) {
  const companyId = params.company_id || params.companyId;
  if (!companyId) {
    const error = new Error('Company scope required for command query');
    error.code = 'COMPANY_SCOPE_REQUIRED';
    error.statusCode = 400;
    throw error;
  }

  let sql = 'SELECT * FROM iot_device_commands WHERE company_id = ?';
  const args = [companyId];

  if (params.device_id || params.deviceId) {
    sql += ' AND device_id = ?';
    args.push(params.device_id || params.deviceId);
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
    deviceId: r.device_id,
    commandType: r.command_type,
    riskLevel: r.risk_level,
    status: r.status,
    requiresApproval: !!r.requires_approval,
    requestedBy: r.requested_by,
    approvedBy: r.approved_by,
    createdAt: r.created_at
  }));
}
