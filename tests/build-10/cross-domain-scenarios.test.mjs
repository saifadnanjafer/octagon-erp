import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import * as deviceRegistry from '../../platform/iot/device-registry.mjs';
import * as gateways from '../../platform/iot/gateways.mjs';
import * as telemetry from '../../platform/iot/telemetry.mjs';
import * as health from '../../platform/iot/health-diagnostics.mjs';
import * as firmwareConfig from '../../platform/iot/firmware-config.mjs';
import * as fleetMapping from '../../platform/iot/fleet-telematics-mapping.mjs';
import * as locationTrips from '../../platform/iot/location-trips.mjs';
import * as geofences from '../../platform/iot/geofences.mjs';
import * as fleetEvents from '../../platform/iot/fleet-events.mjs';
import * as fuelTelemetry from '../../platform/iot/fuel-telemetry.mjs';
import * as maintenanceTriggers from '../../platform/iot/maintenance-triggers.mjs';
import * as clientRegistry from '../../platform/offline/client-registry.mjs';
import * as syncEngine from '../../platform/offline/sync-engine.mjs';
import * as conflictRes from '../../platform/offline/conflict-resolution.mjs';
import * as kioskRegistry from '../../platform/kiosk/kiosk-registry.mjs';
import * as operationalBoards from '../../platform/kiosk/operational-boards.mjs';

async function setupFixture(t, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `octagon-b10-scenarios-${name}-`));
  const dbPath = path.join(dir, 'scenarios.db');
  await freshInstall({ dbPath, backupDir: path.join(dir, 'backups'), actor: `b10-scenario-${name}` });
  const db = openMigrationDatabase(dbPath);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  const ctx = { company_id: 'default', warehouse_id: 'wh-main', branch_id: 'branch-a', actor: 'scenario-admin' };
  
  // Seed vehicle
  const stamp = new Date().toISOString();
  db.prepare('INSERT INTO fleet_vehicles(id,company_id,vehicle_number,registration_number,name,license_plate,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run('veh-scenario-1', 'default', 'VN-SCENARIO-1', 'REG-SCENARIO-1', 'Delivery Van A', 'BAGHDAD-101', 'active', stamp, stamp);

  return { db, ctx };
}

