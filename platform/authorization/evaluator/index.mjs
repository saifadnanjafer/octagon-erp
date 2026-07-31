// Canonical permission evaluator — Phase 02 packets 02.07 – 02.10.
//
// THIS IS THE ONLY SERVER AUTHORIZATION DECISION POINT. API routes, domain
// commands, exports, reports, files, workflow tasks, jobs, AI tools, and
// webhooks all call `evaluate()` and receive the same PermissionDecision (§ 15).
//
// Source composition:
// - VNext vnext/server/acl/acl-engine.js (project-owned, MERGE-CANONICAL):
//   scopeFor()'s "best scope wins" grant resolution, SCOPE_RANK ordering,
//   rowScopeAllows(), maskFields(), checkForbiddenWrites(). All four behaviors
//   are preserved; the engine adds explicit DENY precedence, document-state
//   checks, module/feature gating, approval requirements, reason codes, decision
//   ids, and caching.
// - Odoo odoo/addons/base/models/ir_rule.py (clean-room): record rules are
//   combined per model and are ALWAYS applied on read paths, not only writes.
// - NocoBase packages/core/acl/src/acl.ts (clean-room): the decision object
//   carries the field partition, not just a boolean.
// - RuoYi data-scope (MIT reference, behavior only): dept/own/company scope ranks.
//
// Invariants enforced here (§ 9):
//   1. unknown sensitive permission -> DENY (PERMISSION_UNKNOWN)
//   2. explicit deny beats any allow, at any scope
//   3. disabled module -> DENY regardless of grants
//   4. document-state constraints are part of the decision, not a later check
//   5. no request-body input reaches this function — it takes a DecisionContext
//   6. there is NO loopback, environment, or header branch anywhere in this file

'use strict';

import crypto from 'node:crypto';
import { permissionMatches } from '../registry/index.mjs';

export class AuthorizationError extends Error {
  constructor(decision) {
    super(decision.message || `permission denied: ${decision.permission}`);
    this.name = 'AuthorizationError';
    this.code = decision.reasonCode;
    this.statusCode = decision.reasonCode === 'NO_CONTEXT' ? 401 : 403;
    this.decision = decision;
  }
}

/** Broader scope wins when several grants match. Preserved from VNext SCOPE_RANK. */
export const SCOPE_RANK = Object.freeze({
  all: 100, tenant: 90, company: 80, branch: 70, department: 60,
  warehouse: 50, project: 45, team: 40, assignee: 30, own: 20,
});

export const REASON = Object.freeze({
  ALLOWED: 'ALLOWED',
  NO_CONTEXT: 'NO_CONTEXT',
  PERMISSION_UNKNOWN: 'PERMISSION_UNKNOWN',
  PERMISSION_RETIRED: 'PERMISSION_RETIRED',
  NO_GRANT: 'NO_GRANT',
  EXPLICIT_DENY: 'EXPLICIT_DENY',
  MODULE_DISABLED: 'MODULE_DISABLED',
  FEATURE_DISABLED: 'FEATURE_DISABLED',
  COMPANY_NOT_A_MEMBERSHIP: 'COMPANY_NOT_A_MEMBERSHIP',
  TENANT_MISMATCH: 'TENANT_MISMATCH',
  DOCUMENT_STATE_DENIED: 'DOCUMENT_STATE_DENIED',
  RECORD_OUT_OF_SCOPE: 'RECORD_OUT_OF_SCOPE',
  FIELD_WRITE_DENIED: 'FIELD_WRITE_DENIED',
  API_KEY_SCOPE_DENIED: 'API_KEY_SCOPE_DENIED',
  APPROVAL_REQUIRED: 'APPROVAL_REQUIRED',
  SOD_CONFLICT: 'SOD_CONFLICT',
  AUTHORITY_LIMIT_EXCEEDED: 'AUTHORITY_LIMIT_EXCEEDED',
  ROUTE_NOT_COVERED: 'ROUTE_NOT_COVERED',
});

