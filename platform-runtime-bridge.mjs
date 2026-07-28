// Phase 02 runtime authority bridge for the existing Octagon server.
//
// This module is the ONLY place where the CommonJS server.js touches the ESM
// governance platform. It creates the canonical authorities, seeds the default
// permission namespace, and exposes helper functions that replace the legacy
// authSessions Map, acl.json, and localhost-bypass checks.
//
// All callers inside server.js receive the same DecisionContext, so the server
// and the platform can never disagree about who the actor is.

'use strict';

import { createSessionAuthority } from './platform/identity/sessions/index.mjs';
import { createUserDirectory } from './platform/identity/users/index.mjs';
import { createMembershipDirectory } from './platform/organizations/memberships/index.mjs';
import { createPermissionRegistry } from './platform/authorization/registry/index.mjs';
import { createPermissionEvaluator, AuthorizationError } from './platform/authorization/evaluator/index.mjs';
import { createRouteCoverageRegistry } from './platform/authorization/route-coverage/index.mjs';
import { createGovernanceBootstrap, DEFAULT_PAGE_CATALOGUE } from './platform/client/governance-bootstrap.mjs';
import { createSettingsAuthority } from './platform/settings/index.mjs';
import { createNotificationService } from './platform/notifications/index.mjs';
import { createApprovalEngine } from './platform/approvals/index.mjs';
import { createPolicyEngine } from './platform/policies/index.mjs';
import { createActionRegistry, createActionExecutor } from './platform/kernel/actions/index.mjs';
import { createRepository } from './platform/data/repositories/index.mjs';
import { buildDecisionContext, stripUntrustedContext } from './platform/identity/context/index.mjs';
import { setPassword, checkCredentials } from './platform/identity/passwords/index.mjs';
import { registerFinanceActions } from './platform/finance/index.mjs';
import { registerCommercialActions } from './platform/commercial/index.mjs';
import { registerInventoryActions } from './platform/inventory/index.mjs';
import { registerWmsActions } from './platform/wms/index.mjs';
import { registerSalesActions } from './platform/sales/index.mjs';
import { registerProcurementActions } from './platform/procurement/index.mjs';
import { registerPosActions } from './platform/pos/index.mjs';
import { registerWorkItemActions } from './platform/work_items/index.mjs';
import { registerProjectActions } from './platform/projects/index.mjs';
import { registerControlPlaneActions } from './platform/control_plane/index.mjs';
import { createLegacyWriterRetirementGuard } from './platform/cutover/legacy-writer-retirement.mjs';

const DEFAULT_PAGE_PERMISSIONS = DEFAULT_PAGE_CATALOGUE.map((p) => ({
  id: p.permission,
  module_id: 'platform_kernel',
  kind: 'page',
  label_ar: p.labelAr,
  label_en: p.labelAr,
}));

const DEFAULT_API_PERMISSIONS = [
  { id: 'platform:server:status', module_id: 'platform_kernel', kind: 'settings', label_ar: 'حالة الخادم' },
  { id: 'platform:release:status', module_id: 'platform_kernel', kind: 'settings', label_ar: 'حالة الإصدار' },
  { id: 'platform:tts:use', module_id: 'platform_kernel', kind: 'action', label_ar: 'تحويل النص إلى صوت' },
  { id: 'platform:review_report:save', module_id: 'platform_kernel', kind: 'action', label_ar: 'حفظ تقرير المراجعة' },
  { id: 'platform:backup:verify', module_id: 'platform_kernel', kind: 'action', label_ar: 'التحقق من النسخ الاحتياطي' },
  { id: 'platform:backup:restore', module_id: 'platform_kernel', kind: 'action', label_ar: 'استعادة النسخة الاحتياطية' },
  { id: 'platform:db:read', module_id: 'platform_kernel', kind: 'resource', label_ar: 'قراءة قاعدة البيانات' },
  { id: 'platform:db:write', module_id: 'platform_kernel', kind: 'action', label_ar: 'كتابة قاعدة البيانات' },
  { id: 'platform:scheduler:admin', module_id: 'platform_kernel', kind: 'action', label_ar: 'إدارة الجدولة' },
  { id: 'platform:jarvis:use', module_id: 'platform_kernel', kind: 'action', label_ar: 'استخدام أدوات الذكاء' },
  { id: 'platform:jarvis:approve', module_id: 'platform_kernel', kind: 'action', label_ar: 'الموافقة على إجراءات الذكاء' },
];

