// Repository abstraction — Phase 01 foundation.
//
// Source composition:
// - VNext crud-engine.js (project-owned) used as the implementation base for
//   create/read/update/delete/list/summary verbs and audit hooks.
// - VNext crud-engine.js ACL scope + write guards + company_id scoping adapted
//   to accept a server-derived execution context.
// - NocoBase repository.ts (clean-room reference) for relation handling and
//   separation between resource query and storage repository.
// - Frappe document.py (MIT reference) for defaults, naming series, and
//   optimistic concurrency.
// - IDURAR createCRUDController/* used only for API shape consistency (not
//   source copied).
//
// Responsibilities:
//   - provide bounded, permission-ready CRUD for governed entities
//   - allow generic create/update/delete only for entities with
//     lifecycle_policy === 'generic' (master / configuration data)
//   - deny generic mutation for protected entities (workflow, state_machine,
//     immutable, append_only)
//   - apply tenant/company/branch scope from server context
//   - assign sequences, defaults, audit rows, and version checks
//   - expand declared relations through repositories, not ad-hoc joins
//   - subscribe to write events for audit/outbox (P01.7) and workflow (P01.4)

'use strict';

import crypto from 'node:crypto';
import { nextSeq } from '../../records/sequences/index.mjs';
import { createDocumentLifecycle } from '../../governance/document-state/index.mjs';
import { normalizeDescriptor, rowToDescriptor } from '../../kernel/entities/schemas/entity-descriptor.mjs';

export class RepositoryError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'RepositoryError';
    this.code = code;
    this.details = details;
  }
}

export const FILTER_OPS = {
  eq: '=', ne: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=',
  '=': '=', '!=': '!=', '>': '>', '>=': '>=', '<': '<', '<=': '<=',
};

export const RECORD_COLUMNS = new Set(['id', 'created_at', 'updated_at', 'created_by', 'removed', 'version', 'company_id']);
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 500;
export const MAX_BODY_BYTES = 1024 * 1024;

function scalar(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number' || typeof value === 'string') return value;
  return JSON.stringify(value);
}

function fieldExpr(field, params) {
  if (RECORD_COLUMNS.has(field)) return field;
  params.push('$.' + field);
  return 'json_extract(data, ?)';
}

function buildFilter(filterJson, where, params) {
  if (!filterJson) return;
  let filter;
  try {
    filter = typeof filterJson === 'string' ? JSON.parse(filterJson) : filterJson;
  } catch (_) {
    const err = new RepositoryError('filter must be valid JSON', 'INVALID_FILTER');
    err.statusCode = 400;
    throw err;
  }
  if (!filter || typeof filter !== 'object' || Array.isArray(filter)) {
    const err = new RepositoryError('filter must be a JSON object', 'INVALID_FILTER');
    err.statusCode = 400;
    throw err;
  }
  for (const [field, cond] of Object.entries(filter)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(field)) {
      const err = new RepositoryError(`invalid filter field "${field}"`, 'INVALID_FILTER_FIELD');
      err.statusCode = 400;
      throw err;
    }
    if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
      for (const [op, value] of Object.entries(cond)) {
        if (op === 'in' && Array.isArray(value)) {
          if (!value.length) { where.push('0'); continue; }
          const expr = fieldExpr(field, params);
          where.push(`${expr} IN (${value.map(() => '?').join(', ')})`);
          params.push(...value.map(scalar));
        } else if (op === 'like') {
          const expr = fieldExpr(field, params);
          where.push(`${expr} LIKE ?`);
          params.push('%' + String(value) + '%');
        } else if (FILTER_OPS[op]) {
          const expr = fieldExpr(field, params);
          where.push(`${expr} ${FILTER_OPS[op]} ?`);
          params.push(scalar(value));
        } else {
          const err = new RepositoryError(`unsupported filter operator "${op}"`, 'INVALID_FILTER_OPERATOR');
          err.statusCode = 400;
          throw err;
        }
      }
    } else {
      const expr = fieldExpr(field, params);
      where.push(`${expr} = ?`);
      params.push(scalar(cond));
    }
  }
}

function nowIso() {
  return new Date().toISOString();
}

export class Repository {
  constructor(dialect, descriptor) {
    this.dialect = dialect;
    this.descriptor = normalizeDescriptor(descriptor);
    this.writeSubscribers = [];
    this.writeGuards = [];
    this.lifecycle = createDocumentLifecycle(dialect);
    this.registerGuard((entity, id, action, before) => this.lifecycle.getTerminalError(entity, id));
  }

  subscribe(fn) {
    if (typeof fn === 'function') this.writeSubscribers.push(fn);
    return this;
  }

  registerGuard(fn) {
    if (typeof fn === 'function') this.writeGuards.push(fn);
    return this;
  }

