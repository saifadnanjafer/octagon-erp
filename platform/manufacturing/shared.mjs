// Shared primitives for the Phase 05 manufacturing domain.
//
// Everything here is deliberately small and side-effect free apart from the
// explicit database calls. No module in platform/manufacturing owns a stock
// balance, a GL entry, or a task record; these helpers exist so the domain code
// can find the canonical owner of each of those facts.

import crypto from 'node:crypto';

export class ManufacturingError extends Error {
  constructor(message, code = 'MANUFACTURING_ERROR', statusCode = 400) {
    super(message);
    this.name = 'ManufacturingError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function makeId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function requireCompany(payload) {
  const companyId = payload?.company_id;
  if (!companyId || companyId === '*') {
    throw new ManufacturingError('an active company scope is required', 'COMPANY_SCOPE_REQUIRED', 403);
  }
  return companyId;
}

export function requireActor(payload) {
  const actor = payload?.actor || payload?.actor_id;
  if (!actor) throw new ManufacturingError('an authenticated actor is required', 'ACTOR_REQUIRED', 403);
  return actor;
}

export function positive(value, label) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    throw new ManufacturingError(`${label} must be a positive number`, 'INPUT_INVALID');
  }
  return num;
}

export function nonNegative(value, label) {
  const num = Number(value || 0);
  if (!Number.isFinite(num) || num < 0) {
    throw new ManufacturingError(`${label} must not be negative`, 'INPUT_INVALID');
  }
  return num;
}

export function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function round6(value) {
  return Math.round((Number(value) + Number.EPSILON) * 1e6) / 1e6;
}

/**
 * Look up a row and fail closed when it is outside the caller's company.
 * Every manufacturing read that can reach another tenant's data goes through
 * this rather than a bare SELECT.
 */
export function scopedRow(db, table, id, companyId, label) {
  if (!id) throw new ManufacturingError(`${label} is required`, 'INPUT_MISSING_FIELD');
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  if (!row) throw new ManufacturingError(`${label} not found: ${id}`, 'RECORD_NOT_FOUND', 404);
  if (row.company_id && row.company_id !== companyId) {
    throw new ManufacturingError(`${label} is outside the active company`, 'COMPANY_SCOPE_VIOLATION', 403);
  }
  return row;
}

export function assertState(actual, allowed, label) {
  if (!allowed.includes(actual)) {
    throw new ManufacturingError(
      `${label} state ${actual} does not allow this transition (allowed: ${allowed.join(', ')})`,
      'MANUFACTURING_STATE_INVALID',
    );
  }
}

/**
 * Company-scoped sequence for human-readable references. Uses the existing
 * table as its own counter so a rollback of the surrounding transaction also
 * rolls back the number — no separate sequence store to get out of step.
 */
export function nextReference(db, table, companyId, prefix) {
  const row = db.prepare(
    `SELECT COUNT(*) AS n FROM ${table} WHERE company_id = ? AND reference LIKE ?`,
  ).get(companyId, `${prefix}-%`);
  const next = Number(row?.n || 0) + 1;
  return `${prefix}-${String(next).padStart(6, '0')}`;
}

/**
 * The canonical finance context. Phase 05 never builds a GL entry itself; it
 * hands this context to a Phase 03 engine function.
 */
export function financeContext(payload) {
  return {
    companyId: requireCompany(payload),
    branchId: payload.branch_id || null,
    userId: requireActor(payload),
    tenantId: payload.tenant_id || null,
    now: nowIso(),
  };
}
