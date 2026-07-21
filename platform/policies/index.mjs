// Policy engine, authority limits, delegation, and segregation of duties.
// Phase 02 packets 02.12 and 02.22.
//
// Source composition:
// - VNext vnext/server/modules/governance/policy-engine.js (project-owned,
//   MERGE-REFACTOR): coverageReport(), requiresEscalation()'s "limit > 0 &&
//   amount > limit" rule, and assertCovered()'s fail-closed stance on sensitive
//   transitions are all preserved. Generalized from the fixed
//   SENSITIVE_TRANSITIONS array to a registered, versioned policy table.
// - VNext approvals.js maker≠checker check (project-owned): reused as the
//   self-approval SoD rule.
// - RuoYi BPM delegation (MIT reference, behavior only).
// - Odoo/ERPNext finance role separation (clean-room): create/approve/pay.
//
// Phase 02 implements the ENGINE and the governance policies. Finance- and
// inventory-specific rules (period lock, negative stock, discount limits) are
// declared as categories here and become active in Phase 03/04 (§ 47).
//
// Invariants (§ 11.5, § 11.6, § 37):
//   - delegation is time-bounded and cannot escalate beyond the delegator
//   - a user cannot approve their own request where policy forbids it
//   - SoD is checked at ASSIGNMENT time and at TRANSACTION time
//   - an emergency override is possible only where explicitly allowed, and is audited

'use strict';

import crypto from 'node:crypto';
import { permissionMatches } from '../authorization/registry/index.mjs';

export class PolicyError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'PolicyError';
    this.code = code;
    this.details = details;
  }
}

export const POLICY_CATEGORIES = Object.freeze([
  'authority_limit', 'segregation_of_duties', 'approval_requirement', 'export_restriction',
  'credential_control', 'ai_tool_limit', 'period_lock', 'discount_limit', 'negative_stock',
]);

export class PolicyEngine {
  constructor(dialect, deps = {}) {
    this.dialect = dialect;
    this.now = deps.now || (() => new Date());
    this.evaluator = deps.evaluator || null;
  }

  #nowIso() { return this.now().toISOString(); }

  #audit(action, resourceId, detail, actor) {
    this.dialect.prepare(`
      INSERT INTO platform_audit_log (id, actor_id, actor_type, action, resource, resource_id, occurred_at, source_channel, result, after_value)
      VALUES (?, ?, 'user', ?, 'policy_definitions', ?, ?, 'policy', 'success', ?)
    `).run(crypto.randomUUID(), actor || 'system', action, resourceId, this.#nowIso(), detail ? JSON.stringify(detail) : null);
  }

  // --- policy definitions and versions -------------------------------------

