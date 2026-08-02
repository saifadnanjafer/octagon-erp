// BUILD-10 Slice 2: Firmware Catalogue, Staged Rollout and Config Profiles
'use strict';

export function registerFirmware(db, input, ctx) {
  const companyId = ctx.company_id || ctx.companyId;
  const version = input.version;
  const deviceModel = input.device_model;
  const checksum = input.checksum || 'sha256_placeholder';
  const actor = ctx.actor || ctx.actorId || ctx.userId || 'system';
  const now = new Date().toISOString();

  if (!companyId) {
    const error = new Error('Company scope required for firmware registration');
    error.code = 'COMPANY_SCOPE_REQUIRED';
    error.statusCode = 400;
    throw error;
  }

  const id = `fw_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  db.prepare(`
    INSERT INTO iot_firmware_catalogue (id, company_id, version, checksum, device_model, compatibility_json, release_notes, approval_state, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)
  `).run(id, companyId, version, checksum, deviceModel, JSON.stringify(input.compatibility || []), input.release_notes || null, actor, now, now);

  return { id, companyId, version, deviceModel, approvalState: 'draft' };
}

export function approveFirmware(db, input, ctx) {
  const companyId = ctx.company_id || ctx.companyId;
  const firmwareId = input.firmware_id || input.firmwareId;
  const actor = ctx.actor || ctx.actorId || ctx.userId || 'system';
  const now = new Date().toISOString();

  const fw = db.prepare('SELECT * FROM iot_firmware_catalogue WHERE id = ? AND company_id = ?').get(firmwareId, companyId);
  if (!fw) {
    const error = new Error('Firmware not found or scope denied');
    error.code = 'FIRMWARE_NOT_FOUND';
    error.statusCode = 404;
    throw error;
  }

  db.prepare(`
    UPDATE iot_firmware_catalogue SET approval_state = 'approved', approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?
  `).run(actor, now, now, firmwareId);

  return { id: firmwareId, approvalState: 'approved', approvedBy: actor, approvedAt: now };
}

export function rolloutFirmwareSimulated(db, input, ctx) {
  const companyId = ctx.company_id || ctx.companyId;
  const firmwareId = input.firmware_id || input.firmwareId;
  const actor = ctx.actor || ctx.actorId || ctx.userId || 'system';
  const now = new Date().toISOString();

  const fw = db.prepare('SELECT * FROM iot_firmware_catalogue WHERE id = ? AND company_id = ?').get(firmwareId, companyId);
  if (!fw || fw.approval_state !== 'approved') {
    const error = new Error('Firmware must be approved before rollout');
    error.code = 'FIRMWARE_NOT_APPROVED';
    error.statusCode = 422;
    throw error;
  }

  const rolloutId = `rollout_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  db.prepare(`
    INSERT INTO iot_firmware_rollouts (id, company_id, firmware_id, target_group_json, staged_plan_json, simulator, status, success_count, failure_count, started_at, completed_at, idempotency_key, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, 'completed', 5, 0, ?, ?, ?, ?, ?, ?)
  `).run(rolloutId, companyId, firmwareId, JSON.stringify(input.target_group || {}), JSON.stringify(input.staged_plan || {}), now, now, input.idempotency_key || null, actor, now, now);

  // Update target devices firmware version in simulation
  db.prepare('UPDATE iot_devices SET firmware_version = ? WHERE company_id = ? AND model = ?').run(fw.version, companyId, fw.device_model);

  return { rolloutId, firmwareId, status: 'completed', simulator: true, successCount: 5, failureCount: 0 };
}

export function upsertConfigProfile(db, input, ctx) {
  const companyId = ctx.company_id || ctx.companyId;
  const name = input.name;
  const version = input.profile_version || 1;
  const actor = ctx.actor || ctx.actorId || ctx.userId || 'system';
  const now = new Date().toISOString();

  if (!companyId) {
    const error = new Error('Company scope required for config profile');
    error.code = 'COMPANY_SCOPE_REQUIRED';
    error.statusCode = 400;
    throw error;
  }

  const id = `cfg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  db.prepare(`
    INSERT INTO iot_config_profiles (id, company_id, name, profile_version, device_model, desired_config_json, is_active, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    ON CONFLICT(company_id, name, profile_version) DO UPDATE SET
      desired_config_json = excluded.desired_config_json,
      updated_at = excluded.updated_at
  `).run(id, companyId, name, version, input.device_model || null, JSON.stringify(input.desired_config || {}), actor, now, now);

  return { id, name, profileVersion: version, isActive: true };
}
