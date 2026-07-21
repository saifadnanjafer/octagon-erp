// Business rules and automation — Phase 02 packet 02.21.
//
// Source composition:
// - Octagon modules/automation-engine.js (PRESERVE the intent: rules react to
//   record events and fire configured effects).
// - VNext workflow-engine.js (project-owned, MERGE-REFACTOR): the per-workflow
//   rate limit (60/minute) and the depth guard against trigger loops are
//   preserved as first-class rule columns.
// - Odoo addons/base_automation/models/base_automation.py (clean-room): the
//   BOUNDARY-CROSSING rule — a rule with a condition fires only on the
//   transition INTO the condition, not on every subsequent save while it stays
//   true. This is what stops a rule re-firing forever on unrelated edits.
// - NocoBase workflow trigger/instruction registries (clean-room).
//
// Invariants (§ 46, § 68):
//   - a rule may only invoke a REGISTERED action; it can never run SQL
//   - a rule can never write a frozen payroll/attendance entity
//   - a rule runs under an identity and is permission-checked like any caller
//   - every run is recorded, including the ones that were suppressed

'use strict';

import crypto from 'node:crypto';
import { compare, getPath, interpolateDeep, isFrozenEntity } from '../workflow/index.mjs';

export class AutomationError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'AutomationError';
    this.code = code;
    this.details = details;
  }
}

export const TRIGGER_KINDS = Object.freeze(['create', 'update', 'state_change', 'event', 'time']);

export class AutomationEngine {
  constructor(dialect, deps = {}) {
    this.dialect = dialect;
    this.actionExecutor = deps.actionExecutor || null;
    this.actions = deps.actionRegistry || null;
    this.evaluator = deps.evaluator || null;
    this.now = deps.now || (() => new Date());
  }

  #now() { return this.now().toISOString(); }

