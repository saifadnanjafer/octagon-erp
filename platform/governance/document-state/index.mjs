// Document lifecycle / state machine — Phase 01 governance.
//
// Source composition:
// - VNext vnext/server/state/doc-state.js (project-owned) used as the
//   implementation base for state definition validation, transition execution,
//   terminal/immutable state guards, optimistic version checks, and role checks.
// - Frappe model/document.py (MIT reference) for docstatus and validate/submit/
//   cancel/amend hook ordering.
// - Odoo account_move.py / sale_order.py / stock_picking.py (clean-room reference)
//   for posted/cancelled/reversed state semantics.
//
// Responsibilities:
//   - register and validate state definitions (full graph, reachability, initial)
//   - track current state and version per (entity, recordId)
//   - execute legal transitions with server-side preconditions
//   - reject writes to terminal/immutable states from generic CRUD
//   - write audit + outbox evidence for every transition
//   - support cancel, reverse, and amend semantics

'use strict';

import crypto from 'node:crypto';

export class DocumentLifecycleError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'DocumentLifecycleError';
    this.code = code;
    this.details = details;
  }
}

export function stateName(entry) {
  if (typeof entry === 'string') return entry.trim();
  if (entry && typeof entry === 'object') return String(entry.name || '').trim();
  return '';
}

export function isTerminalEntry(entry) {
  return !!(entry && typeof entry === 'object' && (entry.terminal === true || entry.immutable === true));
}

export function validateStateDefinition(body) {
  const problems = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, problems: ['تعريف دورة الحياة يجب أن يكون كائن JSON'] };
  }

  const rawStates = Array.isArray(body.states) ? body.states : [];
  if (!rawStates.length) problems.push('يجب تعريف قائمة الحالات بعنصر واحد على الأقل');

  const stateNames = new Set();
  for (const entry of rawStates) {
    const name = stateName(entry);
    if (!name) { problems.push('اسم حالة فارغ ضمن قائمة states'); continue; }
    if (stateNames.has(name)) { problems.push(`الحالة [${name}] معرّفة أكثر من مرة`); continue; }
    stateNames.add(name);
  }

  const initial = String(body.initial || '').trim() || (stateNames.has('draft') ? 'draft' : '');
  if (!initial) problems.push('يجب تحديد الحالة الابتدائية');
  else if (!stateNames.has(initial)) problems.push(`الحالة الابتدائية [${initial}] غير معرّفة`);

  const rawTransitions = Array.isArray(body.transitions) ? body.transitions : [];
  const edges = [];
  rawTransitions.forEach((t, i) => {
    const ordinal = i + 1;
    const from = t && typeof t === 'object' ? String(t.from || '').trim() : '';
    const to = t && typeof t === 'object' ? String(t.to || '').trim() : '';
    const action = t && typeof t === 'object' ? String(t.action || '').trim() : '';
    if (!from || !stateNames.has(from)) problems.push(`الانتقال #${ordinal}: الحالة المصدر [${from || '—'}] غير معرّفة`);
    if (!to || !stateNames.has(to)) problems.push(`الانتقال #${ordinal}: الحالة الهدف [${to || '—'}] غير معرّفة`);
    if (!action) problems.push(`الانتقال #${ordinal}: اسم الإجراء مطلوب`);
    if (from && to && stateNames.has(from) && stateNames.has(to)) edges.push([from, to]);
  });

  if (!problems.length) {
    const reachable = new Set([initial]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const [from, to] of edges) {
        if (reachable.has(from) && !reachable.has(to)) { reachable.add(to); grew = true; }
      }
    }
    const unreachable = [...stateNames].filter((name) => !reachable.has(name));
    if (unreachable.length) problems.push(`الحالات غير قابلة للوصول: ${unreachable.join('، ')}`);
  }

  return problems.length ? { ok: false, problems } : { ok: true, initial };
}

