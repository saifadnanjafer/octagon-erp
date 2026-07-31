// platform/api/wave2.mjs — Final Page Catalog · governed read surface for the
// 16 Wave 2 domains.
//
// Read side only. Every mutation stays on POST /api/v1/action/:actionId, so no
// Wave 2 fact is reachable through unrestricted generic CRUD.
//
// SAFETY MODEL — nothing here is built from caller input:
//
//   table      : never from the request. Resolved from the static registry in
//                platform/domains/wave2-registry.mjs.
//   columns    : never from the request. `SELECT *` minus REDACTED_COLUMNS.
//   filters    : only column names the registry declares for that resource, and
//                always bound as parameters, never interpolated.
//   ORDER BY   : never from the request. Taken from the registry and validated
//                against a strict identifier pattern before use.
//   company    : never from the request. ctx.companyId, server-derived from the
//                session cookie.
//
// A caller can therefore choose *which* declared resource to read and *which*
// declared filters to apply, and nothing else. There is no path from request
// text into SQL.
//
// Scope rules:
//   'company' -> WHERE company_id = ?
//   'parent'  -> WHERE <fk> IN (SELECT id FROM <parent> WHERE company_id = ?)
//   'global'  -> reference lookup with no company column (read-only, e.g. the
//                18 Iraqi governorates)

'use strict';

import { buildQueryIndex, REDACTED_COLUMNS, WAVE2_DOMAINS } from '../domains/wave2-registry.mjs';

const QUERY_INDEX = buildQueryIndex();

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 200;

// Registry-supplied ORDER BY clauses are still validated: a typo in the
// registry must fail closed rather than produce an unparsed fragment.
const SAFE_ORDER = /^[A-Za-z_][A-Za-z0-9_]*(\s+(ASC|DESC))?(\s*,\s*[A-Za-z_][A-Za-z0-9_]*(\s+(ASC|DESC))?)*$/;
const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function redact(row) {
  if (!row || typeof row !== 'object') return row;
  const clean = { ...row };
  for (const key of REDACTED_COLUMNS) {
    if (key in clean) clean[key] = null;
  }
  return clean;
}

function envelope(data) {
  const list = Array.isArray(data) ? data.map(redact) : redact(data);
  return { data: list, meta: { total: Array.isArray(list) ? list.length : 1 } };
}