  defineRule({ id, moduleId, name, labelAr = null, entity, triggerKind, triggerConfig = {}, precondition = {},
    postcondition = {}, boundaryField = null, actionId, actionInput = {}, rateLimitPerMinute = 60, maxDepth = 5,
    tenantId = null, companyId = null, enabled = true }, actor = 'system') {
    if (!TRIGGER_KINDS.includes(triggerKind)) throw new AutomationError(`unknown trigger kind ${triggerKind}`, 'TRIGGER_KIND_INVALID', { triggerKind });
    if (!actionId) throw new AutomationError('a rule must name a registered action', 'RULE_ACTION_REQUIRED');
    if (this.actions && !this.actions.get(actionId)) {
      throw new AutomationError(`action ${actionId} is not registered`, 'RULE_ACTION_NOT_REGISTERED', { actionId });
    }
    if (isFrozenEntity(entity) || isFrozenEntity(triggerConfig.targetEntity)) {
      throw new AutomationError('الأتمتة لا تسمح بتعديل بيانات الموظفين أو الدوام أو الرواتب', 'RULE_TARGETS_FROZEN_ENTITY', { entity });
    }
    const ruleId = id || `rule_${name}`;
    this.dialect.prepare(`
      INSERT INTO automation_rules (id, module_id, name, label_ar, entity, trigger_kind, trigger_config, precondition,
        postcondition, boundary_field, action_id, action_input, rate_limit_per_minute, max_depth, tenant_id, company_id, enabled, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET label_ar=excluded.label_ar, trigger_config=excluded.trigger_config,
        precondition=excluded.precondition, postcondition=excluded.postcondition, boundary_field=excluded.boundary_field,
        action_id=excluded.action_id, action_input=excluded.action_input, rate_limit_per_minute=excluded.rate_limit_per_minute,
        max_depth=excluded.max_depth, enabled=excluded.enabled
    `).run(ruleId, moduleId, name, labelAr, entity, triggerKind, JSON.stringify(triggerConfig), JSON.stringify(precondition),
      JSON.stringify(postcondition), boundaryField, actionId, JSON.stringify(actionInput), rateLimitPerMinute, maxDepth,
      tenantId, companyId, enabled ? 1 : 0, this.#now(), actor);
    return this.getRule(ruleId);
  }

  getRule(id) {
    const r = this.dialect.prepare('SELECT * FROM automation_rules WHERE id = ?').get(id);
    if (!r) return null;
    return {
      id: r.id, moduleId: r.module_id, name: r.name, labelAr: r.label_ar, entity: r.entity,
      triggerKind: r.trigger_kind, triggerConfig: JSON.parse(r.trigger_config || '{}'),
      precondition: JSON.parse(r.precondition || '{}'), postcondition: JSON.parse(r.postcondition || '{}'),
      boundaryField: r.boundary_field, actionId: r.action_id, actionInput: JSON.parse(r.action_input || '{}'),
      rateLimitPerMinute: r.rate_limit_per_minute, maxDepth: r.max_depth,
      tenantId: r.tenant_id, companyId: r.company_id, enabled: r.enabled === 1,
    };
  }

  setEnabled(ruleId, enabled) {
    this.dialect.prepare('UPDATE automation_rules SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, ruleId);
    return this.getRule(ruleId);
  }

  #record({ ruleId, entity, recordId, eventKey, depth, outcome, detail, correlationId }) {
    try {
      this.dialect.prepare(`
        INSERT INTO automation_runs (id, rule_id, entity, record_id, event_key, depth, outcome, detail, correlation_id, occurred_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(`arun_${crypto.randomUUID()}`, ruleId, entity, recordId, eventKey, depth, outcome,
        detail ? JSON.stringify(detail) : null, correlationId, this.#now());
      return true;
    } catch (e) {
      // The unique index on (rule_id, event_key) makes duplicate delivery a no-op.
      if (String(e.message).includes('UNIQUE')) return false;
      throw e;
    }
  }

  #matches(condition, context) {
    if (!condition || !condition.path) return true;
    return compare(getPath(context, condition.path), condition.operator || 'eq', condition.value);
  }

  #rateLimited(rule) {
    const windowStart = new Date(this.now().getTime() - 60000).toISOString();
    const row = this.dialect.prepare("SELECT COUNT(*) AS n FROM automation_runs WHERE rule_id = ? AND outcome = 'executed' AND occurred_at > ?")
      .get(rule.id, windowStart);
    return Number(row.n) >= Number(rule.rateLimitPerMinute);
  }

  /**
   * Dispatch an event to every matching rule.
   *
   * `before`/`after` are the record states around the change; they drive the
   * boundary-crossing check. `depth` is carried through so an action that itself
   * triggers another event cannot recurse indefinitely.
   */
  dispatch({ entity, recordId, triggerKind, before = null, after = null, eventKey = null, depth = 1, ctx, dryRun = false }) {
    const rules = this.dialect.prepare(`
      SELECT id FROM automation_rules
      WHERE entity = ? AND trigger_kind = ? AND enabled = 1
        AND (tenant_id IS NULL OR tenant_id = ?)
        AND (company_id IS NULL OR company_id = ?)
      ORDER BY id
    `).all(entity, triggerKind, ctx?.tenantId || null, ctx?.activeCompanyId || null);

    const results = [];
    for (const { id } of rules) {
      results.push(this.#runRule(this.getRule(id), { entity, recordId, before, after, eventKey, depth, ctx, dryRun }));
    }
    return results;
  }

  #runRule(rule, { entity, recordId, before, after, eventKey, depth, ctx, dryRun }) {
    const context = { record: after || {}, before: before || {}, after: after || {}, entity, recordId };
    const base = { ruleId: rule.id, entity, recordId, eventKey, depth, correlationId: ctx?.correlationId || null };

    // 1. Recursion guard.
    if (depth > rule.maxDepth) {
      this.#record({ ...base, outcome: 'loop_blocked', detail: { maxDepth: rule.maxDepth } });
      return { ruleId: rule.id, outcome: 'loop_blocked' };
    }

    // 2. Precondition.
    if (!this.#matches(rule.precondition, context)) {
      this.#record({ ...base, outcome: 'skipped', detail: { reason: 'PRECONDITION_FALSE' } });
      return { ruleId: rule.id, outcome: 'skipped', reason: 'PRECONDITION_FALSE' };
    }

    // 3. Boundary crossing (Odoo base_automation semantics). When the rule
    //    declares a postcondition, it fires only on the TRANSITION into it: the
    //    condition must be false before and true after. A record that was
    //    already in the target state does not re-fire on an unrelated edit.
    if (rule.postcondition && rule.postcondition.path) {
      const wasTrue = before ? this.#matches(rule.postcondition, { ...context, record: before }) : false;
      const isTrue = this.#matches(rule.postcondition, { ...context, record: after || {} });
      if (!isTrue) {
        this.#record({ ...base, outcome: 'skipped', detail: { reason: 'POSTCONDITION_FALSE' } });
        return { ruleId: rule.id, outcome: 'skipped', reason: 'POSTCONDITION_FALSE' };
      }
      if (wasTrue) {
        this.#record({ ...base, outcome: 'boundary_not_crossed', detail: { field: rule.postcondition.path } });
        return { ruleId: rule.id, outcome: 'boundary_not_crossed' };
      }
    }

    // 4. Duplicate event suppression — the unique index does the real work.
    if (eventKey) {
      const fresh = this.#record({ ...base, outcome: dryRun ? 'dry_run' : 'executed', detail: { pending: true } });
      if (!fresh) return { ruleId: rule.id, outcome: 'skipped', reason: 'DUPLICATE_EVENT' };
    }

    // 5. Rate limit.
    if (this.#rateLimited(rule)) {
      if (eventKey) this.dialect.prepare("UPDATE automation_runs SET outcome = 'rate_limited' WHERE rule_id = ? AND event_key = ?").run(rule.id, eventKey);
      else this.#record({ ...base, outcome: 'rate_limited', detail: { limit: rule.rateLimitPerMinute } });
      return { ruleId: rule.id, outcome: 'rate_limited' };
    }

    const targetEntity = rule.triggerConfig.targetEntity || rule.entity;
    if (isFrozenEntity(targetEntity)) {
      if (eventKey) this.dialect.prepare("UPDATE automation_runs SET outcome = 'failed' WHERE rule_id = ? AND event_key = ?").run(rule.id, eventKey);
      else this.#record({ ...base, outcome: 'failed', detail: { reason: 'FROZEN_ENTITY' } });
      return { ruleId: rule.id, outcome: 'failed', reason: 'FROZEN_ENTITY' };
    }

    // 6. Authorization — a rule gets no free pass (§ 9.7).
    if (this.evaluator && ctx) {
      const permission = rule.triggerConfig.requiredPermission || `${targetEntity}:${rule.actionId}`;
      const decision = this.evaluator.evaluate({ permission, ctx, entity: targetEntity, recordId });
      if (!decision.allowed) {
        if (eventKey) this.dialect.prepare("UPDATE automation_runs SET outcome = 'failed' WHERE rule_id = ? AND event_key = ?").run(rule.id, eventKey);
        else this.#record({ ...base, outcome: 'failed', detail: { reason: decision.reasonCode } });
        return { ruleId: rule.id, outcome: 'failed', reason: decision.reasonCode };
      }
      if (decision.requiredApproval) {
        if (eventKey) this.dialect.prepare("UPDATE automation_runs SET outcome = 'skipped' WHERE rule_id = ? AND event_key = ?").run(rule.id, eventKey);
        else this.#record({ ...base, outcome: 'skipped', detail: { reason: 'APPROVAL_REQUIRED' } });
        return { ruleId: rule.id, outcome: 'skipped', reason: 'APPROVAL_REQUIRED' };
      }
    }

    // 7. Dry run / explain: report exactly what WOULD happen, change nothing.
    if (dryRun) {
      const explained = { actionId: rule.actionId, input: interpolateDeep(rule.actionInput, context), targetEntity, recordId };
      if (eventKey) this.dialect.prepare("UPDATE automation_runs SET outcome = 'dry_run', detail = ? WHERE rule_id = ? AND event_key = ?").run(JSON.stringify(explained), rule.id, eventKey);
      else this.#record({ ...base, outcome: 'dry_run', detail: explained });
      return { ruleId: rule.id, outcome: 'dry_run', would: explained };
    }

    // 8. Execute — through the registered action executor, never raw SQL.
    if (!this.actionExecutor) throw new AutomationError('no action executor is wired', 'ACTION_EXECUTOR_MISSING');
    try {
      const input = {
        ...interpolateDeep(rule.actionInput, context),
        record_id: recordId,
        idempotency_key: eventKey || `${rule.id}:${recordId}:${depth}:${crypto.randomUUID()}`,
      };
      const result = this.actionExecutor.execute(rule.actionId, input, { ...(ctx || {}), automationDepth: depth + 1 });
      if (eventKey) this.dialect.prepare("UPDATE automation_runs SET outcome = 'executed', detail = ? WHERE rule_id = ? AND event_key = ?").run(JSON.stringify({ result }), rule.id, eventKey);
      else this.#record({ ...base, outcome: 'executed', detail: { result } });
      return { ruleId: rule.id, outcome: 'executed', result };
    } catch (error) {
      // The action executor owns its own transaction, so a failure here has
      // already rolled back the business change; we only record the attempt.
      if (eventKey) this.dialect.prepare("UPDATE automation_runs SET outcome = 'failed', detail = ? WHERE rule_id = ? AND event_key = ?").run(JSON.stringify({ error: String(error.message || error) }), rule.id, eventKey);
      else this.#record({ ...base, outcome: 'failed', detail: { error: String(error.message || error) } });
      return { ruleId: rule.id, outcome: 'failed', error: String(error.message || error) };
    }
  }

  runs(ruleId, limit = 100) {
    return this.dialect.prepare('SELECT * FROM automation_runs WHERE rule_id = ? ORDER BY occurred_at DESC LIMIT ?').all(ruleId, limit);
  }

  /** Explain what a rule would do for a given record, without executing it. */
  explain(ruleId, { entity, recordId, before, after, ctx }) {
    const rule = this.getRule(ruleId);
    if (!rule) throw new AutomationError('rule not found', 'RULE_NOT_FOUND', { ruleId });
    return this.#runRule(rule, { entity: entity || rule.entity, recordId, before, after, eventKey: null, depth: 1, ctx, dryRun: true });
  }
}

export function createAutomationEngine(dialect, deps) { return new AutomationEngine(dialect, deps); }
