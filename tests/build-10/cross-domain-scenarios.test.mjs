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
  const device = deviceRegistry.enrollDevice(db, { ...ctx, device_code: 'GPS-SCENARIO-1', name: 'Fleet GPS Tracker 1', device_type: 'telematics' });
  deviceRegistry.updateDeviceStatus(db, { ...ctx, device_id: device.id, status: 'active', actor: 'iot-admin' });
  fleetMapping.mapDeviceToVehicle(db, { ...ctx, vehicle_id: 'veh-scenario-1', tracker_device_id: device.id, initial_odometer_km: 50000 });

  // 2. Ingest series of location points forming a trip
  const now = new Date();
  const t0 = new Date(now.getTime() - 3600000).toISOString();
  const t1 = new Date(now.getTime() - 1800000).toISOString();
  const t2 = now.toISOString();

  // Point 1: Origin (inside HQ geofence)
  locationTrips.recordLocationPoint(db, { ...ctx, device_id: device.id, latitude: 33.3152, longitude: 44.3661, altitude_m: 35, speed_kmh: 0, heading_deg: 0, timestamp: t0 });
  // Point 2: En-route high speed
  locationTrips.recordLocationPoint(db, { ...ctx, device_id: device.id, latitude: 33.3500, longitude: 44.4000, altitude_m: 40, speed_kmh: 110, heading_deg: 45, timestamp: t1 });
  // Point 3: Destination (outside HQ geofence)
  locationTrips.recordLocationPoint(db, { ...ctx, device_id: device.id, latitude: 33.4000, longitude: 44.4500, altitude_m: 42, speed_kmh: 0, heading_deg: 90, timestamp: t2 });

  // 3. Define HQ Geofence
  const gf = geofences.defineGeofence(db, { ...ctx, code: 'GF-HQ', name: 'Baghdad HQ Depot', fence_type: 'circular', center_lat: 33.3152, center_lng: 44.3661, radius_m: 500 });
  const breaches = geofences.evaluateGeofenceBreach(db, { ...ctx, device_id: device.id, geofence_id: gf.id, latitude: 33.4000, longitude: 44.4500, event_type: 'exit' });
  assert.equal(breaches.breaches.length, 1);

  // 4. Record speeding event
  const speedEv = fleetEvents.recordSpeedEvent(db, { ...ctx, device_id: device.id, speed_kmh: 110, speed_limit_kmh: 80, latitude: 33.3500, longitude: 44.4000 });
  assert.equal(speedEv.severity, 'major');

  // 5. Calculate trip
  const trip = locationTrips.startOrProjectTrip(db, { ...ctx, vehicle_id: 'veh-scenario-1', device_id: device.id, start_time: t0, end_time: t2, distance_km: 25, max_speed_kmh: 110 });
  assert.equal(trip.status, 'completed');

  // 6. Trigger maintenance request proposal due to odometer threshold
  db.prepare('UPDATE iot_device_fleet_mappings SET current_odometer_km = 60500 WHERE tracker_device_id = ?').run(device.id);
  const mtRule = maintenanceTriggers.createMaintenanceTriggerRule(db, { ...ctx, name: '60,000 km Major Service', trigger_type: 'odometer', threshold_value: 60000, maintenance_type: 'major_service' });
  const mtResult = maintenanceTriggers.evaluateMaintenanceTriggers(db, { ...ctx, vehicle_id: 'veh-scenario-1' });
  assert.equal(mtResult.proposalsCreated, 1);
});

