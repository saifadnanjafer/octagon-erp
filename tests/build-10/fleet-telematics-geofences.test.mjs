import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import * as devices from '../../platform/iot/device-registry.mjs';
import * as mapping from '../../platform/iot/fleet-telematics-mapping.mjs';
import * as trips from '../../platform/iot/location-trips.mjs';
import * as geofences from '../../platform/iot/geofences.mjs';
import * as events from '../../platform/iot/fleet-events.mjs';
import * as fuel from '../../platform/iot/fuel-telemetry.mjs';
import * as maintenance from '../../platform/iot/maintenance-triggers.mjs';

async function fixture(t) {
  const file = path.join(os.tmpdir(), `octagon-b10-fleet-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  t.after(() => { try { fs.unlinkSync(file); } catch {} });
  await freshInstall({ dbPath: file });
  const db = openMigrationDatabase(file);
  t.after(() => db.close());
  const stamp = new Date().toISOString();
  db.prepare(`INSERT INTO fleet_vehicles(id,company_id,vehicle_number,name,registration_number,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?)`).run('veh-1', 'company-a', 'FLEET-100', 'Delivery Truck 1', 'REG-100', stamp, stamp);
  const ctx = { company_id: 'company-a', branch_id: 'branch-a', actor: 'fleet-manager' };
  return { db, ctx };
}

test('fleet device mapping, odometer calibration and company isolation', async (t) => {
  const { db, ctx } = await fixture(t);

  const trk = devices.registerDevice(db, { ...ctx, external_ref: 'TRK-MAP-1', device_type: 'tracker' });
  const snr = devices.registerDevice(db, { ...ctx, external_ref: 'SNR-MAP-1', device_type: 'sensor' });

  const map = mapping.mapFleetDevice(db, { vehicle_id: 'veh-1', tracker_device_id: trk.id, fuel_sensor_device_id: snr.id }, ctx);
  assert.equal(map.vehicleId, 'veh-1');
  assert.equal(map.isActive, true);

  const cal = mapping.calibrateOdometer(db, { vehicle_id: 'veh-1', odometer_offset_km: 1250.0 }, ctx);
  assert.equal(cal.odometerOffsetKm, 1250.0);

  const otherCtx = { ...ctx, company_id: 'company-b' };
  assert.throws(() => mapping.mapFleetDevice(db, { vehicle_id: 'veh-1' }, otherCtx), (err) => err.code === 'VEHICLE_SCOPE_DENIED');
});

test('live location recording, trip start, trip end and trip queries', async (t) => {
  const { db, ctx } = await fixture(t);

  const loc = trips.recordLocationPoint(db, { vehicle_id: 'veh-1', latitude: 33.3152, longitude: 44.3661, speed_kmh: 45.0 }, ctx);
  assert.equal(loc.speedKmh, 45.0);

  const tr = trips.startTrip(db, { vehicle_id: 'veh-1', start_location_point_id: loc.id }, ctx);
  assert.equal(tr.status, 'in_progress');

  const end = trips.endTrip(db, { trip_id: tr.id, distance_km: 25.4, duration_minutes: 35.0 }, ctx);
  assert.equal(end.status, 'completed');
  assert.equal(end.distanceKm, 25.4);

  const list = trips.listTrips(db, { ...ctx, vehicle_id: 'veh-1' });
  assert.equal(list.length, 1);
});

test('geofence creation, evaluation of restricted entry and acknowledgment', async (t) => {
  const { db, ctx } = await fixture(t);

  const gf = geofences.createGeofence(db, { name: 'Restricted Depot', type: 'restricted', lat: 33.3, lng: 44.3, radius_meters: 300 }, ctx);
  assert.equal(gf.name, 'Restricted Depot');

  const evt = geofences.evaluateGeofenceEvent(db, { geofence_id: gf.id, vehicle_id: 'veh-1', event_type: 'unauthorized_entry' }, ctx);
  assert.equal(evt.severity, 'critical');
  assert.ok(evt.workItemProposal);

  const ack = geofences.acknowledgeGeofenceEvent(db, { event_id: evt.id }, ctx);
  assert.equal(ack.status, 'acknowledged');
});

test('speed event recording, severity calculation and acknowledgment', async (t) => {
  const { db, ctx } = await fixture(t);

  const evt = events.recordSpeedEvent(db, { vehicle_id: 'veh-1', speed_kmh: 125, speed_limit_kmh: 80 }, ctx);
  assert.equal(evt.severity, 'critical');

  const ack = events.acknowledgeSpeedEvent(db, { event_id: evt.id }, ctx);
  assert.equal(ack.status, 'acknowledged');
});

test('fuel telemetry, suspected fuel loss detection and investigation', async (t) => {
  const { db, ctx } = await fixture(t);

  // Normal reading
  const r1 = fuel.recordFuelReading(db, { vehicle_id: 'veh-1', raw_fuel_percentage: 80, calibrated_liters: 160 }, ctx);
  assert.equal(r1.eventClassification, 'normal_consumption');

  // Sudden parked drop (from 160L to 130L -> 30L loss)
  const r2 = fuel.recordFuelReading(db, { vehicle_id: 'veh-1', raw_fuel_percentage: 65, calibrated_liters: 130, previous_liters: 160, is_parked: true }, ctx);
  assert.equal(r2.eventClassification, 'suspected_fuel_loss');
  assert.equal(r2.dropLiters, 30);
  assert.equal(r2.status, 'investigation_required');
  assert.ok(r2.investigationProposal);

  const inv = fuel.investigateFuelAnomaly(db, { fuel_id: r2.id, classification: 'investigated_theft' }, ctx);
  assert.equal(inv.status, 'resolved');
});

test('maintenance trigger evaluation and proposal creation', async (t) => {
  const { db, ctx } = await fixture(t);

  // Below threshold
  const t1 = maintenance.evaluateMaintenanceTrigger(db, { vehicle_id: 'veh-1', trigger_type: 'odometer', threshold_value: 50000, current_value: 48000 }, ctx);
  assert.equal(t1.triggered, false);

  // Threshold reached
  const t2 = maintenance.evaluateMaintenanceTrigger(db, { vehicle_id: 'veh-1', trigger_type: 'odometer', threshold_value: 50000, current_value: 50200 }, ctx);
  assert.equal(t2.status, 'triggered');
  assert.ok(t2.proposal);

  const ack = maintenance.acknowledgeMaintenanceTrigger(db, { trigger_id: t2.id }, ctx);
  assert.equal(ack.status, 'acknowledged');
});