export class RuntimeAuthorityError extends Error {
  constructor(message, code, statusCode = 500) {
    super(message);
    this.name = 'RuntimeAuthorityError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class PermissionDeniedError extends Error {
  constructor(decision) {
    super(decision?.message || 'permission denied');
    this.name = 'PermissionDeniedError';
    this.code = decision?.reasonCode || 'PERMISSION_DENIED';
    this.statusCode = 403;
    this.decision = decision;
  }
}

const AUTH_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function seedDefaultOwnerRole(dialect) {
  const now = new Date().toISOString();
  dialect.prepare(`
    INSERT INTO authorization_roles (id, tenant_id, name, label_ar, is_system, status, created_at, updated_at)
    VALUES ('role_default_owner', 'default', 'owner', 'مالك النظام', 1, 'active', ?, ?)
    ON CONFLICT(id) DO NOTHING
  `).run(now, now);
  dialect.prepare(`
    INSERT INTO authorization_grants (id, role_id, permission, effect, scope, document_states, requires_approval, created_at, created_by)
    VALUES ('grant_default_owner_all', 'role_default_owner', '*', 'allow', 'all', '[]', 0, ?, 'platform_bridge')
    ON CONFLICT DO NOTHING
  `).run(now);
  const owners = dialect.prepare("SELECT id FROM identity_users WHERE is_owner = 1 AND status = 'active'").all();
  for (const row of owners) {
    dialect.prepare(`
      INSERT INTO authorization_role_assignments (id, user_id, actor_type, role_id, company_id, status, created_at, created_by)
      VALUES (?, ?, 'user', 'role_default_owner', NULL, 'active', ?, 'platform_bridge')
      ON CONFLICT DO NOTHING
    `).run(`asg_${row.id}_owner`, row.id, now);
  }
}

function seedDefaultFieldRules(dialect) {
  const now = new Date().toISOString();
  // Ensure the owner role exists before attaching the sample rule.
  dialect.prepare(`
    INSERT INTO authorization_roles (id, tenant_id, name, label_ar, is_system, status, created_at, updated_at)
    VALUES ('role_default_owner', 'default', 'owner', 'مالك النظام', 1, 'active', ?, ?)
    ON CONFLICT(id) DO NOTHING
  `).run(now, now);
  // A sample field mask so the bootstrap always delivers field metadata and the
  // UI can prove field-level governance is wired. Even the owner sees this audit
  // field as read-only; it is overridden in per-tenant deployments if needed.
  dialect.prepare(`
    INSERT INTO authorization_field_rules (id, role_id, entity, field, access, created_at)
    VALUES ('field_rule_owner_x_records_sensitive', 'role_default_owner', 'x_records', 'sensitive', 'read', ?)
    ON CONFLICT(id) DO NOTHING
  `).run(now);
}

/**
 * Create the canonical Phase 02 authorities against an open SQLite dialect.
 * The dialect is expected to already have migrations 001–012 applied.
 */
export function createPlatformAuthority(dialect) {
  if (!dialect || typeof dialect.prepare !== 'function') {
    throw new RuntimeAuthorityError('dialect required', 'DIALECT_REQUIRED');
  }

  const registry = createPermissionRegistry(dialect);
  registry.registerMany([...DEFAULT_PAGE_PERMISSIONS, ...DEFAULT_API_PERMISSIONS]);

  // Every governed action declares its required permission in platform_actions
  // (see migrations 003/014+). Register those tokens so the evaluator knows
  // them — unknown tokens fail closed — and the HTTP action route can evaluate
  // them per action. Existing registrations (e.g. page/API defaults) win.
  const ACTION_TOKEN_RE = /^[a-z][a-z0-9_]*(:[a-z0-9_*]+)+$/;
  const actionPermissions = dialect.prepare(`
    SELECT DISTINCT required_permission AS id, module_id FROM platform_actions
    WHERE required_permission IS NOT NULL
  `).all();
  for (const row of actionPermissions) {
    if (!ACTION_TOKEN_RE.test(row.id) || registry.get(row.id)) continue;
    registry.register({ id: row.id, module_id: row.module_id, kind: 'action', label_ar: row.id, label_en: row.id });
  }

  const policyEngine = createPolicyEngine(dialect);
  const evaluator = createPermissionEvaluator(dialect, { permissionRegistry: registry, policyEngine });
  policyEngine.evaluator = evaluator;

  const sessions = createSessionAuthority(dialect);
  const users = createUserDirectory(dialect);
  const memberships = createMembershipDirectory(dialect);
  const settings = createSettingsAuthority(dialect, { evaluator });
  const notifications = createNotificationService(dialect, { evaluator });
  const approvals = createApprovalEngine(dialect, { evaluator, policyEngine });
  const actionRegistry = createActionRegistry(dialect);
  const actionExecutor = createActionExecutor(dialect);
  registerFinanceActions(actionExecutor);
  registerCommercialActions(actionExecutor);
  registerInventoryActions(actionExecutor);
  registerWmsActions(actionExecutor);
  registerSalesActions(actionExecutor);
  registerProcurementActions(actionExecutor);
  registerPosActions(actionExecutor);
  registerWorkItemActions(actionExecutor);
  registerProjectActions(actionExecutor);
  registerControlPlaneActions(actionExecutor);
  const routeCoverage = createRouteCoverageRegistry(dialect, { evaluator, permissionRegistry: registry });
  const bootstrap = createGovernanceBootstrap({ evaluator, dialect, settings, notifications, approvals, membershipDirectory: memberships });

  // Ensure every fresh/disposable database has a usable owner role and sample
  // field rules so the bootstrap always carries field-level governance metadata.
  seedDefaultOwnerRole(dialect);
  seedDefaultFieldRules(dialect);

  // Phase 03 closure audit: persist the finance approval-authority policy as
  // fail-closed by default. The engine reads only this stored value (company
  // scope may override it through the typed settings authority); posting paths
  // never accept a caller-supplied policy flag.
  settings.define({
    key: 'finance.approval_authority.fail_closed', module_id: 'finance_canonical',
    type: 'boolean', default_value: 'false', scopes: ['company', 'system'],
    overridable_scopes: { company: true },
  });
  const financeModule = dialect.prepare("SELECT status FROM platform_modules WHERE id = 'finance_canonical'").get();
  const existingPolicy = dialect.prepare("SELECT 1 FROM settings_values WHERE key = ? AND scope = 'system' AND scope_id = ''").get('finance.approval_authority.fail_closed');
  if (financeModule?.status === 'enabled' && !existingPolicy) {
    settings.set('finance.approval_authority.fail_closed', 'system', '', true, { actor: 'platform_bridge', reason: 'default fail-closed finance approval policy' });
  }

  const authority = {
    dialect, registry, evaluator, policyEngine, sessions, users, memberships,
    settings, notifications, approvals, actionRegistry, actionExecutor, routeCoverage, bootstrap,
  };

  // Bind HTTP handlers so server.js can call them without knowing the internal
  // argument order.
  authority.require = (req, res, opts) => requirePermission(authority, req, res, opts);
  authority.handleLogin = (req, res) => handleLogin(authority, req, res);
  authority.handleLogout = (req, res) => handleLogout(authority, req, res);
  authority.handleSessionInfo = (req, res) => handleSessionInfo(authority, req, res);
  authority.handleBootstrap = (req, res) => handleBootstrap(authority, req, res);
  authority.handleSetPassword = (req, res) => handleSetPassword(authority, req, res);
  authority.handleContextSwitch = (req, res) => handleContextSwitch(authority, req, res);
  authority.resolveContext = (req, opts) => resolveContextFromRequest(authority, req, opts);
  authority.mountApi = async (prefix) => {
    const { createApiHandler } = await import('./platform/api/index.mjs');
    return createApiHandler({
      dialect: authority.dialect,
      prefix,
      // The API must dispatch through the SAME executor that carries the
      // finance handlers (registered above), not a bare kernel executor.
      actionExecutor: authority.actionExecutor,
      resolveContext: (req, requestUrl) => resolveApiContext(authority, req, requestUrl),
      authorize: ({ permission, ctx }) => authority.evaluator.evaluate({ permission, ctx }),
    });
  };

  return authority;
}

/**
 * Parse the octagon_session cookie from a request.
 */
export function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  });
  return out;
}

