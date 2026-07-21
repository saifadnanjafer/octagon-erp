// Session authority — Phase 02 packet 02.02.
//
// Source composition:
// - Octagon server.js requireSession / octagon_session cookie flow (PRESERVE):
//   the working cookie-session model, lockout intent, and Arabic denial text are
//   kept. What is NOT kept: `isLocalWriteTrusted()` / `allowLocalDev` /
//   `OCTAGON_TRUST_LOCALHOST` — see § 9.7. This module has no loopback branch at
//   all, so a bypass cannot be reintroduced by configuration.
// - VNext vnext/server/auth/auth-hardening.js (project-owned, MERGE-REFACTOR):
//   rotateSessionsForUser / isSessionRevoked semantics, generalized from a single
//   per-user revocation watermark to per-session rows so individual devices can
//   be revoked.
// - Odoo/NocoBase/Frappe session behavior (clean-room): fixation resistance via
//   post-authentication token rotation, idle + absolute expiry pair.
//
// Invariants (§ 8):
//   - only a token hash is stored; the raw token leaves once, in createSession()
//   - every read path re-checks revocation, idle expiry, and absolute expiry
//   - privilege change rotates the token (new id, new secret) — fixation-proof
//   - a service identity can never own an interactive session

'use strict';

import crypto from 'node:crypto';
import { loadPasswordPolicy, checkCredentials } from '../passwords/index.mjs';

