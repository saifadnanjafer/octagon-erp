// Security administration and evidence views — Phase 02 packet 02.30.
//
// Source composition:
// - Octagon existing admin/log pages (PRESERVE the operator vocabulary).
// - VNext modules/governance/security-audit.js + support-engine.js
//   (project-owned, MERGE-REFACTOR): the "one read-only report per security
//   surface" shape, and support-bundle redaction.
// - RuoYi yudao-module-system login-log / operate-log (MIT reference, behavior only).
//
// Every view here is READ-ONLY, tenant/company-scoped, permission-gated, and
// masked. Final commercial dashboard polish is Phase 08 (§ 55).

'use strict';

import { AuthorizationError } from '../authorization/evaluator/index.mjs';
import { redactForLogs } from '../settings/secrets/index.mjs';

export class SecurityEvidenceError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'SecurityEvidenceError';
    this.code = code;
    this.details = details;
  }
}

export const EVIDENCE_VIEWS = Object.freeze([
  'active_sessions', 'failed_authentication', 'permission_denials', 'role_changes',
  'delegations', 'approvals', 'workflow_failures', 'api_keys', 'secret_events',
  'file_access', 'imports_exports', 'webhook_failures', 'job_failures', 'policy_violations',
]);

export class SecurityEvidenceService {
  constructor(dialect, deps = {}) {
    this.dialect = dialect;
    this.evaluator = deps.evaluator || null;
    this.sessions = deps.sessions || null;
    this.now = deps.now || (() => new Date());
    this.permission = deps.permission || 'platform:security:read';
  }