function sendJson(res, status, payload) {
  if (res.headersSent || res.writableEnded) return;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.writeHead(status);
  res.end(JSON.stringify(payload));
}

/**
 * Build a server-side DecisionContext from a verified session cookie.
 * Returns null if the session is missing or invalid.
 */
export function resolveContextFromRequest(authority, req, opts = {}) {
  const { sessions, memberships } = authority;
  const cookies = parseCookies(req);
  const token = cookies.octagon_session;
  if (!token) return null;
  try {
    const session = sessions.resolve(token, { touch: opts.touch !== false });
    const requestedScope = stripUntrustedContext(opts.requestBody || {});
    // The active scope is session state written only after the membership
    // check in handleContextSwitch. Reuse it when rebuilding a context so a
    // valid switch survives the next request; caller-supplied identity fields
    // remain stripped and cannot override the session-derived scope.
    if (!requestedScope.requestedCompanyId && session.activeCompanyId) {
      requestedScope.requestedCompanyId = session.activeCompanyId;
    }
    if (!requestedScope.requestedBranchId && session.activeBranchId) {
      requestedScope.requestedBranchId = session.activeBranchId;
    }
    return buildDecisionContext(authority.dialect, {
      actorId: session.userId,
      actorType: session.actorType || 'user',
      impersonatorId: session.impersonatorId || null,
      tenantId: session.tenantId,
      sessionId: session.sessionId,
      mfaSatisfied: session.mfaSatisfied,
    }, requestedScope, { membershipDirectory: memberships });
  } catch (e) {
    return null;
  }
}