/** Safe user-facing messages. A denial never leaks why a record exists. */
const MESSAGES = {
  [REASON.NO_CONTEXT]: 'مطلوب تسجيل الدخول للوصول إلى هذا المورد',
  [REASON.PERMISSION_UNKNOWN]: 'ليس لديك صلاحية تنفيذ هذا الإجراء',
  [REASON.PERMISSION_RETIRED]: 'ليس لديك صلاحية تنفيذ هذا الإجراء',
  [REASON.NO_GRANT]: 'ليس لديك صلاحية تنفيذ هذا الإجراء',
  [REASON.EXPLICIT_DENY]: 'ليس لديك صلاحية تنفيذ هذا الإجراء',
  [REASON.MODULE_DISABLED]: 'هذه الوحدة غير مفعّلة',
  [REASON.FEATURE_DISABLED]: 'هذه الميزة غير مفعّلة',
  [REASON.COMPANY_NOT_A_MEMBERSHIP]: 'ليس لديك صلاحية على هذه الشركة',
  [REASON.TENANT_MISMATCH]: 'ليس لديك صلاحية تنفيذ هذا الإجراء',
  [REASON.DOCUMENT_STATE_DENIED]: 'لا يمكن تنفيذ هذا الإجراء على المستند في حالته الحالية',
  [REASON.RECORD_OUT_OF_SCOPE]: 'السجل غير موجود أو خارج نطاق صلاحيتك',
  [REASON.FIELD_WRITE_DENIED]: 'غير مسموح بكتابة حقل محمي',
  [REASON.API_KEY_SCOPE_DENIED]: 'مفتاح الوصول لا يملك هذا النطاق',
  [REASON.APPROVAL_REQUIRED]: 'هذا الإجراء يتطلب موافقة',
  [REASON.SOD_CONFLICT]: 'تعارض مع قواعد فصل المهام',
  [REASON.AUTHORITY_LIMIT_EXCEEDED]: 'تجاوز حد الصلاحية المالية',
  [REASON.ROUTE_NOT_COVERED]: 'ليس لديك صلاحية تنفيذ هذا الإجراء',
};

function decision(fields) {
  return Object.freeze({
    allowed: false,
    reasonCode: REASON.NO_GRANT,
    matchedGrants: [],
    matchedDenies: [],
    effectiveScopes: [],
    readableFields: null,
    writableFields: null,
    maskedFields: [],
    requiredApproval: false,
    policyReferences: [],
    decisionId: `dec_${crypto.randomUUID()}`,
    auditClassification: 'normal',
    ...fields,
    message: fields.message || MESSAGES[fields.reasonCode] || MESSAGES[REASON.NO_GRANT],
  });
}

export class PermissionEvaluator {
  /**
   * @param {object} dialect
   * @param {object} deps optional `{ permissionRegistry, featureFlags, policyEngine }`
   */
  constructor(dialect, deps = {}) {
    if (!dialect || typeof dialect.prepare !== 'function') throw new Error('dialect required');
    this.dialect = dialect;
    this.registry = deps.permissionRegistry || null;
    this.featureFlags = deps.featureFlags || null;
    this.policyEngine = deps.policyEngine || null;
    this.persistDecisions = deps.persistDecisions !== false;
    /** @type {Map<string,{value:any, version:number}>} */
    this.cache = new Map();
    this.cacheVersion = this.#currentVersion();
  }

