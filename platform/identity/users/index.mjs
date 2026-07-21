// Canonical user authority — Phase 02 packets 02.01 and 02.11.
//
// Source composition:
// - Octagon services/permissionService.js + acl.json (PRESERVE): the legacy
//   group/role vocabulary is mapped, not discarded — see LEGACY_ROLE_ALIASES.
// - VNext vnext/server/acl/acl-engine.js (project-owned, MERGE-REFACTOR):
//   LEGACY_GROUP_TO_ROLE / LEGACY_ROLE_ALIASES tables lifted so existing Octagon
//   sessions resolve to the new role model without a data migration.
// - RuoYi yudao-module-system user/dept/tenant (MIT reference, behavior only):
//   suspended-user semantics, owner-lockout protection.
//
// Invariants:
//   - identity_users is the ONLY writer of a user fact; platform_users is a view
//   - a user always belongs to exactly one tenant
//   - suspension is immediate: it revokes sessions, it does not merely hide the row

'use strict';

import crypto from 'node:crypto';
import { setPassword } from '../passwords/index.mjs';

export class UserError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'UserError';
    this.code = code;
    this.details = details;
  }
}

/** Legacy Octagon group -> Phase 02 role token. Preserved from acl-engine.js. */
export const LEGACY_GROUP_TO_ROLE = Object.freeze({
  'system.admin': 'admin',
  'workshop.manager': 'manager',
  'finance.manager': 'accountant',
  'finance.user': 'accountant',
  'workshop.user': 'operator',
});

/** Legacy Octagon role alias -> Phase 02 role token. Preserved from acl-engine.js. */
export const LEGACY_ROLE_ALIASES = Object.freeze({
  system: 'admin', system_admin: 'admin', admin: 'admin',
  manager: 'manager', workshop_manager: 'manager', mgr_workshop: 'manager',
  finance_manager: 'accountant', mgr_finance: 'accountant',
  finance_user: 'accountant', user_finance: 'accountant',
  workshop_user: 'operator', user_workshop: 'operator',
  operator: 'operator', operator_user: 'operator',
  sales: 'sales', sales_user: 'sales',
  viewer: 'viewer', viewer_user: 'viewer', employee: 'viewer', employee_user: 'viewer',
});

/**
 * Map a legacy Octagon session shape ({role, roleId, groups[]}) onto Phase 02
 * role tokens. Compatibility adapter required by packet 02.01. Returns [] when
 * nothing maps — deny-by-default, never a fallback to admin.
 */
export function mapLegacyRoles(legacy = {}) {
  const out = new Set();
  const explicit = String(legacy.aclRole || legacy.role || legacy.roleId || '').trim();
  if (explicit && LEGACY_ROLE_ALIASES[explicit]) out.add(LEGACY_ROLE_ALIASES[explicit]);
  const groups = Array.isArray(legacy.groups) ? legacy.groups : [];
  for (const g of groups) if (LEGACY_GROUP_TO_ROLE[g]) out.add(LEGACY_GROUP_TO_ROLE[g]);
  return [...out];
}

export class UserDirectory {
  constructor(dialect) {
    if (!dialect || typeof dialect.prepare !== 'function') throw new UserError('dialect required', 'DIALECT_REQUIRED');
    this.dialect = dialect;
  }

  #now() { return new Date().toISOString(); }

  #audit(action, resourceId, detail, actor) {
    this.dialect.prepare(`
      INSERT INTO platform_audit_log (id, actor_id, actor_type, action, resource, resource_id, occurred_at, source_channel, result, after_value)
      VALUES (?, ?, 'user', ?, 'identity_users', ?, ?, 'identity', 'success', ?)
    `).run(crypto.randomUUID(), actor || 'system', action, resourceId, this.#now(), detail ? JSON.stringify(detail) : null);
  }

