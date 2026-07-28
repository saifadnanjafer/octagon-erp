// platform/fleet/telematics.mjs — Telematics Adapters Domain Engine.

'use strict';

import crypto from 'node:crypto';
import { FleetError } from './vehicles.mjs';

function nowISO() {
  return new Date().toISOString();
}

export function ingestTelemetry(db, input) {
  const { vehicle_id, device_id, provider_type, event_type, latitude, longitude, speed, speed_kmh, odometer, engine_hours, fuel_level, payload, payload_json } = input;
  if (!vehicle_id || !event_type) {
    throw new FleetError('vehicle_id and event_type are required', 'INPUT_MISSING_FIELD');
  }

  const dialect = db;
  const veh = dialect.prepare('SELECT * FROM fleet_vehicles WHERE id = ?').get(vehicle_id);
  if (!veh) throw new FleetError(`vehicle ${vehicle_id} not found`, 'VEHICLE_NOT_FOUND');

  const provType = provider_type || device_id || 'obd2_adapter';
  const spd = speed_kmh !== undefined ? Number(speed_kmh) : (speed !== undefined ? Number(speed) : null);
  const pData = payload_json || payload;

  const id = `tel_${crypto.randomUUID()}`;
  const now = nowISO();

  dialect.prepare(`
    INSERT INTO fleet_telemetry_events (
      id, company_id, vehicle_id, provider_type, event_type, timestamp, latitude, longitude,
      speed, odometer, engine_hours, fuel_level, payload_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, veh.company_id, vehicle_id, provType, event_type, now,
    latitude !== undefined ? Number(latitude) : null,
    longitude !== undefined ? Number(longitude) : null,
    spd,
    odometer !== undefined ? Number(odometer) : null,
    engine_hours !== undefined ? Number(engine_hours) : null,
    fuel_level !== undefined ? Number(fuel_level) : null,
    pData ? (typeof pData === 'string' ? pData : JSON.stringify(pData)) : '{}', now
  );

  if (odometer && Number(odometer) > veh.current_odometer) {
    dialect.prepare('UPDATE fleet_vehicles SET current_odometer = ?, updated_at = ? WHERE id = ?').run(Number(odometer), now, vehicle_id);
  }

  return { id, vehicle_id, provider_type: provType, event_type, speed_kmh: spd };
}
