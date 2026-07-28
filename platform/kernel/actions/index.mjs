// Action registry and executor — Phase 01 kernel.
//
// Source composition:
// - VNext vnext/server/state/doc-state.js (project-owned) used for transition
//   execution, audit/outbox hooks, and version checks.
// - VNext vnext/server/modules/r3-infra.js (project-owned) used for idempotency,
//   transaction ownership, and evidence-write patterns.
// - Frappe model/document.py (MIT reference) for validate/submit/cancel/amend hooks.
// - Odoo account_move.py (clean-room reference) for reverse/cancel semantics.
//
// Responsibilities:
//   - register and validate actions in platform_actions
//   - execute actions inside an explicit transaction boundary
//   - enforce input schema, preconditions, and required scope
//   - handle idempotency keys (required, supported, none)
//   - dispatch lifecycle transitions, creates, reversals, and amendments
//   - write audit and outbox evidence for every governed action
//   - ensure client code uses one API contract for all actions

'use strict';

import crypto from 'node:crypto';
import { assertModuleAccess } from '../../control_plane/index.mjs';
import { DocumentLifecycle, createDocumentLifecycle } from '../../governance/document-state/index.mjs';

export class ActionError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'ActionError';
    this.code = code;
    this.details = details;
  }
}

export const ACTION_KINDS = ['lifecycle_transition', 'create', 'reverse', 'amend', 'domain'];

export function validateActionId(id) {
  return /^[a-z][a-z0-9_]*(?::[a-z][a-z0-9_]*)+$/.test(id)
    || /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/.test(id);
}

export function normalizeAction(input) {
  if (!input || typeof input !== 'object') throw new ActionError('action must be an object', 'ACTION_INVALID');
  if (!input.id || !validateActionId(input.id)) throw new ActionError('action id must be module:action or module.action', 'ACTION_INVALID_ID');
  if (!input.module_id || typeof input.module_id !== 'string') throw new ActionError('module_id is required', 'ACTION_MISSING_MODULE');
  if (!ACTION_KINDS.includes(input.kind)) throw new ActionError(`kind must be one of ${ACTION_KINDS.join(', ')}`, 'ACTION_INVALID_KIND');
  if (!input.entity_id) throw new ActionError('entity_id is required', 'ACTION_MISSING_ENTITY');
  if (!input.transaction_owner) throw new ActionError('transaction_owner is required', 'ACTION_MISSING_TRANSACTION_OWNER');

  return {
    id: input.id,
    module_id: input.module_id,
    entity_id: input.entity_id,
    kind: input.kind,
    allowed_states: Array.isArray(input.allowed_states) ? input.allowed_states : [],
    required_permission: input.required_permission || `${input.module_id}:${input.entity_id}:${input.id}`,
    required_scope: input.required_scope || 'company',
    input_schema: input.input_schema || null,
    preconditions: Array.isArray(input.preconditions) ? input.preconditions : [],
    transaction_owner: input.transaction_owner,
    idempotency_policy: input.idempotency_policy || 'required',
    sequence_policy: input.sequence_policy || 'none',
    audit_policy: input.audit_policy || 'required',
    outbox_policy: input.outbox_policy || 'required',
    reversal_action: input.reversal_action || null,
    result_schema: input.result_schema || null,
    error_contract: input.error_contract || null,
  };
}

