// Checkpoint C5 — canonical Administration and Module Control authority.

'use strict';

import crypto from 'node:crypto';

const ACTIVE_LICENSES = new Set(['active', 'trial']);

export class ControlPlaneError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'ControlPlaneError';
    this.code = code;
    this.details = details;
  }
}

function json(value, fallback = []) {
  if (Array.isArray(value) || (value && typeof value === 'object')) return value;
  try { return value ? JSON.parse(value) : fallback; } catch (_) { return fallback; }
}

function moduleRow(db, moduleId) {
  return db.prepare('SELECT * FROM platform_modules WHERE id = ?').get(moduleId);
}

export function evaluateModuleAccess(db, moduleId, ctx = {}) {
  if (!moduleId || moduleId === 'platform_kernel') {
    return { allowed: true, code: 'CORE_MODULE', moduleId: moduleId || 'platform_kernel' };
  }
  const module = moduleRow(db, moduleId);
  if (!module) return { allowed: false, code: 'MODULE_NOT_FOUND', moduleId };
  if (module.status !== 'enabled') {
    return { allowed: false, code: 'MODULE_NOT_ENABLED', moduleId, status: module.status };
  }
  const branchAssignment = ctx.branchId
    ? db.prepare("SELECT * FROM platform_module_assignments WHERE module_id=? AND scope_type='branch' AND scope_id=?").get(moduleId, ctx.branchId)
    : null;
  const companyAssignment = ctx.companyId
    ? db.prepare("SELECT * FROM platform_module_assignments WHERE module_id=? AND scope_type='company' AND scope_id=?").get(moduleId, ctx.companyId)
    : null;
  const assignment = branchAssignment || companyAssignment;
  if (assignment && assignment.enabled !== 1) {
    return {
      allowed: false,
      code: 'MODULE_SCOPE_DENIED',
      moduleId,
      scopeType: assignment.scope_type,
      scopeId: assignment.scope_id,
    };
  }
  const license = ctx.companyId
    ? db.prepare('SELECT * FROM platform_module_licenses WHERE module_id=? AND company_id=?').get(moduleId, ctx.companyId)
    : null;
  const expiredByDate = license?.valid_until && Date.parse(license.valid_until) <= Date.now();
  if (license && (!ACTIVE_LICENSES.has(license.package_status) || expiredByDate)) {
    return {
      allowed: false,
      code: 'MODULE_UNLICENSED',
      moduleId,
      licenseStatus: expiredByDate ? 'expired' : license.package_status,
    };
  }
  return {
    allowed: true,
    code: 'MODULE_ACCESS_GRANTED',
    moduleId,
    assignment: assignment ? {
      scopeType: assignment.scope_type,
      scopeId: assignment.scope_id,
      navigationVisible: assignment.navigation_visible === 1,
      configurationStatus: assignment.configuration_status,
      configurationUrl: assignment.configuration_url,
    } : null,
    license: license ? {
      plan: license.plan,
      status: license.package_status,
      validUntil: license.valid_until,
      seats: license.seats,
    } : null,
  };
}

export function assertModuleAccess(db, moduleId, ctx = {}) {
  const result = evaluateModuleAccess(db, moduleId, ctx);
  if (!result.allowed) throw new ControlPlaneError(`module access denied: ${result.code}`, result.code, result);
  return result;
}

function ensureModule(db, moduleId) {
  const module = moduleRow(db, moduleId);
  if (!module) throw new ControlPlaneError('module not found', 'MODULE_NOT_FOUND', { moduleId });
  return module;
}

function setModuleStatus(db, input, ctx) {
  const module = ensureModule(db, input.module_id);
  if (module.id === 'platform_kernel' && !input.enabled) {
    throw new ControlPlaneError('platform kernel cannot be disabled', 'CORE_MODULE_LOCKED');
  }
  if (input.enabled) {
    for (const dependency of json(module.dependencies)) {
      const dep = moduleRow(db, dependency);
      if (!dep || dep.status !== 'enabled') {
        throw new ControlPlaneError(`dependency ${dependency} is not enabled`, 'DEPENDENCY_NOT_ENABLED', { dependency });
      }
    }
  } else {
    const dependent = db.prepare("SELECT id, dependencies FROM platform_modules WHERE status='enabled' AND id<>?").all(module.id)
      .find((row) => json(row.dependencies).includes(module.id));
    if (dependent) {
      throw new ControlPlaneError('enabled dependent module exists', 'DEPENDENT_MODULES_ENABLED', { dependent: dependent.id });
    }
  }
  db.prepare('UPDATE platform_modules SET status=?, updated_at=? WHERE id=?')
    .run(input.enabled ? 'enabled' : 'installed', ctx.now, module.id);
  return { ...evaluateModuleAccess(db, module.id, ctx), status: input.enabled ? 'enabled' : 'installed' };
}