  define({ id, moduleId, category, name, labelAr = null, severity = 'deny', priority = 100 }, actor = 'system') {
    if (!POLICY_CATEGORIES.includes(category)) throw new PolicyError(`unknown policy category ${category}`, 'POLICY_CATEGORY_INVALID', { category });
    const policyId = id || `pol_${name}`;
    this.dialect.prepare(`
      INSERT INTO policy_definitions (id, module_id, category, name, label_ar, severity, priority, status, active_version, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 1, ?)
      ON CONFLICT(id) DO UPDATE SET label_ar=excluded.label_ar, severity=excluded.severity, priority=excluded.priority
    `).run(policyId, moduleId, category, name, labelAr, severity, priority, this.#nowIso());
    this.#audit('policy.define', policyId, { category, severity }, actor);
    return this.getPolicy(policyId);
  }

  /** A new version never mutates a prior one — policies are append-only history. */
  addVersion(policyId, { rule, appliesTo = [], tenantId = null, companyId = null, effectiveFrom = null, effectiveTo = null }, actor = 'system') {
    const policy = this.getPolicy(policyId);
    if (!policy) throw new PolicyError('policy not found', 'POLICY_NOT_FOUND', { policyId });
    const row = this.dialect.prepare('SELECT MAX(version) AS v FROM policy_versions WHERE policy_id = ?').get(policyId);
    const version = Number(row?.v || 0) + 1;
    this.dialect.prepare(`
      INSERT INTO policy_versions (id, policy_id, version, tenant_id, company_id, applies_to, rule, effective_from, effective_to, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(`pv_${crypto.randomUUID()}`, policyId, version, tenantId, companyId, JSON.stringify(appliesTo), JSON.stringify(rule),
      effectiveFrom, effectiveTo, this.#nowIso(), actor);
    this.dialect.prepare('UPDATE policy_definitions SET active_version = ? WHERE id = ?').run(version, policyId);
    this.#audit('policy.version', policyId, { version }, actor);
    return { policyId, version };
  }

  getPolicy(id) {
    const r = this.dialect.prepare('SELECT * FROM policy_definitions WHERE id = ?').get(id);
    if (!r) return null;
    return { id: r.id, moduleId: r.module_id, category: r.category, name: r.name, labelAr: r.label_ar, severity: r.severity, priority: r.priority, status: r.status, activeVersion: r.active_version };
  }

  activeVersions({ tenantId = null, companyId = null } = {}) {
    const nowIso = this.#nowIso();
    return this.dialect.prepare(`
      SELECT d.id AS policy_id, d.category, d.severity, d.priority, d.name, v.version, v.rule, v.applies_to, v.tenant_id, v.company_id
      FROM policy_definitions d
      JOIN policy_versions v ON v.policy_id = d.id AND v.version = d.active_version
      WHERE d.status = 'active'
        AND (v.tenant_id IS NULL OR v.tenant_id = ?)
        AND (v.company_id IS NULL OR v.company_id = ?)
        AND (v.effective_from IS NULL OR v.effective_from <= ?)
        AND (v.effective_to IS NULL OR v.effective_to > ?)
      ORDER BY d.priority ASC, d.id ASC
    `).all(tenantId, companyId, nowIso, nowIso)
      .map((r) => ({ ...r, rule: JSON.parse(r.rule || '{}'), applies_to: JSON.parse(r.applies_to || '[]') }));
  }

  // --- authority limits -----------------------------------------------------

  setAuthorityLimit({ id, roleId = null, userId = null, companyId = null, permission, maxAmount, currency = 'IQD' }) {
    if (!roleId && !userId) throw new PolicyError('an authority limit needs a roleId or a userId', 'AUTHORITY_LIMIT_TARGET_REQUIRED');
    this.dialect.prepare(`
      INSERT INTO policy_authority_limits (id, role_id, user_id, company_id, permission, max_amount, currency, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET max_amount=excluded.max_amount, currency=excluded.currency
    `).run(id || `lim_${crypto.randomUUID()}`, roleId, userId, companyId, permission, maxAmount, currency, this.#nowIso());
  }

  /** The tightest applicable limit wins. Returns null when unlimited. */
  effectiveLimit({ permission, userId, roleIds = [], companyId = null }) {
    const rows = this.dialect.prepare(`
      SELECT permission, max_amount FROM policy_authority_limits
      WHERE (company_id IS NULL OR company_id = ?)
        AND (user_id = ? OR role_id IN (${roleIds.length ? roleIds.map(() => '?').join(',') : "''"}))
    `).all(companyId, userId, ...roleIds);
    const applicable = rows.filter((r) => permissionMatches(r.permission, permission) && r.max_amount != null);
    if (!applicable.length) return null;
    return applicable.reduce((min, r) => (min === null || Number(r.max_amount) < min ? Number(r.max_amount) : min), null);
  }

  // --- delegation -----------------------------------------------------------

  /**
   * Delegate authority. A delegator can only pass on what they hold — the
   * evaluator is consulted so a delegation can never be an escalation ladder.
   */
  delegate({ fromUserId, toUserId, permissions, companyId = null, maxAmount = null, reason = null, validFrom = null, validTo }, actor = 'system', ctxOfDelegator = null) {
    if (fromUserId === toUserId) throw new PolicyError('cannot delegate to yourself', 'DELEGATION_SELF');
    if (!validTo) throw new PolicyError('a delegation must be time-bounded', 'DELEGATION_UNBOUNDED');
    const from = this.dialect.prepare('SELECT tenant_id, status FROM identity_users WHERE id = ?').get(fromUserId);
    const to = this.dialect.prepare('SELECT tenant_id, status FROM identity_users WHERE id = ?').get(toUserId);
    if (!from || !to) throw new PolicyError('user not found', 'USER_NOT_FOUND');
    if (from.tenant_id !== to.tenant_id) throw new PolicyError('cannot delegate across tenants', 'DELEGATION_CROSS_TENANT');
    if (to.status !== 'active') throw new PolicyError('delegate is not active', 'DELEGATION_TARGET_INACTIVE');

    const start = validFrom || this.#nowIso();
    if (Date.parse(validTo) <= Date.parse(start)) throw new PolicyError('delegation window is empty', 'DELEGATION_WINDOW_INVALID');

    // No escalation: the delegator must currently hold every delegated permission.
    if (this.evaluator && ctxOfDelegator) {
      for (const p of permissions) {
        const d = this.evaluator.evaluate({ permission: p, ctx: ctxOfDelegator });
        if (!d.allowed) throw new PolicyError(`cannot delegate ${p}: the delegator does not hold it`, 'DELEGATION_ESCALATION', { permission: p });
      }
    }

    const id = `del_${crypto.randomUUID()}`;
    this.dialect.prepare(`
      INSERT INTO policy_delegations (id, from_user_id, to_user_id, company_id, permissions, max_amount, reason, valid_from, valid_to, status, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(id, fromUserId, toUserId, companyId, JSON.stringify(permissions), maxAmount, reason, start, validTo, this.#nowIso(), actor);
    this.#audit('policy.delegate', id, { fromUserId, toUserId, permissions, validTo }, actor);
    return this.getDelegation(id);
  }

  getDelegation(id) {
    const r = this.dialect.prepare('SELECT * FROM policy_delegations WHERE id = ?').get(id);
    if (!r) return null;
    return {
      id: r.id, fromUserId: r.from_user_id, toUserId: r.to_user_id, companyId: r.company_id,
      permissions: JSON.parse(r.permissions || '[]'), maxAmount: r.max_amount, reason: r.reason,
      validFrom: r.valid_from, validTo: r.valid_to, status: r.status,
    };
  }

  revokeDelegation(id, actor = 'system') {
    this.dialect.prepare("UPDATE policy_delegations SET status = 'revoked' WHERE id = ?").run(id);
    this.#audit('policy.delegation.revoke', id, null, actor);
  }

  activeDelegationsFor(userId, companyId = null) {
    const nowIso = this.#nowIso();
    return this.dialect.prepare(`
      SELECT * FROM policy_delegations
      WHERE to_user_id = ? AND status = 'active' AND valid_from <= ? AND valid_to > ?
        AND (company_id IS NULL OR company_id = ?)
    `).all(userId, nowIso, nowIso, companyId).map((r) => ({
      id: r.id, fromUserId: r.from_user_id, permissions: JSON.parse(r.permissions || '[]'),
      companyId: r.company_id, maxAmount: r.max_amount,
    }));
  }

  // --- segregation of duties ------------------------------------------------

  defineSodRule({ id, name, labelAr = null, leftPermission, rightPermission, enforceAtAssignment = true, enforceAtTransaction = true, allowEmergencyOverride = false }, actor = 'system') {
    const ruleId = id || `sod_${name}`;
    this.dialect.prepare(`
      INSERT INTO policy_sod_rules (id, name, label_ar, left_permission, right_permission, enforce_at_assignment, enforce_at_transaction, allow_emergency_override, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
      ON CONFLICT(id) DO UPDATE SET label_ar=excluded.label_ar, left_permission=excluded.left_permission,
        right_permission=excluded.right_permission, enforce_at_assignment=excluded.enforce_at_assignment,
        enforce_at_transaction=excluded.enforce_at_transaction, allow_emergency_override=excluded.allow_emergency_override
    `).run(ruleId, name, labelAr, leftPermission, rightPermission, enforceAtAssignment ? 1 : 0, enforceAtTransaction ? 1 : 0, allowEmergencyOverride ? 1 : 0, this.#nowIso());
    this.#audit('policy.sod.define', ruleId, { leftPermission, rightPermission }, actor);
    return ruleId;
  }

  activeSodRules() {
    return this.dialect.prepare("SELECT * FROM policy_sod_rules WHERE status = 'active'").all().map((r) => ({
      id: r.id, name: r.name, labelAr: r.label_ar, left: r.left_permission, right: r.right_permission,
      atAssignment: r.enforce_at_assignment === 1, atTransaction: r.enforce_at_transaction === 1,
      allowEmergencyOverride: r.allow_emergency_override === 1,
    }));
  }

  /**
   * Assignment-time SoD: would granting `roleId` to `userId` give them both
   * halves of an incompatible pair? Returns the conflicting rules.
   */
  checkAssignmentSod(userId, roleId, companyId = null) {
    const currentRoles = this.dialect.prepare(`
      SELECT DISTINCT role_id FROM authorization_role_assignments
      WHERE user_id = ? AND status = 'active' AND (company_id IS NULL OR company_id = ?)
    `).all(userId, companyId || '').map((r) => r.role_id);
    const combined = [...new Set([...currentRoles, roleId])];
    if (!combined.length) return [];
    const ph = combined.map(() => '?').join(',');
    const held = this.dialect.prepare(`SELECT permission FROM authorization_grants WHERE role_id IN (${ph}) AND effect = 'allow'`).all(...combined).map((r) => r.permission);
    const holds = (target) => held.some((g) => permissionMatches(g, target));
    return this.activeSodRules().filter((rule) => rule.atAssignment && holds(rule.left) && holds(rule.right));
  }

  /**
   * Does this permission participate in a transaction-time SoD rule? The
   * evaluator asks this so it can PERSIST the allow decision — a maker≠checker
   * rule can only fire if the maker's own action was actually recorded. Without
   * this, SoD would silently never trigger.
   */
  isSodTracked(permission) {
    return this.activeSodRules().some((r) => r.atTransaction && (permissionMatches(r.left, permission) || permissionMatches(r.right, permission)));
  }

  /**
   * Transaction-time SoD: is this actor about to perform the counterpart of an
   * action they already performed on this record? This is the generalized
   * maker≠checker rule salvaged from VNext approvals.js.
   */
  checkTransactionSod({ actorId, permission, entity, recordId }) {
    const rules = this.activeSodRules().filter((r) => r.atTransaction && (permissionMatches(r.left, permission) || permissionMatches(r.right, permission)));
    const violations = [];
    for (const rule of rules) {
      // If the incoming permission is the LEFT half, the counterpart we must not
      // have performed already is the RIGHT half, and vice versa.
      const counterpart = permissionMatches(rule.left, permission) ? rule.right : rule.left;
      const priorSelf = this.dialect.prepare(`
        SELECT 1 FROM authorization_decisions
        WHERE actor_id = ? AND allowed = 1 AND record_id = ? AND resource = ? AND permission = ?
        LIMIT 1
      `).get(actorId, recordId, entity, counterpart);
      if (priorSelf) violations.push({ ruleId: rule.id, name: rule.name, counterpart, allowEmergencyOverride: rule.allowEmergencyOverride });
    }
    return violations;
  }

  recordOverride({ policyId = null, sodRuleId = null, actorId, reason, recordRef = null, approvedBy = null }) {
    if (!reason || String(reason).trim().length < 5) throw new PolicyError('an override requires a stated reason', 'OVERRIDE_REASON_REQUIRED');
    const id = `ovr_${crypto.randomUUID()}`;
    this.dialect.prepare(`
      INSERT INTO policy_overrides (id, policy_id, sod_rule_id, actor_id, reason, record_ref, occurred_at, approved_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, policyId, sodRuleId, actorId, String(reason).slice(0, 500), recordRef, this.#nowIso(), approvedBy);
    this.dialect.prepare(`
      INSERT INTO platform_audit_log (id, actor_id, actor_type, action, resource, resource_id, occurred_at, source_channel, result, after_value)
      VALUES (?, ?, 'user', 'policy.override', 'policy_overrides', ?, ?, 'policy', 'success', ?)
    `).run(crypto.randomUUID(), actorId, id, this.#nowIso(), JSON.stringify({ reason: String(reason).slice(0, 300), policyId, sodRuleId }));
    return id;
  }

  // --- the evaluator hook ---------------------------------------------------

  /**
   * Called by PermissionEvaluator. Returns
   * `{denied, reasonCode, requiresApproval, policyReferences}`.
   * Precedence: lower `priority` runs first; the first `deny` wins; otherwise
   * any `require_approval` accumulates.
   */
  evaluate({ permission, ctx, entity = null, recordId = null, amount = null, state = null }) {
    const policyReferences = [];
    let requiresApproval = false;

    // 1. Authority limits.
    if (amount !== null && amount !== undefined) {
      const roleIds = this.dialect.prepare(`
        SELECT DISTINCT role_id FROM authorization_role_assignments
        WHERE user_id = ? AND status = 'active' AND (company_id IS NULL OR company_id = ?)
      `).all(ctx.actorId, ctx.activeCompanyId || '').map((r) => r.role_id);
      const limit = this.effectiveLimit({ permission, userId: ctx.actorId, roleIds, companyId: ctx.activeCompanyId });
      // A delegation may carry its own, tighter cap.
      const delegatedCaps = (ctx.delegations || [])
        .filter((d) => d.permissions.some((p) => permissionMatches(p, permission)) && d.maxAmount != null)
        .map((d) => Number(d.maxAmount));
      const effective = [limit, ...delegatedCaps].filter((v) => v !== null && v !== undefined);
      if (effective.length) {
        const cap = Math.min(...effective);
        if (Number(amount) > cap) {
          policyReferences.push(`authority_limit:${permission}:${cap}`);
          const escalating = this.activeVersions({ tenantId: ctx.tenantId, companyId: ctx.activeCompanyId })
            .find((p) => p.category === 'authority_limit' && p.severity === 'require_approval');
          if (escalating) {
            requiresApproval = true;
          } else {
            return { denied: true, reasonCode: 'AUTHORITY_LIMIT_EXCEEDED', policyReferences };
          }
        }
      }
    }

    // 2. Transaction-time segregation of duties.
    if (entity && recordId) {
      const violations = this.checkTransactionSod({ actorId: ctx.actorId, permission, entity, recordId });
      if (violations.length) {
        policyReferences.push(...violations.map((v) => `sod:${v.ruleId}`));
        return { denied: true, reasonCode: 'SOD_CONFLICT', policyReferences, violations };
      }
    }

    // 3. Declarative policy versions.
    for (const policy of this.activeVersions({ tenantId: ctx.tenantId, companyId: ctx.activeCompanyId })) {
      if (policy.applies_to.length && !policy.applies_to.some((p) => permissionMatches(p, permission))) continue;
      const rule = policy.rule || {};
      let triggered = false;
      if (rule.amountAbove !== undefined && amount !== null && Number(amount) > Number(rule.amountAbove)) triggered = true;
      if (rule.states && state && rule.states.includes(state)) triggered = true;
      if (rule.always === true) triggered = true;
      if (!triggered) continue;
      policyReferences.push(`${policy.policy_id}@v${policy.version}`);
      if (policy.severity === 'deny') return { denied: true, reasonCode: 'POLICY_DENIED', policyReferences };
      if (policy.severity === 'require_approval') requiresApproval = true;
    }

    return { denied: false, requiresApproval, policyReferences };
  }

  /**
   * Coverage report — preserved from VNext policy-engine.coverageReport().
   * A sensitive permission with no governing policy is a gap, not a pass.
   */
  coverageReport(sensitivePermissions = []) {
    const active = this.activeVersions();
    const covers = (perm) => active.some((p) => !p.applies_to.length || p.applies_to.some((a) => permissionMatches(a, perm)));
    const rows = sensitivePermissions.map((perm) => ({ permission: perm, covered: covers(perm) }));
    return {
      totalPolicies: active.length,
      sensitivePermissions: rows,
      allSensitiveCovered: rows.every((r) => r.covered),
      sodRules: this.activeSodRules().length,
      categories: [...new Set(active.map((p) => p.category))].sort(),
    };
  }

  /** Detect two active policies that would both fire on the same permission with opposite severities. */
  conflictReport() {
    const active = this.activeVersions();
    const conflicts = [];
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i]; const b = active[j];
        if (a.severity === b.severity) continue;
        const overlap = a.applies_to.filter((p) => b.applies_to.some((q) => permissionMatches(q, p) || permissionMatches(p, q)));
        if (overlap.length) {
          conflicts.push({
            a: `${a.policy_id}@v${a.version}`, b: `${b.policy_id}@v${b.version}`,
            overlap, resolvedBy: a.priority <= b.priority ? a.policy_id : b.policy_id,
          });
        }
      }
    }
    return { conflicts, hasConflicts: conflicts.length > 0 };
  }

  /** Human-readable explanation of why a decision went the way it did. */
  explain({ permission, ctx, amount = null, entity = null, recordId = null, state = null }) {
    const verdict = this.evaluate({ permission, ctx, amount, entity, recordId, state });
    return {
      permission,
      actorId: ctx.actorId,
      outcome: verdict.denied ? 'denied' : (verdict.requiresApproval ? 'requires_approval' : 'allowed'),
      reasonCode: verdict.reasonCode || null,
      policyReferences: verdict.policyReferences,
      evaluatedPolicies: this.activeVersions({ tenantId: ctx.tenantId, companyId: ctx.activeCompanyId })
        .map((p) => ({ id: p.policy_id, category: p.category, severity: p.severity, priority: p.priority, version: p.version })),
      delegationsConsidered: (ctx.delegations || []).map((d) => d.id),
    };
  }
}

export function createPolicyEngine(dialect, deps) { return new PolicyEngine(dialect, deps); }
