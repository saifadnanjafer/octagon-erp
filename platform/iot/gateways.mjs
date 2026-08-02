// BUILD-10 canonical IoT gateway administration.
'use strict';

import crypto from 'node:crypto';
import { IotDeviceError, requiredScope, deviceInScope, assertLifecycle } from './device-registry.mjs';

const uid = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const timestamp = () => new Date().toISOString();
const parseJson = (value, fallback = {}) => {
  try { return JSON.parse(value || ''); } catch { return fallback; }
};

const GATEWAY_STATES = ['active', 'suspended', 'offline', 'retired'];

export function mapGateway(row) {
  if (!row) return null;
  return {
    id: row.id, companyId: row.company_id, branchId: row.branch_id,
    code: row.code, name: row.name, site: row.site,
    connectivityType: row.connectivity_type,
    protocolMetadata: parseJson(row.protocol_metadata_json),
    buffering: parseJson(row.buffering_json),
    simulatorConfig: parseJson(row.simulator_config_json),
    lifecycleState: row.lifecycle_state, lastSeenAt: row.last_seen_at,
    createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function gatewayInScope(db, id, scope) {
  const row = db.prepare('SELECT * FROM iot_gateways WHERE id=? AND company_id=?').get(id, scope.companyId);
  if (!row) throw new IotDeviceError('Gateway is outside active company scope', 'GATEWAY_SCOPE_DENIED', 403);
  return mapGateway(row);
}

function assertGatewayLifecycle(gateway, allowed) {
  if (!allowed.includes(gateway.lifecycleState)) {
    throw new IotDeviceError('Gateway lifecycle state does not allow this action', 'GATEWAY_LIFECYCLE_INVALID', 409);
  }
}

export function registerGateway(db, input) {
  const scope = requiredScope(input);
  if (!input.code || !input.name) throw new IotDeviceError('Gateway code and name are required', 'INVALID_GATEWAY');
  const id = uid('iotgw');
  const now = timestamp();
  try {
    db.prepare(`INSERT INTO iot_gateways(
      id,company_id,branch_id,code,name,site,connectivity_type,protocol_metadata_json,
      buffering_json,simulator_config_json,lifecycle_state,last_seen_at,created_by,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,'active',?,?,?,?)`).run(
      id, scope.companyId, scope.branchId, String(input.code).trim().toUpperCase(),
      String(input.name).trim(), input.site || null, input.connectivity_type || null,
      JSON.stringify(input.protocol_metadata || {}), JSON.stringify(input.buffering || {}),
      JSON.stringify(input.simulator_config || {}), now, input.actor, now, now,
    );
  } catch (error) {
    if (/UNIQUE/.test(error.message)) throw new IotDeviceError('Gateway code already exists in this company', 'GATEWAY_CODE_DUPLICATE', 409);
    throw error;
  }
  return gatewayInScope(db, id, scope);
}

export function updateGateway(db, input) {
  const scope = requiredScope(input);
  const current = gatewayInScope(db, input.gateway_id || input.id, scope);
  assertGatewayLifecycle(current, ['active', 'suspended', 'offline']);
  db.prepare(`UPDATE iot_gateways SET name=?,site=?,connectivity_type=?,protocol_metadata_json=?,
    buffering_json=?,simulator_config_json=?,updated_at=? WHERE id=?`).run(
    String(input.name || current.name).trim(),
    input.site === undefined ? current.site : input.site,
    input.connectivity_type === undefined ? current.connectivityType : input.connectivity_type,
    input.protocol_metadata === undefined ? JSON.stringify(current.protocolMetadata) : JSON.stringify(input.protocol_metadata || {}),
    input.buffering === undefined ? JSON.stringify(current.buffering) : JSON.stringify(input.buffering || {}),
    input.simulator_config === undefined ? JSON.stringify(current.simulatorConfig) : JSON.stringify(input.simulator_config || {}),
    timestamp(), current.id,
  );
  return gatewayInScope(db, current.id, scope);
}

export function assignDeviceToGateway(db, input) {
  const scope = requiredScope(input);
  const current = gatewayInScope(db, input.gateway_id || input.id, scope);
  assertGatewayLifecycle(current, ['active', 'offline']);
  const device = deviceInScope(db, input.device_id, scope);
  assertLifecycle(device, ['draft', 'enrollment_pending', 'enrolled', 'active', 'suspended', 'offline', 'degraded']);
  db.prepare('UPDATE iot_devices SET gateway_id=?,updated_at=? WHERE id=?').run(current.id, timestamp(), device.id);
  return deviceInScope(db, device.id, scope);
}

export function suspendGateway(db, input) {
  const scope = requiredScope(input);
  const current = gatewayInScope(db, input.gateway_id || input.id, scope);
  assertGatewayLifecycle(current, ['active', 'offline']);
  db.prepare(`UPDATE iot_gateways SET lifecycle_state='suspended',updated_at=? WHERE id=?`).run(timestamp(), current.id);
  return gatewayInScope(db, current.id, scope);
}

export function resumeGateway(db, input) {
  const scope = requiredScope(input);
  const current = gatewayInScope(db, input.gateway_id || input.id, scope);
  assertGatewayLifecycle(current, ['suspended']);
  const now = timestamp();
  db.prepare(`UPDATE iot_gateways SET lifecycle_state='active',last_seen_at=?,updated_at=? WHERE id=?`).run(now, now, current.id);
  return gatewayInScope(db, current.id, scope);
}

export function getGateway(db, input) {
  const scope = requiredScope(input);
  return gatewayInScope(db, input.gateway_id || input.id, scope);
}

export function listGateways(db, input) {
  const scope = requiredScope(input);
  let sql = 'SELECT * FROM iot_gateways WHERE company_id=?';
  const params = [scope.companyId];
  if (input.lifecycle_state) { sql += ' AND lifecycle_state=?'; params.push(input.lifecycle_state); }
  if (input.branch_id) { sql += ' AND branch_id=?'; params.push(input.branch_id); }
  if (input.search) {
    sql += ' AND (code LIKE ? OR name LIKE ?)';
    const term = `%${input.search}%`;
    params.push(term, term);
  }
  sql += ' ORDER BY code';
  return db.prepare(sql).all(...params).map(mapGateway);
}

export { GATEWAY_STATES };