  #assertGenericMutationAllowed(action) {
    if (this.descriptor.lifecycle_policy !== 'generic') {
      throw new RepositoryError(
        `entity "${this.descriptor.id}" is protected (${this.descriptor.lifecycle_policy}); generic ${action} is not allowed`,
        'PROTECTED_ENTITY_MUTATION',
        { entityId: this.descriptor.id, lifecycle_policy: this.descriptor.lifecycle_policy, action }
      );
    }
  }

  #contextDefaults(ctx) {
    return {
      tenantId: ctx?.tenantId || null,
      companyId: ctx?.companyId || null,
      branchId: ctx?.branchId || null,
      userId: ctx?.userId || 'system',
      actorType: ctx?.actorType || 'user',
      correlationId: ctx?.correlationId || null,
      sourceChannel: ctx?.sourceChannel || 'repository',
      now: ctx?.now || nowIso(),
    };
  }

  #companyWhereClause(companyId, where, params) {
    if (this.descriptor.scope === 'company') {
      where.push('company_id IS ?');
      params.push(companyId);
    }
  }

  #getRow(id, companyId) {
    if (this.descriptor.scope === 'company') {
      return this.dialect
        .prepare('SELECT entity, id, company_id, data, created_at, updated_at, created_by, removed, version FROM x_records WHERE entity = ? AND id = ? AND company_id IS ?')
        .get(this.descriptor.id, id, companyId);
    }
    return this.dialect
      .prepare('SELECT entity, id, company_id, data, created_at, updated_at, created_by, removed, version FROM x_records WHERE entity = ? AND id = ?')
      .get(this.descriptor.id, id);
  }

  #toDoc(row) {
    let data = {};
    try { data = JSON.parse(row.data); } catch (_) { data = {}; }
    return {
      ...data,
      id: row.id,
      company_id: row.company_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
      created_by: row.created_by,
      removed: Number(row.removed) || 0,
      version: Number(row.version) || 1,
    };
  }

  #writeAudit(action, recordId, before, after, ctx) {
    if (this.descriptor.history_policy !== 'audit' && this.descriptor.history_policy !== 'full') return;
    this.dialect.prepare(`
      INSERT INTO x_audit (id, entity, record_id, user, action, before, after, at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(), this.descriptor.id, recordId, ctx.userId, action,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      ctx.now
    );
  }

  #writePlatformAudit(action, recordId, before, after, ctx) {
    this.dialect.prepare(`
      INSERT INTO platform_audit_log (
        id, actor_id, actor_type, tenant_id, company_id, branch_id, action, resource, resource_id,
        correlation_id, occurred_at, before_value, after_value, source_channel, result
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(), ctx.userId, ctx.actorType, ctx.tenantId, ctx.companyId, ctx.branchId,
      action, this.descriptor.id, recordId, ctx.correlationId, ctx.now,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      ctx.sourceChannel, 'success'
    );
  }

  #onWrite(action, doc) {
    for (const fn of this.writeSubscribers) {
      try {
        fn(this.descriptor.id, action, doc);
      } catch (error) {
        console.error(`[repository ${this.descriptor.id}] onWrite subscriber failed (${action}):`, error.message);
      }
    }
  }

  #checkGuards(action, id, before) {
    for (const fn of this.writeGuards) {
      const err = fn(this.descriptor.id, id, action, before);
      if (err) {
        const error = new RepositoryError(err, 'WRITE_GUARD_REJECTED');
        error.statusCode = 409;
        throw error;
      }
    }
  }

  #applyDefaults(data) {
    const fields = this.descriptor.fields || {};
    for (const [key, spec] of Object.entries(fields)) {
      if (data[key] === undefined && spec && spec.default !== null) {
        data[key] = spec.default;
      }
    }
  }

  #assignSequence(data, ctx) {
    if (!this.descriptor.sequence) return;
    const seqField = this.descriptor.seq_field || 'seq';
    if (!data[seqField]) {
      const issued = nextSeq(this.dialect, {
        scopeKey: this.descriptor.id,
        template: this.descriptor.sequence,
        companyId: ctx.companyId,
        resetPolicy: 'none',
        gapPolicy: 'allowed',
      });
      data[seqField] = issued.formatted;
    }
  }

  #stripReadOnly(data) {
    const copy = { ...data };
    delete copy.id;
    delete copy.removed;
    delete copy.created_at;
    delete copy.updated_at;
    delete copy.created_by;
    delete copy.company_id;
    delete copy.version;
    return copy;
  }

  create(data, ctx) {
    this.#assertGenericMutationAllowed('create');
    const context = this.#contextDefaults(ctx);
    const now = context.now;
    const body = this.#stripReadOnly(data || {});
    this.#applyDefaults(body);
    this.#assignSequence(body, context);
    const id = body[this.descriptor.primary_key] || `${this.descriptor.id}_${crypto.randomUUID()}`;
    delete body[this.descriptor.primary_key];

    if (this.#getRow(id, context.companyId)) {
      const err = new RepositoryError(`record "${id}" already exists`, 'DUPLICATE_RECORD');
      err.statusCode = 409;
      throw err;
    }

    this.dialect.exec('BEGIN IMMEDIATE;');
    try {
      this.dialect.prepare(`
        INSERT INTO x_records (entity, id, company_id, data, created_at, updated_at, created_by, removed, version)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1)
      `).run(this.descriptor.id, id, context.companyId, JSON.stringify(body), now, now, context.userId);
      const doc = this.#toDoc(this.#getRow(id, context.companyId));
      this.#writeAudit('create', id, null, doc, context);
      this.#writePlatformAudit('entity.create', id, null, doc, context);
      this.dialect.exec('COMMIT;');
      this.#onWrite('create', doc);
      return doc;
    } catch (error) {
      this.dialect.exec('ROLLBACK;');
      throw error;
    }
  }

  update(id, patch, ctx) {
    this.#assertGenericMutationAllowed('update');
    const context = this.#contextDefaults(ctx);
    const row = this.#getRow(id, context.companyId);
    if (!row || Number(row.removed) === 1) {
      return null;
    }
    const before = this.#toDoc(row);
    this.#checkGuards('update', id, before);

    const incoming = this.#stripReadOnly(patch || {});
    let current = {};
    try { current = JSON.parse(row.data); } catch (_) { current = {}; }
    const merged = { ...current, ...incoming };
    const now = context.now;
    const nextVersion = Number(row.version || 1) + 1;

    if (patch && patch.version !== undefined && Number(patch.version) !== Number(row.version)) {
      const err = new RepositoryError('record has been modified by another transaction', 'STALE_VERSION');
      err.statusCode = 409;
      throw err;
    }

    this.dialect.exec('BEGIN IMMEDIATE;');
    try {
      this.dialect.prepare(`
        UPDATE x_records SET data = ?, updated_at = ?, version = ?
        WHERE entity = ? AND id = ? AND company_id IS ?
      `).run(JSON.stringify(merged), now, nextVersion, this.descriptor.id, id, context.companyId);
      const doc = this.#toDoc(this.#getRow(id, context.companyId));
      this.#writeAudit('update', id, before, doc, context);
      this.#writePlatformAudit('entity.update', id, before, doc, context);
      this.dialect.exec('COMMIT;');
      this.#onWrite('update', doc);
      return doc;
    } catch (error) {
      this.dialect.exec('ROLLBACK;');
      throw error;
    }
  }

  delete(id, ctx) {
    this.#assertGenericMutationAllowed('delete');
    const context = this.#contextDefaults(ctx);
    const row = this.#getRow(id, context.companyId);
    if (!row || Number(row.removed) === 1) {
      return null;
    }
    const before = this.#toDoc(row);
    this.#checkGuards('delete', id, before);

    this.dialect.exec('BEGIN IMMEDIATE;');
    try {
      this.dialect.prepare(`
        UPDATE x_records SET removed = 1, updated_at = ?
        WHERE entity = ? AND id = ? AND company_id IS ?
      `).run(nowIso(), this.descriptor.id, id, context.companyId);
      this.#writeAudit('delete', id, before, null, context);
      this.#writePlatformAudit('entity.delete', id, before, null, context);
      this.dialect.exec('COMMIT;');
      this.#onWrite('delete', before);
      return before;
    } catch (error) {
      this.dialect.exec('ROLLBACK;');
      throw error;
    }
  }

  read(id, ctx) {
    const context = this.#contextDefaults(ctx);
    const row = this.#getRow(id, context.companyId);
    if (!row || Number(row.removed) === 1) return null;
    return this.#toDoc(row);
  }

  readWithRelations(id, include, ctx) {
    const doc = this.read(id, ctx);
    if (!doc) return null;
    const expand = Array.isArray(include) ? include : [];
    if (!expand.length) return doc;
    for (const name of expand) {
      const relation = this.descriptor.relations[name];
      if (!relation) continue;
      const fk = doc[relation.foreign_key];
      if (!fk) {
        doc[name] = relation.cardinality === 'many' ? [] : null;
        continue;
      }
      const targetRepo = RepositoryFactory.for(this.dialect, relation.target);
      if (relation.cardinality === 'many') {
        const ids = Array.isArray(fk) ? fk : [fk];
        doc[name] = ids.map((targetId) => targetRepo.read(targetId, ctx)).filter(Boolean);
      } else {
        doc[name] = targetRepo.read(fk, ctx);
      }
    }
    return doc;
  }

  list(query = {}, ctx) {
    const context = this.#contextDefaults(ctx);
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(query.limit, 10) || DEFAULT_LIMIT));
    const where = ['entity = ?', 'removed = 0'];
    const params = [this.descriptor.id];

    this.#companyWhereClause(context.companyId, where, params);

    const q = (query.q || '').trim();
    if (q) {
      where.push("data LIKE ? ESCAPE '\\'");
      params.push('%' + q.replace(/[\\%_]/g, (ch) => '\\' + ch) + '%');
    }

    buildFilter(query.filter, where, params);

    let sortField = 'updated_at';
    let sortDir = 'DESC';
    const rawSort = (query.sort || '').trim();
    if (rawSort) {
      let field = rawSort;
      if (field.startsWith('-')) { field = field.slice(1); sortDir = 'DESC'; }
      else if (field.includes(':')) {
        const [f, d] = field.split(':');
        field = f;
        sortDir = String(d).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
      } else {
        sortDir = 'ASC';
      }
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(field)) {
        const err = new RepositoryError(`invalid sort field "${field}"`, 'INVALID_SORT_FIELD');
        err.statusCode = 400;
        throw err;
      }
      sortField = field;
    }
    const orderParams = [];
    const orderExpr = fieldExpr(sortField, orderParams);

    const whereSql = where.join(' AND ');
    const totalRow = this.dialect.prepare(`SELECT COUNT(*) AS n FROM x_records WHERE ${whereSql}`).get(...params);
    const total = Number(totalRow ? totalRow.n : 0);
    const rows = this.dialect.prepare(`
      SELECT entity, id, company_id, data, created_at, updated_at, created_by, removed, version
      FROM x_records
      WHERE ${whereSql}
      ORDER BY ${orderExpr} ${sortDir}, id ASC
      LIMIT ? OFFSET ?
    `).all(...params, ...orderParams, limit, (page - 1) * limit);

    return { items: rows.map((row) => this.#toDoc(row)), meta: { total, page, limit } };
  }

  summary(ctx) {
    const context = this.#contextDefaults(ctx);
    const statusKey = this.descriptor.status_key || 'status';
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(statusKey)) {
      throw new RepositoryError(`invalid status_key "${statusKey}"`, 'INVALID_STATUS_KEY');
    }
    const where = ['entity = ?', 'removed = 0'];
    const params = [this.descriptor.id];
    this.#companyWhereClause(context.companyId, where, params);
    const whereSql = where.join(' AND ');

    const totalRow = this.dialect.prepare(`SELECT COUNT(*) AS n FROM x_records WHERE ${whereSql}`).get(...params);
    const total = Number(totalRow ? totalRow.n : 0);
    const rows = this.dialect.prepare(`
      SELECT COALESCE(json_extract(data, ?), '(none)') AS status, COUNT(*) AS n
      FROM x_records
      WHERE ${whereSql}
      GROUP BY 1
      ORDER BY 2 DESC
    `).all('$.' + statusKey, ...params);

    const byStatus = {};
    for (const row of rows) byStatus[row.status] = Number(row.n);
    return { total, status_key: statusKey, by_status: byStatus };
  }

  history(id) {
    const rows = this.dialect
      .prepare('SELECT id, entity, record_id, user, action, before, after, at FROM x_audit WHERE entity = ? AND record_id = ? ORDER BY at ASC')
      .all(this.descriptor.id, id);
    return rows.map((row) => ({
      id: row.id,
      entity: row.entity,
      record_id: row.record_id,
      user: row.user,
      action: row.action,
      before: row.before ? JSON.parse(row.before) : null,
      after: row.after ? JSON.parse(row.after) : null,
      at: row.at,
    }));
  }
}

export class RepositoryFactory {
  static #registry = new WeakMap();

  static #forDialect(dialect) {
    if (!this.#registry.has(dialect)) {
      this.#registry.set(dialect, new Map());
    }
    return this.#registry.get(dialect);
  }

  static register(dialect, descriptor) {
    const repo = new Repository(dialect, descriptor);
    this.#forDialect(dialect).set(descriptor.id, repo);
    return repo;
  }

  static for(dialect, entityId) {
    const cache = this.#forDialect(dialect);
    if (cache.has(entityId)) return cache.get(entityId);
    const row = dialect.prepare('SELECT * FROM platform_entities WHERE id = ?').get(entityId);
    if (!row) {
      throw new RepositoryError(`entity "${entityId}" is not registered`, 'ENTITY_NOT_REGISTERED');
    }
    const descriptor = rowToDescriptor(row);
    return this.register(dialect, descriptor);
  }

  static clear(dialect = null) {
    if (dialect) {
      this.#registry.delete(dialect);
    } else {
      this.#registry = new WeakMap();
    }
  }
}

export function createRepository(dialect, entityId) {
  return RepositoryFactory.for(dialect, entityId);
}
