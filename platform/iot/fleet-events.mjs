// BUILD-10 Slice 3: Speeding, Driving Events and Deviations
'use strict';

export function recordSpeedEvent(db, input, ctx) {
  const companyId = ctx.company_id || ctx.companyId;
  const vehicleId = input.vehicle_id || input.vehicleId;
  const speedKmh = input.speed_kmh || input.speedKmh;
  const speedLimitKmh = input.speed_limit_kmh || input.speedLimitKmh || 80;
  const eventType = input.event_type || input.eventType || 'speeding';
  const now = new Date().toISOString();

  if (!companyId) {
    const error = new Error('Company scope required for speed event');
    error.code = 'COMPANY_SCOPE_REQUIRED';
    error.statusCode = 400;
    throw error;
  }

  const excess = speedKmh - speedLimitKmh;
  const severity = excess > 30 ? 'critical' : excess > 10 ? 'warning' : 'info';
  const evtId = `spe_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  db.prepare(`
    INSERT INTO fleet_speed_events (id, company_id, vehicle_id, driver_id, speed_kmh, speed_limit_kmh, duration_seconds, event_type, severity, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)
  `).run(evtId, companyId, vehicleId, input.driver_id || null, speedKmh, speedLimitKmh, input.duration_seconds || 10, eventType, severity, now);

  return { id: evtId, vehicleId, speedKmh, speedLimitKmh, eventType, severity, status: 'open' };
}

export function acknowledgeSpeedEvent(db, input, ctx) {
  const companyId = ctx.company_id || ctx.companyId;
  const eventId = input.event_id || input.eventId;
  const actor = ctx.actor || ctx.actorId || ctx.userId || 'system';
  const now = new Date().toISOString();

  const evt = db.prepare('SELECT * FROM fleet_speed_events WHERE id = ? AND company_id = ?').get(eventId, companyId);
  if (!evt) {
    const error = new Error('Speed event not found or scope denied');
    error.code = 'SPEED_EVENT_NOT_FOUND';
    error.statusCode = 404;
    throw error;
  }

  db.prepare('UPDATE fleet_speed_events SET status = \'acknowledged\', acknowledged_by = ?, acknowledged_at = ? WHERE id = ?').run(actor, now, eventId);

  return { id: eventId, status: 'acknowledged', acknowledgedBy: actor, acknowledgedAt: now };
}

export function listSpeedEvents(db, params) {
  const companyId = params.company_id || params.companyId;
  if (!companyId) {
    const error = new Error('Company scope required for speed events query');
    error.code = 'COMPANY_SCOPE_REQUIRED';
    error.statusCode = 400;
    throw error;
  }

  let sql = 'SELECT * FROM fleet_speed_events WHERE company_id = ?';
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
    driverId: r.driver_id,
    speedKmh: r.speed_kmh,
    speedLimitKmh: r.speed_limit_kmh,
    durationSeconds: r.duration_seconds,
    eventType: r.event_type,
    severity: r.severity,
    status: r.status,
    createdAt: r.created_at
  }));
}
