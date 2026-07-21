// SSO / external identity provider registry — Phase 02 packet 02.04.
//
// Source composition:
// - VNext vnext/server/modules/governance/sso-engine.js + sso-routes.js
//   (project-owned, MERGE-REFACTOR): provider record shape, tenant binding,
//   email-domain matching, JIT provisioning switch.
// - Odoo addons/auth_oauth (clean-room): provider registry + validation endpoint
//   separation; the adapter is data, not code.
// - NocoBase auth plugins (clean-room): pluggable authenticator contract.
//
// This module is deliberately an ADAPTER CONTRACT, not a hardwired IdP stack.
// It owns: provider records, state/nonce/PKCE issuance and single-use
// consumption, claim→user matching policy, JIT provisioning policy, and account
// linking protection. It does NOT perform network I/O — the caller supplies a
// `exchange(providerConfig, {code, codeVerifier})` function, which keeps this
// unit testable and keeps HTTP egress under integration governance.
//
// SAML is a declared kind but has NO implementation here (§ 28 stop condition,
// § 66 ADR requirement). Attempting to complete a SAML login throws.

'use strict';

import crypto from 'node:crypto';

export class SsoError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'SsoError';
    this.code = code;
    this.details = details;
  }
}

const STATE_TTL_SECONDS = 600;

export class SsoRegistry {
  constructor(dialect, options = {}) {
    this.dialect = dialect;
    this.now = options.now || (() => new Date());
    /** @type {Map<string, (config:object, input:object)=>Promise<object>|object>} */
    this.exchangers = new Map();
  }

  /** Register a transport for a provider kind. Tests register a deterministic fake. */
  registerExchanger(kind, fn) {
    if (typeof fn !== 'function') throw new SsoError('exchanger must be a function', 'INVALID_EXCHANGER');
    this.exchangers.set(kind, fn);
    return this;
  }

  registerProvider(provider, actor = 'system') {
    const kind = provider.kind;
    if (!['oidc', 'oauth2', 'saml'].includes(kind)) throw new SsoError('unsupported provider kind', 'PROVIDER_KIND_INVALID');
    const tenant = this.dialect.prepare('SELECT 1 FROM platform_tenants WHERE id = ? AND status = ?').get(provider.tenantId, 'active');
    if (!tenant) throw new SsoError('tenant not found or inactive', 'TENANT_INVALID');
    const id = provider.id || `sso_${crypto.randomUUID()}`;
    const now = this.now().toISOString();
    this.dialect.prepare(`
      INSERT INTO identity_sso_providers (id, tenant_id, kind, name, issuer, client_id, client_secret_ref, authorize_url,
        token_url, jwks_url, email_domains, jit_provisioning, jit_role_template, require_verified_email, allow_account_link,
        status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, issuer=excluded.issuer, client_id=excluded.client_id,
        client_secret_ref=excluded.client_secret_ref, authorize_url=excluded.authorize_url, token_url=excluded.token_url,
        jwks_url=excluded.jwks_url, email_domains=excluded.email_domains, jit_provisioning=excluded.jit_provisioning,
        jit_role_template=excluded.jit_role_template, require_verified_email=excluded.require_verified_email,
        allow_account_link=excluded.allow_account_link, status=excluded.status, updated_at=excluded.updated_at
    `).run(
      id, provider.tenantId, kind, provider.name, provider.issuer || null, provider.clientId || null,
      // NEVER the secret itself — only a reference into the secret vault.
      provider.clientSecretRef || null, provider.authorizeUrl || null, provider.tokenUrl || null, provider.jwksUrl || null,
      JSON.stringify(provider.emailDomains || []), provider.jitProvisioning ? 1 : 0, provider.jitRoleTemplate || null,
      provider.requireVerifiedEmail === false ? 0 : 1, provider.allowAccountLink ? 1 : 0,
      provider.status === 'enabled' ? 'enabled' : 'disabled', now, now
    );
    this.dialect.prepare(`
      INSERT INTO platform_audit_log (id, actor_id, actor_type, action, resource, resource_id, occurred_at, source_channel, result)
      VALUES (?, ?, 'user', 'sso.provider.configure', 'identity_sso_providers', ?, ?, 'identity', 'success')
    `).run(crypto.randomUUID(), actor, id, now);
    return this.getProvider(id);
  }

