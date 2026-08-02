// BUILD-10 canonical IoT device-registry extension.
'use strict';

import crypto from 'node:crypto';

export class IotDeviceError extends Error {
  constructor(message, code, statusCode = 422) {
    super(message);
    this.name = 'IotDeviceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const uid = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const timestamp = () => new Date().toISOString();
const parseJson = (value, fallback = {}) => {
  try { return JSON.parse(value || ''); } catch { return fallback; }
};

export const DEVICE_TYPES = ['gateway', 'sensor', 'tracker', 'kiosk', 'display'];
export const DEVICE_LIFECYCLE_STATES = ['draft', 'enrollment_pending', 'enrolled', 'active', 'suspended', 'offline', 'degraded', 'retired', 'revoked', 'lost', 'replaced'];
const TERMINAL_STATES = ['revoked', 'lost'];
const PLAINTEXT_CREDENTIAL_RE = /token|password|secret/i;

export function requiredScope(input) {
  if (!input.company_id) throw new IotDeviceError('Active company scope is required', 'COMPANY_SCOPE_REQUIRED', 403);
  return { companyId: input.company_id, branchId: input.branch_id || null };
}

export function deviceInScope(db, id, scope) {
  const row = db.prepare('SELECT * FROM iot_devices WHERE id=? AND company_id=?').get(id, scope.companyId);
  if (!row) throw new IotDeviceError('Device is outside active company scope', 'DEVICE_SCOPE_DENIED', 403);
  return mapDevice(row);
}

export function assertLifecycle(device, allowed, message = 'Device lifecycle state does not allow this action') {
  if (TERMINAL_STATES.includes(device.lifecycleState)) {
    throw new IotDeviceError('Device is revoked or lost and cannot be mutated', 'DEVICE_REVOKED', 409);
  }
  if (!allowed.includes(device.lifecycleState)) {
    throw new IotDeviceError(message, 'DEVICE_LIFECYCLE_INVALID', 409);
  }
}

function rejectPlaintextCredentials(input) {
  for (const key of Object.keys(input)) {
    if (key === 'credential_ref') continue;
    if (PLAINTEXT_CREDENTIAL_RE.test(key)) {
      throw new IotDeviceError('Plaintext credential material is rejected; store a credential_ref instead', 'CREDENTIAL_PLAINTEXT_REJECTED');
    }
  }
}

export function mapDevice(row) {
  if (!row) return null;
  return {
    id: row.id, companyId: row.company_id, branchId: row.branch_id, site: row.site,
    externalRef: row.external_ref, deviceType: row.device_type,
    manufacturer: row.manufacturer, model: row.model, hardwareRevision: row.hardware_revision,
    serialNumber: row.serial_number, gatewayId: row.gateway_id, assetId: row.asset_id,
    vehicleId: row.vehicle_id, warehouseId: row.warehouse_id, workCenterId: row.work_center_id,
    employeeId: row.employee_id, timezone: row.timezone, connectivityType: row.connectivity_type,
    protocolMetadata: parseJson(row.protocol_metadata_json),
    installationDate: row.installation_date, activationDate: row.activation_date,
    lastSeenAt: row.last_seen_at, healthState: row.health_state, lifecycleState: row.lifecycle_state,
    provider: row.provider, simulatorProvider: row.simulator_provider,
    firmwareVersion: row.firmware_version, configurationVersion: row.configuration_version,
    ownership: row.ownership, tags: parseJson(row.tags_json, []), notes: row.notes,
    credentialRef: row.credential_ref, replacedByDeviceId: row.replaced_by_device_id,
    createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function registerDevice(db, input) {
  const scope = requiredScope(input);
  rejectPlaintextCredentials(input);
  if (!input.external_ref) throw new IotDeviceError('Device external_ref is required', 'INVALID_DEVICE');
  if (!DEVICE_TYPES.includes(input.device_type)) throw new IotDeviceError('Device type is not supported', 'INVALID_DEVICE_TYPE');
  const id = uid('iotdev');
  const now = timestamp();
  try {
    db.prepare(`INSERT INTO iot_devices(
      id,company_id,branch_id,site,external_ref,device_type,manufacturer,model,hardware_revision,
      serial_number,gateway_id,asset_id,vehicle_id,warehouse_id,work_center_id,employee_id,timezone,
      connectivity_type,protocol_metadata_json,lifecycle_state,health_state,provider,simulator_provider,
      firmware_version,configuration_version,ownership,tags_json,notes,credential_ref,
      created_by,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'{}','draft','unknown',?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, scope.companyId, scope.branchId, input.site || null, String(input.external_ref).trim(),
      input.device_type, input.manufacturer || null, input.model || null,
      input.hardware_revision || null, input.serial_number || null,
      input.gateway_id || null, input.asset_id || null, input.vehicle_id || null,
      input.warehouse_id || null, input.work_center_id || null, input.employee_id || null,
      input.timezone || null, input.connectivity_type || null,
      input.provider || null, input.simulator_provider || null,
      input.firmware_version || null, input.configuration_version || null,
      input.ownership || null, JSON.stringify(input.tags || []), input.notes || null,
      input.credential_ref || null, input.actor, now, now,
    );
  } catch (error) {
    if (/UNIQUE/.test(error.message)) throw new IotDeviceError('Device external_ref already exists in this company', 'DEVICE_EXTERNAL_REF_DUPLICATE', 409);
    throw error;
  }
  return deviceInScope(db, id, scope);
}

export function updateDraftDevice(db, input) {
  const scope = requiredScope(input);
  rejectPlaintextCredentials(input);
  const current = deviceInScope(db, input.device_id || input.id, scope);
  assertLifecycle(current, ['draft', 'enrollment_pending']);
  if (input.device_type && !DEVICE_TYPES.includes(input.device_type)) throw new IotDeviceError('Device type is not supported', 'INVALID_DEVICE_TYPE');
  db.prepare(`UPDATE iot_devices SET external_ref=?,device_type=?,manufacturer=?,model=?,
    hardware_revision=?,serial_number=?,site=?,timezone=?,connectivity_type=?,provider=?,
    firmware_version=?,ownership=?,tags_json=?,notes=?,credential_ref=?,protocol_metadata_json=?,updated_at=?
    WHERE id=?`).run(
    String(input.external_ref || current.externalRef).trim(),
    input.device_type || current.deviceType,
    input.manufacturer === undefined ? current.manufacturer : input.manufacturer,
    input.model === undefined ? current.model : input.model,
    input.hardware_revision === undefined ? current.hardwareRevision : input.hardware_revision,
    input.serial_number === undefined ? current.serialNumber : input.serial_number,
    input.site === undefined ? current.site : input.site,
    input.timezone === undefined ? current.timezone : input.timezone,
    input.connectivity_type === undefined ? current.connectivityType : input.connectivity_type,
    input.provider === undefined ? current.provider : input.provider,
    input.firmware_version === undefined ? current.firmwareVersion : input.firmware_version,
    input.ownership === undefined ? current.ownership : input.ownership,
    input.tags === undefined ? JSON.stringify(current.tags) : JSON.stringify(input.tags),
    input.notes === undefined ? current.notes : input.notes,
    input.credential_ref === undefined ? current.credentialRef : input.credential_ref,
    input.protocol_metadata === undefined ? JSON.stringify(current.protocolMetadata) : JSON.stringify(input.protocol_metadata || {}),
    timestamp(), current.id,
  );
  return deviceInScope(db, current.id, scope);
}

export function assignAsset(db, input) {
  const scope = requiredScope(input);
  const current = deviceInScope(db, input.device_id || input.id, scope);
  assertLifecycle(current, ['draft', 'enrollment_pending', 'enrolled', 'active', 'suspended', 'offline', 'degraded']);
  if (!input.asset_id) throw new IotDeviceError('asset_id is required', 'INVALID_ASSET_ASSIGNMENT');
  const asset = db.prepare('SELECT id FROM assets WHERE id=? AND company_id=?').get(input.asset_id, scope.companyId);
  if (!asset) throw new IotDeviceError('Asset is outside active company scope', 'ASSET_SCOPE_DENIED', 403);
  db.prepare('UPDATE iot_devices SET asset_id=?,updated_at=? WHERE id=?').run(input.asset_id, timestamp(), current.id);
  return deviceInScope(db, current.id, scope);
}

export function assignVehicle(db, input) {
  const scope = requiredScope(input);
  const current = deviceInScope(db, input.device_id || input.id, scope);
  assertLifecycle(current, ['draft', 'enrollment_pending', 'enrolled', 'active', 'suspended', 'offline', 'degraded']);
  if (!input.vehicle_id) throw new IotDeviceError('vehicle_id is required', 'INVALID_VEHICLE_ASSIGNMENT');
  const vehicle = db.prepare('SELECT id FROM fleet_vehicles WHERE id=? AND company_id=?').get(input.vehicle_id, scope.companyId);
  if (!vehicle) throw new IotDeviceError('Vehicle is outside active company scope', 'VEHICLE_SCOPE_DENIED', 403);
  db.prepare('UPDATE iot_devices SET vehicle_id=?,updated_at=? WHERE id=?').run(input.vehicle_id, timestamp(), current.id);
  return deviceInScope(db, current.id, scope);
}

export function assignSite(db, input) {
  const scope = requiredScope(input);
  const current = deviceInScope(db, input.device_id || input.id, scope);
  assertLifecycle(current, ['draft', 'enrollment_pending', 'enrolled', 'active', 'suspended', 'offline', 'degraded']);
  db.prepare('UPDATE iot_devices SET site=?,branch_id=?,warehouse_id=?,work_center_id=?,updated_at=? WHERE id=?').run(
    input.site === undefined ? current.site : input.site,
    input.branch_id === undefined ? current.branchId : input.branch_id,
    input.warehouse_id === undefined ? current.warehouseId : input.warehouse_id,
    input.work_center_id === undefined ? current.workCenterId : input.work_center_id,
    timestamp(), current.id,
  );
  return deviceInScope(db, current.id, scope);
}

export function assignGateway(db, input) {
  const scope = requiredScope(input);
  const current = deviceInScope(db, input.device_id || input.id, scope);
  assertLifecycle(current, ['draft', 'enrollment_pending', 'enrolled', 'active', 'suspended', 'offline', 'degraded']);
  if (input.gateway_id) {
    const gateway = db.prepare('SELECT id FROM iot_gateways WHERE id=? AND company_id=?').get(input.gateway_id, scope.companyId);
    if (!gateway) throw new IotDeviceError('Gateway is outside active company scope', 'GATEWAY_SCOPE_DENIED', 403);
  }
  db.prepare('UPDATE iot_devices SET gateway_id=?,updated_at=? WHERE id=?').run(input.gateway_id || null, timestamp(), current.id);
  return deviceInScope(db, current.id, scope);
}

export function enrollDeviceSimulated(db, input) {
  const scope = requiredScope(input);
  const current = deviceInScope(db, input.device_id || input.id, scope);
  if (current.lifecycleState === 'enrolled' && input.idempotency_key && current.simulatorProvider) {
    return current;
  }
  assertLifecycle(current, ['draft', 'enrollment_pending']);
  const simulatorProvider = input.simulator_provider || current.simulatorProvider || 'simulated';
  const enrollmentId = input.idempotency_key || uid('iotenroll');
  db.prepare(`UPDATE iot_devices SET lifecycle_state='enrolled',simulator_provider=?,
    protocol_metadata_json=?,activation_date=NULL,updated_at=? WHERE id=?`).run(
    simulatorProvider,
    JSON.stringify({ ...current.protocolMetadata, simulated_enrollment_id: enrollmentId }),
    timestamp(), current.id,
  );
  return deviceInScope(db, current.id, scope);
}

export function activateDevice(db, input) {
  const scope = requiredScope(input);
  const current = deviceInScope(db, input.device_id || input.id, scope);
  assertLifecycle(current, ['enrolled']);
  const now = timestamp();
  db.prepare(`UPDATE iot_devices SET lifecycle_state='active',activation_date=?,last_seen_at=?,
    health_state='online',updated_at=? WHERE id=?`).run(now, now, now, current.id);
  return deviceInScope(db, current.id, scope);
}

export function suspendDevice(db, input) {
  const scope = requiredScope(input);
  const current = deviceInScope(db, input.device_id || input.id, scope);
  assertLifecycle(current, ['active', 'degraded', 'offline']);
  db.prepare(`UPDATE iot_devices SET lifecycle_state='suspended',updated_at=? WHERE id=?`).run(timestamp(), current.id);
  return deviceInScope(db, current.id, scope);
}

export function resumeDevice(db, input) {
  const scope = requiredScope(input);
  const current = deviceInScope(db, input.device_id || input.id, scope);
  assertLifecycle(current, ['suspended']);
  const now = timestamp();
  db.prepare(`UPDATE iot_devices SET lifecycle_state='active',last_seen_at=?,updated_at=? WHERE id=?`).run(now, now, current.id);
  return deviceInScope(db, current.id, scope);
}

export function revokeDevice(db, input) {
  const scope = requiredScope(input);
  const current = deviceInScope(db, input.device_id || input.id, scope);
  assertLifecycle(current, ['draft', 'enrollment_pending', 'enrolled', 'active', 'suspended', 'offline', 'degraded']);
  db.prepare(`UPDATE iot_devices SET lifecycle_state='revoked',updated_at=? WHERE id=?`).run(timestamp(), current.id);
  return deviceInScope(db, current.id, scope);
}

export function markDeviceLost(db, input) {
  const scope = requiredScope(input);
  const current = deviceInScope(db, input.device_id || input.id, scope);
  assertLifecycle(current, ['active', 'suspended', 'offline', 'degraded', 'enrolled']);
  db.prepare(`UPDATE iot_devices SET lifecycle_state='lost',health_state='offline',updated_at=? WHERE id=?`).run(timestamp(), current.id);
  return deviceInScope(db, current.id, scope);
}

export function replaceDevice(db, input) {
  const scope = requiredScope(input);
  const current = deviceInScope(db, input.device_id || input.id, scope);
  assertLifecycle(current, ['active', 'suspended', 'offline', 'degraded', 'enrolled']);
  const replacementId = uid('iotdev');
  const now = timestamp();
  db.prepare(`INSERT INTO iot_devices(
    id,company_id,branch_id,site,external_ref,device_type,manufacturer,model,hardware_revision,
    serial_number,gateway_id,asset_id,vehicle_id,warehouse_id,work_center_id,employee_id,timezone,
    connectivity_type,protocol_metadata_json,lifecycle_state,health_state,provider,simulator_provider,
    firmware_version,configuration_version,ownership,tags_json,notes,credential_ref,
    created_by,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'{}','draft','unknown',?,?,?,?,?,?,?,?,?,?,?)`).run(
    replacementId, scope.companyId, current.branchId, current.site,
    input.external_ref || `${current.externalRef}-R`,
    current.deviceType, current.manufacturer, current.model, current.hardwareRevision,
    input.serial_number || null, current.gatewayId, current.assetId, current.vehicleId,
    current.warehouseId, current.workCenterId, current.employeeId, current.timezone,
    current.connectivityType, current.provider, current.simulatorProvider,
    input.firmware_version || current.firmwareVersion, current.configurationVersion,
    current.ownership, JSON.stringify(current.tags), current.notes,
    input.credential_ref || null, input.actor, now, now,
  );
  db.prepare(`UPDATE iot_devices SET lifecycle_state='replaced',replaced_by_device_id=?,updated_at=? WHERE id=?`).run(replacementId, now, current.id);
  return { replaced: deviceInScope(db, current.id, scope), replacement: deviceInScope(db, replacementId, scope) };
}

export function retireDevice(db, input) {
  const scope = requiredScope(input);
  const current = deviceInScope(db, input.device_id || input.id, scope);
  if (current.lifecycleState === 'revoked' || current.lifecycleState === 'lost') {
    throw new IotDeviceError('Device is revoked or lost and cannot be mutated', 'DEVICE_REVOKED', 409);
  }
  if (!['suspended', 'offline', 'replaced'].includes(current.lifecycleState)) {
    throw new IotDeviceError('Only suspended, offline or replaced devices can be retired', 'DEVICE_LIFECYCLE_INVALID', 409);
  }
  db.prepare(`UPDATE iot_devices SET lifecycle_state='retired',updated_at=? WHERE id=?`).run(timestamp(), current.id);
  return deviceInScope(db, current.id, scope);
}

export function rotateCredentialReference(db, input) {
  const scope = requiredScope(input);
  rejectPlaintextCredentials(input);
  const current = deviceInScope(db, input.device_id || input.id, scope);
  assertLifecycle(current, ['draft', 'enrollment_pending', 'enrolled', 'active', 'suspended', 'offline', 'degraded']);
  if (!input.credential_ref) throw new IotDeviceError('A new credential_ref is required', 'CREDENTIAL_REF_REQUIRED');
  db.prepare('UPDATE iot_devices SET credential_ref=?,updated_at=? WHERE id=?').run(input.credential_ref, timestamp(), current.id);
  return deviceInScope(db, current.id, scope);
}

export function updateDeviceConfiguration(db, input) {
  const scope = requiredScope(input);
  const current = deviceInScope(db, input.device_id || input.id, scope);
  assertLifecycle(current, ['draft', 'enrollment_pending', 'enrolled', 'active', 'suspended', 'offline', 'degraded']);
  const nextVersion = input.configuration_version
    || String(Number(current.configurationVersion || 0) + 1);
  db.prepare('UPDATE iot_devices SET configuration_version=?,firmware_version=?,protocol_metadata_json=?,updated_at=? WHERE id=?').run(
    nextVersion,
    input.firmware_version === undefined ? current.firmwareVersion : input.firmware_version,
    input.protocol_metadata === undefined ? JSON.stringify(current.protocolMetadata) : JSON.stringify(input.protocol_metadata || {}),
    timestamp(), current.id,
  );
  return deviceInScope(db, current.id, scope);
}

export function recordInstallation(db, input) {
  const scope = requiredScope(input);
  const current = deviceInScope(db, input.device_id || input.id, scope);
  assertLifecycle(current, ['draft', 'enrollment_pending', 'enrolled', 'active', 'suspended', 'offline', 'degraded']);
  db.prepare('UPDATE iot_devices SET installation_date=?,site=?,updated_at=? WHERE id=?').run(
    input.installation_date || timestamp().slice(0, 10),
    input.site === undefined ? current.site : input.site,
    timestamp(), current.id,
  );
  return deviceInScope(db, current.id, scope);
}

export function recordHealthCheck(db, input) {
  const scope = requiredScope(input);
  const current = deviceInScope(db, input.device_id || input.id, scope);
  assertLifecycle(current, ['enrolled', 'active', 'suspended', 'offline', 'degraded']);
  const healthState = input.health_state || current.healthState;
  if (!['online', 'offline', 'degraded', 'warning', 'critical', 'unknown'].includes(healthState)) {
    throw new IotDeviceError('Health state is not supported', 'INVALID_HEALTH_STATE');
  }
  const lifecycle = healthState === 'offline' ? 'offline'
    : healthState === 'degraded' && current.lifecycleState === 'active' ? 'degraded'
    : current.lifecycleState;
  const missed = Number(current.protocolMetadata.missed_health_checks || 0);
  const metadata = {
    ...current.protocolMetadata,
    missed_health_checks: input.missed ? missed + 1 : 0,
  };
  const now = timestamp();
  db.prepare('UPDATE iot_devices SET health_state=?,lifecycle_state=?,last_seen_at=?,protocol_metadata_json=?,updated_at=? WHERE id=?').run(
    healthState, lifecycle, input.missed ? current.lastSeenAt : now, JSON.stringify(metadata), now, current.id,
  );
  return deviceInScope(db, current.id, scope);
}

export function getDevice(db, input) {
  const scope = requiredScope(input);
  return deviceInScope(db, input.device_id || input.id, scope);
}

export function listDevices(db, input) {
  const scope = requiredScope(input);
  let sql = 'SELECT * FROM iot_devices WHERE company_id=?';
  const params = [scope.companyId];
  if (input.device_type) { sql += ' AND device_type=?'; params.push(input.device_type); }
  if (input.lifecycle_state) { sql += ' AND lifecycle_state=?'; params.push(input.lifecycle_state); }
  if (input.health_state) { sql += ' AND health_state=?'; params.push(input.health_state); }
  if (input.gateway_id) { sql += ' AND gateway_id=?'; params.push(input.gateway_id); }
  if (input.vehicle_id) { sql += ' AND vehicle_id=?'; params.push(input.vehicle_id); }
  if (input.branch_id) { sql += ' AND branch_id=?'; params.push(input.branch_id); }
  if (input.search) {
    sql += ' AND (external_ref LIKE ? OR serial_number LIKE ? OR model LIKE ?)';
    const term = `%${input.search}%`;
    params.push(term, term, term);
  }
  sql += ' ORDER BY external_ref';
  return db.prepare(sql).all(...params).map(mapDevice);
}