/**
 * Require a verified session and optional permission for a request.
 * Replaces the legacy requireSession / requireRoleSession / requireAdminSession.
 */
export function requirePermission(authority, req, res, opts = {}) {
  const ctx = resolveContextFromRequest(authority, req, opts);
  if (!ctx) {
    sendJson(res, 401, { success: false, error: 'Login session required' });
    return { ok: false };
  }
  if (!opts.permission) {
    return { ok: true, ctx };
  }
  const decision = authority.evaluator.evaluate({
    permission: opts.permission,
    ctx,
    entity: opts.entity || null,
    recordId: opts.recordId || null,
  });
  if (!decision.allowed) {
    sendJson(res, 403, { success: false, error: decision.message || 'Permission denied', reasonCode: decision.reasonCode });
    return { ok: false };
  }
  return { ok: true, ctx, decision };
}

/**
 * Login handler wrapper. Uses the canonical SessionAuthority.
 */
export async function handleLogin(authority, req, res) {
  const { sessions, users } = authority;
  const body = await readBody(req, 64 * 1024);
  let parsed = {};
  try { parsed = body ? JSON.parse(body) : {}; } catch (e) { return sendJson(res, 400, { success: false, error: 'Invalid JSON' }); }
  const login = String(parsed.userId || parsed.login || '').trim();
  const password = String(parsed.password || '');
  const tenantId = String(parsed.tenantId || 'default').trim();
  if (!login || !password) return sendJson(res, 400, { success: false, error: 'userId and password are required' });

  try {
    const authResult = sessions.authenticate({ tenantId, login, password });
    const user = users.get(authResult.userId);
    const session = sessions.createSession(authResult.userId, { activeCompanyId: user?.tenantId ? getDefaultCompanyId(authority.dialect, user.tenantId) : null });
    setAuthCookie(res, session.token, Math.floor(AUTH_SESSION_TTL_MS / 1000));
    return sendJson(res, 200, {
      success: true, authenticated: true,
      user: sanitizeUser(user),
      expiresAt: new Date(Date.now() + AUTH_SESSION_TTL_MS).toISOString(),
    });
  } catch (e) {
    const status = e.statusCode || (e.code === 'LOCKED_OUT' ? 423 : 401);
    return sendJson(res, status, { success: false, error: e.message, code: e.code, locked: e.code === 'LOCKED_OUT' });
  }
}

/**
 * Logout handler wrapper.
 */
export function handleLogout(authority, req, res) {
  const { sessions } = authority;
  const cookies = parseCookies(req);
  const token = cookies.octagon_session;
  if (token) {
    try {
      const session = sessions.resolve(token, { touch: false });
      sessions.revoke(session.sessionId, 'logout');
    } catch (_) { /* already invalid */ }
  }
  setAuthCookie(res, '', 0);
  return sendJson(res, 200, { success: true });
}

/**
 * Session-info handler wrapper.
 */
