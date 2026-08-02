// BUILD-10 Slice 3: Geofences and Geofence Events
'use strict';

export function createGeofence(db, input, ctx) {
  const companyId = ctx.company_id || ctx.companyId;
  const name = input.name;
  const type = input.type || 'circle';
  const actor = ctx.actor || ctx.actorId || ctx.userId || 'system';
  const now = new Date().toISOString();

  if (!companyId) {
    const error = new Error('Company scope required for geofence create');
    error.code = 'COMPANY_SCOPE_REQUIRED';
    error.statusCode = 400;
    throw error;
  }

  const id = `geo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  db.prepare(`
    INSERT INTO fleet_geofences (id, company_id, branch_id, name, type, center_latitude, center_longitude, radius_meters, polygon_coords_json, speed_limit_kmh, is_active, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
  `).run(id, companyId, ctx.branch_id || ctx.branchId || null, name, type, input.center_latitude || input.lat || 33.3152, input.center_longitude || input.lng || 44.3661, input.radius_meters || 500, JSON.stringify(input.polygon_coords || []), input.speed_limit_kmh || null, actor, now, now);

  return { id, companyId, name, type, isActive: true };
}

export function evaluateGeofenceEvent(db, input, ctx) {
  const companyId = ctx.company_id || ctx.companyId;
  const geofenceId = input.geofence_id || input.geofenceId;
  const vehicleId = input.vehicle_id || input.vehicleId;
  const eventType = input.event_type || input.eventType || 'entry';
  const now = new Date().toISOString();

  const gf = db.prepare('SELECT * FROM fleet_geofences WHERE id = ? AND company_id = ?').get(geofenceId, companyId);
  if (!gf) {
    const error = new Error('Geofence not found or scope denied');
    error.code = 'GEOFENCE_NOT_FOUND';
    error.statusCode = 404;
    throw error;
  }

  const severity = (gf.type === 'restricted' && (eventType === 'entry' || eventType === 'unauthorized_entry')) ? 'critical' : 'info';
  const evtId = `gfe_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  
  const proposal = severity === 'critical' ? { action: 'create_work_item', title: `Geofence violation: ${gf.name}`, severity } : null;

  db.prepare(`
    INSERT INTO fleet_geofence_events (id, company_id, geofence_id, vehicle_id, driver_id, event_type, severity, dwell_duration_minutes, status, work_item_proposal_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
  `).run(evtId, companyId, geofenceId, vehicleId, input.driver_id || null, eventType, severity, input.dwell_duration_minutes || 0, proposal ? JSON.stringify(proposal) : null, now);

  return { id: evtId, geofenceId, vehicleId, eventType, severity, status: 'open', workItemProposal: proposal };
}

export function acknowledgeGeofenceEvent(db, input, ctx) {
  const companyId = ctx.company_id || ctx.companyId;
  const eventId = input.event_id || input.eventId;
  const actor = ctx.actor || ctx.actorId || ctx.userId || 'system';
  const now = new Date().toISOString();

  const evt = db.prepare('SELECT * FROM fleet_geofence_events WHERE id = ? AND company_id = ?').get(eventId, companyId);
  if (!evt) {
    const error = new Error('Geofence event not found or scope denied');
    error.code = 'GEOFENCE_EVENT_NOT_FOUND';
    error.statusCode = 404;
    throw error;
  }

  db.prepare('UPDATE fleet_geofence_events SET status = \'acknowledged\', acknowledged_by = ?, acknowledged_at = ? WHERE id = ?').run(actor, now, eventId);

  return { id: eventId, status: 'acknowledged', acknowledgedBy: actor, acknowledgedAt: now };
}

export function listGeofences(db, params) {
  const companyId = params.company_id || params.companyId;
  if (!companyId) {
    const error = new Error('Company scope required for geofences query');
    error.code = 'COMPANY_SCOPE_REQUIRED';
    error.statusCode = 400;
    throw error;
  }

  let sql = 'SELECT * FROM fleet_geofences WHERE company_id = ?';
  const args = [companyId];

  if (params.is_active !== undefined) {
    sql += ' AND is_active = ?';
    args.push(params.is_active ? 1 : 0);
  }

  return db.prepare(sql).all(...args).map(r => ({
    id: r.id,
    companyId: r.company_id,
    name: r.name,
    type: r.type,
    centerLatitude: r.center_latitude,
    centerLongitude: r.center_longitude,
    radiusMeters: r.radius_meters,
    speedLimitKmh: r.speed_limit_kmh,
    isActive: !!r.is_active
  }));
}
