// BUILD-10 Slice 5: Kiosk Device Registry & Governance
'use strict';

export function registerKiosk(db, input, ctx) {
  const companyId = ctx.company_id || ctx.companyId;
  const code = input.code;
  const name = input.name;
  const kioskType = input.kiosk_type || input.kioskType || 'employee';
  const actor = ctx.actor || ctx.actorId || ctx.userId || 'system';
  const now = new Date().toISOString();

  if (!companyId) {
    const error = new Error('Company scope required for kiosk registration');
    error.code = 'COMPANY_SCOPE_REQUIRED';
    error.statusCode = 400;
    throw error;
  }
  if (!code || !name) {
    const error = new Error('Kiosk code and name are required');
    error.code = 'KIOSK_REQUIRED_FIELDS';
    error.statusCode = 400;
    throw error;
  }

  const allowedActions = input.allowed_actions || [
    `kiosk:${kioskType}_task_view`,
    `kiosk:${kioskType}_submit`
  ];
  const allowedPages = input.allowed_pages || [
    `/${kioskType}-kiosk`
  ];

  const id = `ksk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  db.prepare(`
    INSERT INTO kiosk_device_registries (id, company_id, branch_id, site, warehouse_id, work_center_id, code, name, kiosk_type, assigned_role_profile, allowed_actions_json, allowed_pages_json, status, session_timeout_seconds, last_heartbeat_at, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)
    ON CONFLICT(company_id, code) DO UPDATE SET
      name = excluded.name,
      kiosk_type = excluded.kiosk_type,
      updated_at = excluded.updated_at
  `).run(id, companyId, ctx.branch_id || ctx.branchId || null, input.site || null, input.warehouse_id || null, input.work_center_id || null, code, name, kioskType, input.assigned_role_profile || 'kiosk_restricted', JSON.stringify(allowedActions), JSON.stringify(allowedPages), input.session_timeout_seconds || 120, now, actor, now, now);

  return { id, companyId, code, name, kioskType, status: 'active', allowedActions, allowedPages };
}

export function recordKioskHeartbeat(db, input, ctx) {
  const companyId = ctx.company_id || ctx.companyId;
  const kioskId = input.kiosk_id || input.kioskId;
  const now = new Date().toISOString();

  const kiosk = db.prepare('SELECT * FROM kiosk_device_registries WHERE id = ? AND company_id = ?').get(kioskId, companyId);
  if (!kiosk || kiosk.status !== 'active') {
    const error = new Error('Kiosk device inactive, locked or scope denied');
    error.code = 'KIOSK_INACTIVE';
    error.statusCode = 403;
    throw error;
  }

  db.prepare('UPDATE kiosk_device_registries SET last_heartbeat_at = ?, updated_at = ? WHERE id = ?').run(now, now, kioskId);

  return { id: kioskId, status: kiosk.status, lastHeartbeatAt: now };
}

export function startKioskSession(db, input, ctx) {
  const companyId = ctx.company_id || ctx.companyId;
  const kioskId = input.kiosk_id || input.kioskId;
  const actorId = input.actor_id || ctx.actor || ctx.userId || null;
  const now = new Date().toISOString();

  const kiosk = db.prepare('SELECT * FROM kiosk_device_registries WHERE id = ? AND company_id = ?').get(kioskId, companyId);
  if (!kiosk || kiosk.status !== 'active') {
    const error = new Error('Kiosk device inactive or scope denied');
    error.code = 'KIOSK_INACTIVE';
    error.statusCode = 403;
    throw error;
  }

  const sessId = `ksks_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  db.prepare(`
    INSERT INTO kiosk_session_logs (id, company_id, kiosk_id, actor_id, kiosk_type, status, started_at, created_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
  `).run(sessId, companyId, kioskId, actorId, kiosk.kiosk_type, now, now);

  return { sessionId: sessId, kioskId, kioskType: kiosk.kiosk_type, status: 'active', startedAt: now };
}

export function evaluateKioskActionPermission(db, input, ctx) {
  const companyId = ctx.company_id || ctx.companyId;
  const kioskId = input.kiosk_id || input.kioskId;
  const actionName = input.action_name || input.actionName;

  if (!companyId) {
    const error = new Error('Company scope required for kiosk action evaluation');
    error.code = 'COMPANY_SCOPE_REQUIRED';
    error.statusCode = 400;
    throw error;
  }

  const kiosk = db.prepare('SELECT * FROM kiosk_device_registries WHERE id = ? AND company_id = ?').get(kioskId, companyId);
  if (!kiosk) {
    const error = new Error('Kiosk not found or scope denied');
    error.code = 'KIOSK_NOT_FOUND';
    error.statusCode = 404;
    throw error;
  }

  const allowedActions = JSON.parse(kiosk.allowed_actions_json || '[]');
  const allowed = kiosk.status === 'active' && allowedActions.includes(actionName);

  return { kioskId, actionName, allowed, reason: allowed ? null : 'restricted_kiosk_role' };
}

export function listKiosks(db, params) {
  const companyId = params.company_id || params.companyId;
  if (!companyId) {
    const error = new Error('Company scope required for kiosk query');
    error.code = 'COMPANY_SCOPE_REQUIRED';
    error.statusCode = 400;
    throw error;
  }

  let sql = 'SELECT * FROM kiosk_device_registries WHERE company_id = ?';
  const args = [companyId];

  if (params.kiosk_type || params.kioskType) {
    sql += ' AND kiosk_type = ?';
    args.push(params.kiosk_type || params.kioskType);
  }

  return db.prepare(sql).all(...args).map(r => ({
    id: r.id,
    companyId: r.company_id,
    code: r.code,
    name: r.name,
    kioskType: r.kiosk_type,
    status: r.status,
    lastHeartbeatAt: r.last_heartbeat_at
  }));
}