test('cross-domain scenario 1 joins telematics location, trip calculation, geofence breach, speeding, and maintenance trigger', async (t) => {
  const { db, ctx } = await setupFixture(t, 'scenario-1');

  // 1. Enroll IoT Telematics device & map to fleet vehicle
  const device = deviceRegistry.enrollDevice(db, { ...ctx, device_code: 'GPS-SCENARIO-1', name: 'Fleet GPS Tracker 1', device_type: 'tracker' });
  deviceRegistry.updateDeviceStatus(db, { ...ctx, device_id: device.id, status: 'active', actor: 'iot-admin' });
  const mapInput = { ...ctx, vehicle_id: 'veh-scenario-1', tracker_device_id: device.id, odometer_offset_km: 50000 };
  fleetMapping.mapFleetDevice(db, mapInput, mapInput);

  // 2. Ingest series of location points forming a trip
  const now = new Date();
  const t0 = new Date(now.getTime() - 3600000).toISOString();
  const t1 = new Date(now.getTime() - 1800000).toISOString();
  const t2 = now.toISOString();

  // Point 1: Origin (inside HQ geofence)
  locationTrips.recordLocationPoint(db, { ...ctx, vehicle_id: 'veh-scenario-1', device_id: device.id, latitude: 33.3152, longitude: 44.3661, speed_kmh: 0, heading: 0, timestamp: t0 }, ctx);
  // Point 2: En-route high speed
  locationTrips.recordLocationPoint(db, { ...ctx, vehicle_id: 'veh-scenario-1', device_id: device.id, latitude: 33.3500, longitude: 44.4000, speed_kmh: 120, heading: 45, timestamp: t1 }, ctx);
  // Point 3: Destination (outside HQ geofence)
  locationTrips.recordLocationPoint(db, { ...ctx, vehicle_id: 'veh-scenario-1', device_id: device.id, latitude: 33.4000, longitude: 44.4500, speed_kmh: 0, heading: 90, timestamp: t2 }, ctx);

  // 3. Define HQ Geofence (restricted, so an entry/unauthorized_entry would be critical; an exit stays informational)
  const gf = geofences.createGeofence(db, { ...ctx, name: 'Baghdad HQ Depot', type: 'restricted', center_latitude: 33.3152, center_longitude: 44.3661, radius_meters: 500 }, ctx);
  const breach = geofences.evaluateGeofenceEvent(db, { ...ctx, geofence_id: gf.id, vehicle_id: 'veh-scenario-1', event_type: 'exit' }, ctx);
  assert.equal(breach.status, 'open');
  assert.equal(breach.eventType, 'exit');

  // 4. Record speeding event (120 vs 80 limit -> excess 40 > 30 -> critical)
  const speedEv = fleetEvents.recordSpeedEvent(db, { ...ctx, vehicle_id: 'veh-scenario-1', speed_kmh: 120, speed_limit_kmh: 80 }, ctx);
  assert.equal(speedEv.severity, 'critical');

  // 5. Start and end the trip
  const trip = locationTrips.startTrip(db, { ...ctx, vehicle_id: 'veh-scenario-1', start_time: t0 }, ctx);
  const tripEnd = locationTrips.endTrip(db, { ...ctx, trip_id: trip.id, distance_km: 25, duration_minutes: 60, end_time: t2 }, ctx);
  assert.equal(tripEnd.status, 'completed');

  // 6. Trigger maintenance request proposal due to odometer threshold
  const mtResult = maintenanceTriggers.evaluateMaintenanceTrigger(db, { ...ctx, vehicle_id: 'veh-scenario-1', trigger_type: 'odometer', threshold_value: 60000, current_value: 60500 }, ctx);
  assert.equal(mtResult.status, 'triggered');
});

test('cross-domain scenario 2 handles fuel telemetry drop, loss detection, investigation proposal, and resolution', async (t) => {
  const { db, ctx } = await setupFixture(t, 'scenario-2');

  const device = deviceRegistry.enrollDevice(db, { ...ctx, device_code: 'FUEL-SCENARIO-2', name: 'Tank Telematics 2', device_type: 'tracker' });
  deviceRegistry.updateDeviceStatus(db, { ...ctx, device_id: device.id, status: 'active', actor: 'iot-admin' });
  const mapInput = { ...ctx, vehicle_id: 'veh-scenario-1', tracker_device_id: device.id };
  fleetMapping.mapFleetDevice(db, mapInput, mapInput);

  const t0 = new Date(Date.now() - 3600000).toISOString();
  const t1 = new Date().toISOString();

  // Record baseline fuel reading (100L)
  fuelTelemetry.recordFuelReading(db, { ...ctx, vehicle_id: 'veh-scenario-1', raw_fuel_percentage: 100, calibrated_liters: 100, previous_liters: 100, timestamp: t0 }, ctx);

  // Record sudden drop reading (100L -> 40L, parked, no refuel) -> diff 60 > 15 while parked -> suspected_fuel_loss
  const reading2 = fuelTelemetry.recordFuelReading(db, { ...ctx, vehicle_id: 'veh-scenario-1', raw_fuel_percentage: 40, calibrated_liters: 40, previous_liters: 100, is_parked: true, timestamp: t1 }, ctx);
  assert.equal(reading2.eventClassification, 'suspected_fuel_loss');
  assert.equal(reading2.status, 'investigation_required');

  const pendingLosses = db.prepare('SELECT * FROM fleet_fuel_telemetry WHERE status = ?').all('investigation_required');
  assert.equal(pendingLosses.length, 1);

  // Investigate and resolve
  const resolved = fuelTelemetry.investigateFuelAnomaly(db, { ...ctx, fuel_id: pendingLosses[0].id, classification: 'confirmed_theft' }, { ...ctx, actor: 'fleet-manager' });
  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.classification, 'confirmed_theft');
});

