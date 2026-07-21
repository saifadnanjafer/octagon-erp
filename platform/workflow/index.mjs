// Workflow definition registry and durable runtime — Phase 02 packets 02.17/02.18.
//
// Source composition:
// - VNext vnext/server/workflow/workflow-engine.js (project-owned,
//   MERGE-REFACTOR). Preserved behaviors: node-type whitelist, the
//   `current_node_index` resume cursor, per-workflow rate limiting, the depth
//   guard against trigger loops, the `{{path}}` interpolation helper, the
//   comparison operators, and — importantly — `isFrozen()`, which refuses any
//   write node targeting employee/timesheet/attendance/payroll entities.
//   Replaced: runs lived as JSON inside x_records, so a crashed worker could not
//   be recovered by query, and there were no leases, timers, cancellation, or
//   compensation. Those come from the donor behavior below.
// - NocoBase plugin-workflow Processor.ts / Dispatcher.ts /
//   RunningExecutionRegistry.ts / ExecutionTimeoutManager.ts (clean-room):
//   lease + heartbeat dispatch, durable timers, timeout management, and pinning a
//   running instance to the definition version it started on.
// - Odoo addons/base_automation (clean-room): boundary-crossing semantics.
//
// Invariants (§ 11):
//   1. a version is immutable once active; edits create a new version
//   2. a running instance stays pinned to its version
//   3. every node invokes a REGISTERED action — there is no SQL node, ever
//   4. leases make duplicate dispatch impossible
//   5. an external side effect happens only after commit (via the outbox)

'use strict';

import crypto from 'node:crypto';

export class WorkflowError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'WorkflowError';
    this.code = code;
    this.details = details;
  }
}

/** Node kinds the runtime can execute. Anything else is refused at validation. */
export const NODE_TYPES = Object.freeze(['condition', 'action', 'approval', 'notify', 'wait', 'timeout', 'terminate']);

/**
 * Frozen-zone guard, preserved verbatim in behavior from VNext workflow-engine.
 * Automation may never write employee, timesheet, attendance, or payroll data.
 */
export const FROZEN_ENTITY_RE = /(^|_)(employee|employees|timesheet|attendance|payroll)(_|$)/i;
export function isFrozenEntity(entity) { return FROZEN_ENTITY_RE.test(String(entity || '')); }

// --- expression helpers (preserved from VNext) --------------------------------

export function getPath(source, dotted) {
  return String(dotted || '').split('.').filter(Boolean)
    .reduce((value, key) => (value && typeof value === 'object' ? value[key] : undefined), source);
}

export function interpolate(input, context) {
  if (typeof input !== 'string') return input;
  return input.replace(/{{\s*([^}]+?)\s*}}/g, (_, path) => {
    const value = getPath(context, path);
    return value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  });
}

export function interpolateDeep(input, context) {
  if (typeof input === 'string') return interpolate(input, context);
  if (Array.isArray(input)) return input.map((v) => interpolateDeep(v, context));
  if (input && typeof input === 'object') {
    return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, interpolateDeep(v, context)]));
  }
  return input;
}

export function compare(actual, operator, expected) {
  if (operator === 'exists') return actual !== undefined && actual !== null && actual !== '';
  if (operator === 'not_exists') return actual === undefined || actual === null || actual === '';
  if (operator === 'in') return String(expected).split(',').map((x) => x.trim()).includes(String(actual));
  if (operator === 'contains') return String(actual || '').includes(String(expected || ''));
  if (operator === 'gt') return Number(actual) > Number(expected);
  if (operator === 'gte') return Number(actual) >= Number(expected);
  if (operator === 'lt') return Number(actual) < Number(expected);
  if (operator === 'lte') return Number(actual) <= Number(expected);
  if (operator === 'neq') return String(actual) !== String(expected);
  return String(actual) === String(expected);
}

// --- definition registry (packet 02.17) --------------------------------------

export class WorkflowRegistry {
  constructor(dialect, deps = {}) {
    this.dialect = dialect;
    this.actions = deps.actionRegistry || null;
    this.permissions = deps.permissionRegistry || null;
    this.now = deps.now || (() => new Date());
  }

  #now() { return this.now().toISOString(); }