function setFeature(db, input, ctx) {
  const existing = db.prepare('SELECT module_id, scope FROM platform_feature_flags WHERE key=?').get(input.key);
  const moduleId = input.module_id || existing?.module_id;
  if (!moduleId) throw new ControlPlaneError('feature flag not found and module_id missing', 'FEATURE_MODULE_REQUIRED');
  ensureModule(db, moduleId);
  db.prepare(`
    INSERT INTO platform_feature_flags
      (key,module_id,scope,enabled,audit_policy,created_at,updated_at)
    VALUES (?,?,?,?, 'required',?,?)
    ON CONFLICT(key) DO UPDATE SET
      module_id=excluded.module_id, scope=excluded.scope,
      enabled=excluded.enabled, updated_at=excluded.updated_at
  `).run(input.key, moduleId, input.scope || existing?.scope || 'company', input.enabled ? 1 : 0, ctx.now, ctx.now);
  return db.prepare('SELECT key,module_id,scope,enabled,updated_at FROM platform_feature_flags WHERE key=?').get(input.key);
}

function assignModule(db, input, ctx) {
  ensureModule(db, input.module_id);
  if (!['company', 'branch'].includes(input.scope_type)) throw new ControlPlaneError('invalid scope type', 'MODULE_SCOPE_INVALID');
  if (input.scope_type === 'company') {
    const company = db.prepare('SELECT id FROM platform_companies WHERE id=? AND tenant_id=?').get(input.scope_id, ctx.tenantId);
    if (!company) throw new ControlPlaneError('company not in tenant', 'MODULE_SCOPE_INVALID');
  } else {
    const branch = db.prepare(`
      SELECT b.id FROM platform_branches b JOIN platform_companies c ON c.id=b.company_id
      WHERE b.id=? AND c.tenant_id=?
    `).get(input.scope_id, ctx.tenantId);
    if (!branch) throw new ControlPlaneError('branch not in tenant', 'MODULE_SCOPE_INVALID');
  }
  const id = `modasg_${crypto.createHash('sha1').update(`${input.module_id}:${input.scope_type}:${input.scope_id}`).digest('hex').slice(0, 20)}`;
  db.prepare(`
    INSERT INTO platform_module_assignments
      (id,module_id,scope_type,scope_id,enabled,navigation_visible,
       configuration_url,configuration_status,version,created_at,updated_at,updated_by)
    VALUES (?,?,?,?,?,?,?,?,1,?,?,?)
    ON CONFLICT(module_id,scope_type,scope_id) DO UPDATE SET
      enabled=excluded.enabled, navigation_visible=excluded.navigation_visible,
      configuration_url=excluded.configuration_url,
      configuration_status=excluded.configuration_status,
      version=platform_module_assignments.version+1,
      updated_at=excluded.updated_at, updated_by=excluded.updated_by
  `).run(
    id, input.module_id, input.scope_type, input.scope_id,
    input.enabled ? 1 : 0, input.navigation_visible === false ? 0 : 1,
    input.configuration_url || null, input.configuration_status || 'ready',
    ctx.now, ctx.now, ctx.userId,
  );
  return db.prepare('SELECT * FROM platform_module_assignments WHERE module_id=? AND scope_type=? AND scope_id=?')
    .get(input.module_id, input.scope_type, input.scope_id);
}

function setLicense(db, input, ctx) {
  ensureModule(db, input.module_id);
  const company = db.prepare('SELECT id FROM platform_companies WHERE id=? AND tenant_id=?').get(input.company_id, ctx.tenantId);
  if (!company) throw new ControlPlaneError('company not in tenant', 'LICENSE_COMPANY_INVALID');
  if (!['active', 'trial', 'suspended', 'expired', 'unlicensed'].includes(input.status)) {
    throw new ControlPlaneError('invalid license status', 'LICENSE_STATUS_INVALID');
  }
  const id = `modlic_${crypto.createHash('sha1').update(`${input.module_id}:${input.company_id}`).digest('hex').slice(0, 20)}`;
  db.prepare(`
    INSERT INTO platform_module_licenses
      (id,module_id,company_id,plan,package_status,license_key_prefix,seats,
       features,valid_from,valid_until,version,created_at,updated_at,updated_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?,?)
    ON CONFLICT(module_id,company_id) DO UPDATE SET
      plan=excluded.plan, package_status=excluded.package_status,
      license_key_prefix=excluded.license_key_prefix, seats=excluded.seats,
      features=excluded.features, valid_from=excluded.valid_from,
      valid_until=excluded.valid_until, version=platform_module_licenses.version+1,
      updated_at=excluded.updated_at, updated_by=excluded.updated_by
  `).run(
    id, input.module_id, input.company_id, input.plan, input.status,
    input.license_key_prefix || null, input.seats == null ? null : Number(input.seats),
    JSON.stringify(input.features || []), input.valid_from || null, input.valid_until || null,
    ctx.now, ctx.now, ctx.userId,
  );
  return db.prepare('SELECT * FROM platform_module_licenses WHERE module_id=? AND company_id=?')
    .get(input.module_id, input.company_id);
}

