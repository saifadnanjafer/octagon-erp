// platform/fleet/vehicles.mjs — Fleet Vehicles & Driver Assignments Domain Engine.

'use strict';

import crypto from 'node:crypto';

export class FleetError extends Error {
  constructor(message, code = 'FLEET_ERROR', statusCode = 422) {
    super(message);
    this.name = 'FleetError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function nowISO() {
  return new Date().toISOString();
}

export function createVehicle(db, input) {
  const { name, registration_number, license_plate, asset_id, vehicle_type, fuel_type, fuel_tank_capacity, fuel_capacity_liters, current_odometer, expected_consumption_per_100km } = input;
  const regNum = registration_number || license_plate || `REG-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  if (!name) throw new FleetError('name is required', 'INPUT_MISSING_FIELD');

  const dialect = db;
  const companyId = input.company_id || 'default';
  const id = `veh_${crypto.randomUUID()}`;
  const countRow = dialect.prepare('SELECT COUNT(*) as c FROM fleet_vehicles WHERE company_id = ?').get(companyId);
  const vehNumber = `FLEET-${String((countRow?.c || 0) + 1).padStart(5, '0')}`;
  const now = nowISO();

  const odo = Number(current_odometer || 0);
  const cap = Number(fuel_capacity_liters || fuel_tank_capacity || 60.0);

  dialect.prepare(`
    INSERT INTO fleet_vehicles (
      id, company_id, branch_id, asset_id, vehicle_number, name, registration_number, vehicle_type,
      license_plate, fuel_type, fuel_tank_capacity, current_odometer, expected_consumption_per_100km, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `).run(
    id, companyId, input.branch_id || null, asset_id || null, vehNumber, name, regNum,
    vehicle_type || 'car', license_plate || regNum, fuel_type || 'diesel',
    cap, odo, expected_consumption_per_100km || 10.0, now, now
  );

  return { id, vehicle_number: vehNumber, current_odometer: odo, status: 'active' };
}

export function createDriver(db, input) {
  const { name, license_number, license_class, mobile } = input;
  if (!name || !license_number) throw new FleetError('name and license_number are required', 'INPUT_MISSING_FIELD');

  const dialect = db;
  const companyId = input.company_id || 'default';
  const id = `drv_${crypto.randomUUID()}`;
  const countRow = dialect.prepare('SELECT COUNT(*) as c FROM fleet_drivers WHERE company_id = ?').get(companyId);
  const drvNumber = `DRV-${String((countRow?.c || 0) + 1).padStart(5, '0')}`;
  const now = nowISO();

  dialect.prepare(`
    INSERT INTO fleet_drivers (
      id, company_id, driver_number, name, license_number, license_class, mobile, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    id, companyId, drvNumber, name, license_number, license_class || 'C', mobile || '', now, now
  );

  return { id, driver_number: drvNumber, name, is_active: 1 };
}

export function assignDriver(db, input) {
  const { vehicle_id, driver_id } = input;
  const dialect = db;
  const veh = dialect.prepare('SELECT * FROM fleet_vehicles WHERE id = ?').get(vehicle_id);
  if (!veh) throw new FleetError(`vehicle ${vehicle_id} not found`, 'VEHICLE_NOT_FOUND');

  const drv = dialect.prepare('SELECT * FROM fleet_drivers WHERE id = ?').get(driver_id);
  if (!drv) throw new FleetError(`driver ${driver_id} not found`, 'DRIVER_NOT_FOUND');

  const now = nowISO();
  dialect.prepare('UPDATE fleet_assignments SET is_active = 0, end_date = ? WHERE vehicle_id = ? AND is_active = 1').run(now, vehicle_id);

  const id = `asgn_${crypto.randomUUID()}`;
  dialect.prepare(`
    INSERT INTO fleet_assignments (
      id, company_id, vehicle_id, driver_id, start_date, start_odometer, is_active, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
  `).run(id, veh.company_id, vehicle_id, driver_id, now, veh.current_odometer, now);

  dialect.prepare('UPDATE fleet_vehicles SET current_driver_id = ?, updated_at = ? WHERE id = ?').run(driver_id, now, vehicle_id);

  return { id, vehicle_id, driver_id, is_active: 1, status: 'active' };
}