  getProvider(id) {
    const r = this.dialect.prepare('SELECT * FROM identity_sso_providers WHERE id = ?').get(id);
    if (!r) return null;
    return {
      id: r.id, tenantId: r.tenant_id, kind: r.kind, name: r.name, issuer: r.issuer, clientId: r.client_id,
      clientSecretRef: r.client_secret_ref, authorizeUrl: r.authorize_url, tokenUrl: r.token_url, jwksUrl: r.jwks_url,
      emailDomains: JSON.parse(r.email_domains || '[]'), jitProvisioning: r.jit_provisioning === 1,
      jitRoleTemplate: r.jit_role_template, requireVerifiedEmail: r.require_verified_email === 1,
      allowAccountLink: r.allow_account_link === 1, status: r.status,
    };
  }

  setStatus(id, status) {
    this.dialect.prepare('UPDATE identity_sso_providers SET status = ?, updated_at = ? WHERE id = ?')
      .run(status === 'enabled' ? 'enabled' : 'disabled', this.now().toISOString(), id);
    return this.getProvider(id);
  }

  /** Begin a login: mint single-use state + nonce + PKCE verifier/challenge. */
  beginLogin(providerId, { redirectUri = null } = {}) {
    const provider = this.getProvider(providerId);
    if (!provider) throw new SsoError('provider not found', 'PROVIDER_NOT_FOUND');
    if (provider.status !== 'enabled') throw new SsoError('provider is disabled', 'PROVIDER_DISABLED');
    if (provider.kind === 'saml') throw new SsoError('SAML is not implemented; an approved ADR is required', 'SAML_NOT_IMPLEMENTED');

    const state = crypto.randomBytes(24).toString('base64url');
    const nonce = crypto.randomBytes(24).toString('base64url');
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    const now = this.now();
    this.dialect.prepare(`
      INSERT INTO identity_sso_logins (state, provider_id, tenant_id, nonce, code_verifier, code_challenge, redirect_uri, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(state, providerId, provider.tenantId, nonce, codeVerifier, codeChallenge, redirectUri,
      now.toISOString(), new Date(now.getTime() + STATE_TTL_SECONDS * 1000).toISOString());
    return { state, nonce, codeChallenge, codeChallengeMethod: 'S256', authorizeUrl: provider.authorizeUrl };
  }

  #consumeState(state, providerId) {
    const row = this.dialect.prepare('SELECT * FROM identity_sso_logins WHERE state = ?').get(state);
    if (!row) throw new SsoError('unknown or already used state', 'SSO_STATE_INVALID');
    if (row.consumed_at) throw new SsoError('state replay rejected', 'SSO_STATE_REPLAYED');
    if (Date.parse(row.expires_at) <= this.now().getTime()) throw new SsoError('state expired', 'SSO_STATE_EXPIRED');
    if (row.provider_id !== providerId) throw new SsoError('state does not belong to this provider', 'SSO_STATE_PROVIDER_MISMATCH');
    this.dialect.prepare('UPDATE identity_sso_logins SET consumed_at = ? WHERE state = ?').run(this.now().toISOString(), state);
    return row;
  }

  /**
   * Complete a login. `userDirectory` and `membershipDirectory` are injected so
   * JIT provisioning goes through the canonical writers, never raw SQL.
   */
  async completeLogin({ providerId, state, code, claims: presetClaims = null }, { userDirectory, membershipDirectory = null, defaultCompanyId = null } = {}) {
    const provider = this.getProvider(providerId);
    if (!provider) throw new SsoError('provider not found', 'PROVIDER_NOT_FOUND');
    if (provider.status !== 'enabled') throw new SsoError('provider is disabled', 'PROVIDER_DISABLED');
    if (provider.kind === 'saml') throw new SsoError('SAML is not implemented; an approved ADR is required', 'SAML_NOT_IMPLEMENTED');

    const stateRow = this.#consumeState(state, providerId);

    let claims = presetClaims;
    if (!claims) {
      const exchange = this.exchangers.get(provider.kind);
      if (!exchange) throw new SsoError(`no exchanger registered for kind ${provider.kind}`, 'SSO_EXCHANGER_MISSING');
      claims = await exchange(provider, { code, codeVerifier: stateRow.code_verifier, nonce: stateRow.nonce });
    }
    if (!claims || !claims.sub) throw new SsoError('provider returned no subject', 'SSO_NO_SUBJECT');
    if (claims.nonce !== undefined && claims.nonce !== stateRow.nonce) {
      throw new SsoError('nonce mismatch', 'SSO_NONCE_MISMATCH');
    }
    if (provider.requireVerifiedEmail && claims.email_verified !== true) {
      throw new SsoError('provider did not assert a verified email', 'SSO_EMAIL_UNVERIFIED');
    }
    const email = String(claims.email || '').toLowerCase();
    if (provider.emailDomains.length) {
      const domain = email.split('@')[1] || '';
      if (!provider.emailDomains.map((d) => String(d).toLowerCase()).includes(domain)) {
        throw new SsoError('email domain is not permitted for this provider', 'SSO_DOMAIN_DENIED', { domain });
      }
    }

    // 1. An existing federated link always wins — stable across email changes.
    const link = this.dialect.prepare('SELECT user_id FROM identity_federated_links WHERE provider_id = ? AND subject = ?').get(providerId, String(claims.sub));
    if (link) return { userId: link.user_id, provisioned: false, linked: true };

    // 2. Account-linking takeover protection: matching an existing local account
    //    by email is only allowed when the tenant explicitly opted in.
    const existing = email ? this.dialect.prepare('SELECT id FROM identity_users WHERE tenant_id = ? AND LOWER(COALESCE(email,\'\')) = ?').get(provider.tenantId, email) : null;
    if (existing) {
      if (!provider.allowAccountLink) {
        throw new SsoError('an account with this email already exists; automatic linking is disabled', 'SSO_LINK_NOT_ALLOWED');
      }
      this.#link(providerId, String(claims.sub), existing.id);
      return { userId: existing.id, provisioned: false, linked: true };
    }

    // 3. JIT provisioning, only if configured.
    if (!provider.jitProvisioning) throw new SsoError('no matching account and JIT provisioning is disabled', 'SSO_NO_ACCOUNT');
    const user = userDirectory.create({
      tenantId: provider.tenantId,
      login: email || `${providerId}:${claims.sub}`,
      name: claims.name || email || String(claims.sub),
      email: email || null,
    }, `sso:${providerId}`);
    if (membershipDirectory && defaultCompanyId) {
      membershipDirectory.grant({ userId: user.id, companyId: defaultCompanyId, isDefault: true }, `sso:${providerId}`);
    }
    this.#link(providerId, String(claims.sub), user.id);
    return { userId: user.id, provisioned: true, linked: true, roleTemplate: provider.jitRoleTemplate };
  }

  #link(providerId, subject, userId) {
    this.dialect.prepare(`
      INSERT INTO identity_federated_links (id, provider_id, subject, user_id, linked_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(provider_id, subject) DO UPDATE SET user_id = excluded.user_id
    `).run(`fed_${crypto.randomUUID()}`, providerId, subject, userId, this.now().toISOString());
  }

  /**
   * Local emergency access policy: even with SSO enforced, an owner account with
   * a local credential must remain able to log in, otherwise a broken IdP locks
   * the tenant out permanently.
   */
  emergencyLocalAccessAvailable(tenantId) {
    const row = this.dialect.prepare(`
      SELECT COUNT(*) AS n FROM identity_users u
      JOIN identity_credentials c ON c.user_id = u.id
      WHERE u.tenant_id = ? AND u.is_owner = 1 AND u.status = 'active'
    `).get(tenantId);
    return Number(row?.n || 0) > 0;
  }
}

export function createSsoRegistry(dialect, options) { return new SsoRegistry(dialect, options); }
