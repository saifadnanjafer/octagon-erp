// BUILD-10 Slice 3: Fleet Device Mapping, Sensors & Calibrations
'use strict';

export function mapFleetDevice(db, input, ctx) {
  const companyId = ctx.company_id || ctx.companyId;
  const vehicleId = input.vehicle_id || input.vehicleId;
  const trackerDeviceId = input.tracker_device_id || input.trackerDeviceId || null;
  const fuelSensorDeviceId = input.fuel_sensor_device_id || input.fuelSensorDeviceId || null;
  const actor = ctx.actor || ctx.actorId || ctx.userId || 'system';
  const now = new Date().toISOString();

  if (!companyId) {
    const error = new Error('Company scope required for fleet device mapping');
    error.code = 'COMPANY_SCOPE_REQUIRED';
    error.statusCode = 400;
    throw error;
  }

  // Validate vehicle scope
  const vehicle = db.prepare('SELECT company_id FROM fleet_vehicles WHERE id = ?').get(vehicleId);
  if (!vehicle || vehicle.company_id !== companyId) {
    const error = new Error('Vehicle not found or scope denied');
    error.code = 'VEHICLE_SCOPE_DENIED';
    error.statusCode = 403;
    throw error;
  }

  // Deactivate any current mapping
  db.prepare('UPDATE fleet_device_mappings SET is_active = 0, removal_date = ?, updated_at = ? WHERE company_id = ? AND vehicle_id = ? AND is_active = 1').run(now, now, companyId, vehicleId);

  const id = `fdm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  db.prepare(`
    INSERT INTO fleet_device_mappings (id, company_id, branch_id, vehicle_id, asset_id, tracker_device_id, fuel_sensor_device_id, driver_id, installation_date, odometer_offset_km, fuel_calibration_json, is_active, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
  `).run(id, companyId, ctx.branch_id || ctx.branchId || null, vehicleId, input.asset_id || null, trackerDeviceId, fuelSensorDeviceId, input.driver_id || null, input.installation_date || now, input.odometer_offset_km || 0, JSON.stringify(input.fuel_calibration || {}), actor, now, now);

  if (trackerDeviceId) {
    db.prepare('UPDATE iot_devices SET vehicle_id = ? WHERE id = ?').run(vehicleId, trackerDeviceId);
  }
  if (fuelSensorDeviceId) {
    db.prepare('UPDATE iot_devices SET vehicle_id = ? WHERE id = ?').run(vehicleId, fuelSensorDeviceId);
  }

  return { id, companyId, vehicleId, trackerDeviceId, fuelSensorDeviceId, isActive: true };
}

export function calibrateOdometer(db, input, ctx) {
  const companyId = ctx.company_id || ctx.companyId;
  const vehicleId = input.vehicle_id || input.vehicleId;
  const offsetKm = input.odometer_offset_km || input.odometerOffsetKm || 0;
  const now = new Date().toISOString();

  const mapping = db.prepare('SELECT * FROM fleet_device_mappings WHERE company_id = ? AND vehicle_id = ? AND is_active = 1').get(companyId, vehicleId);
  if (!mapping) {
    const error = new Error('No active device mapping found for vehicle');
    error.code = 'MAPPING_NOT_FOUND';
    error.statusCode = 404;
    throw error;
  }

  db.prepare('UPDATE fleet_device_mappings SET odometer_offset_km = ?, updated_at = ? WHERE id = ?').run(offsetKm, now, mapping.id);

  return { mappingId: mapping.id, vehicleId, odometerOffsetKm: offsetKm };
}

export function listFleetDeviceMappings(db, params) {
  const companyId = params.company_id || params.companyId;
  if (!companyId) {
    const error = new Error('Company scope required for device mapping query');
    error.code = 'COMPANY_SCOPE_REQUIRED';
    error.statusCode = 400;
    throw error;
  }

  let sql = 'SELECT * FROM fleet_device_mappings WHERE company_id = ?';
  const args = [companyId];

  if (params.vehicle_id || params.vehicleId) {
    sql += ' AND vehicle_id = ?';
    args.push(params.vehicle_id || params.vehicleId);
  }
  if (params.is_active !== undefined) {
    sql += ' AND is_active = ?';
    args.push(params.is_active ? 1 : 0);
  }

  return db.prepare(sql).all(...args).map(r => ({
    id: r.id,
    companyId: r.company_id,
    vehicleId: r.vehicle_id,
    trackerDeviceId: r.tracker_device_id,
    fuelSensorDeviceId: r.fuel_sensor_device_id,
    driverId: r.driver_id,
    installationDate: r.installation_date,
    odometerOffsetKm: r.odometer_offset_km,
    isActive: !!r.is_active
  }));
}