function setJob(db, input, ctx) {
  const result = db.prepare('UPDATE platform_jobs SET enabled=?,updated_at=? WHERE id=?')
    .run(input.enabled ? 1 : 0, ctx.now, input.job_id);
  if (!result.changes) throw new ControlPlaneError('job not found', 'JOB_NOT_FOUND');
  return db.prepare('SELECT id,module_id,name,schedule,handler,enabled FROM platform_jobs WHERE id=?').get(input.job_id);
}

export function registerControlPlaneActions(executor) {
  executor.registerHandler('control:module:set_status', ({ dialect, input, ctx }) => setModuleStatus(dialect, input, ctx));
  executor.registerHandler('control:feature:set', ({ dialect, input, ctx }) => setFeature(dialect, input, ctx));
  executor.registerHandler('control:module:assign', ({ dialect, input, ctx }) => assignModule(dialect, input, ctx));
  executor.registerHandler('control:license:set', ({ dialect, input, ctx }) => setLicense(dialect, input, ctx));
  executor.registerHandler('control:job:set', ({ dialect, input, ctx }) => setJob(dialect, input, ctx));
  executor.registerHandler('control:test:ping', ({ ctx }) => ({
    ok: true,
    module_id: 'checkpoint_c_test_module',
    company_id: ctx.companyId,
    branch_id: ctx.branchId,
  }));
  return executor;
}

export function listModules(db, ctx) {
  return db.prepare('SELECT * FROM platform_modules ORDER BY kind,id').all().map((row) => {
    const access = evaluateModuleAccess(db, row.id, ctx);
    const missing = db.prepare(`
      SELECT COUNT(*) AS n FROM platform_settings s
      WHERE s.module_id=? AND s.default_value IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM settings_values v
          WHERE v.key=s.key AND (
            (v.scope='company' AND v.scope_id=?) OR
            (v.scope='system' AND v.scope_id='')
          )
        )
    `).get(row.id, ctx.companyId || '').n;
    const views = db.prepare('SELECT id,route,menu_location FROM platform_views WHERE module_id=? ORDER BY id').all(row.id);
    return {
      id: row.id,
      name: row.name,
      version: row.version,
      status: row.status,
      kind: row.kind,
      owner: row.owner,
      dependencies: json(row.dependencies),
      capabilities: json(row.capabilities),
      access,
      health: access.allowed && !missing ? 'healthy' : access.allowed ? 'warning' : 'blocked',
      missing_configuration: Number(missing),
      configuration_url: access.assignment?.configurationUrl || null,
      navigation: views.map((view) => ({ ...view, visible: access.allowed && access.assignment?.navigationVisible !== false })),
    };
  });
}

function scopedCompanies(db, ctx) {
  return db.prepare('SELECT id,name,status,fiscal_year_start,created_at FROM platform_companies WHERE tenant_id=? ORDER BY name')
    .all(ctx.tenantId);
}

