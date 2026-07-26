// Shared domain primitives for Phase 05 modules.
//
// These are the checks that every canonical domain has to repeat: company
// scope, actor identity, numeric validation, scoped row loading, state-machine
// assertion, and reference numbering. Factoring them out keeps each domain file
// about its own business rules rather than about boilerplate — and means a fix
// to a scope check is a fix everywhere.

import crypto from 'node:crypto';

export function createDomainError(name, defaultCode) {
  return class DomainError extends Error {
    constructor(message, code = defaultCode, statusCode = 400) {
      super(message);
      this.name = name;
      this.code = code;
      this.statusCode = statusCode;
    }
  };
}

export function makeId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function today() {
  return nowIso().slice(0, 10);
}

export function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function round6(value) {
  return Math.round((Number(value) + Number.EPSILON) * 1e6) / 1e6;
}

/**
 * Build the guard set for one domain. `Err` is that domain's error class, so a
 * caller always sees an error typed to the domain it called.
 */
export function domainGuards(Err) {
  const requireCompany = (payload) => {
    const companyId = payload?.company_id;
    if (!companyId || companyId === '*') {
      throw new Err('an active company scope is required', 'COMPANY_SCOPE_REQUIRED', 403);
    }
    return companyId;
  };

  const requireActor = (payload) => {
    const actor = payload?.actor || payload?.actor_id;
    if (!actor) throw new Err('an authenticated actor is required', 'ACTOR_REQUIRED', 403);
    return actor;
  };

  const positive = (value, label) => {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) {
      throw new Err(`${label} must be a positive number`, 'INPUT_INVALID');
    }
    return num;
  };

  const nonNegative = (value, label) => {
    const num = Number(value || 0);
    if (!Number.isFinite(num) || num < 0) {
      throw new Err(`${label} must not be negative`, 'INPUT_INVALID');
    }
    return num;
  };

  const requireText = (value, label) => {
    const text = String(value || '').trim();
    if (!text) throw new Err(`${label} is required`, 'INPUT_MISSING_FIELD');
    return text;
  };

  const scopedRow = (db, table, id, companyId, label) => {
    if (!id) throw new Err(`${label} is required`, 'INPUT_MISSING_FIELD');
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
    if (!row) throw new Err(`${label} not found: ${id}`, 'RECORD_NOT_FOUND', 404);
    if (row.company_id && row.company_id !== companyId) {
      throw new Err(`${label} is outside the active company`, 'COMPANY_SCOPE_VIOLATION', 403);
    }
    return row;
  };

  const assertState = (actual, allowed, label, code) => {
    if (!allowed.includes(actual)) {
      throw new Err(
        `${label} state ${actual} does not allow this transition (allowed: ${allowed.join(', ')})`,
        code || 'STATE_INVALID',
      );
    }
  };

  const nextReference = (db, table, companyId, prefix, column = 'reference') => {
    const row = db.prepare(
      `SELECT COUNT(*) AS n FROM ${table} WHERE company_id = ? AND ${column} LIKE ?`,
    ).get(companyId, `${prefix}-%`);
    return `${prefix}-${String(Number(row?.n || 0) + 1).padStart(6, '0')}`;
  };

  /** The context object every Phase 03 finance engine function expects. */
  const financeContext = (payload) => ({
    companyId: requireCompany(payload),
    branchId: payload.branch_id || null,
    userId: requireActor(payload),
    tenantId: payload.tenant_id || null,
    now: nowIso(),
  });

  return {
    requireCompany, requireActor, positive, nonNegative, requireText,
    scopedRow, assertState, nextReference, financeContext,
  };
}

// --------------------------------------------------------------------------
// Frozen zone
// --------------------------------------------------------------------------

/**
 * Payroll, attendance and timesheet data are read-only forever, by owner
 * decision. Phase 05 creates none of these tables and writes to none of them.
 *
 * This guard is the enforcement, not the documentation: any Phase 05 path that
 * is handed one of these collection names fails closed with
 * FROZEN_ZONE_WRITE_DENIED. It is called on the project labour-cost path, which
 * is the only Phase 05 surface that a careless change could point at payroll.
 */
export const FROZEN_COLLECTIONS = Object.freeze([
  'employees',
  'employee_advances',
  'employee_payroll_closings',
  'payroll_payments',
  'payroll_periods',
  'omni.employeeAttendance',
  'omni.workshopAdvances',
  'omni.workshopTimesheetCases',
]);

export class FrozenZoneError extends Error {
  constructor(target) {
    super(`write denied: ${target} is payroll/attendance/timesheet data and is read-only`);
    this.name = 'FrozenZoneError';
    this.code = 'FROZEN_ZONE_WRITE_DENIED';
    this.statusCode = 403;
    this.target = target;
  }
}

export function assertNotFrozen(target) {
  const name = String(target || '').trim();
  if (!name) return true;
  const normalised = name.toLowerCase();
  for (const frozen of FROZEN_COLLECTIONS) {
    if (normalised === frozen.toLowerCase()) throw new FrozenZoneError(name);
  }
  return true;
}

/**
 * Fingerprint of the frozen collections, used by the attestation evidence to
 * prove Phase 05 changed none of them. Tables that do not exist in a given
 * database are reported as absent rather than silently skipped.
 */
export function frozenZoneDigest(db) {
  const result = {};
  for (const collection of FROZEN_COLLECTIONS) {
    if (collection.includes('.')) {
      result[collection] = { present: false, reason: 'legacy client-store collection; not a SQL table' };
      continue;
    }
    const exists = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
    ).get(collection);
    if (!exists) {
      result[collection] = { present: false, rows: 0 };
      continue;
    }
    const rows = db.prepare(`SELECT COUNT(*) AS n FROM ${collection}`).get().n;
    result[collection] = { present: true, rows: Number(rows) };
  }
  return result;
}