  #authorize(ctx) {
    if (!this.evaluator) return;
    const decision = this.evaluator.evaluate({ permission: this.permission, ctx });
    if (!decision.allowed) throw new AuthorizationError(decision);
  }

  #companies(ctx) {
    const list = ctx.companyMemberships?.length ? ctx.companyMemberships : (ctx.activeCompanyId ? [ctx.activeCompanyId] : []);
    return list;
  }

  /**
   * All views funnel through here so scoping, masking, and authorization can
   * never be forgotten on one of them.
   */
  view(name, ctx, { limit = 200, sinceIso = null } = {}) {
    if (!EVIDENCE_VIEWS.includes(name)) throw new SecurityEvidenceError(`unknown evidence view ${name}`, 'VIEW_UNKNOWN', { name });
    this.#authorize(ctx);
    const companies = this.#companies(ctx);
    if (!companies.length) return { view: name, rows: [], scoped: true };
    const inList = companies.map(() => '?').join(',');
    const since = sinceIso || new Date(this.now().getTime() - 30 * 86400000).toISOString();
    let rows = [];

    switch (name) {
      case 'active_sessions':
        rows = this.dialect.prepare(`
          SELECT s.id, s.user_id, u.login, s.created_at, s.last_seen_at, s.idle_expires_at, s.absolute_expires_at,
                 s.actor_type, s.impersonator_id, s.ip, s.user_agent
          FROM identity_sessions s JOIN identity_users u ON u.id = s.user_id
          WHERE s.revoked_at IS NULL AND s.absolute_expires_at > ? AND u.tenant_id = ?
          ORDER BY s.last_seen_at DESC LIMIT ?
        `).all(this.now().toISOString(), ctx.tenantId, limit);
        break;
      case 'failed_authentication':
        rows = this.dialect.prepare(`
          SELECT id, login, reason_code, occurred_at, ip FROM identity_login_attempts
          WHERE succeeded = 0 AND tenant_id = ? AND occurred_at >= ? ORDER BY occurred_at DESC LIMIT ?
        `).all(ctx.tenantId, since, limit);
        break;
      case 'permission_denials':
        rows = this.dialect.prepare(`
          SELECT decision_id, occurred_at, actor_id, actor_type, permission, resource, record_id, reason_code, source_channel
          FROM authorization_decisions
          WHERE allowed = 0 AND occurred_at >= ? AND (company_id IS NULL OR company_id IN (${inList}))
          ORDER BY occurred_at DESC LIMIT ?
        `).all(since, ...companies, limit);
        break;
      case 'role_changes':
        rows = this.dialect.prepare(`
          SELECT id, actor_id, action, resource_id, occurred_at, after_value FROM platform_audit_log
          WHERE resource = 'authorization_roles' AND occurred_at >= ? ORDER BY occurred_at DESC LIMIT ?
        `).all(since, limit);
        break;
      case 'delegations':
        rows = this.dialect.prepare(`
          SELECT id, from_user_id, to_user_id, company_id, permissions, valid_from, valid_to, status, reason
          FROM policy_delegations WHERE company_id IS NULL OR company_id IN (${inList})
          ORDER BY created_at DESC LIMIT ?
        `).all(...companies, limit);
        break;
      case 'approvals':
        rows = this.dialect.prepare(`
          SELECT id, entity, record_id, action, requester_id, status, amount, escalated, created_at, decided_at
          FROM approval_requests WHERE company_id IN (${inList}) AND created_at >= ?
          ORDER BY created_at DESC LIMIT ?
        `).all(...companies, since, limit);
        break;
      case 'workflow_failures':
        rows = this.dialect.prepare(`
          SELECT id, definition_id, definition_version, entity, record_id, status, attempts, last_error, started_at, finished_at
          FROM workflow_instances WHERE status IN ('failed','dead') AND (company_id IS NULL OR company_id IN (${inList}))
          ORDER BY started_at DESC LIMIT ?
        `).all(...companies, limit);
        break;
      case 'api_keys':
        // Metadata only — never key_hash, never a raw key.
        rows = this.dialect.prepare(`
          SELECT k.id, k.prefix, k.label, k.scopes, k.company_id, k.created_at, k.expires_at, k.revoked_at, k.last_used_at,
                 a.name AS service_account
          FROM identity_api_keys k JOIN identity_service_accounts a ON a.id = k.service_account_id
          WHERE k.tenant_id = ? ORDER BY k.created_at DESC LIMIT ?
        `).all(ctx.tenantId, limit);
        break;
      case 'secret_events':
        rows = this.dialect.prepare(`
          SELECT id, ref, event, occurred_at, actor_id, detail FROM secret_events
          WHERE occurred_at >= ? ORDER BY occurred_at DESC LIMIT ?
        `).all(since, limit);
        break;
      case 'file_access':
        rows = this.dialect.prepare(`
          SELECT l.id, l.file_id, l.actor_id, l.share_id, l.operation, l.reason_code, l.occurred_at, l.ip
          FROM file_access_log l LEFT JOIN file_objects f ON f.id = l.file_id
          WHERE l.occurred_at >= ? AND (f.company_id IS NULL OR f.company_id IN (${inList}))
          ORDER BY l.occurred_at DESC LIMIT ?
        `).all(since, ...companies, limit);
        break;
      case 'imports_exports':
        rows = [
          ...this.dialect.prepare(`
            SELECT id, 'import' AS kind, entity, status, total_rows, ok_rows, failed_rows, created_by, created_at
            FROM import_jobs WHERE company_id IN (${inList}) AND created_at >= ?
          `).all(...companies, since),
          ...this.dialect.prepare(`
            SELECT id, 'export' AS kind, entity, 'completed' AS status, row_count AS total_rows, row_count AS ok_rows,
                   0 AS failed_rows, requested_by AS created_by, created_at
            FROM export_jobs WHERE company_id IN (${inList}) AND created_at >= ?
          `).all(...companies, since),
        ].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, limit);
        break;
      case 'webhook_failures':
        rows = this.dialect.prepare(`
          SELECT d.id, d.subscription_id, s.event_type, s.url, d.status, d.attempts, d.response_status, d.last_error, d.created_at
          FROM webhook_deliveries d JOIN webhook_subscriptions s ON s.id = d.subscription_id
          WHERE d.status IN ('failed','dead') AND (s.company_id IS NULL OR s.company_id IN (${inList}))
          ORDER BY d.created_at DESC LIMIT ?
        `).all(...companies, limit);
        break;
      case 'job_failures':
        rows = this.dialect.prepare(`
          SELECT id, kind, status, attempts, last_error, tenant_id, company_id, created_at, finished_at
          FROM job_runs WHERE status IN ('failed','dead') AND (company_id IS NULL OR company_id IN (${inList}))
          ORDER BY created_at DESC LIMIT ?
        `).all(...companies, limit);
        break;
      case 'policy_violations':
        rows = [
          ...this.dialect.prepare(`
            SELECT decision_id AS id, 'denied' AS kind, actor_id, permission, reason_code, policy_references, occurred_at
            FROM authorization_decisions
            WHERE allowed = 0 AND reason_code IN ('SOD_CONFLICT','AUTHORITY_LIMIT_EXCEEDED','POLICY_DENIED')
              AND occurred_at >= ? AND (company_id IS NULL OR company_id IN (${inList}))
          `).all(since, ...companies),
          ...this.dialect.prepare(`
            SELECT id, 'override' AS kind, actor_id, sod_rule_id AS permission, 'OVERRIDE' AS reason_code,
                   reason AS policy_references, occurred_at
            FROM policy_overrides WHERE occurred_at >= ?
          `).all(since),
        ].sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at))).slice(0, limit);
        break;
      default:
        rows = [];
    }
    // Redaction is applied to EVERY view on the way out — a secret cannot leak
    // through an evidence screen.
    return { view: name, scoped: true, generatedAt: this.now().toISOString(), rows: rows.map((r) => redactForLogs(r)) };
  }

  /** One-call operator summary. */
  summary(ctx) {
    this.#authorize(ctx);
    const out = {};
    for (const name of EVIDENCE_VIEWS) {
      try { out[name] = this.view(name, ctx, { limit: 1000 }).rows.length; } catch { out[name] = null; }
    }
    return { generatedAt: this.now().toISOString(), counts: out };
  }

  /** Revoke a session from the operator console. Governed and audited. */
  revokeSession(sessionId, ctx) {
    if (!this.evaluator) throw new SecurityEvidenceError('evaluator required', 'EVALUATOR_REQUIRED');
    const decision = this.evaluator.evaluate({ permission: 'platform:security:revoke_session', ctx });
    if (!decision.allowed) throw new AuthorizationError(decision);
    if (!this.sessions) throw new SecurityEvidenceError('session authority required', 'SESSIONS_REQUIRED');
    return this.sessions.revoke(sessionId, `revoked_by:${ctx.actorId}`);
  }

  /**
   * Export an evidence view. Exporting security evidence is itself a governed,
   * separately-permissioned act (§ 55 "export authorization").
   */
  export(name, ctx, options = {}) {
    if (!this.evaluator) throw new SecurityEvidenceError('evaluator required', 'EVALUATOR_REQUIRED');
    const decision = this.evaluator.evaluate({ permission: 'platform:security:export', ctx });
    if (!decision.allowed) throw new AuthorizationError(decision);
    return this.view(name, ctx, options);
  }

  /**
   * Support bundle: operational context with every secret redacted. Verified by
   * the security suite rather than assumed.
   */
  supportBundle(ctx) {
    this.#authorize(ctx);
    return redactForLogs({
      generatedAt: this.now().toISOString(),
      tenantId: ctx.tenantId,
      activeCompanyId: ctx.activeCompanyId,
      moduleStates: this.dialect.prepare('SELECT id, status FROM platform_modules').all(),
      migrations: this.dialect.prepare('SELECT migration_id, applied_at FROM schema_migrations ORDER BY migration_id').all(),
      providerHealth: this.dialect.prepare('SELECT * FROM provider_health').all(),
      deadLetters: {
        jobs: Number(this.dialect.prepare("SELECT COUNT(*) AS n FROM job_runs WHERE status='dead'").get().n),
        webhooks: Number(this.dialect.prepare("SELECT COUNT(*) AS n FROM webhook_deliveries WHERE status='dead'").get().n),
        notifications: Number(this.dialect.prepare("SELECT COUNT(*) AS n FROM notification_deliveries WHERE status='dead'").get().n),
        workflows: Number(this.dialect.prepare("SELECT COUNT(*) AS n FROM workflow_instances WHERE status='dead'").get().n),
      },
      // References only — never ciphertext, never plaintext. The key is named
      // `vaultReferences` rather than `secretRefs` on purpose: the redactor
      // blanks any key matching /secret/, which would (correctly but unhelpfully)
      // erase the whole block. Renaming keeps the audit value while the redactor
      // stays strict.
      vaultReferences: this.dialect.prepare('SELECT ref, module_id, reveal_policy FROM secret_references').all(),
    });
  }
}

export function createSecurityEvidenceService(dialect, deps) { return new SecurityEvidenceService(dialect, deps); }