  // --- cache invalidation ---------------------------------------------------
  // The cache key includes a version stamped from the authorization tables. Any
  // grant/assignment/role change bumps it, so a stale allow cannot survive a
  // revocation (§ 32 "stale cache invalidation").
  #currentVersion() {
    const row = this.dialect.prepare(`
      SELECT
        (SELECT COUNT(*) FROM authorization_grants) AS g,
        (SELECT COUNT(*) FROM authorization_role_assignments WHERE status='active') AS a,
        (SELECT COUNT(*) FROM authorization_roles WHERE status='active') AS r,
        (SELECT COUNT(*) FROM authorization_field_rules) AS f,
        (SELECT COUNT(*) FROM authorization_record_scopes) AS s,
        (SELECT COUNT(*) FROM organization_memberships WHERE status='active') AS m
    `).get();
    return `${row.g}.${row.a}.${row.r}.${row.f}.${row.s}.${row.m}`;
  }

  invalidate() {
    this.cache.clear();
    this.cacheVersion = this.#currentVersion();
  }

  #cached(key, produce) {
    const version = this.#currentVersion();
    if (version !== this.cacheVersion) {
      this.cache.clear();
      this.cacheVersion = version;
    }
    if (this.cache.has(key)) return this.cache.get(key);
    const value = produce();
    this.cache.set(key, value);
    return value;
  }

  // --- role and grant resolution -------------------------------------------

  effectiveRoleIds(ctx) {
    if (!ctx || !ctx.actorId) return [];
    const actorType = ctx.actorType === 'service' ? 'service' : 'user';
    const now = ctx.now || new Date().toISOString();
    return this.#cached(`roles:${actorType}:${ctx.actorId}:${ctx.activeCompanyId}`, () =>
      this.dialect.prepare(`
        SELECT DISTINCT a.role_id
        FROM authorization_role_assignments a
        JOIN authorization_roles r ON r.id = a.role_id AND r.status = 'active'
        WHERE a.user_id = ? AND a.status = 'active' AND a.actor_type = ?
          AND (a.company_id IS NULL OR a.company_id = ?)
          AND (a.valid_from IS NULL OR a.valid_from <= ?)
          AND (a.valid_to   IS NULL OR a.valid_to   >  ?)
      `).all(ctx.actorId, actorType, ctx.activeCompanyId || '', now, now).map((r) => r.role_id)
    );
  }

  #grantsFor(roleIds) {
    if (!roleIds.length) return [];
    const placeholders = roleIds.map(() => '?').join(',');
    return this.#cached(`grants:${roleIds.join(',')}`, () =>
      this.dialect.prepare(`
        SELECT id, role_id, permission, effect, scope, document_states, requires_approval
        FROM authorization_grants WHERE role_id IN (${placeholders})
      `).all(...roleIds).map((g) => ({ ...g, document_states: JSON.parse(g.document_states || '[]'), requires_approval: g.requires_approval === 1 }))
    );
  }

  // --- the decision ---------------------------------------------------------

  /**
   * @param {object} params
   *   permission   required token, e.g. `crm:crm_lead:create`
   *   ctx          DecisionContext from platform/identity/context
   *   entity       optional entity for field/record rules
   *   recordId     optional record for document-state and row-scope checks
   *   documentState optional explicit state (else read from x_doc_states)
   *   amount       optional monetary amount for authority limits
   *   fields       optional array of fields being written
   */
  evaluate(params) {
    const { permission, ctx, entity = null, recordId = null, documentState = null, amount = null, fields = null } = params || {};
    const base = {
      permission,
      auditClassification: 'normal',
    };

    if (!ctx || !ctx.actorId) return this.#finish(decision({ ...base, reasonCode: REASON.NO_CONTEXT }), params);

    // System context is the migration/job identity; it is never reachable from HTTP.
    if (ctx.actorType === 'system') {
      return this.#finish(decision({ ...base, allowed: true, reasonCode: REASON.ALLOWED, effectiveScopes: ['all'] }), params, false);
    }

    // 1. Registry: unknown or retired tokens fail closed.
    if (this.registry) {
      try {
        this.registry.assertKnown(permission);
      } catch (e) {
        const code = e.code === 'PERMISSION_RETIRED' ? REASON.PERMISSION_RETIRED : REASON.PERMISSION_UNKNOWN;
        return this.#finish(decision({ ...base, reasonCode: code, auditClassification: 'security' }), params);
      }
    }

    // 2. Module state. NOTE: an EMPTY enabledModules array means "nothing is
    // enabled", which must deny — treating empty as "unknown, allow" would be a
    // fail-open. Only a missing/non-array field (a legacy context that does not
    // carry module state at all) skips this check.
    const def = this.registry?.get(permission);
    if (def && Array.isArray(ctx.enabledModules) && !ctx.enabledModules.includes(def.moduleId)) {
      return this.#finish(decision({ ...base, reasonCode: REASON.MODULE_DISABLED }), params);
    }

    // 3. Service identities are bounded by their API key scopes, additionally to roles.
    if (ctx.actorType === 'service') {
      const scopes = ctx.apiKeyScopes || [];
      const scoped = scopes.some((s) => s === '*' || permissionMatches(s, permission));
      if (!scoped) return this.#finish(decision({ ...base, reasonCode: REASON.API_KEY_SCOPE_DENIED, auditClassification: 'security' }), params);
    }

    // 4. Grants, with explicit deny winning.
    const roleIds = this.effectiveRoleIds(ctx);
    const grants = this.#grantsFor(roleIds);
    const delegated = this.#delegatedGrants(ctx, permission);

    const denies = grants.filter((g) => g.effect === 'deny' && permissionMatches(g.permission, permission));
    if (denies.length) {
      return this.#finish(decision({
        ...base, reasonCode: REASON.EXPLICIT_DENY, auditClassification: 'security',
        matchedDenies: denies.map((d) => d.id),
      }), params);
    }

    const allows = grants.filter((g) => g.effect === 'allow' && permissionMatches(g.permission, permission));
    const allMatches = [...allows, ...delegated];
    if (!allMatches.length) {
      return this.#finish(decision({ ...base, reasonCode: REASON.NO_GRANT }), params);
    }

    // 5. Best (widest) scope wins — preserved VNext scopeFor() behavior.
    let best = allMatches[0];
    for (const g of allMatches) {
      if ((SCOPE_RANK[g.scope] || 0) > (SCOPE_RANK[best.scope] || 0)) best = g;
    }
    const effectiveScopes = [...new Set(allMatches.map((g) => g.scope))];

    // 6. Document-state constraint.
    let state = documentState;
    if (state === null && entity && recordId) state = this.#documentState(entity, recordId);
    const stateConstrained = allMatches.filter((g) => (g.document_states || []).length);
    if (stateConstrained.length && state) {
      const permitted = stateConstrained.some((g) => g.document_states.includes(state));
      const unconstrained = allMatches.some((g) => !(g.document_states || []).length);
      if (!permitted && !unconstrained) {
        return this.#finish(decision({
          ...base, reasonCode: REASON.DOCUMENT_STATE_DENIED,
          matchedGrants: allMatches.map((g) => g.id), effectiveScopes,
        }), params);
      }
    }

    // 7. Record row scope.
    if (entity && recordId) {
      const inScope = this.recordInScope({ entity, recordId, ctx, scope: best.scope, roleIds });
      if (!inScope) {
        return this.#finish(decision({
          ...base, reasonCode: REASON.RECORD_OUT_OF_SCOPE, auditClassification: 'security',
          matchedGrants: allMatches.map((g) => g.id), effectiveScopes,
        }), params);
      }
    }

    // 8. Field partition.
    const fieldPartition = entity ? this.fieldPartition(entity, roleIds) : { readable: null, writable: null, masked: [] };
    if (fields && fields.length && fieldPartition.denyWrite.length) {
      const violating = fields.filter((f) => fieldPartition.denyWrite.includes(f));
      if (violating.length) {
        return this.#finish(decision({
          ...base, reasonCode: REASON.FIELD_WRITE_DENIED, auditClassification: 'security',
          maskedFields: fieldPartition.masked, policyReferences: violating.map((f) => `field:${entity}.${f}`),
        }), params);
      }
    }

    // 9. Policy engine (authority limits, SoD) when wired.
    let requiredApproval = allMatches.some((g) => g.requires_approval);
    const policyReferences = [];
    if (this.policyEngine) {
      const verdict = this.policyEngine.evaluate({ permission, ctx, entity, recordId, amount, state });
      policyReferences.push(...(verdict.policyReferences || []));
      if (verdict.denied) {
        return this.#finish(decision({
          ...base, reasonCode: verdict.reasonCode || REASON.SOD_CONFLICT, auditClassification: 'security',
          policyReferences: verdict.policyReferences || [],
        }), params);
      }
      if (verdict.requiresApproval) requiredApproval = true;
    }

    return this.#finish(decision({
      ...base,
      allowed: true,
      reasonCode: REASON.ALLOWED,
      matchedGrants: allMatches.map((g) => g.id),
      effectiveScopes,
      readableFields: fieldPartition.readable,
      writableFields: fieldPartition.writable,
      maskedFields: fieldPartition.masked,
      requiredApproval,
      policyReferences,
    }), params);
  }

  /** Throwing wrapper for command paths. */
  require(params) {
    const d = this.evaluate(params);
    if (!d.allowed) throw new AuthorizationError(d);
    return d;
  }

  #delegatedGrants(ctx, permission) {
    const out = [];
    for (const d of ctx.delegations || []) {
      if (d.companyId && d.companyId !== ctx.activeCompanyId) continue;
      for (const p of d.permissions || []) {
        if (permissionMatches(p, permission)) {
          out.push({ id: `delegation:${d.id}`, role_id: `delegated:${d.fromUserId}`, permission: p, effect: 'allow', scope: 'company', document_states: [], requires_approval: false });
        }
      }
    }
    return out;
  }

  #documentState(entity, recordId) {
    try {
      const row = this.dialect.prepare('SELECT state FROM x_doc_states WHERE entity = ? AND record_id = ?').get(entity, recordId);
      return row ? row.state : null;
    } catch {
      return null;
    }
  }

  // --- record scope (packet 02.08) -----------------------------------------

  /**
   * Row-level predicate. Preserved and generalized from VNext rowScopeAllows():
   * 'all' passes, 'own' compares created_by, 'dept'/'department' compares the
   * record's department, plus company/branch/warehouse/project/assignee.
   */
  recordInScope({ entity, recordId, ctx, scope, roleIds = null }) {
    const row = this.dialect.prepare('SELECT company_id, created_by, data FROM x_records WHERE entity = ? AND id = ? AND removed = 0').get(entity, recordId);
    if (!row) return false;
    // Tenant/company containment is unconditional and cannot be widened by a grant.
    if (row.company_id && ctx.companyMemberships?.length && !ctx.companyMemberships.includes(row.company_id)) return false;

    const data = (() => { try { return JSON.parse(row.data || '{}'); } catch { return {}; } })();
    const explicit = roleIds ? this.#recordScopeRules(entity, roleIds) : [];
    const effectiveScope = explicit.length
      ? explicit.reduce((best, r) => ((SCOPE_RANK[r.scope_kind] || 0) > (SCOPE_RANK[best] || 0) ? r.scope_kind : best), scope)
      : scope;

    switch (effectiveScope) {
      case 'all':
      case 'tenant':
        return true;
      case 'company':
        return !row.company_id || row.company_id === ctx.activeCompanyId;
      case 'branch':
        return !data.branch_id || data.branch_id === ctx.activeBranchId;
      case 'department':
        return !!ctx.departmentId && String(data.department_id || data.department || '') === String(ctx.departmentId);
      case 'warehouse':
      case 'project':
      case 'team':
        return (ctx.operatingScopes || []).some((s) => s.id === (data.warehouse_id || data.project_id || data.team_id));
      case 'assignee':
        return String(data.assignee_id || data.assigned_to || '') === String(ctx.actorId);
      case 'employee':
        return String(data.employee_id || '') === String(ctx.actorId);
      case 'own':
        return row.created_by === ctx.actorId;
      case 'predicate': {
        const rule = explicit.find((r) => r.scope_kind === 'predicate');
        return rule ? this.#matchPredicate(JSON.parse(rule.predicate || '{}'), data, ctx) : false;
      }
      default:
        return false;
    }
  }

  #recordScopeRules(entity, roleIds) {
    if (!roleIds.length) return [];
    const placeholders = roleIds.map(() => '?').join(',');
    return this.dialect.prepare(`
      SELECT scope_kind, predicate FROM authorization_record_scopes
      WHERE entity = ? AND role_id IN (${placeholders})
    `).all(entity, ...roleIds);
  }

  /** Declarative predicate only — never SQL, never eval. */
  #matchPredicate(predicate, data, ctx) {
    for (const [field, spec] of Object.entries(predicate)) {
      const actual = data[field];
      const expected = typeof spec === 'string' && spec.startsWith('$ctx.') ? ctx[spec.slice(5)] : spec;
      if (Array.isArray(expected)) { if (!expected.includes(actual)) return false; }
      else if (String(actual) !== String(expected)) return false;
    }
    return true;
  }

  /**
   * Build a SQL scope filter for LIST/COUNT/EXPORT so a list can never return a
   * row a detail read would refuse (§ 9.3). Returns `{sql, params}` fragments the
   * repository appends — the caller cannot omit it because listScoped() below is
   * the only supported list path.
   */
  scopeFilter({ entity, ctx, scope = 'company' }) {
    const clauses = ['entity = ?', 'removed = 0'];
    const params = [entity];
    const companies = ctx.companyMemberships?.length ? ctx.companyMemberships : (ctx.activeCompanyId ? [ctx.activeCompanyId] : []);
    if (companies.length) {
      clauses.push(`(company_id IS NULL OR company_id IN (${companies.map(() => '?').join(',')}))`);
      params.push(...companies);
    } else {
      clauses.push('1 = 0'); // no membership -> no rows, never "all rows"
    }
    switch (scope) {
      case 'all':
      case 'tenant':
        break;
      case 'company':
        clauses.push('(company_id IS NULL OR company_id = ?)');
        params.push(ctx.activeCompanyId);
        break;
      case 'branch':
        clauses.push("(json_extract(data,'$.branch_id') IS NULL OR json_extract(data,'$.branch_id') = ?)");
        params.push(ctx.activeBranchId);
        break;
      case 'department':
        clauses.push("json_extract(data,'$.department_id') = ?");
        params.push(ctx.departmentId);
        break;
      case 'assignee':
        clauses.push("json_extract(data,'$.assignee_id') = ?");
        params.push(ctx.actorId);
        break;
      case 'own':
        clauses.push('created_by = ?');
        params.push(ctx.actorId);
        break;
      default:
        clauses.push('1 = 0');
    }
    return { sql: clauses.join(' AND '), params };
  }

  /** The ONLY supported scoped list path. Counts use the identical filter. */
  listScoped({ entity, ctx, permission, limit = 100, offset = 0 }) {
    const d = this.evaluate({ permission, ctx, entity });
    if (!d.allowed) throw new AuthorizationError(d);
    const scope = d.effectiveScopes.reduce((best, s) => ((SCOPE_RANK[s] || 0) > (SCOPE_RANK[best] || 0) ? s : best), 'own');
    const { sql, params } = this.scopeFilter({ entity, ctx, scope });
    const rows = this.dialect.prepare(`SELECT id, company_id, created_by, data FROM x_records WHERE ${sql} ORDER BY id LIMIT ? OFFSET ?`)
      .all(...params, limit, offset);
    const masked = rows.map((r) => ({
      id: r.id,
      companyId: r.company_id,
      data: this.maskRecord(entity, JSON.parse(r.data || '{}'), this.effectiveRoleIds(ctx)),
    }));
    return { rows: masked, decision: d };
  }

  countScoped({ entity, ctx, permission }) {
    const d = this.evaluate({ permission, ctx, entity });
    if (!d.allowed) throw new AuthorizationError(d);
    const scope = d.effectiveScopes.reduce((best, s) => ((SCOPE_RANK[s] || 0) > (SCOPE_RANK[best] || 0) ? s : best), 'own');
    const { sql, params } = this.scopeFilter({ entity, ctx, scope });
    const row = this.dialect.prepare(`SELECT COUNT(*) AS n FROM x_records WHERE ${sql}`).get(...params);
    return Number(row?.n || 0);
  }

  // --- field masking (packet 02.09) ----------------------------------------

  /**
   * Field partition for an entity given the actor's roles.
   * Precedence across roles is MOST RESTRICTIVE WINS: if any role says `none`,
   * the field is hidden even when another role says `read`. That is the opposite
   * of grant resolution and is deliberate — a mask is a protection, not a grant.
   */
  fieldPartition(entity, roleIds) {
    if (!roleIds || !roleIds.length) return { readable: null, writable: null, masked: [], hidden: [], denyWrite: [] };
    return this.#cached(`fields:${entity}:${roleIds.join(',')}`, () => {
      const placeholders = roleIds.map(() => '?').join(',');
      const rules = this.dialect.prepare(`
        SELECT field, access FROM authorization_field_rules WHERE entity = ? AND role_id IN (${placeholders})
      `).all(entity, ...roleIds);
      const RANK = { none: 0, masked: 1, read: 2, write: 3 };
      const strictest = new Map();
      for (const r of rules) {
        const cur = strictest.get(r.field);
        if (cur === undefined || RANK[r.access] < RANK[cur]) strictest.set(r.field, r.access);
      }
      const hidden = [];
      const masked = [];
      const denyWrite = [];
      for (const [field, access] of strictest) {
        if (access === 'none') { hidden.push(field); denyWrite.push(field); }
        else if (access === 'masked') { masked.push(field); denyWrite.push(field); }
        else if (access === 'read') { denyWrite.push(field); }
      }
      return { readable: null, writable: null, masked, hidden, denyWrite };
    });
  }

  /** Preserved from VNext maskValue(): keep 2 leading + 2 trailing characters. */
  static maskValue(value) {
    if (value == null) return value;
    const str = String(value);
    if (str.length <= 4) return '****';
    return `${str.slice(0, 2)}****${str.slice(-2)}`;
  }

  /**
   * Apply the field partition to a record. Used identically by detail reads,
   * lists, exports, reports, history, chatter, and notification payloads so
   * masking cannot be bypassed by choosing a different surface (§ 9.4).
   */
  maskRecord(entity, record, roleIds) {
    if (!record || typeof record !== 'object') return record;
    const { hidden, masked } = this.fieldPartition(entity, roleIds || []);
    if (!hidden.length && !masked.length) return record;
    const out = { ...record };
    for (const f of hidden) delete out[f];
    for (const f of masked) if (out[f] !== undefined) out[f] = PermissionEvaluator.maskValue(out[f]);
    return out;
  }

  /**
   * Reject a write to a protected field instead of silently dropping it
   * (§ 34 "write rejection rather than silent acceptance"). Preserved from
   * VNext checkForbiddenWrites(), generalized to the multi-role partition.
   */
  assertWritableFields(entity, payload, roleIds, existing = null) {
    const { hidden, masked, denyWrite } = this.fieldPartition(entity, roleIds || []);
    for (const field of denyWrite) {
      if (payload[field] === undefined) continue;
      if (hidden.includes(field) || masked.includes(field)) {
        throw new AuthorizationError(decision({
          permission: `${entity}:${field}:write`, reasonCode: REASON.FIELD_WRITE_DENIED,
          auditClassification: 'security', policyReferences: [`field:${entity}.${field}`],
        }));
      }
      // read-only field: unchanged values are tolerated, changes are refused
      const unchanged = existing && String(payload[field]) === String(existing[field]);
      const emptyOnCreate = !existing && (payload[field] === null || payload[field] === '');
      if (!unchanged && !emptyOnCreate) {
        throw new AuthorizationError(decision({
          permission: `${entity}:${field}:write`, reasonCode: REASON.FIELD_WRITE_DENIED,
          auditClassification: 'security', policyReferences: [`field:${entity}.${field}`],
        }));
      }
    }
    return true;
  }

  // --- decision evidence ----------------------------------------------------

  #finish(d, params, persist = true) {
    if (!this.persistDecisions || !persist) return d;
    // Only denials, sensitive allows, and SoD-tracked allows are persisted, so
    // the log stays evidence rather than a firehose. Every denial is always
    // recorded. An allow on a permission that participates in a transaction-time
    // segregation-of-duties rule MUST be recorded too — otherwise the maker's
    // own action leaves no trace and maker≠checker could never fire.
    const sodTracked = !!(d.allowed && params?.recordId && this.policyEngine?.isSodTracked?.(d.permission));
    const isSensitive = d.auditClassification === 'security' || !d.allowed || sodTracked;
    if (!isSensitive) return d;
    const ctx = params?.ctx || {};
    try {
      this.dialect.prepare(`
        INSERT INTO authorization_decisions (decision_id, occurred_at, actor_id, actor_type, tenant_id, company_id, branch_id,
          permission, resource, action, record_id, allowed, reason_code, matched_grants, matched_denies, effective_scopes,
          required_approval, policy_references, audit_classification, correlation_id, source_channel)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        d.decisionId, new Date().toISOString(), ctx.actorId || 'anonymous', ctx.actorType || 'unknown',
        ctx.tenantId || null, ctx.activeCompanyId || null, ctx.activeBranchId || null,
        String(d.permission || ''), params?.entity || null, String(d.permission || '').split(':').pop() || null,
        params?.recordId || null, d.allowed ? 1 : 0, d.reasonCode,
        JSON.stringify(d.matchedGrants), JSON.stringify(d.matchedDenies), JSON.stringify(d.effectiveScopes),
        d.requiredApproval ? 1 : 0, JSON.stringify(d.policyReferences), d.auditClassification,
        ctx.correlationId || null, ctx.sourceChannel || null
      );
    } catch { /* evidence write must never break the decision */ }
    return d;
  }
}

export function createPermissionEvaluator(dialect, deps) { return new PermissionEvaluator(dialect, deps); }
