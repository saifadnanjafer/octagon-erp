import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import * as devices from '../../platform/iot/device-registry.mjs';
import * as gateways from '../../platform/iot/gateways.mjs';
import * as sensors from '../../platform/iot/sensors.mjs';

async function fixture(t) {
  const file = path.join(os.tmpdir(), `octagon-b10-iot-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  t.after(() => { try { fs.unlinkSync(file); } catch {} });
  await freshInstall({ dbPath: file });
  const db = openMigrationDatabase(file);
  t.after(() => db.close());
  const stamp = new Date().toISOString();
  db.prepare(`INSERT INTO fleet_vehicles(id,company_id,vehicle_number,name,registration_number,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?)`).run('veh-a', 'company-a', 'FLEET-00001', 'Truck A', 'REG-A', stamp, stamp);
  const ctx = { company_id: 'company-a', branch_id: 'branch-a', actor: 'operator-a' };
  return { db, ctx };
}

test('device lifecycle draft to active with suspend/resume and terminal revoke', async (t) => {
  const { db, ctx } = await fixture(t);
  let device = devices.registerDevice(db, { ...ctx, external_ref: 'TRK-001', device_type: 'tracker', model: 'T-100' });
  assert.equal(device.lifecycleState, 'draft');
  assert.equal(device.healthState, 'unknown');
  assert.throws(() => devices.activateDevice(db, { ...ctx, device_id: device.id }), (error) => error.code === 'DEVICE_LIFECYCLE_INVALID');

  device = devices.enrollDeviceSimulated(db, { ...ctx, device_id: device.id, idempotency_key: 'enroll-trk-001' });
  assert.equal(device.lifecycleState, 'enrolled');
  assert.equal(device.simulatorProvider, 'simulated');
  assert.equal(device.protocolMetadata.simulated_enrollment_id, 'enroll-trk-001');
  const replay = devices.enrollDeviceSimulated(db, { ...ctx, device_id: device.id, idempotency_key: 'enroll-trk-001' });
  assert.equal(replay.id, device.id);

  device = devices.activateDevice(db, { ...ctx, device_id: device.id });
  assert.equal(device.lifecycleState, 'active');
  assert.ok(device.activationDate);
  assert.equal(device.healthState, 'online');

  device = devices.suspendDevice(db, { ...ctx, device_id: device.id });
  assert.equal(device.lifecycleState, 'suspended');
  device = devices.resumeDevice(db, { ...ctx, device_id: device.id });
  assert.equal(device.lifecycleState, 'active');

  device = devices.revokeDevice(db, { ...ctx, device_id: device.id });
  assert.equal(device.lifecycleState, 'revoked');
  assert.throws(() => devices.activateDevice(db, { ...ctx, device_id: device.id }), (error) => error.code === 'DEVICE_REVOKED');
  assert.throws(() => devices.suspendDevice(db, { ...ctx, device_id: device.id }), (error) => error.code === 'DEVICE_REVOKED');
});

test('company isolation denies cross-company reads and writes', async (t) => {
  const { db, ctx } = await fixture(t);
  const device = devices.registerDevice(db, { ...ctx, external_ref: 'SNS-100', device_type: 'sensor' });
  const other = { ...ctx, company_id: 'company-b' };
  assert.throws(() => devices.getDevice(db, { ...other, device_id: device.id }), (error) => error.code === 'DEVICE_SCOPE_DENIED' && error.statusCode === 403);
  assert.throws(() => devices.updateDraftDevice(db, { ...other, device_id: device.id, notes: 'x' }), (error) => error.code === 'DEVICE_SCOPE_DENIED');
  assert.throws(() => devices.suspendDevice(db, { ...other, device_id: device.id }), (error) => error.code === 'DEVICE_SCOPE_DENIED');
  assert.throws(() => gateways.registerGateway(db, { ...other, code: 'GW-1', name: 'Other' }) && devices.deviceInScope(db, device.id, { companyId: 'company-b' }), (error) => error.code === 'DEVICE_SCOPE_DENIED');
  assert.equal(devices.listDevices(db, other).length, 0);
  assert.throws(() => devices.registerDevice(db, { external_ref: 'X', device_type: 'sensor', actor: 'a' }), (error) => error.code === 'COMPANY_SCOPE_REQUIRED');
});

test('plaintext credentials are rejected and credential_ref rotation works', async (t) => {
  const { db, ctx } = await fixture(t);
  assert.throws(() => devices.registerDevice(db, { ...ctx, external_ref: 'SEC-1', device_type: 'sensor', api_token: 'abc123' }),
    (error) => error.code === 'CREDENTIAL_PLAINTEXT_REJECTED');
  assert.throws(() => devices.registerDevice(db, { ...ctx, external_ref: 'SEC-2', device_type: 'sensor', password: 'hunter2' }),
    (error) => error.code === 'CREDENTIAL_PLAINTEXT_REJECTED');
  const device = devices.registerDevice(db, { ...ctx, external_ref: 'SEC-3', device_type: 'sensor', credential_ref: 'vault://iot/sec-3/v1' });
  assert.equal(device.credentialRef, 'vault://iot/sec-3/v1');
  const rotated = devices.rotateCredentialReference(db, { ...ctx, device_id: device.id, credential_ref: 'vault://iot/sec-3/v2' });
  assert.equal(rotated.credentialRef, 'vault://iot/sec-3/v2');
  assert.throws(() => devices.rotateCredentialReference(db, { ...ctx, device_id: device.id, new_secret: 'plain' }),
    (error) => error.code === 'CREDENTIAL_PLAINTEXT_REJECTED');
});

test('sensor registration, threshold validation, calibration and reading metadata', async (t) => {
  const { db, ctx } = await fixture(t);
  const device = devices.registerDevice(db, { ...ctx, external_ref: 'SNS-200', device_type: 'sensor' });
  let sensor = sensors.registerSensor(db, { ...ctx, device_id: device.id, channel: 'temp-1', measurement_type: 'temperature', engineering_unit: 'C', range_min: -40, range_max: 125 });
  assert.equal(sensor.calibrationStatus, 'unknown');
  assert.throws(() => sensors.registerSensor(db, { ...ctx, device_id: device.id, channel: 'temp-1' }), (error) => error.code === 'SENSOR_CHANNEL_DUPLICATE');

  assert.throws(() => sensors.setSensorThresholds(db, { ...ctx, sensor_id: sensor.id, warning_min: 90, warning_max: 80 }),
    (error) => error.code === 'INVALID_WARNING_THRESHOLDS');
  sensor = sensors.setSensorThresholds(db, { ...ctx, sensor_id: sensor.id, warning_min: 60, warning_max: 80, critical_min: 80, critical_max: 100 });
  assert.equal(sensor.warningMin, 60);
  assert.equal(sensor.criticalMax, 100);

  sensor = sensors.calibrateSensor(db, { ...ctx, sensor_id: sensor.id, calibration_date: '2026-08-01' });
  assert.equal(sensor.calibrationStatus, 'valid');
  assert.equal(sensor.calibrationDate, '2026-08-01');

  sensor = sensors.recordSensorReadingMeta(db, { ...ctx, sensor_id: sensor.id, reading: { value: 42.5, at: '2026-08-02T08:00:00Z' }, data_quality_state: 'good', battery_level: 87, signal_strength: -61, clock_skew_seconds: 1.5, last_sequence: 12 });
  assert.equal(sensor.lastReading.value, 42.5);
  assert.equal(sensor.lastGoodReading.value, 42.5);
  assert.equal(sensor.batteryLevel, 87);
  assert.equal(sensor.lastSequence, 12);
  assert.equal(sensor.dataQualityState, 'good');

  sensor = sensors.recordSensorReadingMeta(db, { ...ctx, sensor_id: sensor.id, reading: { value: 999 }, data_quality_state: 'bad', last_sequence: 13 });
  assert.equal(sensor.lastReading.value, 999);
  assert.equal(sensor.lastGoodReading.value, 42.5);
  assert.equal(sensor.dataQualityState, 'bad');

  sensor = sensors.setSensorActive(db, { ...ctx, sensor_id: sensor.id, active: false });
  assert.equal(sensor.active, false);
  assert.equal(sensors.listSensors(db, ctx).length, 0);
  assert.equal(sensors.listSensors(db, { ...ctx, include_inactive: true }).length, 1);
});

test('gateway register, device assignment and suspend/resume', async (t) => {
  const { db, ctx } = await fixture(t);
  let gateway = gateways.registerGateway(db, { ...ctx, code: 'gw-01', name: 'Plant Gateway', connectivity_type: 'mqtt', buffering: { max_records: 5000 } });
  assert.equal(gateway.code, 'GW-01');
  assert.equal(gateway.lifecycleState, 'active');
  assert.throws(() => gateways.registerGateway(db, { ...ctx, code: 'GW-01', name: 'Duplicate' }), (error) => error.code === 'GATEWAY_CODE_DUPLICATE');

  const device = devices.registerDevice(db, { ...ctx, external_ref: 'SNS-300', device_type: 'sensor' });
  const assigned = gateways.assignDeviceToGateway(db, { ...ctx, gateway_id: gateway.id, device_id: device.id });
  assert.equal(assigned.gatewayId, gateway.id);

  const other = gateways.registerGateway(db, { ...ctx, company_id: 'company-b', code: 'GW-B', name: 'Foreign' });
  assert.equal(other.companyId, 'company-b');
  assert.throws(() => gateways.assignDeviceToGateway(db, { ...ctx, gateway_id: other.id, device_id: device.id }),
    (error) => error.code === 'GATEWAY_SCOPE_DENIED');

  gateway = gateways.suspendGateway(db, { ...ctx, gateway_id: gateway.id });
  assert.equal(gateway.lifecycleState, 'suspended');
  assert.throws(() => gateways.assignDeviceToGateway(db, { ...ctx, gateway_id: gateway.id, device_id: device.id }),
    (error) => error.code === 'GATEWAY_LIFECYCLE_INVALID');
  gateway = gateways.resumeGateway(db, { ...ctx, gateway_id: gateway.id });
  assert.equal(gateway.lifecycleState, 'active');
});

test('vehicle assignment, replace links and list filters', async (t) => {
  const { db, ctx } = await fixture(t);
  let tracker = devices.registerDevice(db, { ...ctx, external_ref: 'TRK-500', device_type: 'tracker', model: 'FleetLink' });
  tracker = devices.assignVehicle(db, { ...ctx, device_id: tracker.id, vehicle_id: 'veh-a' });
  assert.equal(tracker.vehicleId, 'veh-a');
  assert.throws(() => devices.assignVehicle(db, { ...ctx, device_id: tracker.id, vehicle_id: 'veh-missing' }),
    (error) => error.code === 'VEHICLE_SCOPE_DENIED');

  tracker = devices.enrollDeviceSimulated(db, { ...ctx, device_id: tracker.id, idempotency_key: 'enroll-trk-500' });
  tracker = devices.activateDevice(db, { ...ctx, device_id: tracker.id });
  const { replaced, replacement } = devices.replaceDevice(db, { ...ctx, device_id: tracker.id, serial_number: 'SN-NEW-1' });
  assert.equal(replaced.lifecycleState, 'replaced');
  assert.equal(replaced.replacedByDeviceId, replacement.id);
  assert.equal(replacement.lifecycleState, 'draft');
  assert.equal(replacement.vehicleId, 'veh-a');
  assert.equal(replacement.serialNumber, 'SN-NEW-1');

  devices.registerDevice(db, { ...ctx, external_ref: 'KSK-1', device_type: 'kiosk' });
  assert.equal(devices.listDevices(db, { ...ctx, device_type: 'tracker' }).length, 2);
  assert.equal(devices.listDevices(db, { ...ctx, vehicle_id: 'veh-a' }).length, 2);
  assert.equal(devices.listDevices(db, { ...ctx, lifecycle_state: 'replaced' }).length, 1);
  assert.equal(devices.listDevices(db, { ...ctx, search: 'KSK' }).length, 1);
  assert.equal(devices.listDevices(db, { ...ctx, search: 'FleetLink' }).length, 2);

  const retired = devices.retireDevice(db, { ...ctx, device_id: replaced.id });
  assert.equal(retired.lifecycleState, 'retired');
  assert.throws(() => devices.retireDevice(db, { ...ctx, device_id: replacement.id }), (error) => error.code === 'DEVICE_LIFECYCLE_INVALID');
});
