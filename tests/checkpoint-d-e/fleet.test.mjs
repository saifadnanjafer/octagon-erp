// Checkpoint E5 — Fleet Vehicles, Drivers, Trips, Fraud-Protected Fuel Logs, and Telematics Ingestion.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, before, after } from 'node:test';

import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';

let tempDir;
let db;
let executor;
let ctx;
let ikCount = 0;

function ik(prefix) {
  ikCount += 1;
  return `${prefix}_${Date.now()}_${ikCount}`;
}

const execute = (actionId, input, key) => executor.execute(actionId, { ...input, idempotency_key: key }, ctx);

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-fleet-test-'));
  const dbPath = path.join(tempDir, 'fleet.db');
  await freshInstall({ dbPath, backupDir: path.join(tempDir, 'backups'), actor: 'fleet-test' });
  db = openMigrationDatabase(dbPath);

  const auth = createPlatformAuthority(db);
  executor = auth.actionExecutor;
  ctx = { tenantId: 'default', companyId: 'default', userId: 'usr_fleet_mgr', roles: ['admin', 'fleet_manager'] };
});

after(() => {
  try { db?.close(); } catch {}
  if (tempDir && fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Fleet vehicle creation, driver assignment, trip execution, fuel anomaly detection, and telematics ingestion', () => {
  // 0. Create Asset Category & Asset
  const cat = execute('assets:category:create', {
    company_id: 'default',
    code: 'CAT-FLEET',
    name: 'Fleet Vehicles Category',
    name_en: 'Fleet Vehicles Category'
  }, ik('fleet_asset_cat'));

  const asset = execute('assets:asset:create', {
    company_id: 'default',
    category_id: cat.id,
    name: 'Heavy Transport Truck T-101 Asset',
    name_en: 'Heavy Transport Truck T-101 Asset',
    acquisition_cost: 250000
  }, ik('fleet_asset'));

  // 1. Create Fleet Vehicle & Driver
  const vehicle = execute('fleet:vehicle:create', {
    company_id: 'default',
    name: 'Heavy Transport Truck T-101',
    registration_number: 'REG-DXB-98765',
    license_plate: 'UAE-DXB-98765',
    fuel_capacity_liters: 300,
    current_odometer: 45000,
    asset_id: asset.id
  }, ik('veh_create'));

  assert.equal(vehicle.status, 'active');
  assert.ok(vehicle.vehicle_number.startsWith('FLEET-'));

  const driver = execute('fleet:driver:create', {
    company_id: 'default',
    name: 'Ahmed Al-Mansoori',
    license_number: 'DL-992011',
    license_expiry: '2028-12-31'
  }, ik('driver_create'));

  assert.equal(driver.name, 'Ahmed Al-Mansoori');

  // 2. Driver Vehicle Assignment
  const assign = execute('fleet:driver:assign', {
    vehicle_id: vehicle.id,
    driver_id: driver.id
  }, ik('assign_create'));

  assert.equal(assign.status, 'active');

  // 3. Create & Complete Trip
  const trip = execute('fleet:trip:record', {
    company_id: 'default',
    vehicle_id: vehicle.id,
    driver_id: driver.id,
    start_location: 'Dubai Logistics City',
    end_location: 'Abu Dhabi Industrial Zone',
    start_odometer: 45000,
    end_odometer: 45160
  }, ik('trip_create'));

  assert.equal(trip.state, 'completed');
  assert.equal(trip.distance_km, 160);

  // Check vehicle odometer updated
  const updatedVeh = db.prepare(`SELECT * FROM fleet_vehicles WHERE id = ?`).get(vehicle.id);
  assert.equal(updatedVeh.current_odometer, 45160);

  // 4. Record Fuel Log with Anomaly Flag (Fuel added exceeds tank capacity)
  const anomalyFuel = execute('fleet:fuel:record', {
    company_id: 'default',
    vehicle_id: vehicle.id,
    driver_id: driver.id,
    fuel_qty: 350,
    fuel_liters: 350, // Exceeds 300L capacity -> triggers anomaly_flag
    total_cost: 1050,
    odometer_reading: 45160
  }, ik('fuel_anomaly'));

  assert.equal(anomalyFuel.anomaly_flag, 1);
  assert.ok(anomalyFuel.anomaly_notes.includes('exceeds tank capacity'));

  // 5. Ingest Telematics Telemetry Event
  const telemetry = execute('fleet:telemetry:ingest', {
    vehicle_id: vehicle.id,
    device_id: 'OBD2-GPS-8821',
    provider_type: 'obd',
    event_type: 'speed_alert',
    latitude: 25.1972,
    longitude: 55.2744,
    speed_kmh: 82.5,
    payload_json: { g_force: 1.4 }
  }, ik('telemetry_ingest'));

  assert.equal(telemetry.event_type, 'speed_alert');
  assert.equal(telemetry.speed_kmh, 82.5);
});