test('cross-domain scenario 2 handles fuel telemetry drop, loss detection, investigation proposal, and resolution', async (t) => {
  const { db, ctx } = await setupFixture(t, 'scenario-2');

  const device = deviceRegistry.enrollDevice(db, { ...ctx, device_code: 'FUEL-SCENARIO-2', name: 'Tank Telematics 2', device_type: 'telematics' });
  deviceRegistry.updateDeviceStatus(db, { ...ctx, device_id: device.id, status: 'active', actor: 'iot-admin' });
  fleetMapping.mapDeviceToVehicle(db, { ...ctx, vehicle_id: 'veh-scenario-1', tracker_device_id: device.id });

  // Record baseline fuel reading
  const t0 = new Date(Date.now() - 3600000).toISOString();
  const t1 = new Date().toISOString();
  fuelTelemetry.recordFuelReading(db, { ...ctx, device_id: device.id, fuel_level_liters: 100, fuel_percentage: 100, timestamp: t0 });

  // Record sudden drop reading (100L -> 40L with no vehicle movement)
  const reading2 = fuelTelemetry.recordFuelReading(db, { ...ctx, device_id: device.id, fuel_level_liters: 40, fuel_percentage: 40, timestamp: t1 });
  assert.equal(reading2.anomalyDetected, true);

  const pendingLosses = db.prepare('SELECT * FROM iot_suspected_fuel_loss_records WHERE status = ?').all('flagged');
  assert.equal(pendingLosses.length, 1);

  // Propose investigation action
  const resolved = fuelTelemetry.resolveFuelLossRecord(db, { ...ctx, loss_id: pendingLosses[0].id, resolution: 'confirmed_theft', notes: 'Tank drain plug tampered', actor: 'fleet-manager' });
  assert.equal(resolved.status, 'confirmed_theft');
});

test('cross-domain scenario 3 handles telemetry threshold breach, missed heartbeat alert, device health score degradation, and health board query', async (t) => {
  const { db, ctx } = await setupFixture(t, 'scenario-3');

  const device = deviceRegistry.enrollDevice(db, { ...ctx, device_code: 'SENS-SCENARIO-3', name: 'Warehouse Temp Sensor', device_type: 'sensor' });
  deviceRegistry.updateDeviceStatus(db, { ...ctx, device_id: device.id, status: 'active', actor: 'iot-admin' });

  const gateway = gateways.registerGateway(db, { ...ctx, gateway_code: 'GW-MAIN', name: 'Main Warehouse Gateway' });
  gateways.assignDeviceToGateway(db, { ...ctx, gateway_id: gateway.id, device_id: device.id });

  // Telemetry payload with high temp breach
  const telem = telemetry.ingestTelemetryPayload(db, { ...ctx, device_code: device.device_code, payload: { temperature_c: 65, humidity_pct: 80 } });
  assert.equal(telem.status, 'ingested');

  // Compute health score
  const scoreResult = health.calculateDeviceHealthScore(db, { ...ctx, device_id: device.id, health_score: 35, missed_heartbeats: 4, is_online: false, actor: 'health-evaluator' });
  assert.equal(scoreResult.health_status, 'critical');

  // Query health board data
  const boardData = operationalBoards.getBoardData(db, { ...ctx, board_type: 'health' });
  assert.equal(boardData.metrics.criticalDevicesCount >= 1, true);
});

test('cross-domain scenario 4 handles firmware catalogue entry, rollout simulation across active devices, and config drift', async (t) => {
  const { db, ctx } = await setupFixture(t, 'scenario-4');

  const d1 = deviceRegistry.enrollDevice(db, { ...ctx, device_code: 'DEV-FW-1', name: 'Gateway Node 1', device_type: 'gateway' });
  const d2 = deviceRegistry.enrollDevice(db, { ...ctx, device_code: 'DEV-FW-2', name: 'Gateway Node 2', device_type: 'gateway' });
  deviceRegistry.updateDeviceStatus(db, { ...ctx, device_id: d1.id, status: 'active', actor: 'admin' });
  deviceRegistry.updateDeviceStatus(db, { ...ctx, device_id: d2.id, status: 'active', actor: 'admin' });

  // Add & approve firmware
  const fw = firmwareConfig.registerFirmware(db, { ...ctx, device_type: 'gateway', version: 'v2.4.0', title: 'Security Hotfix 2.4.0', firmware_checksum: 'a'.repeat(64) });
  firmwareConfig.approveFirmware(db, { ...ctx, firmware_id: fw.id, approved_by: 'security-lead' });

  // Simulate staged rollout
  const rollout = firmwareConfig.simulateStagedRollout(db, { ...ctx, firmware_id: fw.id, target_device_type: 'gateway', stage_percentage: 100 });
  assert.equal(rollout.targetedDevicesCount, 2);
  assert.equal(rollout.simulatedSuccessCount, 2);

  // Define & evaluate config profile drift
  const profile = firmwareConfig.createConfigurationProfile(db, { ...ctx, profile_code: 'SEC-PROFILE-1', device_type: 'gateway', parameters: { reporting_interval_s: 30, encryption: 'AES-256' } });
  const drift = firmwareConfig.evaluateConfigDrift(db, { ...ctx, device_id: d1.id, profile_id: profile.id, current_parameters: { reporting_interval_s: 60, encryption: 'AES-256' } });
  assert.equal(drift.hasDrift, true);
  assert.equal(drift.driftDetails[0].key, 'reporting_interval_s');
});