export function currentPeriod(now = new Date()) {
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export class DocumentLifecycle {
  constructor(dialect) {
    if (!dialect || typeof dialect.prepare !== 'function') {
      throw new DocumentLifecycleError('dialect with prepare() is required', 'DIALECT_REQUIRED');
    }
    this.dialect = dialect;
  }

  #now() {
    return new Date().toISOString();
  }

  #contextDefaults(ctx) {
    return {
      tenantId: ctx?.tenantId || null,
      companyId: ctx?.companyId || null,
      branchId: ctx?.branchId || null,
      userId: ctx?.userId || 'system',
      actorType: ctx?.actorType || 'user',
      correlationId: ctx?.correlationId || null,
      sourceChannel: ctx?.sourceChannel || 'lifecycle',
      now: ctx?.now || this.#now(),
    };
  }

  #writePlatformAudit(action, entity, recordId, before, after, ctx) {
    const c = this.#contextDefaults(ctx);
    this.dialect.prepare(`
      INSERT INTO platform_audit_log (
        id, actor_id, actor_type, tenant_id, company_id, branch_id, action, resource, resource_id,
        correlation_id, occurred_at, before_value, after_value, source_channel, result
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(), c.userId, c.actorType, c.tenantId, c.companyId, c.branchId,
      action, entity, recordId, c.correlationId, c.now,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      c.sourceChannel, 'success'
    );
  }

  #writeOutbox(eventType, entity, recordId, payload, ctx) {
    const c = this.#contextDefaults(ctx);
    this.dialect.prepare(`
      INSERT INTO platform_outbox (
        id, event_type, schema_version, module_id, aggregate_id, tenant_id, company_id, actor_id,
        correlation_id, payload, created_at, scheduled_at, attempts, max_attempts, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(), eventType, '1.0.0', 'platform_kernel', `${entity}:${recordId}`,
      c.tenantId, c.companyId, c.userId, c.correlationId, JSON.stringify(payload),
      c.now, c.now, 0, 3, 'pending'
    );
  }

  registerStateDefinition(entity, definition, actor = 'system') {
    const validation = validateStateDefinition(definition);
    if (!validation.ok) {
      throw new DocumentLifecycleError(`invalid state definition: ${validation.problems.join('; ')}`, 'INVALID_STATE_DEFINITION', { problems: validation.problems });
    }
    const now = this.#now();
    this.dialect.prepare(`
      INSERT INTO x_doc_state_defs (entity, definition, updated_at, updated_by)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(entity) DO UPDATE SET
        definition = excluded.definition,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by
    `).run(entity, JSON.stringify(definition), now, actor);
    this.#writePlatformAudit('lifecycle.def.register', entity, null, null, { definition, initial: validation.initial }, { userId: actor, actorType: 'user', tenantId: null, companyId: null, branchId: null, correlationId: null, now, sourceChannel: 'lifecycle' });
    return { entity, initial: validation.initial };
  }

  getStateDefinition(entity) {
    const row = this.dialect.prepare('SELECT definition FROM x_doc_state_defs WHERE entity = ?').get(entity);
    if (!row) return null;
    try { return JSON.parse(row.definition); } catch (_) { return null; }
  }

  getCurrentState(entity, recordId) {
    const row = this.dialect.prepare('SELECT state, version FROM x_doc_states WHERE entity = ? AND record_id = ?').get(entity, recordId);
    if (row) return { state: row.state, version: Number(row.version) || 1 };
    const def = this.getStateDefinition(entity);
    return { state: def?.initial || 'draft', version: 1 };
  }

  isTerminalState(entity, recordId) {
    const def = this.getStateDefinition(entity);
    if (!def) return false;
    const current = this.getCurrentState(entity, recordId);
    const entry = (def.states || []).find((s) => stateName(s) === current.state);
    return isTerminalEntry(entry);
  }

  getTerminalError(entity, recordId) {
    if (!this.isTerminalState(entity, recordId)) return null;
    const current = this.getCurrentState(entity, recordId);
    return `المستند في حالة نهائية [${current.state}] ولا يمكن تعديله أو حذفه إلا عبر انتقال حالة معكوس معرّف صراحة`;
  }

  transition(entity, recordId, action, input, ctx) {
    const def = this.getStateDefinition(entity);
    if (!def) throw new DocumentLifecycleError(`no lifecycle defined for entity ${entity}`, 'NO_LIFECYCLE');

    const current = this.getCurrentState(entity, recordId);
    const transition = (def.transitions || []).find((t) => t.from === current.state && t.action === action);
    if (!transition) {
      throw new DocumentLifecycleError(`action [${action}] not allowed from state [${current.state}]`, 'ILLEGAL_TRANSITION', { from: current.state, action });
    }

    if (input && input.version !== undefined && Number(input.version) !== current.version) {
      throw new DocumentLifecycleError('record has been modified by another transaction', 'STALE_VERSION');
    }

    const nextVersion = current.version + 1;
    const correlationId = ctx.correlationId || crypto.randomUUID();
    const reason = input && input.reason ? String(input.reason).slice(0, 500) : null;
    const now = ctx.now || this.#now();

    this.dialect.prepare(`
      INSERT INTO x_doc_states (entity, record_id, state, version)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(entity, record_id) DO UPDATE SET state = excluded.state, version = excluded.version
    `).run(entity, recordId, transition.to, nextVersion);

    this.dialect.prepare(`
      INSERT INTO x_doc_state_history (id, entity, record_id, from_state, to_state, action, actor, reason, correlation_id, version, at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(), entity, recordId, current.state, transition.to, action, ctx.userId, reason, correlationId, nextVersion, now
    );

    const row = this.dialect.prepare('SELECT data FROM x_records WHERE entity = ? AND id = ?').get(entity, recordId);
    if (row) {
      let data = {};
      try { data = JSON.parse(row.data); } catch (_) { data = {}; }
      data.status = transition.to;
      this.dialect.prepare('UPDATE x_records SET data = ?, updated_at = ? WHERE entity = ? AND id = ?').run(JSON.stringify(data), now, entity, recordId);
    }

    const before = { state: current.state, version: current.version };
    const after = { state: transition.to, version: nextVersion, correlationId, reason };
    this.#writePlatformAudit(`lifecycle.transition.${action}`, entity, recordId, before, after, ctx);
    this.#writeOutbox('lifecycle.transition', entity, recordId, { from: current.state, to: transition.to, action, version: nextVersion }, ctx);

    return { entity, record_id: recordId, from: current.state, to: transition.to, action, version: nextVersion, correlationId };
  }

  reverse(entity, recordId, reversalAction, input, ctx) {
    const def = this.getStateDefinition(entity);
    if (!def) throw new DocumentLifecycleError(`no lifecycle defined for entity ${entity}`, 'NO_LIFECYCLE');
    const current = this.getCurrentState(entity, recordId);
    const transition = (def.transitions || []).find((t) => t.from === current.state && t.action === reversalAction);
    if (!transition) {
      throw new DocumentLifecycleError(`reversal action [${reversalAction}] not allowed from state [${current.state}]`, 'ILLEGAL_REVERSAL', { from: current.state, action: reversalAction });
    }
    return this.transition(entity, recordId, reversalAction, input, ctx);
  }

  amend(entity, recordId, input, ctx) {
    const def = this.getStateDefinition(entity);
    if (!def) throw new DocumentLifecycleError(`no lifecycle defined for entity ${entity}`, 'NO_LIFECYCLE');
    const row = this.dialect.prepare('SELECT data, company_id FROM x_records WHERE entity = ? AND id = ?').get(entity, recordId);
    if (!row) throw new DocumentLifecycleError('record not found', 'RECORD_NOT_FOUND');

    let data = {};
    try { data = JSON.parse(row.data); } catch (_) { data = {}; }
    data.amended_from = recordId;
    data.amendment_sequence = Number(data.amendment_sequence || 0) + 1;
    data.status = def.initial || 'draft';
    delete data.id;

    const newId = `${entity}_${crypto.randomUUID()}`;
    const now = ctx.now || this.#now();
    this.dialect.prepare(`
      INSERT INTO x_records (entity, id, company_id, data, created_at, updated_at, created_by, removed, version)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1)
    `).run(entity, newId, row.company_id, JSON.stringify(data), now, now, ctx.userId);

    this.dialect.prepare(`
      INSERT INTO x_doc_states (entity, record_id, state, version)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(entity, record_id) DO UPDATE SET state = excluded.state, version = excluded.version
    `).run(entity, newId, def.initial || 'draft', 1);

    this.dialect.prepare(`
      INSERT INTO x_doc_state_history (id, entity, record_id, from_state, to_state, action, actor, reason, correlation_id, version, at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(), entity, newId, recordId, def.initial || 'draft', 'amend', ctx.userId, input?.reason || null, ctx.correlationId || crypto.randomUUID(), 1, now
    );

    this.#writePlatformAudit('lifecycle.amend', entity, newId, { original: recordId }, { amended_from: recordId, status: def.initial || 'draft' }, ctx);
    this.#writeOutbox('lifecycle.amend', entity, newId, { original: recordId, amendment_sequence: data.amendment_sequence }, ctx);

    return { entity, record_id: newId, amended_from: recordId, status: def.initial || 'draft', version: 1 };
  }
}

export function createDocumentLifecycle(dialect) {
  return new DocumentLifecycle(dialect);
}
