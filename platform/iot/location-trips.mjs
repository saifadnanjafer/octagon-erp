// BUILD-10 Slice 3: Live Location Points and Trip Projections
'use strict';

export function recordLocationPoint(db, input, ctx) {
  const companyId = ctx.company_id || ctx.companyId;
  const vehicleId = input.vehicle_id || input.vehicleId;
  const now = new Date().toISOString();

  if (!companyId) {
    const error = new Error('Company scope required for location point');
    error.code = 'COMPANY_SCOPE_REQUIRED';
    error.statusCode = 400;
    throw error;
  }

  const ptId = `pt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  db.prepare(`
    INSERT INTO fleet_location_points (id, company_id, vehicle_id, device_id, driver_id, latitude, longitude, speed_kmh, heading, accuracy_meters, ignition_state, timestamp, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(ptId, companyId, vehicleId, input.device_id || null, input.driver_id || null, input.latitude, input.longitude, input.speed_kmh || 0, input.heading || 0, input.accuracy_meters || 5.0, input.ignition_state !== undefined ? (input.ignition_state ? 1 : 0) : 1, input.timestamp || now, now);

  return { id: ptId, vehicleId, latitude: input.latitude, longitude: input.longitude, speedKmh: input.speed_kmh || 0, timestamp: input.timestamp || now };
}

export function startTrip(db, input, ctx) {
  const companyId = ctx.company_id || ctx.companyId;
  const vehicleId = input.vehicle_id || input.vehicleId;
  const actor = ctx.actor || ctx.actorId || ctx.userId || 'system';
  const now = new Date().toISOString();

  if (!companyId) {
    const error = new Error('Company scope required for trip start');
    error.code = 'COMPANY_SCOPE_REQUIRED';
    error.statusCode = 400;
    throw error;
  }

  const tripId = `trip_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  db.prepare(`
    INSERT INTO fleet_trip_projections (id, company_id, branch_id, vehicle_id, driver_id, start_location_point_id, start_time, distance_km, duration_minutes, idle_duration_minutes, status, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 'in_progress', ?, ?, ?)
  `).run(tripId, companyId, ctx.branch_id || ctx.branchId || null, vehicleId, input.driver_id || null, input.start_location_point_id || null, input.start_time || now, actor, now, now);

  return { id: tripId, vehicleId, status: 'in_progress', startTime: input.start_time || now };
}

export function endTrip(db, input, ctx) {
  const companyId = ctx.company_id || ctx.companyId;
  const tripId = input.trip_id || input.tripId;
  const now = new Date().toISOString();

  const trip = db.prepare('SELECT * FROM fleet_trip_projections WHERE id = ? AND company_id = ?').get(tripId, companyId);
  if (!trip) {
    const error = new Error('Trip not found or scope denied');
    error.code = 'TRIP_NOT_FOUND';
    error.statusCode = 404;
    throw error;
  }

  const dist = input.distance_km || input.distanceKm || 15.5;
  const dur = input.duration_minutes || input.durationMinutes || 30.0;
  const idle = input.idle_duration_minutes || input.idleDurationMinutes || 5.0;

  db.prepare(`
    UPDATE fleet_trip_projections SET status = 'completed', end_location_point_id = ?, end_time = ?, distance_km = ?, duration_minutes = ?, idle_duration_minutes = ?, updated_at = ? WHERE id = ?
  `).run(input.end_location_point_id || null, input.end_time || now, dist, dur, idle, now, tripId);

  return { id: tripId, status: 'completed', distanceKm: dist, durationMinutes: dur, idleDurationMinutes: idle };
}

export function listTrips(db, params) {
  const companyId = params.company_id || params.companyId;
  if (!companyId) {
    const error = new Error('Company scope required for trip query');
    error.code = 'COMPANY_SCOPE_REQUIRED';
    error.statusCode = 400;
    throw error;
  }

  let sql = 'SELECT * FROM fleet_trip_projections WHERE company_id = ?';
  const args = [companyId];

  if (params.vehicle_id || params.vehicleId) {
    sql += ' AND vehicle_id = ?';
    args.push(params.vehicle_id || params.vehicleId);
  }
  if (params.status) {
    sql += ' AND status = ?';
    args.push(params.status);
  }

  sql += ' ORDER BY start_time DESC LIMIT ? OFFSET ?';
  args.push(params.limit || 50, params.offset || 0);

  return db.prepare(sql).all(...args).map(r => ({
    id: r.id,
    companyId: r.company_id,
    vehicleId: r.vehicle_id,
    driverId: r.driver_id,
    startTime: r.start_time,
    endTime: r.end_time,
    distanceKm: r.distance_km,
    durationMinutes: r.duration_minutes,
    idleDurationMinutes: r.idle_duration_minutes,
    status: r.status
  }));
}