export function handleSessionInfo(authority, req, res) {
  const ctx = resolveContextFromRequest(authority, req, { touch: false });
  if (!ctx) {
    return sendJson(res, 200, { authenticated: false, user: null, enforced: true });
  }
  const { users } = authority;
  const user = users.get(ctx.actorId);
  return sendJson(res, 200, {
    authenticated: !!user,
    user: sanitizeUser(user),
    expiresAt: ctx.now,
  });
}

/**
 * Bootstrap handler wrapper.
 */
export function handleBootstrap(authority, req, res) {
  const require = requirePermission(authority, req, res, { permission: 'platform:page:home' });
  if (!require.ok) return;
  const ctx = require.ctx;
  const payload = authority.bootstrap.build(ctx, {
    actions: [
      { id: 'db_write', permission: 'platform:db:write', entity: 'x_records' },
      { id: 'backup_verify', permission: 'platform:backup:verify' },
      { id: 'backup_restore', permission: 'platform:backup:restore' },
      { id: 'tts', permission: 'platform:tts:use' },
      { id: 'review_report', permission: 'platform:review_report:save' },
    ],
  });
  const retirement = createLegacyWriterRetirementGuard(authority.dialect);
  payload.cutover = {
    finance: {
      canonicalAuthority: 'platform.finance',
      enforced: true,
    },
    phase04: {
      canonicalAuthority: 'platform.commercial',
      enabled: retirement.cutoverEnabled(),
      domains: retirement.status(),
    },
  };
  return sendJson(res, 200, { success: true, ...payload });
}

/**
 * Set-password handler. The client is never a credential authority:
 * passwords are set only here, against the canonical identity tables.
 * - self-service: the actor must supply their current password.
 * - owner reset: an owner may reset any user's password (must_change = true).
 * Every successful change revokes the target user's other sessions.
 */
export async function handleSetPassword(authority, req, res) {
  const ctx = resolveContextFromRequest(authority, req, { touch: false });
  if (!ctx) return sendJson(res, 401, { success: false, error: 'Login session required' });
  const body = await readBody(req, 16 * 1024);
  let parsed = {};
  try { parsed = body ? JSON.parse(body) : {}; } catch (e) { return sendJson(res, 400, { success: false, error: 'Invalid JSON' }); }
  const userId = String(parsed.userId || '').trim();
  const password = String(parsed.password || '');
  const currentPassword = String(parsed.currentPassword || '');
  if (!userId || !password) return sendJson(res, 400, { success: false, error: 'userId and password are required' });

  const { users, dialect } = authority;
  const target = users.get(userId);
  if (!target) return sendJson(res, 404, { success: false, error: 'User not found' });
  const actor = users.get(ctx.actorId);
  const isSelf = ctx.actorId === userId;
  const isOwnerReset = !!actor?.isOwner && !isSelf;
  if (!isSelf && !isOwnerReset) {
    return sendJson(res, 403, { success: false, error: 'Only an owner may reset another user\'s password' });
  }
  if (isSelf) {
    if (!currentPassword) return sendJson(res, 400, { success: false, error: 'currentPassword is required' });
    const credentialCheck = checkCredentials(dialect, userId, currentPassword);
    if (!credentialCheck.ok) {
      return sendJson(res, 403, { success: false, error: 'Current password is incorrect' });
    }
  }
  try {
    setPassword(dialect, userId, password, { actor: ctx.actorId, mustChange: isOwnerReset });
  } catch (e) {
    return sendJson(res, e.statusCode || 400, { success: false, error: e.message, code: e.code });
  }
  // Revoke every other live session for the target user.
  dialect.prepare(`
    UPDATE identity_sessions SET revoked_at = ?, revoked_reason = 'password_change'
    WHERE user_id = ? AND revoked_at IS NULL AND id != ?
  `).run(new Date().toISOString(), userId, ctx.sessionId || '');
  return sendJson(res, 200, { success: true, mustChange: isOwnerReset });
}

/**
 * Context-switch handler. The active company/branch is server-derived from a
 * verified membership; the request body can never claim a company the actor
 * is not a member of.
 */