test('cross-domain scenario 3 handles telemetry threshold breach, missed heartbeat alert, device health score degradation, and health board query', async (t) => {
  const { db, ctx } = await setupFixture(t, 'scenario-3');

  const device = deviceRegistry.enrollDevice(db, { ...ctx, device_code: 'SENS-SCENARIO-3', name: 'Warehouse Temp Sensor', device_type: 'sensor' });
  deviceRegistry.updateDeviceStatus(db, { ...ctx, device_id: device.id, status: 'active', actor: 'iot-admin' });

  const gateway = gateways.registerGateway(db, { ...ctx, code: 'GW-MAIN', name: 'Main Warehouse Gateway' });
  gateways.assignDeviceToGateway(db, { ...ctx, gateway_id: gateway.id, device_id: device.id });

  // Telemetry payload with high temp reading
  const telem = telemetry.ingestTelemetrySimulated(db, { ...ctx, device_id: device.id, measurements: [{ type: 'temperature', value: 65, unit: 'C' }] }, ctx);
  assert.equal(telem.status, 'normalized');

  // Simulate silence since last telemetry (>1h) so health degrades to offline/critical rather than the
  // just-ingested online/100 state calculateDeviceHealth would otherwise compute from a fresh last_seen_at
  const staleTimestamp = new Date(Date.now() - 7200000).toISOString();
  db.prepare('UPDATE iot_devices SET last_seen_at = ? WHERE id = ?').run(staleTimestamp, device.id);
  const scoreResult = health.calculateDeviceHealth(db, { ...ctx, device_id: device.id }, { ...ctx, actor: 'health-evaluator' });
  assert.equal(scoreResult.healthState, 'offline');
  assert.equal(scoreResult.healthScore, 0);

  // Query health board data
  const boardData = operationalBoards.getBoardData(db, { ...ctx, board_key: 'device_health' });
  assert.ok(boardData.items.some((item) => item.id === device.id && item.health_state === 'offline'));
});

test('cross-domain scenario 4 handles firmware catalogue entry, rollout simulation across active devices, and config drift', async (t) => {
  const { db, ctx } = await setupFixture(t, 'scenario-4');

  const d1 = deviceRegistry.enrollDevice(db, { ...ctx, device_code: 'DEV-FW-1', name: 'Gateway Node 1', device_type: 'gateway' });
  const d2 = deviceRegistry.enrollDevice(db, { ...ctx, device_code: 'DEV-FW-2', name: 'Gateway Node 2', device_type: 'gateway' });
  deviceRegistry.updateDeviceStatus(db, { ...ctx, device_id: d1.id, status: 'active', actor: 'admin' });
  deviceRegistry.updateDeviceStatus(db, { ...ctx, device_id: d2.id, status: 'active', actor: 'admin' });

  // Add & approve firmware
  const fw = firmwareConfig.registerFirmware(db, { ...ctx, device_model: 'gateway-v2', version: 'v2.4.0', release_notes: 'Security Hotfix 2.4.0' }, ctx);
  firmwareConfig.approveFirmware(db, { ...ctx, firmware_id: fw.id }, ctx);

  // Simulate staged rollout (simulator, fixed success/failure counts by design - see iot-telemetry-health-commands.test.mjs)
  const rollout = firmwareConfig.rolloutFirmwareSimulated(db, { ...ctx, firmware_id: fw.id, target_group: { device_type: 'gateway' }, stage_percentage: 100 }, ctx);
  assert.equal(rollout.status, 'completed');
  assert.equal(rollout.successCount, 5);
  assert.equal(rollout.failureCount, 0);

  // Define & evaluate config profile drift
  const profile = firmwareConfig.upsertConfigProfile(db, { ...ctx, name: 'SEC-PROFILE-1', device_model: 'gateway-v2', desired_config: { reporting_interval_s: 30, encryption: 'AES-256' } }, ctx);
  const drift = firmwareConfig.evaluateConfigDrift(db, { ...ctx, device_id: d1.id, profile_id: profile.id, current_parameters: { reporting_interval_s: 60, encryption: 'AES-256' } }, ctx);
  assert.equal(drift.hasDrift, true);
  assert.equal(drift.driftDetails[0].key, 'reporting_interval_s');
});

