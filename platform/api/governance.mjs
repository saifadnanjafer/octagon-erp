// platform/api/governance.mjs — Final Page Catalog · FP-2 governed reads for
// the workflow, approval, automation, and policy engines.
//
// Companion to platform/domains/governance-actions.mjs (writes). Read side
// only — every mutation stays on POST /api/v1/action/:actionId.
//
// Namespaces: `workflow`, `approvals`, `automation`, `policy`, `permissions`.
//
// `permissions/explain` is the one resource that is not a table read: it calls
// the SAME PermissionEvaluator that authorizes every other request
// (platform/authorization/evaluator/index.mjs), so "why was this denied" can
// never drift from what the server actually enforces.

'use strict';

const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function clampLimit(raw, max = 200) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return Math.min(50, max);
  return Math.min(Math.floor(n), max);
}

function json(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function rows(data) { return { data, meta: { total: Array.isArray(data) ? data.length : 1 } }; }

function scopedRows(dialect, table, ctx, { extraWhere = [], extraParams = [], order = 'created_at DESC', limit = 100, companyColumn = 'company_id' } = {}) {
  if (!SAFE_IDENT.test(table) || !SAFE_IDENT.test(companyColumn)) throw new Error('GOVERNANCE_QUERY_INVALID');
  const clauses = [];
  const params = [];
  if (ctx.companyId) {
    clauses.push(`(${companyColumn} IS NULL OR ${companyColumn} = ?)`);
    params.push(ctx.companyId);
  }
  clauses.push(...extraWhere);
  params.push(...extraParams);
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return dialect.prepare(`SELECT * FROM ${table} ${where} ORDER BY ${order} LIMIT ?`).all(...params, limit);
}

// --------------------------------------------------------------- workflow --

function handleWorkflowQuery({ dialect, ctx, resource, recordId, query, deps }) {
  if (resource === 'definitions') {
    if (recordId) {
      const def = deps.workflowRegistry?.get(recordId);
      if (!def) return { error: 'workflow definition not found', status: 404 };
      const version = def.activeVersion ? deps.workflowRegistry.getVersion(recordId, def.activeVersion) : null;
      return { data: { ...def, activeVersionDetail: version }, meta: null };
    }
    const list = dialect.prepare('SELECT id, module_id, name, label_ar, entity, active_version, status, created_at FROM workflow_definitions ORDER BY created_at DESC LIMIT ?').all(clampLimit(query.limit));
    return rows(list);
  }
  if (resource === 'instances') {
    const list = scopedRows(dialect, 'workflow_instances', ctx, {
      order: 'started_at DESC', limit: clampLimit(query.limit),
      ...(query.definition_id ? { extraWhere: ['definition_id = ?'], extraParams: [String(query.definition_id)] } : {}),
    });
    return rows(list.map((r) => ({ ...r, context: json(r.context, {}) })));
  }
  if (resource === 'instance-steps' && query.instance_id) {
    const list = dialect.prepare('SELECT * FROM workflow_steps WHERE instance_id = ? ORDER BY cursor ASC').all(query.instance_id);
    return rows(list);
  }
  return { error: 'unknown workflow resource', status: 404 };
}

// -------------------------------------------------------------- approvals --

function handleApprovalsQuery({ dialect, ctx, resource, recordId, query, deps }) {
  if (!deps.approvalEngine) return { error: 'MODULE_NOT_INSTALLED: approval engine unavailable', status: 409 };
  if (resource === 'policies') {
    const list = dialect.prepare(`
      SELECT id, module_id, entity, action, label_ar, mode, quorum, amount_threshold, escalate_role,
             maker_checker, allow_return, company_id, status, created_at
      FROM approval_policies WHERE (company_id IS NULL OR company_id = ?) ORDER BY created_at DESC LIMIT ?
    `).all(ctx.companyId || null, clampLimit(query.limit));
    return rows(list);
  }
  if (resource === 'worklist') {
    const box = query.box || 'todo';
    if (!ctx.userId) return { error: 'COMPANY_SCOPE_REQUIRED: an authenticated actor is required', status: 403 };
    try {
      const list = deps.approvalEngine.worklist(box, {
        actorId: ctx.userId, activeCompanyId: ctx.companyId, companyMemberships: ctx.companyId ? [ctx.companyId] : [],
      }, { limit: clampLimit(query.limit), offset: Number(query.offset) || 0 });
      return rows(list);
    } catch (error) {
      return { error: String(error.message || error), status: 400 };
    }
  }
  if (resource === 'counts') {
    if (!ctx.userId) return { error: 'COMPANY_SCOPE_REQUIRED: an authenticated actor is required', status: 403 };
    const counts = deps.approvalEngine.counts({
      actorId: ctx.userId, activeCompanyId: ctx.companyId, companyMemberships: ctx.companyId ? [ctx.companyId] : [],
    });
    return { data: counts, meta: null };
  }
  if (resource === 'decisions' && query.request_id) {
    const list = dialect.prepare('SELECT * FROM approval_decisions WHERE request_id = ? ORDER BY decided_at ASC').all(query.request_id);
    return rows(list);
  }
  return { error: 'unknown approvals resource', status: 404 };
}

// ------------------------------------------------------------- automation --

function handleAutomationQuery({ dialect, ctx, resource, query }) {
  if (resource === 'rules') {
    const list = scopedRows(dialect, 'automation_rules', ctx, { order: 'created_at DESC', limit: clampLimit(query.limit) });
    return rows(list.map((r) => ({
      ...r, trigger_config: json(r.trigger_config, {}), precondition: json(r.precondition, {}), postcondition: json(r.postcondition, {}),
    })));
  }
  if (resource === 'runs' && query.rule_id) {
    const list = dialect.prepare('SELECT * FROM automation_runs WHERE rule_id = ? ORDER BY occurred_at DESC LIMIT ?').all(query.rule_id, clampLimit(query.limit));
    return rows(list);
  }
  return { error: 'unknown automation resource', status: 404 };
}

// ----------------------------------------------------------------- policy --

function handlePolicyQuery({ dialect, ctx, resource, deps, query }) {
  if (!deps.policyEngine) return { error: 'MODULE_NOT_INSTALLED: policy engine unavailable', status: 409 };
  if (resource === 'delegations') {
    if (!ctx.userId) return { error: 'COMPANY_SCOPE_REQUIRED: an authenticated actor is required', status: 403 };
    if (query.for_user_id) {
      const list = deps.policyEngine.activeDelegationsFor(query.for_user_id, ctx.companyId || null);
      return rows(list);
    }
    const list = dialect.prepare(`
      SELECT * FROM policy_delegations
      WHERE (from_user_id = ? OR to_user_id = ?) AND (company_id IS NULL OR company_id = ?)
      ORDER BY created_at DESC LIMIT ?
    `).all(ctx.userId, ctx.userId, ctx.companyId || null, clampLimit(query.limit));
    return rows(list);
  }
  if (resource === 'authority-limits') {
    const list = scopedRows(dialect, 'policy_authority_limits', ctx, { order: 'created_at DESC', limit: clampLimit(query.limit) });
    return rows(list);
  }
  if (resource === 'sod-rules') {
    return rows(deps.policyEngine.activeSodRules());
  }
  if (resource === 'coverage-report') {
    const sensitive = String(query.permissions || '').split(',').map((s) => s.trim()).filter(Boolean);
    return { data: deps.policyEngine.coverageReport(sensitive), meta: null };
  }
  if (resource === 'conflict-report') {
    return { data: deps.policyEngine.conflictReport(), meta: null };
  }
  return { error: 'unknown policy resource', status: 404 };
}

// ------------------------------------------------------------- permissions --

/**
 * `permissions/explain` — the read-only "why was this allowed/denied" view.
 *
 * Calls the live PermissionEvaluator, the exact function every other request
 * is authorized through. Never mutates, never bypasses; it answers the
 * question with the same decision object the real request would get.
 *
 * Requires `permission` (the token being explained). `for_user_id` lets an
 * administrator explain another user's access; without it the caller's own
 * context is used. Explaining another user's access is itself permission-
 * gated by the router (platform:db:read + permissions.view) — this function
 * does not additionally check who may ask.
 */
function handlePermissionsQuery({ dialect, ctx, resource, query, deps }) {
  if (resource !== 'explain') return { error: 'unknown permissions resource', status: 404 };
  if (!deps.evaluator) return { error: 'MODULE_NOT_INSTALLED: evaluator unavailable', status: 409 };
  const permission = query.permission;
  if (!permission) return { error: 'permission is required', status: 400 };

  const targetCtx = query.for_user_id && query.for_user_id !== ctx.userId
    ? { ...ctx, userId: query.for_user_id, actorId: query.for_user_id }
    : ctx;

  const decision = deps.evaluator.evaluate({
    permission,
    ctx: targetCtx,
    entity: query.entity || null,
    recordId: query.record_id || null,
    amount: query.amount ? Number(query.amount) : null,
    state: query.state || null,
  });
  return { data: decision, meta: null };
}

export function handleGovernanceQuery({ dialect, ctx, deps, namespace, resource, recordId = null, query = {} }) {
  try {
    if (namespace === 'workflow') return handleWorkflowQuery({ dialect, ctx, resource, recordId, query, deps });
    if (namespace === 'approvals') return handleApprovalsQuery({ dialect, ctx, resource, recordId, query, deps });
    if (namespace === 'automation') return handleAutomationQuery({ dialect, ctx, resource, query });
    if (namespace === 'policy') return handlePolicyQuery({ dialect, ctx, resource, deps, query });
    if (namespace === 'permissions') return handlePermissionsQuery({ dialect, ctx, resource, query, deps });
    return { error: 'unknown governance namespace', status: 404 };
  } catch (error) {
    if (/no such table/i.test(String(error?.message))) {
      return { error: `MODULE_NOT_INSTALLED: ${error.message}`, status: 409 };
    }
    return { error: String(error?.message || error), status: 500 };
  }
}

export const GOVERNANCE_NAMESPACES = Object.freeze(['workflow', 'approvals', 'automation', 'policy', 'permissions']);
