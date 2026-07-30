// CRM shared primitives: scope, ids, validation, numbering, audit, outbox.
//
// The ActionExecutor already strips client-supplied company/actor and replaces
// them with server-derived values (see kernel trustedActionInput), so these
// helpers read `input.company_id` / `input.actor` as trusted facts rather than
// re-deriving them. They still assert presence, because the services are also
// callable directly from tests and must not silently run unscoped.

import crypto from 'node:crypto';
import { CRM_ERRORS, fail } from './errors.mjs';

export const newId = (prefix) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
export const now = () => new Date().toISOString();

export function scopeOf(input) {
  if (!input?.company_id) fail(CRM_ERRORS.COMPANY_SCOPE_REQUIRED, 'company scope is required');
  if (!input?.actor) fail(CRM_ERRORS.ACTOR_REQUIRED, 'actor identity is required');
  return { companyId: input.company_id, branchId: input.branch_id ?? null, actor: input.actor };
}

// --- normalisation ---------------------------------------------------------

/** Digits only, with a leading + preserved. Arabic-Indic digits folded to ASCII. */
export function normalisePhone(v) {
  const folded = String(v ?? '').replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  const kept = folded.replace(/[^\d+]/g, '');
  return kept.startsWith('+') ? `+${kept.slice(1).replace(/\+/g, '')}` : kept.replace(/\+/g, '');
}

export const normaliseEmail = (v) => String(v ?? '').trim().toLowerCase();

/** Case/whitespace-insensitive organisation key, with common suffixes dropped. */
export function normaliseOrg(v) {
  return String(v ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\b(llc|ltd|inc|co|company|شركة|مؤسسة)\b\.?/g, '')
    .trim();
}

// --- validation ------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateLeadInput(input, { partial = false } = {}) {
  const errors = [];
  const has = (k) => input[k] !== undefined && input[k] !== null && String(input[k]).trim() !== '';

  if (!partial) {
    // A lead must be reachable or nameable, or it is not a lead.
    if (!has('name') && !has('contact_name') && !has('organization_name')) {
      errors.push({ field: 'name', code: 'REQUIRED', message: 'a title, contact name or organization is required' });
    }
  }
  if (has('email') && !EMAIL_RE.test(normaliseEmail(input.email))) {
    errors.push({ field: 'email', code: CRM_ERRORS.INVALID_EMAIL, message: 'email is not a valid address' });
  }
  if (has('phone') && normalisePhone(input.phone).replace('+', '').length < 6) {
    errors.push({ field: 'phone', code: CRM_ERRORS.INVALID_PHONE, message: 'phone is too short to be dialable' });
  }
  if (input.expected_revenue !== undefined && input.expected_revenue !== null) {
    const n = Number(input.expected_revenue);
    if (!Number.isFinite(n) || n < 0) {
      errors.push({ field: 'expected_revenue', code: CRM_ERRORS.INVALID_AMOUNT, message: 'expected revenue must be a non-negative number' });
    }
  }
  if (errors.length) fail(CRM_ERRORS.VALIDATION_FAILED, 'lead validation failed', { errors });
  return true;
}

// --- numbering -------------------------------------------------------------

/**
 * Allocate the next company-scoped reference.
 *
 * Uses `platform_sequences`, the existing numbering authority — CRM does not
 * build a second one. The row is created on first use and incremented in place;
 * callers must already be inside the action's transaction, which is what makes
 * this concurrency-safe (SQLite serialises writers, so two racers cannot read
 * the same current_value and both commit).
 */
export function nextReference(db, { moduleId = 'crm', kind, companyId, prefix }) {
  const scopeKey = `${companyId}:${kind}`;
  const year = new Date().getUTCFullYear();
  const existing = db.prepare('SELECT id, current_value FROM platform_sequences WHERE module_id = ? AND scope_key = ?')
    .get(moduleId, scopeKey);

  let next;
  if (existing) {
    next = Number(existing.current_value) + 1;
    db.prepare('UPDATE platform_sequences SET current_value = ?, updated_at = ? WHERE id = ?')
      .run(next, now(), existing.id);
  } else {
    next = 1;
    db.prepare(`
      INSERT INTO platform_sequences
        (id, module_id, scope_key, template, current_value, reset_policy, gap_policy, fiscal_period_key, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'yearly', 'allow', ?, ?, ?)
    `).run(newId('seq'), moduleId, scopeKey, `${prefix}-{YYYY}-{#####}`, next, String(year), now(), now());
  }
  return `${prefix}-${year}-${String(next).padStart(5, '0')}`;
}

// --- audit and outbox ------------------------------------------------------

export function writeAudit(db, { companyId, branchId = null, actor, action, resource, resourceId, before = null, after = null, correlationId = null, result = 'success', reason = null }) {
  db.prepare(`
    INSERT INTO platform_audit_log
      (id, actor_id, actor_type, tenant_id, company_id, branch_id, action, resource, resource_id,
       correlation_id, occurred_at, before_value, after_value, reason, source_channel, result, failure_code)
    VALUES (?, ?, 'user', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'action', ?, NULL)
  `).run(
    newId('aud'), actor, companyId, companyId, branchId, action, resource, resourceId,
    correlationId, now(), before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null,
    reason, result
  );
}

export function emitEvent(db, { companyId, actor, eventType, aggregateId, payload = {}, correlationId = null }) {
  db.prepare(`
    INSERT INTO platform_outbox
      (id, event_type, schema_version, module_id, aggregate_id, tenant_id, company_id, actor_id,
       correlation_id, payload, created_at, scheduled_at, attempts, max_attempts, status, error_log, delivered_at)
    VALUES (?, ?, 1, 'crm', ?, ?, ?, ?, ?, ?, ?, ?, 0, 5, 'pending', NULL, NULL)
  `).run(
    newId('evt'), eventType, aggregateId, companyId, companyId, actor,
    correlationId, JSON.stringify(payload), now(), now()
  );
}

/**
 * Idempotency: return the prior result for a key, or null.
 *
 * Keyed on (company, action, key) in the existing action_idempotency table so a
 * retried request returns the original outcome instead of doing the work twice.
 */
export function recallIdempotent(db, { companyId, actor, action, key }) {
  if (!key) return null;
  const row = db.prepare(
    `SELECT response_json FROM action_idempotency
      WHERE actor_id = ? AND company_id = ? AND operation_type = ? AND idempotency_key = ?`
  ).get(actor, companyId, action, key);
  return row?.response_json ? JSON.parse(row.response_json) : null;
}

/**
 * Persist a command result against its idempotency key.
 *
 * Errors are NOT swallowed: idempotency is a correctness guarantee, and a
 * silently-disabled cache would let a retried conversion create a second
 * Opportunity while appearing to work.
 */
export function rememberIdempotent(db, { companyId, actor, action, key, result }) {
  if (!key) return;
  const payloadHash = crypto.createHash('sha256').update(JSON.stringify(result ?? {})).digest('hex');
  db.prepare(`
    INSERT INTO action_idempotency
      (id, actor_id, company_id, tenant_id, operation_type, idempotency_key, payload_hash, response_json, status_code, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 200, ?, NULL)
    ON CONFLICT (actor_id, company_id, operation_type, idempotency_key) DO NOTHING
  `).run(newId('idem'), actor, companyId, companyId, action, key, payloadHash, JSON.stringify(result), now());
}
