// platform/fleet/trips.mjs — Fleet Trips & Fuel Logs Engine.

'use strict';

import crypto from 'node:crypto';
import { FleetError } from './vehicles.mjs';

function nowISO() {
  return new Date().toISOString();
}

export function recordTrip(db, input) {
  const { vehicle_id, driver_id, start_odometer, end_odometer, start_location, end_location, project_id, work_item_id, route_name, origin, destination } = input;
  if (!vehicle_id || !driver_id) {
    throw new FleetError('vehicle_id and driver_id are required', 'INPUT_MISSING_FIELD');
  }

  const dialect = db;
  const veh = dialect.prepare('SELECT * FROM fleet_vehicles WHERE id = ?').get(vehicle_id);
  if (!veh) throw new FleetError(`vehicle ${vehicle_id} not found`, 'VEHICLE_NOT_FOUND');

  const sOdo = start_odometer !== undefined ? Number(start_odometer) : veh.current_odometer;
  const eOdo = end_odometer !== undefined ? Number(end_odometer) : sOdo;
  const dist = Math.max(0.0, eOdo - sOdo);
  const companyId = veh.company_id;
  const id = `trip_${crypto.randomUUID()}`;
  const countRow = dialect.prepare('SELECT COUNT(*) as c FROM fleet_trips WHERE company_id = ?').get(companyId);
  const tripNumber = `TRIP-${String((countRow?.c || 0) + 1).padStart(5, '0')}`;
  const now = nowISO();
  const state = end_odometer !== undefined ? 'completed' : 'in_progress';

  dialect.prepare(`
    INSERT INTO fleet_trips (
      id, company_id, trip_number, vehicle_id, driver_id, project_id, work_item_id,
      route_name, origin, destination, start_time, end_time, start_odometer, end_odometer,
      distance_km, state, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, companyId, tripNumber, vehicle_id, driver_id, project_id || null, work_item_id || null,
    route_name || '', origin || start_location || '', destination || end_location || '', now, now, sOdo, eOdo, dist, state, now, now
  );

  if (eOdo > veh.current_odometer) {
    dialect.prepare('UPDATE fleet_vehicles SET current_odometer = ?, updated_at = ? WHERE id = ?').run(eOdo, now, vehicle_id);
  }

  return { id, trip_number: tripNumber, distance_km: dist, state };
}

export function completeTrip(db, input) {
  const { trip_id, end_odometer, fuel_used_liters } = input;
  const dialect = db;
  const trip = dialect.prepare('SELECT * FROM fleet_trips WHERE id = ?').get(trip_id);
  if (!trip) throw new FleetError(`trip ${trip_id} not found`, 'TRIP_NOT_FOUND');

  const eOdo = Number(end_odometer || trip.start_odometer);
  const dist = Math.max(0.0, eOdo - trip.start_odometer);
  const now = nowISO();

  dialect.prepare(`
    UPDATE fleet_trips
    SET state = 'completed', end_odometer = ?, distance_km = ?, end_time = ?, updated_at = ?
    WHERE id = ?
  `).run(eOdo, dist, now, now, trip_id);

  dialect.prepare('UPDATE fleet_vehicles SET current_odometer = MAX(current_odometer, ?), updated_at = ? WHERE id = ?').run(eOdo, now, trip.vehicle_id);

  return { id: trip_id, state: 'completed', distance_km: dist };
}

export function recordFuel(db, input) {
  const { vehicle_id, driver_id, trip_id, fuel_card_number, odometer, odometer_reading, fuel_qty, fuel_liters, unit_price, total_cost, vendor } = input;
  const fQty = Number(fuel_qty !== undefined ? fuel_qty : (fuel_liters !== undefined ? fuel_liters : 0));
  const cost = Number(total_cost || 0);
  const dialect = db;

  const veh = dialect.prepare('SELECT * FROM fleet_vehicles WHERE id = ?').get(vehicle_id);
  if (!veh) throw new FleetError(`vehicle ${vehicle_id} not found`, 'VEHICLE_NOT_FOUND');

  const uPrice = unit_price !== undefined ? Number(unit_price) : (fQty > 0 ? cost / fQty : 0.0);
  const odo = odometer !== undefined ? Number(odometer) : (odometer_reading !== undefined ? Number(odometer_reading) : veh.current_odometer);

  // Check for fuel anomaly (exceeds tank capacity or high variance)
  let anomalyFlag = 0;
  let anomalyNotes = '';
  if (veh.fuel_tank_capacity && fQty > veh.fuel_tank_capacity) {
    anomalyFlag = 1;
    anomalyNotes = `Fuel quantity ${fQty}L exceeds tank capacity ${veh.fuel_tank_capacity}L`;
  }

  const id = `fuel_${crypto.randomUUID()}`;
  const now = nowISO();

  dialect.prepare(`
    INSERT INTO fleet_fuel_logs (
      id, company_id, vehicle_id, driver_id, trip_id, fuel_card_number, transaction_date,
      odometer, fuel_qty, unit_price, total_cost, vendor, anomaly_flag, anomaly_notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, veh.company_id, vehicle_id, driver_id || veh.current_driver_id || null, trip_id || null,
    fuel_card_number || '', now, odo, fQty, uPrice, cost, vendor || '', anomalyFlag, anomalyNotes, now
  );

  return { id, total_cost: cost, anomaly_flag: anomalyFlag, anomaly_notes: anomalyNotes };
}