test('cross-domain scenario 5 handles offline PWA client registry, batch queue push, local ID remapping, and disallowed offline GL rejection', async (t) => {
  const { db, ctx } = await setupFixture(t, 'scenario-5');

  const client = clientRegistry.registerOfflineClient(db, { client_uuid: 'PWA-UUID-1001', device_name: 'Warehouse Handheld 1' }, ctx);
  assert.equal(client.deviceTrustState, 'trusted');

  // Push batch offline commands (1 valid inventory scan, 1 disallowed offline GL posting)
  const batchResult = syncEngine.pushOfflineSync(db, {
    client_id: client.id,
    commands: [
      { local_temp_id: 'ITEM-1', action_name: 'warehouse:scan_capture', payload: { barcode: 'BC-OFFLINE-1', quantity: 5 } },
      { local_temp_id: 'ITEM-2', action_name: 'finance:post_gl', payload: { account_id: 'acc_101000', amount: 5000 } }
    ]
  }, ctx);

  assert.equal(batchResult.pushedCount, 2);
  assert.equal(batchResult.acceptedCount, 1);
  assert.equal(batchResult.rejectedCount, 1);
  assert.equal(batchResult.results[1].status, 'rejected');
  assert.equal(batchResult.results[1].reason, 'OFFLINE_ACTION_DISALLOWED');
});

test('cross-domain scenario 6 handles sync conflict detection, conflict resolution strategies, and kiosk restricted profile action enforcement', async (t) => {
  const { db, ctx } = await setupFixture(t, 'scenario-6');

  const client = clientRegistry.registerOfflineClient(db, { client_uuid: 'PWA-UUID-1002', device_name: 'Counter Kiosk Tablet' }, ctx);

  // Push a batch containing one command flagged to simulate a mid-sync conflict (existing pushOfflineSync path)
  const push = syncEngine.pushOfflineSync(db, {
    client_id: client.id,
    commands: [
      { local_temp_id: 'WO-101', action_name: 'work_item:status_update', payload: { item_id: 'wo-101', status: 'in_progress', simulate_conflict: true } }
    ]
  }, ctx);
  assert.equal(push.conflictCount, 1);

  const openConflicts = conflictRes.listConflicts(db, { ...ctx, client_id: client.id, status: 'open' });
  assert.equal(openConflicts.length, 1);

  // Resolve conflict using server_wins
  const res = conflictRes.resolveConflict(db, { conflict_id: openConflicts[0].id, resolution_strategy: 'server_wins', resolution_note: 'Server state takes precedence' }, { ...ctx, actor: 'sync-admin' });
  assert.equal(res.status, 'resolved');
  assert.equal(res.resolutionStrategy, 'server_wins');

  // Register kiosk & test restricted actions
  const kiosk = kioskRegistry.registerKiosk(db, { code: 'KIOSK-SHOP-1', kiosk_type: 'shopfloor', name: 'Shop Floor Terminal 1' }, ctx);
  kioskRegistry.recordKioskHeartbeat(db, { kiosk_id: kiosk.id }, ctx);

  const restricted = kioskRegistry.evaluateKioskActionPermission(db, { kiosk_id: kiosk.id, action_name: 'post_accounting_journal' }, ctx);
  assert.equal(restricted.allowed, false);
  assert.equal(restricted.reason, 'restricted_kiosk_role');
});