function hashPayload(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function validateInputSchema(schema, input) {
  if (!schema) return true;
  if (!input || typeof input !== 'object') throw new ActionError('input must be an object', 'INPUT_INVALID');
  if (schema.required && Array.isArray(schema.required)) {
    for (const key of schema.required) {
      if (input[key] === undefined) throw new ActionError(`input missing required field: ${key}`, 'INPUT_MISSING_FIELD');
    }
  }
  return true;
}

function evaluatePreconditions(preconditions, input, ctx, record) {
  for (const pre of preconditions) {
    if (typeof pre === 'function') {
      const result = pre(input, ctx, record);
      if (result) throw new ActionError(result, 'PRECONDITION_FAILED');
    } else if (typeof pre === 'string') {
      if (pre === 'record_exists' && !record) throw new ActionError('record not found', 'PRECONDITION_FAILED');
    }
  }
  return true;
}

export class ActionRegistry {
  constructor(dialect) {
    if (!dialect || typeof dialect.prepare !== 'function') {
      throw new ActionError('dialect with prepare() is required', 'DIALECT_REQUIRED');
    }
    this.dialect = dialect;
  }

  #now() {
    return new Date().toISOString();
  }

  #assertModuleEnabled(moduleId) {
    const row = this.dialect.prepare('SELECT status FROM platform_modules WHERE id = ?').get(moduleId);
    if (!row) throw new ActionError(`module ${moduleId} not installed`, 'MODULE_NOT_FOUND');
    if (row.status !== 'enabled') throw new ActionError(`module ${moduleId} is not enabled`, 'MODULE_NOT_ENABLED');
  }

  register(action, actor = 'system') {
    const normalized = normalizeAction(action);
    this.#assertModuleEnabled(normalized.module_id);

    const now = this.#now();
    this.dialect.prepare(`
      INSERT INTO platform_actions (
        id, module_id, entity_id, kind, allowed_states, required_permission, required_scope,
        input_schema, preconditions, transaction_owner, idempotency_policy, sequence_policy,
        audit_policy, outbox_policy, reversal_action, result_schema, error_contract, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        module_id = excluded.module_id,
        entity_id = excluded.entity_id,
        kind = excluded.kind,
        allowed_states = excluded.allowed_states,
        required_permission = excluded.required_permission,
        required_scope = excluded.required_scope,
        input_schema = excluded.input_schema,
        preconditions = excluded.preconditions,
        transaction_owner = excluded.transaction_owner,
        idempotency_policy = excluded.idempotency_policy,
        sequence_policy = excluded.sequence_policy,
        audit_policy = excluded.audit_policy,
        outbox_policy = excluded.outbox_policy,
        reversal_action = excluded.reversal_action,
        result_schema = excluded.result_schema,
        error_contract = excluded.error_contract,
        updated_at = excluded.updated_at
    `).run(
      normalized.id, normalized.module_id, normalized.entity_id, normalized.kind,
      JSON.stringify(normalized.allowed_states), normalized.required_permission, normalized.required_scope,
      normalized.input_schema ? JSON.stringify(normalized.input_schema) : null,
      JSON.stringify(normalized.preconditions),
      normalized.transaction_owner, normalized.idempotency_policy, normalized.sequence_policy,
      normalized.audit_policy, normalized.outbox_policy, normalized.reversal_action,
      normalized.result_schema ? JSON.stringify(normalized.result_schema) : null,
      normalized.error_contract ? JSON.stringify(normalized.error_contract) : null,
      now, now
    );
    this.dialect.prepare(`
      INSERT INTO platform_audit_log (id, actor_id, actor_type, action, resource, resource_id, occurred_at, source_channel, result)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), actor, 'user', 'action.register', 'platform_actions', normalized.id, now, 'registry', 'success');
    return normalized;
  }

  get(actionId) {
    const row = this.dialect.prepare('SELECT * FROM platform_actions WHERE id = ?').get(actionId);
    if (!row) return null;
    return {
      id: row.id,
      module_id: row.module_id,
      entity_id: row.entity_id,
      kind: row.kind,
      allowed_states: JSON.parse(row.allowed_states || '[]'),
      required_permission: row.required_permission,
      required_scope: row.required_scope,
      input_schema: row.input_schema ? JSON.parse(row.input_schema) : null,
      preconditions: JSON.parse(row.preconditions || '[]'),
      transaction_owner: row.transaction_owner,
      idempotency_policy: row.idempotency_policy,
      sequence_policy: row.sequence_policy,
      audit_policy: row.audit_policy,
      outbox_policy: row.outbox_policy,
      reversal_action: row.reversal_action,
      result_schema: row.result_schema ? JSON.parse(row.result_schema) : null,
      error_contract: row.error_contract ? JSON.parse(row.error_contract) : null,
    };
  }

  list() {
    return this.dialect.prepare('SELECT id FROM platform_actions ORDER BY id').all().map((row) => row.id);
  }
}

export class ActionExecutor {
  constructor(dialect) {
    this.dialect = dialect;
    this.lifecycle = createDocumentLifecycle(dialect);
    this.handlers = new Map();
  }

  registerHandler(actionId, fn) {
    if (typeof fn !== 'function') throw new ActionError('handler must be a function', 'INVALID_HANDLER');
    this.handlers.set(actionId, fn);
    return this;
  }

  #contextDefaults(ctx) {
    return {
      tenantId: ctx?.tenantId || null,
      companyId: ctx?.companyId || null,
      branchId: ctx?.branchId || null,
      userId: ctx?.userId || 'system',
      actorType: ctx?.actorType || 'user',
      correlationId: ctx?.correlationId || crypto.randomUUID(),
      sourceChannel: ctx?.sourceChannel || 'action',
      now: ctx?.now || new Date().toISOString(),
    };
  }

  #now() {
    return new Date().toISOString();
  }

  #checkIdempotency(action, input, ctx) {
    if (action.idempotency_policy === 'none') return null;
    const key = input?.idempotency_key;
    if (!key) {
      if (action.idempotency_policy === 'required') throw new ActionError('idempotency_key is required', 'IDEMPOTENCY_KEY_REQUIRED');
      return null;
    }
    const payloadHash = hashPayload({ actionId: action.id, input, companyId: ctx.companyId, userId: ctx.userId });
    const existing = this.dialect.prepare(`
      SELECT payload_hash, response_json, status_code FROM action_idempotency
      WHERE actor_id = ? AND company_id = ? AND operation_type = ? AND idempotency_key = ?
    `).get(ctx.userId, ctx.companyId || 'global', action.id, key);
    if (existing) {
      if (existing.payload_hash !== payloadHash) throw new ActionError('idempotency key reused with different payload', 'IDEMPOTENCY_MISMATCH');
      return { replay: JSON.parse(existing.response_json) };
    }
    return { key, payloadHash, record: true };
  }

  #rememberIdempotency(scope, action, input, result, statusCode, ctx) {
    if (!scope || !scope.record) return;
    this.dialect.prepare(`
      INSERT INTO action_idempotency (id, actor_id, company_id, tenant_id, operation_type, idempotency_key, payload_hash, response_json, status_code, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(), ctx.userId, ctx.companyId || 'global', ctx.tenantId, action.id, scope.key,
      scope.payloadHash, JSON.stringify(result), statusCode, ctx.now, null
    );
  }

  #writePlatformAudit(action, entity, recordId, before, after, ctx) {
    this.dialect.prepare(`
      INSERT INTO platform_audit_log (
        id, actor_id, actor_type, tenant_id, company_id, branch_id, action, resource, resource_id,
        correlation_id, occurred_at, before_value, after_value, source_channel, result
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(), ctx.userId, ctx.actorType, ctx.tenantId, ctx.companyId, ctx.branchId,
      action, entity, recordId, ctx.correlationId, ctx.now,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      ctx.sourceChannel, 'success'
    );
  }

  #writeOutbox(eventType, entity, recordId, payload, ctx) {
    this.dialect.prepare(`
      INSERT INTO platform_outbox (
        id, event_type, schema_version, module_id, aggregate_id, tenant_id, company_id, actor_id,
        correlation_id, payload, created_at, scheduled_at, attempts, max_attempts, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(), eventType, '1.0.0', 'platform_kernel', `${entity}:${recordId}`,
      ctx.tenantId, ctx.companyId, ctx.userId, ctx.correlationId, JSON.stringify(payload),
      ctx.now, ctx.now, 0, 3, 'pending'
    );
  }

  #loadRecord(entity, recordId) {
    return this.dialect.prepare('SELECT data, company_id, created_by FROM x_records WHERE entity = ? AND id = ? AND removed = 0').get(entity, recordId);
  }

  #createRecord(entity, input, ctx) {
    const now = ctx.now;
    const data = { ...(input.data || {}) };
    delete data.id;
    delete data.removed;
    delete data.created_at;
    delete data.updated_at;
    delete data.created_by;
    delete data.company_id;
    delete data.version;

    const def = this.lifecycle.getStateDefinition(entity);
    if (def) data.status = def.initial || 'draft';

    const id = input.record_id || `${entity}_${crypto.randomUUID()}`;
    this.dialect.prepare(`
      INSERT INTO x_records (entity, id, company_id, data, created_at, updated_at, created_by, removed, version)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1)
    `).run(entity, id, ctx.companyId, JSON.stringify(data), now, now, ctx.userId);

    if (def) {
      this.dialect.prepare(`
        INSERT INTO x_doc_states (entity, record_id, state, version)
        VALUES (?, ?, ?, ?)
      `).run(entity, id, def.initial || 'draft', 1);
    }

    this.#writePlatformAudit('action.create', entity, id, null, { id, status: data.status }, ctx);
    this.#writeOutbox('action.create', entity, id, { status: data.status }, ctx);
    return { entity, record_id: id, status: data.status, version: 1 };
  }

  execute(actionId, input, ctx) {
    const action = this.dialect.prepare('SELECT * FROM platform_actions WHERE id = ?').get(actionId);
    if (!action) throw new ActionError(`action ${actionId} not registered`, 'ACTION_NOT_REGISTERED');
    const normalized = {
      ...action,
      allowed_states: JSON.parse(action.allowed_states || '[]'),
      preconditions: JSON.parse(action.preconditions || '[]'),
      input_schema: action.input_schema ? JSON.parse(action.input_schema) : null,
    };

    const context = this.#contextDefaults(ctx);
    assertModuleAccess(this.dialect, normalized.module_id, context);
    validateInputSchema(normalized.input_schema, input);

    const idempotency = this.#checkIdempotency(normalized, input, context);
    if (idempotency && idempotency.replay) {
      return idempotency.replay;
    }

    const record = input.record_id ? this.#loadRecord(normalized.entity_id, input.record_id) : null;
    evaluatePreconditions(normalized.preconditions, input, context, record);

    this.dialect.exec('BEGIN IMMEDIATE;');
    let result;
    try {
      if (normalized.kind === 'lifecycle_transition') {
        result = this.lifecycle.transition(normalized.entity_id, input.record_id, actionId.split(/[:.]/).pop(), input, context);
      } else if (normalized.kind === 'create') {
        result = this.#createRecord(normalized.entity_id, input, context);
      } else if (normalized.kind === 'reverse') {
        if (!normalized.reversal_action) throw new ActionError('reversal_action is not defined', 'REVERSAL_NOT_DEFINED');
        result = this.lifecycle.reverse(normalized.entity_id, input.record_id, normalized.reversal_action, input, context);
      } else if (normalized.kind === 'domain') {
        const handler = this.handlers.get(normalized.id);
        if (!handler) throw new ActionError(`no handler registered for action ${normalized.id}`, 'HANDLER_NOT_FOUND');
        result = handler({ action: normalized, input, ctx: context, dialect: this.dialect });
      } else if (normalized.kind === 'amend') {
        result = this.lifecycle.amend(normalized.entity_id, input.record_id, input, context);
      } else {
        throw new ActionError(`unsupported action kind: ${normalized.kind}`, 'UNSUPPORTED_KIND');
      }
      this.#rememberIdempotency(idempotency, normalized, input, result, 200, context);
      const auditRecordId = result?.record_id || result?.id || input?.record_id || input?.id || null;
      this.#writePlatformAudit(`action.execute.${actionId}`, normalized.entity_id, auditRecordId, null, result, context);
      this.#writeOutbox('action.execute', normalized.entity_id, auditRecordId, { actionId, result }, context);
      this.dialect.exec('COMMIT;');
    } catch (error) {
      this.dialect.exec('ROLLBACK;');
      throw error;
    }
    return result;
  }
}

export function createActionExecutor(dialect) {
  return new ActionExecutor(dialect);
}

export function createActionRegistry(dialect) {
  return new ActionRegistry(dialect);
}
