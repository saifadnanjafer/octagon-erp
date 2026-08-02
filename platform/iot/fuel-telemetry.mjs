// BUILD-10 Slice 3: Fuel Telemetry and Suspected Fuel Loss Classification
'use strict';

export function recordFuelReading(db, input, ctx) {
  const companyId = ctx.company_id || ctx.companyId;
  const vehicleId = input.vehicle_id || input.vehicleId;
  const rawPct = input.raw_fuel_percentage !== undefined ? input.raw_fuel_percentage : input.rawFuelPercentage;
  const calLiters = input.calibrated_liters !== undefined ? input.calibrated_liters : input.calibratedLiters || (rawPct * 3.0);
  const previousLiters = input.previous_liters !== undefined ? input.previous_liters : calLiters;
  const now = new Date().toISOString();

  if (!companyId) {
    const error = new Error('Company scope required for fuel reading');
    error.code = 'COMPANY_SCOPE_REQUIRED';
    error.statusCode = 400;
    throw error;
  }

  let classification = 'normal_consumption';
  let dropLiters = 0;
  let status = 'normal';
  let workItemProposal = null;

  const diff = previousLiters - calLiters;
  if (diff < -10) {
    classification = 'refuel';
  } else if (diff > 15 && (input.is_parked || input.ignition_state === 0)) {
    classification = 'suspected_fuel_loss';
    dropLiters = diff;
    status = 'investigation_required';
    workItemProposal = {
      action: 'create_work_item',
      title: `Suspected Fuel Loss: ${dropLiters}L on Vehicle ${vehicleId}`,
      severity: 'warning',
      classification: 'suspected_fuel_loss'
    };
  }

  const id = `flt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  db.prepare(`
    INSERT INTO fleet_fuel_telemetry (id, company_id, vehicle_id, sensor_device_id, raw_fuel_percentage, calibrated_liters, event_classification, drop_liters, status, investigation_work_item_proposal_json, timestamp, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, companyId, vehicleId, input.sensor_device_id || null, rawPct, calLiters, classification, dropLiters, status, workItemProposal ? JSON.stringify(workItemProposal) : null, input.timestamp || now, now);

  return { id, vehicleId, rawFuelPercentage: rawPct, calibratedLiters: calLiters, eventClassification: classification, dropLiters, status, investigationProposal: workItemProposal };
}

export function investigateFuelAnomaly(db, input, ctx) {
  const companyId = ctx.company_id || ctx.companyId;
  const fuelId = input.fuel_id || input.fuelId;
  const classification = input.classification || 'resolved_normal';
  const actor = ctx.actor || ctx.actorId || ctx.userId || 'system';
  const now = new Date().toISOString();

  const record = db.prepare('SELECT * FROM fleet_fuel_telemetry WHERE id = ? AND company_id = ?').get(fuelId, companyId);
  if (!record) {
    const error = new Error('Fuel record not found or scope denied');
    error.code = 'FUEL_RECORD_NOT_FOUND';
    error.statusCode = 404;
    throw error;
  }

  db.prepare('UPDATE fleet_fuel_telemetry SET status = \'resolved\', acknowledged_by = ?, acknowledged_at = ? WHERE id = ?').run(actor, now, fuelId);

  return { id: fuelId, status: 'resolved', classification, acknowledgedBy: actor, acknowledgedAt: now };
}

export function listFuelTelemetry(db, params) {
  const companyId = params.company_id || params.companyId;
  if (!companyId) {
    const error = new Error('Company scope required for fuel query');
    error.code = 'COMPANY_SCOPE_REQUIRED';
    error.statusCode = 400;
    throw error;
  }

  let sql = 'SELECT * FROM fleet_fuel_telemetry WHERE company_id = ?';
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
    rawFuelPercentage: r.raw_fuel_percentage,
    calibratedLiters: r.calibrated_liters,
    eventClassification: r.event_classification,
    dropLiters: r.drop_liters,
    status: r.status,
    createdAt: r.created_at
  }));
}