function clampLimit(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

function clampOffset(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

/**
 * Build the WHERE clause for a declared resource. Every fragment below is
 * derived from the registry; only the *values* come from the caller.
 */
function buildWhere(descriptor, ctx, query) {
  const clauses = [];
  const params = [];

  if (descriptor.scope === 'company') {
    clauses.push('company_id = ?');
    params.push(ctx.companyId);
  } else if (descriptor.scope === 'parent') {
    const { table: parentTable, fk } = descriptor.parent;
    if (!SAFE_IDENT.test(parentTable) || !SAFE_IDENT.test(fk)) {
      throw new Error('WAVE2_QUERY_REGISTRY_INVALID: unsafe parent descriptor');
    }
    clauses.push(`${fk} IN (SELECT id FROM ${parentTable} WHERE company_id = ?)`);
    params.push(ctx.companyId);
  } else if (descriptor.scope !== 'global') {
    throw new Error(`WAVE2_QUERY_REGISTRY_INVALID: unknown scope ${descriptor.scope}`);
  }

  for (const column of descriptor.filters || []) {
    const value = query[column];
    if (value === undefined || value === null || value === '') continue;
    if (!SAFE_IDENT.test(column)) {
      throw new Error('WAVE2_QUERY_REGISTRY_INVALID: unsafe filter column');
    }
    clauses.push(`${column} = ?`);
    params.push(String(value));
  }

  const term = query.q || query.search;
  if (term && Array.isArray(descriptor.search) && descriptor.search.length) {
    const parts = [];
    for (const column of descriptor.search) {
      if (!SAFE_IDENT.test(column)) {
        throw new Error('WAVE2_QUERY_REGISTRY_INVALID: unsafe search column');
      }
      parts.push(`${column} LIKE ?`);
      params.push(`%${String(term)}%`);
    }
    clauses.push(`(${parts.join(' OR ')})`);
  }

  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

/**
 * Governed Wave 2 read.
 *
 * @param {object}  args
 * @param {object}  args.dialect   prepared-statement dialect
 * @param {object}  args.ctx       server-derived request context (companyId, permissions)
 * @param {string}  args.namespace domain key, e.g. 'treasury'
 * @param {string}  args.resource  declared resource, e.g. 'bank-accounts'
 * @param {string?} args.recordId  optional single-record id
 * @param {object}  args.query     caller query string
 * @returns {{data?: any, meta?: object, error?: string, status?: number}}
 */
export function handleWave2Query({ dialect, ctx, namespace, resource, recordId = null, query = {} }) {
  // `_meta` (not the bare namespace) is the descriptor route: the router
  // requires at least two path segments, so /api/v1/<ns> never reaches here.
  // A page calls /api/v1/<ns>/_meta to learn which resources and actions exist
  // and to render a truthful configuration_required state instead of guessing.
  if (!resource || resource === '_meta') {
    const domain = WAVE2_DOMAINS.find((d) => d.key === namespace);
    if (!domain) return { error: 'unknown wave2 namespace', status: 404 };
    return {
      data: {
        namespace: domain.key,
        module_id: domain.module.id,
        name_ar: domain.module.nameAr,
        name_en: domain.module.nameEn,
        resources: domain.queries.map((q) => q.resource),
        actions: domain.actions.map((a) => a.id),
        permissions: domain.permissions,
      },
      meta: null,
    };
  }

  const descriptor = QUERY_INDEX.get(`${namespace}/${resource}`);
  if (!descriptor) return { error: 'unknown wave2 resource', status: 404 };

  if (!ctx.companyId && descriptor.scope !== 'global') {
    return { error: 'COMPANY_SCOPE_REQUIRED: an active company scope is required', status: 403 };
  }

  if (!SAFE_IDENT.test(descriptor.table)) {
    return { error: 'WAVE2_QUERY_REGISTRY_INVALID: unsafe table', status: 500 };
  }

  const order = descriptor.order || 'created_at DESC';
  if (!SAFE_ORDER.test(order)) {
    return { error: 'WAVE2_QUERY_REGISTRY_INVALID: unsafe order clause', status: 500 };
  }

  try {
    if (recordId) {
      const { where, params } = buildWhere(descriptor, ctx, {});
      const sql = `SELECT * FROM ${descriptor.table} ${where}${where ? ' AND' : ' WHERE'} id = ? LIMIT 1`;
      const row = dialect.prepare(sql).get(...params, String(recordId));
      if (!row) return { error: 'record not found', status: 404 };
      return { data: redact(row), meta: null };
    }

    const { where, params } = buildWhere(descriptor, ctx, query);
    const limit = clampLimit(query.limit);
    const offset = clampOffset(query.offset);
    const sql = `SELECT * FROM ${descriptor.table} ${where} ORDER BY ${order} LIMIT ? OFFSET ?`;
    const rows = dialect.prepare(sql).all(...params, limit, offset);
    const result = envelope(rows);
    result.meta.limit = limit;
    result.meta.offset = offset;
    return result;
  } catch (error) {
    // A missing table means the module's migration has not been applied to this
    // database. That is a real, displayable state — not a server fault.
    if (/no such table/i.test(String(error && error.message))) {
      return { error: `MODULE_NOT_INSTALLED: ${descriptor.moduleId} schema is not present`, status: 409 };
    }
    return { error: String(error && error.message ? error.message : error), status: 500 };
  }
}

/** Namespaces this handler owns, for the router's dispatch table. */
export const WAVE2_NAMESPACES = Object.freeze(WAVE2_DOMAINS.map((d) => d.key));

/** Read permission required for a namespace (used by the router before dispatch). */
export function wave2ReadPermission(namespace) {
  const domain = WAVE2_DOMAINS.find((d) => d.key === namespace);
  return domain ? domain.permissions[0] : null;
}
