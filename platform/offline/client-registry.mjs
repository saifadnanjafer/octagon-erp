// BUILD-10 Slice 4: Offline Client Registry & Governance
'use strict';

export function registerOfflineClient(db, input, ctx) {
  const companyId = ctx.company_id || ctx.companyId;
  const userId = ctx.user_id || ctx.userId || ctx.actor || 'system';
  const clientUuid = input.client_uuid || input.clientUuid;
  const now = new Date().toISOString();

  if (!companyId) {
    const error = new Error('Company scope required for offline client registration');
    error.code = 'COMPANY_SCOPE_REQUIRED';
    error.statusCode = 400;
    throw error;
  }
  if (!clientUuid) {
    const error = new Error('Client UUID required');
    error.code = 'CLIENT_UUID_REQUIRED';
    error.statusCode = 400;
    throw error;
  }

  const id = `offc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  db.prepare(`
    INSERT INTO offline_client_registries (id, company_id, branch_id, client_uuid, user_id, device_name, device_trust_state, local_schema_version, sync_cursor, last_successful_sync_at, supported_capabilities_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'trusted', ?, ?, ?, ?, ?, ?)
    ON CONFLICT(company_id, client_uuid) DO UPDATE SET
      user_id = excluded.user_id,
      device_name = excluded.device_name,
      updated_at = excluded.updated_at
  `).run(id, companyId, ctx.branch_id || ctx.branchId || null, clientUuid, userId, input.device_name || 'Field PWA Client', input.local_schema_version || 1, input.sync_cursor || null, now, JSON.stringify(input.supported_capabilities || ['work_item_update', 'service_note', 'warehouse_scan']), now, now);

  const client = db.prepare('SELECT * FROM offline_client_registries WHERE company_id = ? AND client_uuid = ?').get(companyId, clientUuid);
  return { id: client.id, companyId, clientUuid, deviceTrustState: client.device_trust_state, lastSuccessfulSyncAt: client.last_successful_sync_at };
}

export function revokeOfflineClient(db, input, ctx) {
  const companyId = ctx.company_id || ctx.companyId;
  const clientId = input.client_id || input.clientId;
  const now = new Date().toISOString();

  const client = db.prepare('SELECT * FROM offline_client_registries WHERE id = ? AND company_id = ?').get(clientId, companyId);
  if (!client) {
    const error = new Error('Client not found or scope denied');
    error.code = 'CLIENT_NOT_FOUND';
    error.statusCode = 404;
    throw error;
  }

  db.prepare('UPDATE offline_client_registries SET device_trust_state = \'revoked\', updated_at = ? WHERE id = ?').run(now, clientId);

  return { id: clientId, deviceTrustState: 'revoked' };
}

export function getClientScope(db, clientId, companyId) {
  const client = db.prepare('SELECT * FROM offline_client_registries WHERE id = ? AND company_id = ?').get(clientId, companyId);
  if (!client || client.device_trust_state === 'revoked') {
    const error = new Error('Offline client untrusted or revoked');
    error.code = 'CLIENT_UNTRUSTED';
    error.statusCode = 403;
    throw error;
  }
  return client;
}