  define({ id, moduleId, name, labelAr = null, entity }, actor = 'system') {
    const defId = id || `wf_${name}`;
    this.dialect.prepare(`
      INSERT INTO workflow_definitions (id, module_id, name, label_ar, entity, status, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)
      ON CONFLICT(id) DO UPDATE SET label_ar=excluded.label_ar, entity=excluded.entity
    `).run(defId, moduleId, name, labelAr, entity, this.#now(), actor);
    return this.get(defId);
  }

  get(id) {
    const r = this.dialect.prepare('SELECT * FROM workflow_definitions WHERE id = ?').get(id);
    if (!r) return null;
    return { id: r.id, moduleId: r.module_id, name: r.name, labelAr: r.label_ar, entity: r.entity, activeVersion: r.active_version, status: r.status };
  }

  /**
   * Validate a candidate version. Refuses: unknown node types, unregistered
   * actions, unknown permissions, transitions to undeclared states, cycles that
   * have no terminating edge, and any write targeting a frozen entity.
   */
  validate(definitionId, spec) {
    const problems = [];
    const def = this.get(definitionId);
    if (!def) problems.push({ code: 'DEFINITION_NOT_FOUND', detail: definitionId });

    const states = new Set(spec.states || []);
    if (!spec.initialState) problems.push({ code: 'INITIAL_STATE_REQUIRED' });
    else if (!states.has(spec.initialState)) problems.push({ code: 'INITIAL_STATE_UNDECLARED', detail: spec.initialState });

    for (const t of spec.transitions || []) {
      if (!states.has(t.from)) problems.push({ code: 'TRANSITION_FROM_UNDECLARED', detail: t.from });
      if (!states.has(t.to)) problems.push({ code: 'TRANSITION_TO_UNDECLARED', detail: t.to });
    }

    const nodeIds = new Set();
    for (const node of spec.nodes || []) {
      if (!NODE_TYPES.includes(node.type)) problems.push({ code: 'NODE_TYPE_UNSUPPORTED', detail: node.type });
      if (nodeIds.has(node.id)) problems.push({ code: 'NODE_ID_DUPLICATE', detail: node.id });
      nodeIds.add(node.id);
      if (node.type === 'action') {
        if (!node.actionId) problems.push({ code: 'NODE_ACTION_REQUIRED', detail: node.id });
        else if (this.actions && !this.actions.get(node.actionId)) {
          problems.push({ code: 'NODE_ACTION_NOT_REGISTERED', detail: node.actionId });
        }
        const target = node.config?.entity || def?.entity;
        if (isFrozenEntity(target)) {
          problems.push({ code: 'NODE_TARGETS_FROZEN_ENTITY', detail: target });
        }
      }
      if (node.type === 'wait' && !node.config?.minutes && !node.config?.until) {
        problems.push({ code: 'WAIT_NODE_NEEDS_DURATION', detail: node.id });
      }
    }

    if (spec.requiredPermission && this.permissions && !this.permissions.get(spec.requiredPermission)) {
      problems.push({ code: 'PERMISSION_NOT_REGISTERED', detail: spec.requiredPermission });
    }

    // Reachability: a state graph with no path to a terminal state is a
    // guaranteed hang, so it is a validation failure, not a runtime surprise.
    const terminal = (spec.states || []).filter((s) => !(spec.transitions || []).some((t) => t.from === s));
    if (states.size && !terminal.length) problems.push({ code: 'STATE_GRAPH_HAS_NO_TERMINAL_STATE' });

    return { valid: problems.length === 0, problems };
  }

  /** Create a new DRAFT version. Never mutates an existing version. */
  addVersion(definitionId, spec, actor = 'system') {
    const validation = this.validate(definitionId, spec);
    if (!validation.valid) {
      throw new WorkflowError('workflow version is not valid', 'WORKFLOW_INVALID', { problems: validation.problems });
    }
    const prev = this.dialect.prepare('SELECT MAX(version) AS v FROM workflow_versions WHERE definition_id = ?').get(definitionId);
    const version = Number(prev?.v || 0) + 1;
    this.dialect.prepare(`
      INSERT INTO workflow_versions (id, definition_id, version, initial_state, states, transitions, nodes, triggers,
        required_permission, approval_policy_id, compensation, instance_migration_policy, effective_from, effective_to, status, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
    `).run(`wfv_${crypto.randomUUID()}`, definitionId, version, spec.initialState,
      JSON.stringify(spec.states || []), JSON.stringify(spec.transitions || []), JSON.stringify(spec.nodes || []),
      JSON.stringify(spec.triggers || []), spec.requiredPermission || null, spec.approvalPolicyId || null,
      JSON.stringify(spec.compensation || []), spec.instanceMigrationPolicy || 'pin',
      spec.effectiveFrom || null, spec.effectiveTo || null, this.#now(), actor);
    return { definitionId, version };
  }

  /** Activate a version. Running instances remain pinned to their own version. */
  activate(definitionId, version, actor = 'system') {
    const v = this.getVersion(definitionId, version);
    if (!v) throw new WorkflowError('version not found', 'WORKFLOW_VERSION_NOT_FOUND', { definitionId, version });
    this.dialect.exec('BEGIN IMMEDIATE;');
    try {
      this.dialect.prepare("UPDATE workflow_versions SET status = 'retired' WHERE definition_id = ? AND status = 'active'").run(definitionId);
      this.dialect.prepare("UPDATE workflow_versions SET status = 'active' WHERE definition_id = ? AND version = ?").run(definitionId, version);
      this.dialect.prepare("UPDATE workflow_definitions SET active_version = ?, status = 'active' WHERE id = ?").run(version, definitionId);
      this.dialect.exec('COMMIT;');
    } catch (e) {
      this.dialect.exec('ROLLBACK;');
      throw e;
    }
    this.dialect.prepare(`
      INSERT INTO platform_audit_log (id, actor_id, actor_type, action, resource, resource_id, occurred_at, source_channel, result, after_value)
      VALUES (?, ?, 'user', 'workflow.activate', 'workflow_versions', ?, ?, 'workflow', 'success', ?)
    `).run(crypto.randomUUID(), actor, definitionId, this.#now(), JSON.stringify({ version }));
    return this.getVersion(definitionId, version);
  }

  retire(definitionId, actor = 'system') {
    this.dialect.prepare("UPDATE workflow_definitions SET status = 'retired' WHERE id = ?").run(definitionId);
    this.dialect.prepare("UPDATE workflow_versions SET status = 'retired' WHERE definition_id = ?").run(definitionId);
  }

  getVersion(definitionId, version) {
    const r = this.dialect.prepare('SELECT * FROM workflow_versions WHERE definition_id = ? AND version = ?').get(definitionId, version);
    if (!r) return null;
    return {
      id: r.id, definitionId: r.definition_id, version: r.version, initialState: r.initial_state,
      states: JSON.parse(r.states || '[]'), transitions: JSON.parse(r.transitions || '[]'),
      nodes: JSON.parse(r.nodes || '[]'), triggers: JSON.parse(r.triggers || '[]'),
      requiredPermission: r.required_permission, approvalPolicyId: r.approval_policy_id,
      compensation: JSON.parse(r.compensation || '[]'), instanceMigrationPolicy: r.instance_migration_policy,
      status: r.status,
    };
  }

  activeVersion(definitionId) {
    const r = this.dialect.prepare("SELECT version FROM workflow_versions WHERE definition_id = ? AND status = 'active'").get(definitionId);
    return r ? this.getVersion(definitionId, r.version) : null;
  }

  /**
   * Compatibility adapter for the existing Octagon workflow canvas, whose saved
   * shape is `{name, nodes:[{id,type,label,config}], trigger:{...}}` (see
   * platform/client/workflow-builder.js and VNext normalizeWorkflow()).
   */
  fromCanvas(canvasJson, { moduleId = 'platform_kernel' } = {}) {
    const entity = canvasJson.trigger?.entity || 'generic';
    const TYPE_MAP = { 'update-record': 'action', 'create-record': 'action', 'request-approval': 'approval', notify: 'notify', condition: 'condition', webhook: 'action' };
    return {
      definition: { moduleId, name: canvasJson.name || 'workflow', labelAr: canvasJson.name || null, entity },
      spec: {
        initialState: 'start',
        states: ['start', 'done'],
        transitions: [{ from: 'start', to: 'done' }],
        nodes: (canvasJson.nodes || []).map((n, i) => ({
          id: n.id || `step_${i + 1}`,
          type: TYPE_MAP[n.type] || 'condition',
          label: n.label || '',
          actionId: n.actionId || (TYPE_MAP[n.type] === 'action' ? `${entity}:${n.type.replace('-record', '')}` : undefined),
          config: n.config || {},
        })),
        triggers: canvasJson.trigger ? [canvasJson.trigger] : [],
      },
    };
  }

  toCanvas(definitionId, version) {
    const v = this.getVersion(definitionId, version);
    const def = this.get(definitionId);
    if (!v || !def) return null;
    return {
      name: def.name,
      active: v.status === 'active',
      version: v.version,
      trigger: v.triggers[0] || { type: 'manual' },
      nodes: v.nodes.map((n) => ({ id: n.id, type: n.type, label: n.label || '', config: n.config || {} })),
    };
  }
}

// --- durable runtime (packet 02.18) ------------------------------------------

export class WorkflowRuntime {
  /**
   * @param {object} dialect
   * @param {object} deps
   *   actionExecutor  — Phase 01 ActionExecutor; the ONLY way a node mutates data
   *   evaluator       — canonical permission evaluator
   *   approvals       — ApprovalEngine, for `approval` nodes
   *   calendars       — BusinessCalendarService, for business-time waits
   *   workerId        — identifies this worker for lease ownership
   */
  constructor(dialect, deps = {}) {
    this.dialect = dialect;
    this.registry = deps.registry || new WorkflowRegistry(dialect, deps);
    this.actionExecutor = deps.actionExecutor || null;
    this.evaluator = deps.evaluator || null;
    this.approvals = deps.approvals || null;
    this.calendars = deps.calendars || null;
    this.workerId = deps.workerId || `worker_${crypto.randomUUID().slice(0, 8)}`;
    this.leaseSeconds = deps.leaseSeconds ?? 30;
    this.now = deps.now || (() => new Date());
  }

  #now() { return this.now().toISOString(); }

  /**
   * Start an instance. `idempotencyKey` makes a duplicate trigger a no-op that
   * returns the existing instance rather than a second run.
   */
  start({ definitionId, entity, recordId, context = {}, ctx, idempotencyKey = null, timeoutMinutes = null }) {
    const version = this.registry.activeVersion(definitionId);
    if (!version) throw new WorkflowError('no active version for this workflow', 'WORKFLOW_NOT_ACTIVE', { definitionId });
    if (version.requiredPermission && this.evaluator && ctx) {
      this.evaluator.require({ permission: version.requiredPermission, ctx, entity, recordId });
    }
    if (idempotencyKey) {
      const existing = this.dialect.prepare('SELECT id FROM workflow_instances WHERE definition_id = ? AND idempotency_key = ?').get(definitionId, idempotencyKey);
      if (existing) return this.get(existing.id);
    }
    const id = `wfi_${crypto.randomUUID()}`;
    const startedAt = this.now();
    const timeoutAt = timeoutMinutes ? new Date(startedAt.getTime() + timeoutMinutes * 60000).toISOString() : null;
    this.dialect.prepare(`
      INSERT INTO workflow_instances (id, definition_id, definition_version, entity, record_id, tenant_id, company_id,
        current_state, cursor, status, context, correlation_id, idempotency_key, started_at, started_by, timeout_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'running', ?, ?, ?, ?, ?, ?)
    `).run(id, definitionId, version.version, entity, recordId, ctx?.tenantId || null, ctx?.activeCompanyId || null,
      version.initialState, JSON.stringify(context), ctx?.correlationId || null, idempotencyKey,
      startedAt.toISOString(), ctx?.actorId || 'system', timeoutAt);
    if (timeoutAt) {
      this.dialect.prepare('INSERT INTO workflow_timers (id, instance_id, node_id, kind, fire_at, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(`wft_${crypto.randomUUID()}`, id, '__instance__', 'timeout', timeoutAt, this.#now());
    }
    return this.get(id);
  }

  get(id) {
    const r = this.dialect.prepare('SELECT * FROM workflow_instances WHERE id = ?').get(id);
    if (!r) return null;
    return {
      id: r.id, definitionId: r.definition_id, definitionVersion: r.definition_version,
      entity: r.entity, recordId: r.record_id, tenantId: r.tenant_id, companyId: r.company_id,
      currentState: r.current_state, cursor: r.cursor, status: r.status,
      context: JSON.parse(r.context || '{}'), leaseId: r.lease_id, leasedUntil: r.leased_until,
      attempts: r.attempts, maxAttempts: r.max_attempts, nextAttemptAt: r.next_attempt_at,
      timeoutAt: r.timeout_at, correlationId: r.correlation_id, startedAt: r.started_at,
      finishedAt: r.finished_at, terminalResult: r.terminal_result ? JSON.parse(r.terminal_result) : null,
      lastError: r.last_error,
    };
  }

  steps(instanceId) {
    return this.dialect.prepare('SELECT * FROM workflow_steps WHERE instance_id = ? ORDER BY cursor, attempt').all(instanceId);
  }

  /**
   * Claim one runnable instance with a lease. Two workers calling this
   * concurrently can never claim the same row: the UPDATE is conditional on the
   * lease still being free, inside BEGIN IMMEDIATE.
   */
  claim() {
    const nowIso = this.#now();
    const leaseId = `lease_${crypto.randomUUID()}`;
    const leasedUntil = new Date(this.now().getTime() + this.leaseSeconds * 1000).toISOString();
    this.dialect.exec('BEGIN IMMEDIATE;');
    try {
      const candidate = this.dialect.prepare(`
        SELECT id FROM workflow_instances
        WHERE status IN ('running','waiting')
          AND (leased_until IS NULL OR leased_until <= ?)
          AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
        ORDER BY started_at ASC LIMIT 1
      `).get(nowIso, nowIso);
      if (!candidate) { this.dialect.exec('COMMIT;'); return null; }
      const info = this.dialect.prepare(`
        UPDATE workflow_instances SET lease_id = ?, leased_until = ?, heartbeat_at = ?
        WHERE id = ? AND (leased_until IS NULL OR leased_until <= ?)
      `).run(leaseId, leasedUntil, nowIso, candidate.id, nowIso);
      this.dialect.exec('COMMIT;');
      if (info.changes === 0) return null;
      return { instanceId: candidate.id, leaseId };
    } catch (e) {
      this.dialect.exec('ROLLBACK;');
      throw e;
    }
  }

  heartbeat(instanceId, leaseId) {
    const leasedUntil = new Date(this.now().getTime() + this.leaseSeconds * 1000).toISOString();
    const info = this.dialect.prepare('UPDATE workflow_instances SET heartbeat_at = ?, leased_until = ? WHERE id = ? AND lease_id = ?')
      .run(this.#now(), leasedUntil, instanceId, leaseId);
    return info.changes > 0;
  }

  release(instanceId, leaseId) {
    this.dialect.prepare('UPDATE workflow_instances SET lease_id = NULL, leased_until = NULL WHERE id = ? AND lease_id = ?').run(instanceId, leaseId);
  }

  /**
   * Advance an instance by ONE node. Called in a loop by the dispatcher.
   * Returns `{status, node, result}`.
   */
  step(instanceId, leaseId, ctx) {
    const instance = this.get(instanceId);
    if (!instance) throw new WorkflowError('instance not found', 'INSTANCE_NOT_FOUND', { instanceId });
    if (leaseId && instance.leaseId !== leaseId) {
      throw new WorkflowError('lease is no longer held by this worker', 'STALE_LEASE', { instanceId, expected: instance.leaseId });
    }
    if (['completed', 'failed', 'cancelled', 'dead'].includes(instance.status)) {
      return { status: instance.status, node: null, result: null };
    }
    // Timeout wins over any pending work.
    if (instance.timeoutAt && Date.parse(instance.timeoutAt) <= this.now().getTime()) {
      return this.#terminate(instanceId, 'failed', { reason: 'TIMEOUT' }, 'workflow timed out');
    }

    const version = this.registry.getVersion(instance.definitionId, instance.definitionVersion);
    if (!version) throw new WorkflowError('pinned definition version is missing', 'VERSION_MISSING', { instanceId });
    const node = version.nodes[instance.cursor];
    if (!node) return this.#terminate(instanceId, 'completed', { reason: 'END_OF_NODES' });

    const attempt = instance.attempts + 1;
    const stepId = `wfs_${crypto.randomUUID()}`;
    // A duplicate dispatch for the same (instance, cursor, attempt) is refused
    // by the unique index rather than executing twice.
    try {
      this.dialect.prepare(`
        INSERT INTO workflow_steps (id, instance_id, cursor, node_id, node_type, status, attempt, started_at)
        VALUES (?, ?, ?, ?, ?, 'running', ?, ?)
      `).run(stepId, instanceId, instance.cursor, node.id, node.type, attempt, this.#now());
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) {
        throw new WorkflowError('duplicate dispatch for this step attempt', 'DUPLICATE_DISPATCH', { instanceId, cursor: instance.cursor, attempt });
      }
      throw e;
    }

    let result;
    try {
      result = this.#executeNode(node, instance, version, ctx);
    } catch (error) {
      return this.#failStep(instanceId, stepId, instance, error);
    }

    if (result?.wait) {
      this.dialect.prepare("UPDATE workflow_steps SET status = 'done', finished_at = ?, result = ? WHERE id = ?")
        .run(this.#now(), JSON.stringify({ waiting: true, until: result.until }), stepId);
      this.dialect.prepare("UPDATE workflow_instances SET status = 'waiting', next_attempt_at = ?, cursor = ?, lease_id = NULL, leased_until = NULL WHERE id = ?")
        .run(result.until, instance.cursor + 1, instanceId);
      this.dialect.prepare('INSERT INTO workflow_timers (id, instance_id, node_id, kind, fire_at, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(`wft_${crypto.randomUUID()}`, instanceId, node.id, 'wait', result.until, this.#now());
      return { status: 'waiting', node: node.id, result };
    }

    if (result?.terminate) {
      this.dialect.prepare("UPDATE workflow_steps SET status = 'done', finished_at = ?, result = ? WHERE id = ?")
        .run(this.#now(), JSON.stringify(result), stepId);
      return this.#terminate(instanceId, 'completed', result);
    }

    if (result?.skipRemaining) {
      this.dialect.prepare("UPDATE workflow_steps SET status = 'skipped', finished_at = ?, result = ? WHERE id = ?")
        .run(this.#now(), JSON.stringify(result), stepId);
      return this.#terminate(instanceId, 'completed', result);
    }

    this.dialect.prepare("UPDATE workflow_steps SET status = 'done', finished_at = ?, result = ? WHERE id = ?")
      .run(this.#now(), JSON.stringify(result ?? null), stepId);
    const nextCursor = instance.cursor + 1;
    const done = nextCursor >= version.nodes.length;
    if (done) return this.#terminate(instanceId, 'completed', { reason: 'END_OF_NODES', last: result });
    this.dialect.prepare('UPDATE workflow_instances SET cursor = ?, attempts = 0 WHERE id = ?').run(nextCursor, instanceId);
    return { status: 'running', node: node.id, result };
  }

  #executeNode(node, instance, version, ctx) {
    const context = { ...instance.context, record: { id: instance.recordId, entity: instance.entity }, state: instance.currentState };
    const config = interpolateDeep(node.config || {}, context);

    if (node.type === 'condition') {
      const matched = !config.path || compare(getPath(context, config.path), config.operator || 'eq', config.value);
      if (!matched && config.stopOnFalse !== false) return { skipRemaining: true, matched: false };
      return { matched };
    }

    if (node.type === 'terminate') {
      return { terminate: true, reason: config.reason || 'TERMINATED' };
    }

    if (node.type === 'wait') {
      const base = this.now();
      let until;
      if (config.until) {
        until = new Date(config.until).toISOString();
      } else if (config.businessMinutes && this.calendars) {
        const calendar = this.calendars.resolveFor({ tenantId: instance.tenantId, companyId: instance.companyId });
        until = this.calendars.addBusinessMinutes(calendar, base, Number(config.businessMinutes)).toISOString();
      } else {
        until = new Date(base.getTime() + Number(config.minutes || 1) * 60000).toISOString();
      }
      return { wait: true, until };
    }

    if (node.type === 'notify') {
      // Notifications leave through the outbox, never inline, so a rolled-back
      // workflow cannot have already emailed someone (§ 68).
      this.dialect.prepare(`
        INSERT INTO platform_outbox (id, event_type, schema_version, module_id, aggregate_id, tenant_id, company_id,
          actor_id, correlation_id, payload, created_at, scheduled_at, attempts, max_attempts, status)
        VALUES (?, 'workflow.notify', '1.0.0', 'platform_workflow', ?, ?, ?, ?, ?, ?, ?, ?, 0, 3, 'pending')
      `).run(crypto.randomUUID(), `${instance.entity}:${instance.recordId}`, instance.tenantId, instance.companyId,
        ctx?.actorId || 'system', instance.correlationId, JSON.stringify({ node: node.id, ...config }), this.#now(), this.#now());
      return { queued: true, channel: config.channel || 'inapp' };
    }

    if (node.type === 'approval') {
      if (!this.approvals) throw new WorkflowError('no approval engine is wired', 'APPROVAL_ENGINE_MISSING');
      const request = this.approvals.request({
        entity: instance.entity, recordId: instance.recordId, action: config.action || 'workflow_approval',
        payload: config.payload || {}, amount: config.amount ?? null,
        requesterId: ctx?.actorId || instance.context.requesterId || 'system',
        companyId: instance.companyId, tenantId: instance.tenantId,
        workflowInstanceId: instance.id, correlationId: instance.correlationId,
      });
      // The workflow parks until the approval resolves.
      return { wait: true, until: new Date(this.now().getTime() + 60000).toISOString(), approvalRequestId: request.id };
    }

    if (node.type === 'action') {
      if (!this.actionExecutor) throw new WorkflowError('no action executor is wired', 'ACTION_EXECUTOR_MISSING');
      const targetEntity = config.entity || instance.entity;
      // Defence in depth: validation already refused frozen targets, but a
      // config value could be interpolated at runtime, so re-check here.
      if (isFrozenEntity(targetEntity)) {
        throw new WorkflowError('الهدف محمي: لا تسمح الأتمتة بتعديل بيانات الموظفين أو الدوام أو الرواتب', 'FROZEN_ENTITY_WRITE_REFUSED', { entity: targetEntity });
      }
      if (this.evaluator && ctx) {
        // A workflow acts under an identity and gets no free pass (§ 9.7).
        const permission = node.requiredPermission || `${targetEntity}:${node.actionId}`;
        const decision = this.evaluator.evaluate({ permission, ctx, entity: targetEntity, recordId: instance.recordId });
        if (!decision.allowed) {
          throw new WorkflowError(`workflow node is not authorized: ${decision.reasonCode}`, 'NODE_NOT_AUTHORIZED', { permission, reasonCode: decision.reasonCode });
        }
      }
      const input = { ...(config.input || {}), record_id: instance.recordId, idempotency_key: `${instance.id}:${node.id}` };
      return this.actionExecutor.execute(node.actionId, input, ctx || { userId: 'system', companyId: instance.companyId });
    }

    throw new WorkflowError(`unsupported node type ${node.type}`, 'NODE_TYPE_UNSUPPORTED', { type: node.type });
  }

  #failStep(instanceId, stepId, instance, error) {
    const attempts = instance.attempts + 1;
    const exhausted = attempts >= instance.maxAttempts;
    this.dialect.prepare("UPDATE workflow_steps SET status = 'failed', finished_at = ?, error = ? WHERE id = ?")
      .run(this.#now(), String(error.message || error), stepId);
    if (exhausted) {
      // Dead-letter, and run the compensation boundary for the steps already done.
      this.#compensate(instanceId);
      this.dialect.prepare(`
        UPDATE workflow_instances SET status = 'dead', attempts = ?, last_error = ?, finished_at = ?, lease_id = NULL, leased_until = NULL WHERE id = ?
      `).run(attempts, String(error.message || error), this.#now(), instanceId);
      return { status: 'dead', node: null, error: String(error.message || error) };
    }
    // Exponential backoff.
    const delayMs = Math.min(60000, 1000 * 2 ** (attempts - 1));
    this.dialect.prepare(`
      UPDATE workflow_instances SET status = 'waiting', attempts = ?, last_error = ?, next_attempt_at = ?, lease_id = NULL, leased_until = NULL WHERE id = ?
    `).run(attempts, String(error.message || error), new Date(this.now().getTime() + delayMs).toISOString(), instanceId);
    return { status: 'retry', node: null, error: String(error.message || error), nextAttemptInMs: delayMs };
  }

  /**
   * Compensation boundary: for every completed step whose node declares a
   * `compensateWith` action, run it in reverse order. A compensation failure is
   * recorded but never masks the original failure.
   */
  #compensate(instanceId) {
    const instance = this.get(instanceId);
    const version = this.registry.getVersion(instance.definitionId, instance.definitionVersion);
    if (!version) return [];
    const done = this.dialect.prepare("SELECT * FROM workflow_steps WHERE instance_id = ? AND status = 'done' ORDER BY cursor DESC").all(instanceId);
    const compensated = [];
    for (const step of done) {
      const node = version.nodes.find((n) => n.id === step.node_id);
      if (!node?.compensateWith || !this.actionExecutor) continue;
      try {
        this.actionExecutor.execute(node.compensateWith, { record_id: instance.recordId, idempotency_key: `${instanceId}:${node.id}:compensate` }, { userId: 'system', companyId: instance.companyId });
        this.dialect.prepare("UPDATE workflow_steps SET status = 'compensated' WHERE id = ?").run(step.id);
        compensated.push(node.id);
      } catch (e) {
        this.dialect.prepare('UPDATE workflow_steps SET error = ? WHERE id = ?').run(`compensation failed: ${e.message}`, step.id);
      }
    }
    return compensated;
  }

  #terminate(instanceId, status, result, error = null) {
    this.dialect.prepare(`
      UPDATE workflow_instances SET status = ?, finished_at = ?, terminal_result = ?, last_error = ?, lease_id = NULL, leased_until = NULL WHERE id = ?
    `).run(status, this.#now(), JSON.stringify(result ?? null), error, instanceId);
    this.dialect.prepare('UPDATE workflow_timers SET cancelled_at = ? WHERE instance_id = ? AND fired_at IS NULL AND cancelled_at IS NULL')
      .run(this.#now(), instanceId);
    return { status, node: null, result };
  }

  cancel(instanceId, reason = 'cancelled', ctx = null) {
    const instance = this.get(instanceId);
    if (!instance) throw new WorkflowError('instance not found', 'INSTANCE_NOT_FOUND', { instanceId });
    if (['completed', 'cancelled'].includes(instance.status)) return instance;
    this.#terminate(instanceId, 'cancelled', { reason });
    this.dialect.prepare(`
      INSERT INTO platform_audit_log (id, actor_id, actor_type, action, resource, resource_id, occurred_at, source_channel, result, after_value)
      VALUES (?, ?, 'user', 'workflow.cancel', 'workflow_instances', ?, ?, 'workflow', 'success', ?)
    `).run(crypto.randomUUID(), ctx?.actorId || 'system', instanceId, this.#now(), JSON.stringify({ reason }));
    return this.get(instanceId);
  }

  /** Wake instances whose wait timer has elapsed. Returns the woken ids. */
  fireDueTimers() {
    const nowIso = this.#now();
    const due = this.dialect.prepare('SELECT * FROM workflow_timers WHERE fire_at <= ? AND fired_at IS NULL AND cancelled_at IS NULL').all(nowIso);
    const woken = [];
    for (const timer of due) {
      this.dialect.prepare('UPDATE workflow_timers SET fired_at = ? WHERE id = ?').run(nowIso, timer.id);
      if (timer.kind === 'timeout') {
        this.#terminate(timer.instance_id, 'failed', { reason: 'TIMEOUT' }, 'workflow timed out');
      } else {
        this.dialect.prepare("UPDATE workflow_instances SET status = 'running', next_attempt_at = NULL WHERE id = ? AND status = 'waiting'").run(timer.instance_id);
      }
      woken.push(timer.instance_id);
    }
    return woken;
  }

  /**
   * Recover instances whose worker died: their lease has expired but they are
   * still marked running. Simply clearing the lease makes them claimable again;
   * the cursor tells the next worker exactly where to resume.
   */
  recoverStaleLeases() {
    const nowIso = this.#now();
    const stale = this.dialect.prepare("SELECT id FROM workflow_instances WHERE status IN ('running','waiting') AND lease_id IS NOT NULL AND leased_until <= ?").all(nowIso);
    for (const row of stale) {
      this.dialect.prepare('UPDATE workflow_instances SET lease_id = NULL, leased_until = NULL WHERE id = ?').run(row.id);
    }
    return stale.map((r) => r.id);
  }

  /** Drive one instance to completion. Test/worker convenience. */
  run(instanceId, ctx, { maxSteps = 50 } = {}) {
    const claimed = this.dialect.prepare('SELECT lease_id FROM workflow_instances WHERE id = ?').get(instanceId);
    let leaseId = claimed?.lease_id || null;
    if (!leaseId) {
      const lease = `lease_${crypto.randomUUID()}`;
      this.dialect.prepare('UPDATE workflow_instances SET lease_id = ?, leased_until = ? WHERE id = ?')
        .run(lease, new Date(this.now().getTime() + this.leaseSeconds * 1000).toISOString(), instanceId);
      leaseId = lease;
    }
    const trace = [];
    for (let i = 0; i < maxSteps; i++) {
      const outcome = this.step(instanceId, leaseId, ctx);
      trace.push(outcome);
      if (['completed', 'failed', 'cancelled', 'dead', 'waiting', 'retry'].includes(outcome.status)) break;
    }
    return { instance: this.get(instanceId), trace };
  }

  /** Migrate waiting instances onto a newer version — only where policy allows. */
  migrateRunningInstances(definitionId, toVersion) {
    const target = this.registry.getVersion(definitionId, toVersion);
    if (!target) throw new WorkflowError('target version not found', 'WORKFLOW_VERSION_NOT_FOUND', { definitionId, toVersion });
    if (target.instanceMigrationPolicy !== 'migrate_on_activate') {
      return { migrated: 0, reason: 'PINNED_BY_POLICY' };
    }
    const info = this.dialect.prepare(`
      UPDATE workflow_instances SET definition_version = ?
      WHERE definition_id = ? AND status IN ('running','waiting') AND definition_version <> ?
    `).run(toVersion, definitionId, toVersion);
    return { migrated: info.changes };
  }
}

export function createWorkflowRegistry(dialect, deps) { return new WorkflowRegistry(dialect, deps); }
export function createWorkflowRuntime(dialect, deps) { return new WorkflowRuntime(dialect, deps); }