export class SessionError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'SessionError';
    this.code = code;
    this.details = details;
    this.statusCode = code === 'AUTH_FAILED' ? 401 : 403;
  }
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export class SessionAuthority {
  /**
   * @param {object} dialect
   * @param {{now?: () => Date}} options injectable clock so expiry tests are deterministic
   */
  constructor(dialect, options = {}) {
    if (!dialect || typeof dialect.prepare !== 'function') throw new SessionError('dialect required', 'DIALECT_REQUIRED');
    this.dialect = dialect;
    this.now = options.now || (() => new Date());
  }

  #event(sessionId, userId, event, detail, meta = {}) {
    this.dialect.prepare(`
      INSERT INTO identity_session_events (id, session_id, user_id, event, occurred_at, detail, ip, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), sessionId, userId, event, this.now().toISOString(), detail ? JSON.stringify(detail) : null, meta.ip || null, meta.userAgent || null);
  }

  #attempt(tenantId, login, succeeded, reasonCode, meta = {}) {
    this.dialect.prepare(`
      INSERT INTO identity_login_attempts (id, tenant_id, login, succeeded, reason_code, occurred_at, ip)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), tenantId, login, succeeded ? 1 : 0, reasonCode, this.now().toISOString(), meta.ip || null);
  }

  /**
   * Create a session. Called ONLY after authentication has succeeded.
   * Returns `{ token }` once — the caller places it in a Secure/HttpOnly/SameSite
   * cookie and never logs it.
   */
  createSession(userId, { activeCompanyId = null, activeBranchId = null, mfaSatisfied = false, actorType = 'user', impersonatorId = null, ip = null, userAgent = null } = {}) {
    const user = this.dialect.prepare('SELECT tenant_id, status FROM identity_users WHERE id = ?').get(userId);
    if (!user) throw new SessionError('user not found', 'USER_NOT_FOUND');
    if (user.status !== 'active') throw new SessionError('user is not active', 'USER_INACTIVE');
    // A service account id can never appear in identity_users, so this is
    // structurally enforced; the explicit check documents the invariant.
    const svc = this.dialect.prepare('SELECT 1 FROM identity_service_accounts WHERE id = ?').get(userId);
    if (svc) throw new SessionError('service identities cannot hold interactive sessions', 'SERVICE_IDENTITY_NO_SESSION');

    const policy = loadPasswordPolicy(this.dialect);
    if (Number(policy.max_concurrent_sessions) > 0) {
      const live = this.dialect.prepare('SELECT id FROM identity_sessions WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at ASC').all(userId);
      const excess = live.length - (Number(policy.max_concurrent_sessions) - 1);
      for (let i = 0; i < excess; i++) this.revoke(live[i].id, 'concurrent_session_limit');
    }

    const now = this.now();
    const token = crypto.randomBytes(32).toString('base64url');
    const id = `ses_${crypto.randomUUID()}`;
    this.dialect.prepare(`
      INSERT INTO identity_sessions (id, token_hash, user_id, tenant_id, active_company_id, active_branch_id, actor_type,
        impersonator_id, mfa_satisfied, csrf_token, created_at, last_seen_at, idle_expires_at, absolute_expires_at, user_agent, ip)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, hashToken(token), userId, user.tenant_id, activeCompanyId, activeBranchId, actorType, impersonatorId,
      mfaSatisfied ? 1 : 0, crypto.randomBytes(24).toString('base64url'),
      now.toISOString(), now.toISOString(),
      new Date(now.getTime() + policy.session_idle_seconds * 1000).toISOString(),
      new Date(now.getTime() + policy.session_absolute_seconds * 1000).toISOString(),
      userAgent, ip
    );
    this.#event(id, userId, 'session.created', { actorType, impersonatorId }, { ip, userAgent });
    return { sessionId: id, token, csrfToken: this.dialect.prepare('SELECT csrf_token FROM identity_sessions WHERE id = ?').get(id).csrf_token };
  }

  /**
   * Authenticate a login+password. This is the ONLY place a password is checked.
   * Lockout, attempt counting, and MFA requirement all resolve here.
   */
  authenticate({ tenantId, login, password, ip = null, userAgent = null }) {
    const policy = loadPasswordPolicy(this.dialect);
    let row = null;
    let resolvedTenantId = tenantId;

    // If the caller did not provide a tenant (legacy shell login), look up the
    // user by login. The tenant is then derived from the matched user record so
    // the rest of the session lifecycle remains tenant-aware.
    if (!tenantId || tenantId === 'default') {
      row = this.dialect.prepare('SELECT id, tenant_id, status, locked_until, failed_attempts, mfa_required FROM identity_users WHERE login = ?').get(login);
      if (row) resolvedTenantId = row.tenant_id;
    } else {
      row = this.dialect.prepare('SELECT id, tenant_id, status, locked_until, failed_attempts, mfa_required FROM identity_users WHERE tenant_id = ? AND login = ?').get(tenantId, login);
    }

    // Uniform failure surface: an unknown login and a wrong password produce the
    // same reason code and message, so the endpoint is not a user enumerator.
    if (!row) {
      this.#attempt(resolvedTenantId || tenantId || 'default', login, false, 'AUTH_FAILED', { ip });
      throw new SessionError('اسم المستخدم أو كلمة المرور غير صحيحة', 'AUTH_FAILED');
    }
    if (row.status !== 'active') {
      this.#attempt(resolvedTenantId, login, false, 'USER_INACTIVE', { ip });
      throw new SessionError('الحساب غير مفعّل', 'USER_INACTIVE');
    }
    if (row.locked_until && Date.parse(row.locked_until) > this.now().getTime()) {
      this.#attempt(resolvedTenantId, login, false, 'LOCKED_OUT', { ip });
      throw new SessionError('تم قفل الحساب مؤقتاً بسبب محاولات دخول فاشلة', 'LOCKED_OUT', { until: row.locked_until });
    }
    const check = checkCredentials(this.dialect, row.id, password);
    if (!check.ok) {
      const attempts = row.failed_attempts + 1;
      const lockedUntil = attempts >= Number(policy.max_failed_attempts)
        ? new Date(this.now().getTime() + Number(policy.lockout_seconds) * 1000).toISOString()
        : null;
      this.dialect.prepare('UPDATE identity_users SET failed_attempts = ?, locked_until = COALESCE(?, locked_until), updated_at = ? WHERE id = ?')
        .run(attempts, lockedUntil, this.now().toISOString(), row.id);
      this.#attempt(resolvedTenantId, login, false, 'AUTH_FAILED', { ip });
      this.#event(null, row.id, 'login.failed', { attempts }, { ip, userAgent });
      throw new SessionError('اسم المستخدم أو كلمة المرور غير صحيحة', 'AUTH_FAILED');
    }
    this.dialect.prepare('UPDATE identity_users SET failed_attempts = 0, locked_until = NULL, last_login_at = ?, updated_at = ? WHERE id = ?')
      .run(this.now().toISOString(), this.now().toISOString(), row.id);
    this.#attempt(resolvedTenantId, login, true, null, { ip });
    return { userId: row.id, tenantId: resolvedTenantId, mfaRequired: row.mfa_required === 1, mustChangePassword: !!check.mustChange };
  }

  /** Resolve a raw token to a live session, or throw. No loopback branch exists. */
  resolve(token, { touch = true, ip = null, userAgent = null } = {}) {
    if (!token) throw new SessionError('no session', 'NO_SESSION');
    const row = this.dialect.prepare('SELECT * FROM identity_sessions WHERE token_hash = ?').get(hashToken(token));
    if (!row) throw new SessionError('no session', 'NO_SESSION');
    const nowMs = this.now().getTime();
    if (row.revoked_at) throw new SessionError('session revoked', 'SESSION_REVOKED', { reason: row.revoked_reason });
    if (Date.parse(row.absolute_expires_at) <= nowMs) throw new SessionError('session expired', 'SESSION_EXPIRED', { kind: 'absolute' });
    if (Date.parse(row.idle_expires_at) <= nowMs) throw new SessionError('session expired', 'SESSION_EXPIRED', { kind: 'idle' });
    const user = this.dialect.prepare('SELECT status FROM identity_users WHERE id = ?').get(row.user_id);
    if (!user || user.status !== 'active') throw new SessionError('user is not active', 'USER_INACTIVE');

    if (touch) {
      const policy = loadPasswordPolicy(this.dialect);
      this.dialect.prepare('UPDATE identity_sessions SET last_seen_at = ?, idle_expires_at = ? WHERE id = ?')
        .run(this.now().toISOString(), new Date(nowMs + policy.session_idle_seconds * 1000).toISOString(), row.id);
    }
    return {
      sessionId: row.id, userId: row.user_id, tenantId: row.tenant_id,
      activeCompanyId: row.active_company_id, activeBranchId: row.active_branch_id,
      actorType: row.actor_type, impersonatorId: row.impersonator_id,
      mfaSatisfied: row.mfa_satisfied === 1, csrfToken: row.csrf_token,
      createdAt: row.created_at,
    };
  }

  /**
   * Fixation resistance and privilege-change rotation: issue a NEW token/id and
   * revoke the old row atomically. The old token is dead the moment this returns.
   */
  rotate(token, reason = 'privilege_change') {
    const current = this.resolve(token, { touch: false });
    this.dialect.exec('BEGIN IMMEDIATE;');
    try {
      this.dialect.prepare('UPDATE identity_sessions SET revoked_at = ?, revoked_reason = ? WHERE id = ?')
        .run(this.now().toISOString(), reason, current.sessionId);
      const fresh = this.createSession(current.userId, {
        activeCompanyId: current.activeCompanyId,
        activeBranchId: current.activeBranchId,
        mfaSatisfied: current.mfaSatisfied,
        actorType: current.actorType,
        impersonatorId: current.impersonatorId,
      });
      this.dialect.exec('COMMIT;');
      this.#event(fresh.sessionId, current.userId, 'session.rotated', { reason, previous: current.sessionId });
      return fresh;
    } catch (e) {
      this.dialect.exec('ROLLBACK;');
      throw e;
    }
  }

  /** Change the active company/branch of a live session — memberships are checked by the caller's context builder. */
  setActiveScope(sessionId, companyId, branchId = null) {
    this.dialect.prepare('UPDATE identity_sessions SET active_company_id = ?, active_branch_id = ? WHERE id = ?').run(companyId, branchId, sessionId);
  }

  markMfaSatisfied(sessionId) {
    this.dialect.prepare('UPDATE identity_sessions SET mfa_satisfied = 1 WHERE id = ?').run(sessionId);
  }

  revoke(sessionId, reason = 'logout') {
    const row = this.dialect.prepare('SELECT user_id FROM identity_sessions WHERE id = ?').get(sessionId);
    this.dialect.prepare('UPDATE identity_sessions SET revoked_at = ?, revoked_reason = ? WHERE id = ? AND revoked_at IS NULL')
      .run(this.now().toISOString(), reason, sessionId);
    if (row) this.#event(sessionId, row.user_id, 'session.revoked', { reason });
    return true;
  }

  revokeAllForUser(userId, reason = 'admin_revoke') {
    this.dialect.prepare('UPDATE identity_sessions SET revoked_at = ?, revoked_reason = ? WHERE user_id = ? AND revoked_at IS NULL')
      .run(this.now().toISOString(), reason, userId);
    this.#event(null, userId, 'session.revoked_all', { reason });
  }

  listForUser(userId) {
    return this.dialect.prepare(`
      SELECT id, created_at, last_seen_at, idle_expires_at, absolute_expires_at, revoked_at, revoked_reason, ip, user_agent, actor_type
      FROM identity_sessions WHERE user_id = ? ORDER BY created_at DESC
    `).all(userId);
  }

  /** CSRF / origin verification for state-changing requests. */
  verifyCsrf(session, presentedToken) {
    if (!session?.csrfToken) return false;
    const a = Buffer.from(String(session.csrfToken));
    const b = Buffer.from(String(presentedToken || ''));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
}

export function createSessionAuthority(dialect, options) { return new SessionAuthority(dialect, options); }
export const _internal = { hashToken };