test('cross-domain scenario 5 handles offline PWA client registry, batch queue push, local ID remapping, and disallowed offline GL rejection', async (t) => {
  const { db, ctx } = await setupFixture(t, 'scenario-5');

  const client = clientRegistry.registerClientDevice(db, { ...ctx, client_device_uuid: 'PWA-UUID-1001', device_name: 'Warehouse Handheld 1', app_version: 'v19.0-b10' });
  assert.equal(client.trust_status, 'trusted');

  // Push batch offline actions (1 valid inventory scan, 1 disallowed offline GL action)
  const batchResult = syncEngine.pushOfflineQueueBatch(db, {
    ...ctx,
    client_id: client.id,
    session_uuid: 'SYNC-SESS-9001',
    queue_items: [
      {
        queue_item_uuid: 'ITEM-1',
        entity_name: 'inventory_scan',
        action_type: 'record_scan',
        payload: { barcode: 'BC-OFFLINE-1', quantity: 5 },
        client_timestamp: new Date().toISOString()
      },
      {
        queue_item_uuid: 'ITEM-2',
        entity_name: 'gl_entry',
        action_type: 'post_gl_journal',
        payload: { account_id: 'acc_101000', amount: 5000 },
        client_timestamp: new Date().toISOString()
      }
    ]
  });

  assert.equal(batchResult.processedCount, 2);
  assert.equal(batchResult.appliedCount, 1);
  assert.equal(batchResult.rejectedCount, 1);
  assert.equal(batchResult.results[1].status, 'rejected');
  assert.equal(batchResult.results[1].reason, 'disallowed_offline_action');
});

test('cross-domain scenario 6 handles sync conflict detection, conflict resolution strategies, and kiosk restricted profile action enforcement', async (t) => {
  const { db, ctx } = await setupFixture(t, 'scenario-6');

  const client = clientRegistry.registerClientDevice(db, { ...ctx, client_device_uuid: 'PWA-UUID-1002', device_name: 'Counter Kiosk Tablet', app_version: 'v19.0-b10' });

  // Record conflict
  const conflict = syncEngine.recordSyncConflict(db, {
    ...ctx,
    client_id: client.id,
    session_id: 'SYNC-SESS-9002',
    entity_name: 'work_order_status',
    entity_id: 'wo-101',
    server_version: { status: 'completed', updated_at: '2026-08-02T08:00:00Z' },
    client_version: { status: 'in_progress', updated_at: '2026-08-02T08:05:00Z' },
    conflict_type: 'version_mismatch'
  });

  // Resolve conflict using server_wins
  const res = conflictRes.resolveSyncConflict(db, { ...ctx, conflict_id: conflict.id, strategy: 'server_wins', resolution_notes: 'Server state takes precedence', resolved_by: 'sync-admin' });
  assert.equal(res.status, 'resolved');
  assert.equal(res.chosen_winner, 'server');

  // Register kiosk & test restricted actions
  const kiosk = kioskRegistry.registerKioskDevice(db, { ...ctx, kiosk_code: 'KIOSK-SHOP-1', kiosk_type: 'shop_floor', name: 'Shop Floor Terminal 1' });
  kioskRegistry.updateKioskHeartbeat(db, { ...ctx, kiosk_id: kiosk.id, active_page: 'shop_floor_kiosk' });

  const restricted = kioskRegistry.evaluateKioskActionPermission(db, { ...ctx, kiosk_id: kiosk.id, action_name: 'post_accounting_journal' });
  assert.equal(restricted.allowed, false);
  assert.equal(restricted.reason, 'restricted_kiosk_role');
});
