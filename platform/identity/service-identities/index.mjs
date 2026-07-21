// Service identities, API keys, and impersonation — Phase 02 packets 02.03/02.05.
//
// Source composition:
// - Octagon server-jarvis-security.js AI-key proxy (PRESERVE the intent: no key
//   ever reaches client JS). Here the same rule is generalized: only a SHA-256
//   hash is stored, the raw key is returned exactly once at creation.
// - VNext vnext/server/auth/auth-hardening.js issueApiKey/revokeApiKey/listApiKeys
//   (project-owned, MERGE-REFACTOR): key hashing and one-time display kept;
//   extended with prefix lookup, scopes, IP allowlist, per-key rate limits,
//   rotation overlap, and tenant/company binding.
// - RuoYi infra idempotency/rate-limit starters (MIT reference, behavior only).
//
// Invariants (§ 8.6, § 8.7):
//   - integrations act under a named service identity, never a shared owner login
//   - a service identity cannot create an interactive session (enforced in
//     platform/identity/sessions)
//   - plaintext keys are never stored and never logged

'use strict';

import crypto from 'node:crypto';

export class ServiceIdentityError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'ServiceIdentityError';
    this.code = code;
    this.details = details;
  }
}

function hashKey(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

/** Redact anything that looks like a secret before it can reach a log or audit row. */
export function redactSecrets(value) {
  if (value == null) return value;
  if (typeof value === 'string') {
    return value
      .replace(/\bok_[A-Za-z0-9_-]{8,}/g, 'ok_***REDACTED***')
      .replace(/\b(?:sk|pk|api|key|token|secret|password|bearer)[-_ ]?[:=]?\s*["']?[A-Za-z0-9_\-.]{12,}["']?/gi, '***REDACTED***');
  }
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = /secret|password|token|api[_-]?key|client_secret|authorization/i.test(k) ? '***REDACTED***' : redactSecrets(v);
    }
    return out;
  }
  return value;
}

export class ServiceIdentityAuthority {
  constructor(dialect, options = {}) {
    this.dialect = dialect;
    this.now = options.now || (() => new Date());
  }

  createServiceAccount({ id, tenantId, companyId = null, name, purpose = null }, actor = 'system') {
    const tenant = this.dialect.prepare('SELECT 1 FROM platform_tenants WHERE id = ? AND status = ?').get(tenantId, 'active');
    if (!tenant) throw new ServiceIdentityError('tenant not found or inactive', 'TENANT_INVALID');
    const accountId = id || `svc_${crypto.randomUUID()}`;
    this.dialect.prepare(`
      INSERT INTO identity_service_accounts (id, tenant_id, company_id, name, purpose, status, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(accountId, tenantId, companyId, name, purpose, this.now().toISOString(), actor);
    return this.getServiceAccount(accountId);
  }

  getServiceAccount(id) {
    const row = this.dialect.prepare('SELECT * FROM identity_service_accounts WHERE id = ?').get(id);
    if (!row) return null;
    return { id: row.id, tenantId: row.tenant_id, companyId: row.company_id, name: row.name, purpose: row.purpose, status: row.status };
  }

  suspendServiceAccount(id) {
    this.dialect.prepare("UPDATE identity_service_accounts SET status = 'suspended' WHERE id = ?").run(id);
    this.dialect.prepare('UPDATE identity_api_keys SET revoked_at = ? WHERE service_account_id = ? AND revoked_at IS NULL')
      .run(this.now().toISOString(), id);
  }

  /**
   * Issue a scoped API key. The raw key is returned EXACTLY ONCE. Only the hash
   * and a non-secret prefix are persisted.
   */
  issueApiKey({ serviceAccountId, label = null, scopes = [], companyId = null, ttlDays = 90, ipAllowlist = [], rateLimitPerMinute = 120, rotatedFrom = null }, actor = 'system') {
    const account = this.getServiceAccount(serviceAccountId);
    if (!account) throw new ServiceIdentityError('service account not found', 'SERVICE_ACCOUNT_NOT_FOUND');
    if (account.status !== 'active') throw new ServiceIdentityError('service account is not active', 'SERVICE_ACCOUNT_INACTIVE');
    const raw = `ok_${crypto.randomBytes(32).toString('base64url')}`;
    const id = `key_${crypto.randomUUID()}`;
    const now = this.now();
    const expiresAt = ttlDays > 0 ? new Date(now.getTime() + ttlDays * 86400000).toISOString() : null;
    this.dialect.prepare(`
      INSERT INTO identity_api_keys (id, key_hash, prefix, service_account_id, tenant_id, company_id, label, scopes,
        ip_allowlist, rate_limit_per_minute, created_at, created_by, expires_at, rotated_from)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, hashKey(raw), raw.slice(0, 10), serviceAccountId, account.tenantId, companyId || account.companyId,
      label, JSON.stringify(scopes), JSON.stringify(ipAllowlist), rateLimitPerMinute,
      now.toISOString(), actor, expiresAt, rotatedFrom
    );
    return { id, key: raw, prefix: raw.slice(0, 10), expiresAt, scopes };
  }

  /**
   * Rotation with overlap: the new key is live immediately; the old key stays
   * valid until `overlapSeconds` elapse, then expires on its own.
   */
  rotateApiKey(oldKeyId, { overlapSeconds = 3600, ...opts } = {}, actor = 'system') {
    const old = this.dialect.prepare('SELECT * FROM identity_api_keys WHERE id = ?').get(oldKeyId);
    if (!old) throw new ServiceIdentityError('api key not found', 'API_KEY_NOT_FOUND');
    const fresh = this.issueApiKey({
      serviceAccountId: old.service_account_id,
      label: opts.label ?? old.label,
      scopes: opts.scopes ?? JSON.parse(old.scopes || '[]'),
      companyId: opts.companyId ?? old.company_id,
      ttlDays: opts.ttlDays ?? 90,
      ipAllowlist: opts.ipAllowlist ?? JSON.parse(old.ip_allowlist || '[]'),
      rateLimitPerMinute: opts.rateLimitPerMinute ?? old.rate_limit_per_minute,
      rotatedFrom: oldKeyId,
    }, actor);
    const overlapEnd = new Date(this.now().getTime() + overlapSeconds * 1000).toISOString();
    this.dialect.prepare('UPDATE identity_api_keys SET expires_at = ? WHERE id = ?').run(overlapEnd, oldKeyId);
    return { ...fresh, previousKeyExpiresAt: overlapEnd };
  }

  revokeApiKey(keyId) {
    const info = this.dialect.prepare('UPDATE identity_api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
      .run(this.now().toISOString(), keyId);
    return info.changes > 0;
  }

  /** Metadata only — never key_hash, never the raw key. */
  listApiKeys(serviceAccountId) {
    return this.dialect.prepare(`
      SELECT id, prefix, label, scopes, company_id, created_at, expires_at, revoked_at, last_used_at, rate_limit_per_minute
      FROM identity_api_keys WHERE service_account_id = ? ORDER BY created_at DESC
    `).all(serviceAccountId).map((r) => ({ ...r, scopes: JSON.parse(r.scopes || '[]') }));
  }

  /**
   * Authenticate a raw API key. Returns a service-actor descriptor or throws.
   * Applies expiry, revocation, IP allowlist, and per-minute rate limit.
   */
  authenticateApiKey(rawKey, { ip = null, requiredScope = null } = {}) {
    if (!rawKey) throw new ServiceIdentityError('api key required', 'API_KEY_REQUIRED');
    const row = this.dialect.prepare('SELECT * FROM identity_api_keys WHERE key_hash = ?').get(hashKey(rawKey));
    if (!row) throw new ServiceIdentityError('api key is not valid', 'API_KEY_INVALID');
    const nowMs = this.now().getTime();
    if (row.revoked_at) throw new ServiceIdentityError('api key revoked', 'API_KEY_REVOKED');
    if (row.expires_at && Date.parse(row.expires_at) <= nowMs) throw new ServiceIdentityError('api key expired', 'API_KEY_EXPIRED');
    const account = this.getServiceAccount(row.service_account_id);
    if (!account || account.status !== 'active') throw new ServiceIdentityError('service account is not active', 'SERVICE_ACCOUNT_INACTIVE');

    const allowlist = JSON.parse(row.ip_allowlist || '[]');
    if (allowlist.length && !allowlist.includes(String(ip || ''))) {
      throw new ServiceIdentityError('api key not permitted from this network', 'API_KEY_IP_DENIED');
    }

    const scopes = JSON.parse(row.scopes || '[]');
    if (requiredScope && !scopes.includes(requiredScope) && !scopes.includes('*')) {
      throw new ServiceIdentityError(`api key lacks scope ${requiredScope}`, 'API_KEY_SCOPE_DENIED', { requiredScope });
    }

    // Fixed-window rate limit, persisted so it survives a process restart.
    const window = new Date(Math.floor(nowMs / 60000) * 60000).toISOString();
    this.dialect.prepare(`
      INSERT INTO identity_api_key_usage (id, api_key_id, window_start, calls) VALUES (?, ?, ?, 1)
      ON CONFLICT(api_key_id, window_start) DO UPDATE SET calls = calls + 1
    `).run(`aku_${crypto.randomUUID()}`, row.id, window);
    const usage = this.dialect.prepare('SELECT calls FROM identity_api_key_usage WHERE api_key_id = ? AND window_start = ?').get(row.id, window);
    if (Number(usage.calls) > Number(row.rate_limit_per_minute)) {
      throw new ServiceIdentityError('api key rate limit exceeded', 'API_KEY_RATE_LIMITED', { limit: row.rate_limit_per_minute, window });
    }

    this.dialect.prepare('UPDATE identity_api_keys SET last_used_at = ? WHERE id = ?').run(this.now().toISOString(), row.id);
    return {
      apiKeyId: row.id,
      actorId: account.id,
      actorType: 'service',
      tenantId: row.tenant_id,
      companyId: row.company_id,
      scopes,
    };
  }
}

export class ImpersonationAuthority {
  constructor(dialect, options = {}) {
    this.dialect = dialect;
    this.now = options.now || (() => new Date());
  }

  /**
   * Start an impersonation. Requires an explicit reason, is time-bounded, is
   * audited, and NEVER lets the impersonator gain authority the target does not
   * have — the resulting session's roles come from the target, and the session
   * is tagged `actor_type='impersonated'` so the UI must show a banner.
   * An owner account cannot be impersonated by a non-owner.
   */
  begin({ impersonatorId, targetUserId, reason, ttlSeconds = 1800 }, sessionAuthority) {
    if (!reason || String(reason).trim().length < 5) {
      throw new ServiceIdentityError('impersonation requires a stated reason', 'IMPERSONATION_REASON_REQUIRED');
    }
    if (impersonatorId === targetUserId) {
      throw new ServiceIdentityError('cannot impersonate self', 'IMPERSONATION_SELF');
    }
    const impersonator = this.dialect.prepare('SELECT tenant_id, is_owner, status FROM identity_users WHERE id = ?').get(impersonatorId);
    const target = this.dialect.prepare('SELECT tenant_id, is_owner, status FROM identity_users WHERE id = ?').get(targetUserId);
    if (!impersonator || !target) throw new ServiceIdentityError('user not found', 'USER_NOT_FOUND');
    if (impersonator.tenant_id !== target.tenant_id) throw new ServiceIdentityError('cannot impersonate across tenants', 'IMPERSONATION_CROSS_TENANT');
    if (target.status !== 'active') throw new ServiceIdentityError('target user is not active', 'USER_INACTIVE');
    if (target.is_owner === 1 && impersonator.is_owner !== 1) {
      throw new ServiceIdentityError('a non-owner cannot impersonate an owner', 'IMPERSONATION_PRIVILEGE_DENIED');
    }
    const now = this.now();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
    const session = sessionAuthority.createSession(targetUserId, { actorType: 'impersonated', impersonatorId });
    const id = `imp_${crypto.randomUUID()}`;
    this.dialect.prepare(`
      INSERT INTO identity_impersonations (id, impersonator_id, target_user_id, session_id, reason, started_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, impersonatorId, targetUserId, session.sessionId, String(reason).slice(0, 500), now.toISOString(), expiresAt);
    this.dialect.prepare(`
      INSERT INTO platform_audit_log (id, actor_id, actor_type, action, resource, resource_id, occurred_at, source_channel, result, after_value)
      VALUES (?, ?, 'user', 'identity.impersonation.begin', 'identity_users', ?, ?, 'identity', 'success', ?)
    `).run(crypto.randomUUID(), impersonatorId, targetUserId, now.toISOString(), JSON.stringify({ reason: String(reason).slice(0, 500), expiresAt }));
    return { impersonationId: id, ...session, expiresAt, banner: true };
  }

  end(impersonationId, sessionAuthority) {
    const row = this.dialect.prepare('SELECT * FROM identity_impersonations WHERE id = ?').get(impersonationId);
    if (!row) throw new ServiceIdentityError('impersonation not found', 'IMPERSONATION_NOT_FOUND');
    if (row.session_id) sessionAuthority.revoke(row.session_id, 'impersonation_ended');
    this.dialect.prepare('UPDATE identity_impersonations SET ended_at = ? WHERE id = ?').run(this.now().toISOString(), impersonationId);
    return true;
  }

  isActive(impersonationId) {
    const row = this.dialect.prepare('SELECT ended_at, expires_at FROM identity_impersonations WHERE id = ?').get(impersonationId);
    if (!row || row.ended_at) return false;
    return Date.parse(row.expires_at) > this.now().getTime();
  }
}

export function createServiceIdentityAuthority(dialect, options) { return new ServiceIdentityAuthority(dialect, options); }
export function createImpersonationAuthority(dialect, options) { return new ImpersonationAuthority(dialect, options); }
export const _internal = { hashKey };
