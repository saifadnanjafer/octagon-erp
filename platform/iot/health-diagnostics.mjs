// BUILD-10 Slice 2: Device Health, Diagnostics and Alerts
'use strict';

export function calculateDeviceHealth(db, input, ctx) {
  const companyId = ctx.company_id || ctx.companyId;
  const deviceId = input.device_id || input.deviceId;

  const device = db.prepare('SELECT * FROM iot_devices WHERE id = ? AND company_id = ?').get(deviceId, companyId);
  if (!device) {
    const error = new Error('Device not found or scope denied');
    error.code = 'DEVICE_SCOPE_DENIED';
    error.statusCode = 403;
    throw error;
  }

  const now = new Date().toISOString();
  const actor = ctx.actor || ctx.actorId || ctx.userId || 'system';

  // Check last seen
  let missedIntervals = 0;
  let healthState = 'online';
  let healthScore = 100.0;

  if (!device.last_seen_at) {
    healthState = 'unknown';
    healthScore = 50.0;
  } else {
    const lastSeenMs = new Date(device.last_seen_at).getTime();
    const nowMs = new Date().getTime();
    const diffSec = (nowMs - lastSeenMs) / 1000;

    if (diffSec > 3600) {
      healthState = 'offline';
      healthScore = 0.0;
      missedIntervals = Math.floor(diffSec / 300);
    } else if (diffSec > 600) {
      healthState = 'warning';
      healthScore = 65.0;
      missedIntervals = Math.floor(diffSec / 300);
    }
  }

  const healthId = `hlth_${deviceId}`;
  db.prepare(`
    INSERT INTO iot_device_health (
      id, company_id, device_id, health_state, health_score, missed_interval_count,
      battery_condition, signal_condition, clock_skew_seconds, sensor_fault, gateway_fault,
      data_quality_fault, firmware_mismatch, config_mismatch, restart_count,
      communication_error_count, last_seen_at, evaluated_at, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'good', 'strong', 0, 0, 0, 0, 0, 0, 0, 0, ?, ?, ?, ?, ?)
    ON CONFLICT(company_id, device_id) DO UPDATE SET
      health_state = excluded.health_state,
      health_score = excluded.health_score,
      missed_interval_count = excluded.missed_interval_count,
      last_seen_at = excluded.last_seen_at,
      evaluated_at = excluded.evaluated_at,
      updated_at = excluded.updated_at
  `).run(healthId, companyId, deviceId, healthState, healthScore, missedIntervals, device.last_seen_at, now, actor, now, now);

  db.prepare('UPDATE iot_devices SET health_state = ? WHERE id = ?').run(healthState, deviceId);

  return { deviceId, healthState, healthScore, missedIntervals, evaluatedAt: now };
}

export function acknowledgeAlert(db, input, ctx) {
  const companyId = ctx.company_id || ctx.companyId;
  const alertId = input.alert_id || input.alertId;
  const actor = ctx.actor || ctx.actorId || ctx.userId || 'system';
  const now = new Date().toISOString();

  const alert = db.prepare('SELECT * FROM iot_device_alerts WHERE id = ? AND company_id = ?').get(alertId, companyId);
  if (!alert) {
    const error = new Error('Alert not found or scope denied');
    error.code = 'ALERT_NOT_FOUND';
    error.statusCode = 404;
    throw error;
  }

  db.prepare(`
    UPDATE iot_device_alerts SET status = 'acknowledged', acknowledged_by = ?, acknowledged_at = ?, updated_at = ? WHERE id = ?
  `).run(actor, now, now, alertId);

  return { alertId, status: 'acknowledged', acknowledgedBy: actor, acknowledgedAt: now };
}

export function listAlerts(db, params) {
  const companyId = params.company_id || params.companyId;
  if (!companyId) {
    const error = new Error('Company scope required for alerts query');
    error.code = 'COMPANY_SCOPE_REQUIRED';
    error.statusCode = 400;
    throw error;
  }

  let sql = 'SELECT * FROM iot_device_alerts WHERE company_id = ?';
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
    alertType: r.alert_type,
    severity: r.severity,
    message: r.message,
    status: r.status,
    acknowledgedBy: r.acknowledged_by,
    acknowledgedAt: r.acknowledged_at,
    createdAt: r.created_at
  }));
}
