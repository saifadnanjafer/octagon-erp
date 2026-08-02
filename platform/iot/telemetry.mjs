// BUILD-10 Slice 2: Telemetry Ingestion and Normalization Pipeline
'use strict';

import crypto from 'node:crypto';

function ensureScope(ctx, db, deviceId) {
  const companyId = ctx.company_id || ctx.companyId;
  if (!companyId) {
    const error = new Error('Company scope required for telemetry operation');
    error.code = 'COMPANY_SCOPE_REQUIRED';
    error.statusCode = 400;
    throw error;
  }
  if (deviceId) {
    const device = db.prepare('SELECT company_id, lifecycle_state FROM iot_devices WHERE id = ?').get(deviceId);
    if (!device || device.company_id !== companyId) {
      const error = new Error('Device scope denied or device not found');
      error.code = 'DEVICE_SCOPE_DENIED';
      error.statusCode = 403;
      throw error;
    }
    if (['revoked', 'lost', 'retired'].includes(device.lifecycle_state)) {
      const error = new Error(`Cannot ingest telemetry for ${device.lifecycle_state} device`);
      error.code = 'DEVICE_STATE_INVALID';
      error.statusCode = 422;
      throw error;
    }
    return device;
  }
  return null;
}

export function ingestTelemetrySimulated(db, input, ctx) {
  const companyId = ctx.company_id || ctx.companyId;
  const deviceId = input.device_id;
  ensureScope(ctx, db, deviceId);

  const rawId = input.id || `raw_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const actor = ctx.actor || ctx.actorId || ctx.userId || 'system';
  const now = new Date().toISOString();
  const receivedAt = input.received_at || now;
  const deviceTimestamp = input.device_timestamp || now;
  const rawPayload = JSON.stringify(input.raw_payload || input.payload || {});
  
  // Compute checksum
  const checksum = crypto.createHash('sha256').update(rawPayload).digest('hex');

  // Check duplicate
  const existing = db.prepare('SELECT id FROM iot_telemetry_raw WHERE company_id = ? AND device_id = ? AND payload_checksum = ?').get(companyId, deviceId, checksum);
  if (existing) {
    db.prepare(`
      INSERT INTO iot_telemetry_raw (id, company_id, device_id, gateway_id, sensor_id, correlation_id, sequence, device_timestamp, gateway_timestamp, received_at, payload_checksum, raw_payload_json, status, rejection_reason, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'duplicate', 'Duplicate payload checksum', ?, ?, ?)
    `).run(`raw_dup_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, companyId, deviceId, input.gateway_id || null, input.sensor_id || null, input.correlation_id || null, input.sequence || 0, deviceTimestamp, input.gateway_timestamp || null, receivedAt, `${checksum}_dup_${Date.now()}`, rawPayload, actor, now, now);
    
    return { status: 'duplicate', rawId: existing.id, checksum, processedEvents: [] };
  }

  // Insert raw record
  db.prepare(`
    INSERT INTO iot_telemetry_raw (id, company_id, device_id, gateway_id, sensor_id, correlation_id, sequence, device_timestamp, gateway_timestamp, received_at, payload_checksum, raw_payload_json, status, rejection_reason, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'normalized', NULL, ?, ?, ?)
  `).run(rawId, companyId, deviceId, input.gateway_id || null, input.sensor_id || null, input.correlation_id || null, input.sequence || 0, deviceTimestamp, input.gateway_timestamp || null, receivedAt, checksum, rawPayload, actor, now, now);

  // Update device last_seen_at
  db.prepare('UPDATE iot_devices SET last_seen_at = ?, health_state = ? WHERE id = ?').run(receivedAt, 'online', deviceId);

  // Process and normalize measurements
  const measurements = input.measurements || [{ type: input.measurement_type || 'telemetry', value: input.value, unit: input.unit }];
  const processedEvents = [];

  for (const m of measurements) {
    const eventId = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const mType = m.type || m.measurement_type || 'telemetry';
    const rawVal = m.value !== undefined ? m.value : null;
    const unit = m.unit || null;

    // Unit Normalization example
    let normVal = rawVal;
    let normUnit = unit;
    if (mType === 'temperature' && unit === 'F' && rawVal !== null) {
      normVal = Math.round(((rawVal - 32) * 5 / 9) * 100) / 100;
      normUnit = 'C';
    } else if (mType === 'speed' && unit === 'mph' && rawVal !== null) {
      normVal = Math.round((rawVal * 1.60934) * 100) / 100;
      normUnit = 'km/h';
    }

    // Quality calculation & clock skew
    let quality = 'good';
    const qualityFlags = [];
    const devTimeMs = new Date(deviceTimestamp).getTime();
    const recvTimeMs = new Date(receivedAt).getTime();
    const clockSkewSec = Math.abs((recvTimeMs - devTimeMs) / 1000);

    if (clockSkewSec > 300) {
      qualityFlags.push('CLOCK_SKEW_HIGH');
      quality = 'suspect';
    }

    db.prepare(`
      INSERT INTO iot_telemetry_events (id, company_id, raw_id, device_id, sensor_id, measurement_type, value, value_text, unit, normalized_value, normalized_unit, device_timestamp, received_at, sequence, quality, quality_flags_json, is_late, is_out_of_order, clock_skew_seconds, correlation_id, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)
    `).run(
      eventId, companyId, rawId, deviceId, input.sensor_id || null, mType,
      typeof rawVal === 'number' ? rawVal : null,
      typeof rawVal === 'string' ? rawVal : null,
      unit, typeof normVal === 'number' ? normVal : null, normUnit,
      deviceTimestamp, receivedAt, input.sequence || 0, quality,
      JSON.stringify(qualityFlags), clockSkewSec, input.correlation_id || null,
      actor, now, now
    );

    processedEvents.push({ eventId, measurementType: mType, rawValue: rawVal, normalizedValue: normVal, normalizedUnit: normUnit, quality });
  }

  return { status: 'normalized', rawId, checksum, processedEvents };
}

export function listTelemetryEvents(db, params) {
  const companyId = params.company_id || params.companyId;
  if (!companyId) {
    const error = new Error('Company scope required for telemetry events query');
    error.code = 'COMPANY_SCOPE_REQUIRED';
    error.statusCode = 400;
    throw error;
  }
  let sql = 'SELECT * FROM iot_telemetry_events WHERE company_id = ?';
  const args = [companyId];

  if (params.device_id || params.deviceId) {
    sql += ' AND device_id = ?';
    args.push(params.device_id || params.deviceId);
  }
  if (params.measurement_type || params.measurementType) {
    sql += ' AND measurement_type = ?';
    args.push(params.measurement_type || params.measurementType);
  }
  if (params.quality) {
    sql += ' AND quality = ?';
    args.push(params.quality);
  }

  sql += ' ORDER BY device_timestamp DESC LIMIT ? OFFSET ?';
  args.push(params.limit || 50, params.offset || 0);

  return db.prepare(sql).all(...args).map(r => ({
    id: r.id,
    companyId: r.company_id,
    rawId: r.raw_id,
    deviceId: r.device_id,
    sensorId: r.sensor_id,
    measurementType: r.measurement_type,
    value: r.value,
    valueText: r.value_text,
    unit: r.unit,
    normalizedValue: r.normalized_value,
    normalizedUnit: r.normalized_unit,
    deviceTimestamp: r.device_timestamp,
    receivedAt: r.received_at,
    sequence: r.sequence,
    quality: r.quality,
    qualityFlags: JSON.parse(r.quality_flags_json || '[]'),
    clockSkewSeconds: r.clock_skew_seconds
  }));
}
