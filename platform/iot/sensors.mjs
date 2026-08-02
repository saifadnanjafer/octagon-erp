// BUILD-10 canonical IoT sensor administration.
'use strict';

import crypto from 'node:crypto';
import { IotDeviceError, requiredScope, deviceInScope, assertLifecycle } from './device-registry.mjs';

const uid = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const timestamp = () => new Date().toISOString();
const parseJson = (value, fallback = null) => {
  try { return value == null ? fallback : JSON.parse(value); } catch { return fallback; }
};

export const MEASUREMENT_TYPES = [
  'latitude', 'longitude', 'speed', 'heading', 'odometer', 'engine_hours',
  'fuel_level', 'tank_level', 'voltage', 'temperature', 'humidity', 'vibration',
  'pressure', 'runtime', 'machine_state', 'door_state', 'binary_alarm',
];
const CALIBRATION_STATES = ['valid', 'due', 'overdue', 'unknown'];
const DATA_QUALITY_STATES = ['good', 'suspect', 'bad', 'unknown'];
const SENSOR_HOST_DEVICE_TYPES = ['sensor', 'tracker', 'gateway'];

export function mapSensor(row) {
  if (!row) return null;
  return {
    id: row.id, companyId: row.company_id, branchId: row.branch_id,
    deviceId: row.device_id, gatewayId: row.gateway_id, channel: row.channel,
    measurementType: row.measurement_type, engineeringUnit: row.engineering_unit,
    calibrationDate: row.calibration_date, calibrationStatus: row.calibration_status,
    expectedIntervalSeconds: row.expected_interval_seconds,
    rangeMin: row.range_min, rangeMax: row.range_max,
    warningMin: row.warning_min, warningMax: row.warning_max,
    criticalMin: row.critical_min, criticalMax: row.critical_max,
    dataQualityState: row.data_quality_state,
    lastReading: parseJson(row.last_reading_json),
    lastGoodReading: parseJson(row.last_good_reading_json),
    connectivityState: row.connectivity_state,
    batteryLevel: row.battery_level, signalStrength: row.signal_strength,
    clockSkewSeconds: row.clock_skew_seconds, lastSequence: row.last_sequence,
    active: !!row.is_active,
    createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function sensorInScope(db, id, scope) {
  const row = db.prepare('SELECT * FROM iot_sensors WHERE id=? AND company_id=?').get(id, scope.companyId);
  if (!row) throw new IotDeviceError('Sensor is outside active company scope', 'SENSOR_SCOPE_DENIED', 403);
  return mapSensor(row);
}

const numberOrNull = (value) => value === '' || value == null ? null : Number(value);

function validateRange(min, max, code) {
  if (min != null && max != null && Number(min) >= Number(max)) {
    throw new IotDeviceError('Threshold minimum must be below maximum', code);
  }
}

export function registerSensor(db, input) {
  const scope = requiredScope(input);
  if (!input.channel) throw new IotDeviceError('Sensor channel is required', 'INVALID_SENSOR');
  if (input.measurement_type && !MEASUREMENT_TYPES.includes(input.measurement_type)) {
    throw new IotDeviceError('Measurement type is not supported', 'INVALID_MEASUREMENT_TYPE');
  }
  const device = deviceInScope(db, input.device_id, scope);
  if (!SENSOR_HOST_DEVICE_TYPES.includes(device.deviceType)) {
    throw new IotDeviceError('Sensors can only attach to sensor, tracker or gateway devices', 'INVALID_SENSOR_HOST');
  }
  assertLifecycle(device, ['draft', 'enrollment_pending', 'enrolled', 'active', 'suspended', 'offline', 'degraded']);
  validateRange(input.range_min, input.range_max, 'INVALID_SENSOR_RANGE');
  const id = uid('iotsns');
  const now = timestamp();
  try {
    db.prepare(`INSERT INTO iot_sensors(
      id,company_id,branch_id,device_id,gateway_id,channel,measurement_type,engineering_unit,
      calibration_status,expected_interval_seconds,range_min,range_max,
      warning_min,warning_max,critical_min,critical_max,is_active,created_by,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,'unknown',?,?,?,?,?,?,?,1,?,?,?)`).run(
      id, scope.companyId, scope.branchId, device.id, input.gateway_id || device.gatewayId || null,
      String(input.channel).trim(), input.measurement_type || null, input.engineering_unit || null,
      input.expected_interval_seconds == null ? null : Number(input.expected_interval_seconds),
      numberOrNull(input.range_min), numberOrNull(input.range_max),
      numberOrNull(input.warning_min), numberOrNull(input.warning_max),
      numberOrNull(input.critical_min), numberOrNull(input.critical_max),
      input.actor, now, now,
    );
  } catch (error) {
    if (/UNIQUE/.test(error.message)) throw new IotDeviceError('Sensor channel already exists on this device', 'SENSOR_CHANNEL_DUPLICATE', 409);
    throw error;
  }
  return sensorInScope(db, id, scope);
}

export function configureSensor(db, input) {
  const scope = requiredScope(input);
  const current = sensorInScope(db, input.sensor_id || input.id, scope);
  if (input.measurement_type && !MEASUREMENT_TYPES.includes(input.measurement_type)) {
    throw new IotDeviceError('Measurement type is not supported', 'INVALID_MEASUREMENT_TYPE');
  }
  const rangeMin = input.range_min === undefined ? current.rangeMin : numberOrNull(input.range_min);
  const rangeMax = input.range_max === undefined ? current.rangeMax : numberOrNull(input.range_max);
  validateRange(rangeMin, rangeMax, 'INVALID_SENSOR_RANGE');
  db.prepare(`UPDATE iot_sensors SET measurement_type=?,engineering_unit=?,expected_interval_seconds=?,
    range_min=?,range_max=?,gateway_id=?,updated_at=? WHERE id=?`).run(
    input.measurement_type === undefined ? current.measurementType : input.measurement_type,
    input.engineering_unit === undefined ? current.engineeringUnit : input.engineering_unit,
    input.expected_interval_seconds === undefined ? current.expectedIntervalSeconds : (input.expected_interval_seconds == null ? null : Number(input.expected_interval_seconds)),
    rangeMin, rangeMax,
    input.gateway_id === undefined ? current.gatewayId : input.gateway_id,
    timestamp(), current.id,
  );
  return sensorInScope(db, current.id, scope);
}

export function calibrateSensor(db, input) {
  const scope = requiredScope(input);
  const current = sensorInScope(db, input.sensor_id || input.id, scope);
  const calibrationDate = input.calibration_date || timestamp().slice(0, 10);
  db.prepare(`UPDATE iot_sensors SET calibration_date=?,calibration_status='valid',updated_at=? WHERE id=?`).run(
    calibrationDate, timestamp(), current.id,
  );
  return sensorInScope(db, current.id, scope);
}

export function setSensorThresholds(db, input) {
  const scope = requiredScope(input);
  const current = sensorInScope(db, input.sensor_id || input.id, scope);
  const warningMin = input.warning_min === undefined ? current.warningMin : numberOrNull(input.warning_min);
  const warningMax = input.warning_max === undefined ? current.warningMax : numberOrNull(input.warning_max);
  const criticalMin = input.critical_min === undefined ? current.criticalMin : numberOrNull(input.critical_min);
  const criticalMax = input.critical_max === undefined ? current.criticalMax : numberOrNull(input.critical_max);
  validateRange(warningMin, warningMax, 'INVALID_WARNING_THRESHOLDS');
  validateRange(criticalMin, criticalMax, 'INVALID_CRITICAL_THRESHOLDS');
  db.prepare(`UPDATE iot_sensors SET warning_min=?,warning_max=?,critical_min=?,critical_max=?,updated_at=? WHERE id=?`).run(
    warningMin, warningMax, criticalMin, criticalMax, timestamp(), current.id,
  );
  return sensorInScope(db, current.id, scope);
}

export function setSensorActive(db, input) {
  const scope = requiredScope(input);
  const current = sensorInScope(db, input.sensor_id || input.id, scope);
  const active = input.active === undefined ? true : !!input.active;
  db.prepare('UPDATE iot_sensors SET is_active=?,updated_at=? WHERE id=?').run(active ? 1 : 0, timestamp(), current.id);
  return sensorInScope(db, current.id, scope);
}

export function recordSensorReadingMeta(db, input) {
  const scope = requiredScope(input);
  const current = sensorInScope(db, input.sensor_id || input.id, scope);
  const dataQuality = input.data_quality_state || current.dataQualityState;
  if (!DATA_QUALITY_STATES.includes(dataQuality)) {
    throw new IotDeviceError('Data quality state is not supported', 'INVALID_DATA_QUALITY_STATE');
  }
  const reading = input.reading === undefined ? current.lastReading : input.reading;
  const lastGood = input.is_good || dataQuality === 'good'
    ? reading
    : (input.last_good_reading === undefined ? current.lastGoodReading : input.last_good_reading);
  db.prepare(`UPDATE iot_sensors SET last_reading_json=?,last_good_reading_json=?,battery_level=?,
    signal_strength=?,clock_skew_seconds=?,last_sequence=?,data_quality_state=?,updated_at=? WHERE id=?`).run(
    reading == null ? null : JSON.stringify(reading),
    lastGood == null ? null : JSON.stringify(lastGood),
    input.battery_level === undefined ? current.batteryLevel : numberOrNull(input.battery_level),
    input.signal_strength === undefined ? current.signalStrength : numberOrNull(input.signal_strength),
    input.clock_skew_seconds === undefined ? current.clockSkewSeconds : Number(input.clock_skew_seconds || 0),
    input.last_sequence === undefined ? current.lastSequence : (input.last_sequence == null ? null : Number(input.last_sequence)),
    dataQuality, timestamp(), current.id,
  );
  return sensorInScope(db, current.id, scope);
}

export function getSensor(db, input) {
  const scope = requiredScope(input);
  return sensorInScope(db, input.sensor_id || input.id, scope);
}

export function listSensors(db, input) {
  const scope = requiredScope(input);
  let sql = 'SELECT * FROM iot_sensors WHERE company_id=?';
  const params = [scope.companyId];
  if (input.device_id) { sql += ' AND device_id=?'; params.push(input.device_id); }
  if (input.gateway_id) { sql += ' AND gateway_id=?'; params.push(input.gateway_id); }
  if (input.measurement_type) { sql += ' AND measurement_type=?'; params.push(input.measurement_type); }
  if (input.data_quality_state) { sql += ' AND data_quality_state=?'; params.push(input.data_quality_state); }
  if (!input.include_inactive) sql += ' AND is_active=1';
  sql += ' ORDER BY device_id,channel';
  return db.prepare(sql).all(...params).map(mapSensor);
}
