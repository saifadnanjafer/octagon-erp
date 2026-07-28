// platform/fleet/index.mjs — Fleet Operations Action Registration and Query Handler.

'use strict';

import { registerDomainHandler } from '../kernel/actions/domain-handler.mjs';

import * as vehicles from './vehicles.mjs';
import * as trips from './trips.mjs';
import * as telematics from './telematics.mjs';

export { vehicles, trips, telematics };
export { FleetError } from './vehicles.mjs';

export function registerFleetActions(actionExecutor) {
  if (!actionExecutor || typeof actionExecutor.registerHandler !== 'function') {
    throw new TypeError('canonical ActionExecutor with registerHandler() is required');
  }

  registerDomainHandler(actionExecutor, 'fleet:vehicle:create', vehicles.createVehicle);
  registerDomainHandler(actionExecutor, 'fleet:driver:create', vehicles.createDriver);
  registerDomainHandler(actionExecutor, 'fleet:driver:assign', vehicles.assignDriver);
  registerDomainHandler(actionExecutor, 'fleet:trip:record', trips.recordTrip);
  registerDomainHandler(actionExecutor, 'fleet:fuel:record', trips.recordFuel);
  registerDomainHandler(actionExecutor, 'fleet:telemetry:ingest', telematics.ingestTelemetry);

  return actionExecutor;
}

export function handleFleetQuery({ dialect, ctx, resource, recordId, query }) {
  if (resource === 'vehicles' || resource === 'fleet_vehicles') {
    if (recordId) {
      const doc = dialect.prepare('SELECT * FROM fleet_vehicles WHERE id = ?').get(recordId);
      return doc ? { data: doc } : { error: 'vehicle not found', status: 404 };
    }
    const rows = dialect.prepare('SELECT * FROM fleet_vehicles ORDER BY created_at DESC').all();
    return { data: rows, meta: { total: rows.length } };
  }

  if (resource === 'drivers' || resource === 'fleet_drivers') {
    const rows = dialect.prepare('SELECT * FROM fleet_drivers ORDER BY created_at DESC').all();
    return { data: rows, meta: { total: rows.length } };
  }

  if (resource === 'trips' || resource === 'fleet_trips') {
    const rows = dialect.prepare('SELECT * FROM fleet_trips ORDER BY created_at DESC').all();
    return { data: rows, meta: { total: rows.length } };
  }

  if (resource === 'fuel-logs' || resource === 'fuel_logs') {
    const rows = dialect.prepare('SELECT * FROM fleet_fuel_logs ORDER BY created_at DESC').all();
    return { data: rows, meta: { total: rows.length } };
  }

  if (resource === 'telemetry' || resource === 'telemetry_events') {
    const rows = dialect.prepare('SELECT * FROM fleet_telemetry_events ORDER BY created_at DESC').all();
    return { data: rows, meta: { total: rows.length } };
  }

  return { error: `unknown fleet resource ${resource}`, status: 404 };
}