export function handleControlPlaneQuery({ dialect: db, ctx, resource, recordId = null }) {
  const companies = scopedCompanies(db, ctx);
  const companyIds = new Set(companies.map((row) => row.id));
  const modules = () => listModules(db, ctx);
  if (resource === 'overview') {
    const rows = modules();
    return {
      data: [{
        companies: companies.length,
        branches: db.prepare(`SELECT COUNT(*) AS n FROM platform_branches WHERE company_id IN (${companies.map(() => '?').join(',') || "''"})`).get(...companyIds).n,
        users: db.prepare('SELECT COUNT(*) AS n FROM identity_users WHERE tenant_id=?').get(ctx.tenantId).n,
        modules: rows.length,
        enabled_modules: rows.filter((row) => row.access.allowed).length,
        unhealthy_modules: rows.filter((row) => row.health !== 'healthy').length,
        feature_flags: db.prepare('SELECT COUNT(*) AS n FROM platform_feature_flags').get().n,
      }],
    };
  }
  if (resource === 'companies') return { data: companies };
  if (resource === 'branches') return { data: db.prepare(`SELECT id,company_id,name,status,created_at FROM platform_branches WHERE company_id IN (${companies.map(() => '?').join(',') || "''"}) ORDER BY name`).all(...companyIds) };
  if (resource === 'users') return { data: db.prepare('SELECT id,login,name,email,status,locale,is_owner,mfa_required,last_login_at FROM identity_users WHERE tenant_id=? ORDER BY login').all(ctx.tenantId) };
  if (resource === 'roles') return { data: db.prepare(`
    SELECT r.id,r.name,r.label_ar,r.status,r.is_system,COUNT(g.id) AS grant_count
    FROM authorization_roles r LEFT JOIN authorization_grants g ON g.role_id=r.id
    WHERE r.tenant_id=? GROUP BY r.id ORDER BY r.name
  `).all(ctx.tenantId) };
  if (resource === 'permissions') return { data: db.prepare('SELECT id,module_id,kind,resource,action,label_ar,label_en FROM authorization_permissions ORDER BY module_id,id LIMIT 500').all() };
  if (resource === 'data-scopes') return { data: db.prepare(`SELECT id,company_id,kind,name,status FROM organization_operating_scopes WHERE company_id IN (${companies.map(() => '?').join(',') || "''"}) ORDER BY company_id,name`).all(...companyIds) };
  if (resource === 'modules' || (resource === 'module' && recordId)) {
    const rows = modules();
    return { data: recordId ? rows.find((row) => row.id === recordId) || null : rows };
  }
  if (resource === 'feature-flags') return { data: db.prepare('SELECT key,module_id,scope,enabled,audit_policy,updated_at FROM platform_feature_flags ORDER BY key').all() };
  if (resource === 'packages') return { data: db.prepare('SELECT id,name,version,target_min_version,status,created_at,applied_at FROM configuration_packages ORDER BY created_at DESC LIMIT 100').all() };
  if (resource === 'licensing') return { data: db.prepare(`SELECT module_id,company_id,plan,package_status,seats,features,valid_from,valid_until,version,updated_at FROM platform_module_licenses WHERE company_id IN (${companies.map(() => '?').join(',') || "''"}) ORDER BY company_id,module_id`).all(...companyIds) };
  if (resource === 'settings') return { data: db.prepare("SELECT key,module_id,type,default_value,scopes,required_permission,restart_required FROM platform_settings WHERE secret=0 ORDER BY module_id,key LIMIT 500").all() };
  if (resource === 'numbering-sequences') return { data: db.prepare('SELECT id,module_id,scope_key,template,current_value,reset_policy,gap_policy FROM platform_sequences ORDER BY module_id,id').all() };
  if (resource === 'integrations') return { data: db.prepare('SELECT id,kind,name,issuer,jit_provisioning,status,updated_at FROM identity_sso_providers WHERE tenant_id=? ORDER BY name').all(ctx.tenantId) };
  if (resource === 'api-keys') return { data: db.prepare("SELECT id,prefix,service_account_id,company_id,label,scopes,expires_at,revoked_at,last_used_at FROM identity_api_keys WHERE tenant_id=? AND (company_id IS NULL OR company_id=?) ORDER BY created_at DESC").all(ctx.tenantId, ctx.companyId) };
  if (resource === 'jobs') return { data: db.prepare('SELECT id,module_id,name,schedule,handler,enabled,leased_until,updated_at FROM platform_jobs ORDER BY module_id,id').all() };
  if (resource === 'audit') return { data: db.prepare('SELECT actor_id,action,resource,resource_id,company_id,occurred_at,result,failure_code FROM platform_audit_log WHERE tenant_id IS NULL OR tenant_id=? ORDER BY occurred_at DESC LIMIT 150').all(ctx.tenantId) };
  if (resource === 'health') return { data: modules().map((row) => ({ module_id: row.id, status: row.health, access_code: row.access.code, missing_configuration: row.missing_configuration })) };
  if (resource === 'backups') return { data: db.prepare(`SELECT id,company_id,backup_type,status,storage_ref,bytes,started_at,completed_at,verified_at FROM platform_backup_runs WHERE company_id IS NULL OR company_id IN (${companies.map(() => '?').join(',') || "''"}) ORDER BY started_at DESC LIMIT 100`).all(...companyIds) };
  if (resource === 'localization') return { data: db.prepare(`SELECT id,company_id,pack_code,version,status,legal_validation_status,installed_at,installed_by FROM finance_localization_packs WHERE company_id IN (${companies.map(() => '?').join(',') || "''"}) ORDER BY pack_code`).all(...companyIds) };
  return { error: 'control-plane resource not found', status: 404 };
}
