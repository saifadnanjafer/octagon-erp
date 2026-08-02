// BUILD-10 Slice 3: Maintenance Triggers Integrated with Canonical Maintenance
'use strict';

export function evaluateMaintenanceTrigger(db, input, ctx) {
  const companyId = ctx.company_id || ctx.companyId;
  const vehicleId = input.vehicle_id || input.vehicleId;
  const triggerType = input.trigger_type || input.triggerType || 'odometer';
  const thresholdValue = input.threshold_value || input.thresholdValue;
  const currentValue = input.current_value || input.currentValue;
  const now = new Date().toISOString();

  if (!companyId) {
    const error = new Error('Company scope required for maintenance trigger');
    error.code = 'COMPANY_SCOPE_REQUIRED';
    error.statusCode = 400;
    throw error;
  }

  if (currentValue < thresholdValue) {
    return { triggered: false, currentValue, thresholdValue };
  }

  const proposal = {
    action: 'create_maintenance_request_proposal',
    vehicle_id: vehicleId,
    trigger_type: triggerType,
    current_value: currentValue,
    threshold_value: thresholdValue,
    title: `Scheduled Maintenance Trigger: ${triggerType} threshold reached (${currentValue} >= ${thresholdValue})`
  };

  const id = `fmt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  db.prepare(`
    INSERT INTO fleet_maintenance_triggers (id, company_id, vehicle_id, trigger_type, threshold_value, current_value, status, canonical_maintenance_request_proposal_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'triggered', ?, ?)
  `).run(id, companyId, vehicleId, triggerType, thresholdValue, currentValue, JSON.stringify(proposal), now);

  return { id, vehicleId, triggerType, thresholdValue, currentValue, status: 'triggered', proposal };
}

export function acknowledgeMaintenanceTrigger(db, input, ctx) {
  const companyId = ctx.company_id || ctx.companyId;
  const triggerId = input.trigger_id || input.triggerId;
  const actor = ctx.actor || ctx.actorId || ctx.userId || 'system';
  const now = new Date().toISOString();

  const record = db.prepare('SELECT * FROM fleet_maintenance_triggers WHERE id = ? AND company_id = ?').get(triggerId, companyId);
  if (!record) {
    const error = new Error('Maintenance trigger record not found or scope denied');
    error.code = 'MAINTENANCE_TRIGGER_NOT_FOUND';
    error.statusCode = 404;
    throw error;
  }

  db.prepare('UPDATE fleet_maintenance_triggers SET status = \'acknowledged\', acknowledged_by = ?, acknowledged_at = ? WHERE id = ?').run(actor, now, triggerId);

  return { id: triggerId, status: 'acknowledged', acknowledgedBy: actor, acknowledgedAt: now };
}

export function listMaintenanceTriggers(db, params) {
  const companyId = params.company_id || params.companyId;
  if (!companyId) {
    const error = new Error('Company scope required for maintenance triggers query');
    error.code = 'COMPANY_SCOPE_REQUIRED';
    error.statusCode = 400;
    throw error;
  }

  let sql = 'SELECT * FROM fleet_maintenance_triggers WHERE company_id = ?';
  const args = [companyId];

  if (params.vehicle_id || params.vehicleId) {
    sql += ' AND vehicle_id = ?';
    args.push(params.vehicle_id || params.vehicleId);
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
    vehicleId: r.vehicle_id,
    triggerType: r.trigger_type,
    thresholdValue: r.threshold_value,
    currentValue: r.current_value,
    status: r.status,
    createdAt: r.created_at
  }));
}