export async function handleContextSwitch(authority, req, res) {
  const { sessions, dialect } = authority;
  const cookies = parseCookies(req);
  const token = cookies.octagon_session;
  if (!token) return sendJson(res, 401, { success: false, error: 'Login session required' });
  let session;
  try {
    session = sessions.resolve(token, { touch: false });
  } catch (e) {
    return sendJson(res, 401, { success: false, error: 'Login session required' });
  }
  const body = await readBody(req, 16 * 1024);
  let parsed = {};
  try { parsed = body ? JSON.parse(body) : {}; } catch (e) { return sendJson(res, 400, { success: false, error: 'Invalid JSON' }); }
  const companyId = String(parsed.companyId || '').trim();
  const branchId = parsed.branchId ? String(parsed.branchId).trim() : null;
  if (!companyId) return sendJson(res, 400, { success: false, error: 'companyId is required' });

  const actor = authority.users.get(session.userId);
  const membership = dialect.prepare(`
    SELECT 1 FROM organization_memberships
    WHERE user_id = ? AND company_id = ? AND status = 'active'
  `).get(session.userId, companyId);
  const company = dialect.prepare("SELECT 1 FROM platform_companies WHERE id = ? AND status = 'active'").get(companyId);
  if (!company) return sendJson(res, 404, { success: false, error: 'Company not found' });
  const companyTenant = dialect.prepare('SELECT tenant_id FROM platform_companies WHERE id = ?').get(companyId);
  const ownerMayUseCompany = !!actor?.isOwner && (
    companyId === 'default' || companyTenant?.tenant_id === actor.tenantId
  );
  if (!membership && !ownerMayUseCompany) {
    return sendJson(res, 403, { success: false, error: 'No active membership in the requested company' });
  }
  dialect.prepare('UPDATE identity_sessions SET active_company_id = ? WHERE id = ?').run(companyId, session.sessionId);
  if (branchId !== null) {
    try {
      dialect.prepare('UPDATE identity_sessions SET active_branch_id = ? WHERE id = ?').run(branchId, session.sessionId);
    } catch (_) { /* column optional in older schemas */ }
  }
  return sendJson(res, 200, { success: true, activeCompanyId: companyId, activeBranchId: branchId });
}

function sanitizeUser(user) {  if (!user) return null;
  const { id, tenantId, login, name, email, status, locale, isOwner } = user;
  return { id, tenantId, login, name, email, status, locale, isOwner };
}

function getDefaultCompanyId(dialect, tenantId) {
  try {
    const row = dialect.prepare('SELECT id FROM platform_companies WHERE tenant_id = ? AND status = ? ORDER BY created_at LIMIT 1').get(tenantId, 'active');
    return row ? row.id : null;
  } catch (_) { return null; }
}

function setAuthCookie(res, token, maxAgeSeconds) {
  const cookie = `octagon_session=${encodeURIComponent(token || '')}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, Number(maxAgeSeconds) || 0)}`;
  res.setHeader('Set-Cookie', cookie);
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (Buffer.byteLength(body) > limit) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

/**
 * Re-export the platform route handler so server.js can mount `/api/v1` with
 * a session-derived context. The legacy platform/api/index.mjs header-based
 * resolver is not used here.
 */
export async function mountPlatformApi(authority, prefix = '/api/v1') {
  const { createApiHandler } = await import('./platform/api/index.mjs');
  return createApiHandler({
    dialect: authority.dialect,
    prefix,
    // Same executor as the runtime authority: finance handlers stay reachable
    // over HTTP (Phase 03 closure repair).
    actionExecutor: authority.actionExecutor,
    resolveContext: (req, requestUrl) => resolveApiContext(authority, req, requestUrl),
    authorize: ({ permission, ctx }) => authority.evaluator.evaluate({ permission, ctx }),
  });
}

function resolveApiContext(authority, req, requestUrl) {
  const ctx = resolveContextFromRequest(authority, req, { touch: true });
  if (!ctx) return null;
  const headers = req.headers || {};
  return {
    ...ctx,
    userId: ctx.actorId,
    companyId: ctx.activeCompanyId || ctx.companyId || null,
    branchId: ctx.activeBranchId || ctx.branchId || null,
    correlationId: headers['x-correlation-id'] || requestUrl.searchParams.get('correlation_id') || `corr_${Math.random().toString(36).slice(2)}`,
    idempotencyKey: headers['x-idempotency-key'] ? String(headers['x-idempotency-key']).slice(0, 120) : null,
    sourceChannel: 'api',
  };
}

/**
 * Create a repository-backed command handler that enforces the session context.
 * Used by the legacy API routes that want to delegate storage to the platform
 * generic document store.
 */
export function createRecordCommandHandler(authority, entityId) {
  return createRepository(authority.dialect, entityId);
}

export { AuthorizationError, DEFAULT_PAGE_CATALOGUE };