  create({ id, tenantId, login, name, email = null, password = null, isOwner = false, mfaRequired = false, locale = 'ar' }, actor = 'system') {
    if (!tenantId) throw new UserError('tenantId is required', 'TENANT_REQUIRED');
    if (!login) throw new UserError('login is required', 'LOGIN_REQUIRED');
    const tenant = this.dialect.prepare('SELECT 1 FROM platform_tenants WHERE id = ? AND status = ?').get(tenantId, 'active');
    if (!tenant) throw new UserError('tenant not found or inactive', 'TENANT_INVALID');
    const userId = id || `usr_${crypto.randomUUID()}`;
    const now = this.#now();
    try {
      this.dialect.prepare(`
        INSERT INTO identity_users (id, tenant_id, login, name, email, actor_type, status, locale, is_owner, mfa_required, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'user', 'active', ?, ?, ?, ?, ?)
      `).run(userId, tenantId, login, name || login, email, locale, isOwner ? 1 : 0, mfaRequired ? 1 : 0, now, now);
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) throw new UserError('login already exists in this tenant', 'LOGIN_TAKEN', { login });
      throw e;
    }
    if (password) setPassword(this.dialect, userId, password, { actor });
    this.#audit('user.create', userId, { login, tenantId }, actor);
    return this.get(userId);
  }

  get(userId) {
    const row = this.dialect.prepare('SELECT * FROM identity_users WHERE id = ?').get(userId);
    if (!row) return null;
    return {
      id: row.id, tenantId: row.tenant_id, login: row.login, name: row.name, email: row.email,
      actorType: row.actor_type, status: row.status, locale: row.locale,
      isOwner: row.is_owner === 1, mfaRequired: row.mfa_required === 1,
      failedAttempts: row.failed_attempts, lockedUntil: row.locked_until,
      lastLoginAt: row.last_login_at, createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  findByLogin(tenantId, login) {
    const row = this.dialect.prepare('SELECT id FROM identity_users WHERE tenant_id = ? AND login = ?').get(tenantId, login);
    return row ? this.get(row.id) : null;
  }

  list(tenantId) {
    return this.dialect.prepare('SELECT id FROM identity_users WHERE tenant_id = ? ORDER BY login').all(tenantId).map((r) => this.get(r.id));
  }

  /** Count of active owner accounts in a tenant — used for lockout prevention. */
  activeOwnerCount(tenantId) {
    const row = this.dialect.prepare("SELECT COUNT(*) AS n FROM identity_users WHERE tenant_id = ? AND is_owner = 1 AND status = 'active'").get(tenantId);
    return Number(row?.n || 0);
  }

  setStatus(userId, status, actor = 'system') {
    if (!['active', 'suspended', 'archived'].includes(status)) throw new UserError('invalid status', 'STATUS_INVALID');
    const user = this.get(userId);
    if (!user) throw new UserError('user not found', 'USER_NOT_FOUND');
    if (user.isOwner && status !== 'active' && this.activeOwnerCount(user.tenantId) <= 1) {
      throw new UserError('cannot suspend the last active owner of a tenant', 'OWNER_LOCKOUT_PREVENTED', { tenantId: user.tenantId });
    }
    this.dialect.prepare('UPDATE identity_users SET status = ?, updated_at = ? WHERE id = ?').run(status, this.#now(), userId);
    if (status !== 'active') {
      // Suspension is immediate: kill every live session for this user.
      this.dialect.prepare("UPDATE identity_sessions SET revoked_at = ?, revoked_reason = 'user_status_change' WHERE user_id = ? AND revoked_at IS NULL")
        .run(this.#now(), userId);
    }
    this.#audit('user.status', userId, { status }, actor);
    return this.get(userId);
  }

  recordFailedLogin(userId, policy) {
    const user = this.get(userId);
    if (!user) return null;
    const attempts = user.failedAttempts + 1;
    let lockedUntil = user.lockedUntil;
    if (attempts >= Number(policy.max_failed_attempts)) {
      lockedUntil = new Date(Date.now() + Number(policy.lockout_seconds) * 1000).toISOString();
    }
    this.dialect.prepare('UPDATE identity_users SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?')
      .run(attempts, lockedUntil, this.#now(), userId);
    return { attempts, lockedUntil };
  }

  clearFailedLogins(userId) {
    this.dialect.prepare('UPDATE identity_users SET failed_attempts = 0, locked_until = NULL, last_login_at = ?, updated_at = ? WHERE id = ?')
      .run(this.#now(), this.#now(), userId);
  }

  isLocked(userId, now = new Date()) {
    const user = this.get(userId);
    if (!user || !user.lockedUntil) return false;
    return Date.parse(user.lockedUntil) > now.getTime();
  }
}

export function createUserDirectory(dialect) { return new UserDirectory(dialect); }
