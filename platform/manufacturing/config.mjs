// Manufacturing Control Plane configuration.
//
// Two kinds of configuration live here:
//   1. Account mappings — which GL account each manufacturing posting leg uses.
//      Stored per company in `manufacturing_account_mappings`. Domain code never
//      hard-codes an account id; a missing mapping fails closed.
//   2. Work centres and their capacity calendars.

import {
  ManufacturingError, makeId, nowIso, positive, nonNegative,
  requireActor, requireCompany, scopedRow,
} from './shared.mjs';

const MAPPING_ACCOUNT_FIELDS = [
  'wip_account_id',
  'labor_absorption_account_id',
  'overhead_absorption_account_id',
  'scrap_account_id',
  'variance_account_id',
  'subcontract_stock_account_id',
  'subcontract_expense_account_id',
];

function assertAccount(db, companyId, accountId, field) {
  if (!accountId) return null;
  const row = db.prepare(
    'SELECT id FROM finance_accounts WHERE id = ? AND company_id = ? AND is_active = 1',
  ).get(accountId, companyId);
  if (!row) {
    throw new ManufacturingError(
      `${field} must reference an active finance account in the active company`,
      'MANUFACTURING_ACCOUNT_MAPPING_INVALID',
    );
  }
  return row.id;
}

export function setAccountMapping(db, payload = {}) {
  const companyId = requireCompany(payload);
  const actor = requireActor(payload);
  if (!payload.wip_account_id) {
    throw new ManufacturingError('wip_account_id is required', 'MANUFACTURING_ACCOUNT_MAPPING_MISSING');
  }
  const values = {};
  for (const field of MAPPING_ACCOUNT_FIELDS) {
    values[field] = assertAccount(db, companyId, payload[field] || null, field);
  }
  const now = nowIso();
  db.prepare(`
    INSERT INTO manufacturing_account_mappings (
      company_id, wip_account_id, labor_absorption_account_id,
      overhead_absorption_account_id, scrap_account_id, variance_account_id,
      subcontract_stock_account_id, subcontract_expense_account_id,
      updated_at, updated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(company_id) DO UPDATE SET
      wip_account_id = excluded.wip_account_id,
      labor_absorption_account_id = excluded.labor_absorption_account_id,
      overhead_absorption_account_id = excluded.overhead_absorption_account_id,
      scrap_account_id = excluded.scrap_account_id,
      variance_account_id = excluded.variance_account_id,
      subcontract_stock_account_id = excluded.subcontract_stock_account_id,
      subcontract_expense_account_id = excluded.subcontract_expense_account_id,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by
  `).run(
    companyId, values.wip_account_id, values.labor_absorption_account_id,
    values.overhead_absorption_account_id, values.scrap_account_id, values.variance_account_id,
    values.subcontract_stock_account_id, values.subcontract_expense_account_id,
    now, actor,
  );
  return getAccountMapping(db, companyId);
}

export function getAccountMapping(db, companyId) {
  return db.prepare('SELECT * FROM manufacturing_account_mappings WHERE company_id = ?').get(companyId) || null;
}

export function requireAccountMapping(db, companyId) {
  const mapping = getAccountMapping(db, companyId);
  if (!mapping) {
    throw new ManufacturingError(
      'manufacturing account mapping is not configured for this company',
      'MANUFACTURING_ACCOUNT_MAPPING_MISSING',
    );
  }
  return mapping;
}

export function createWorkCenter(db, payload = {}) {
  const companyId = requireCompany(payload);
  requireActor(payload);
  const code = String(payload.code || '').trim();
  const name = String(payload.name || '').trim();
  if (!code) throw new ManufacturingError('work centre code is required', 'INPUT_MISSING_FIELD');
  if (!name) throw new ManufacturingError('work centre name is required', 'INPUT_MISSING_FIELD');

  const duplicate = db.prepare(
    'SELECT id FROM work_centers WHERE company_id = ? AND code = ?',
  ).get(companyId, code);
  if (duplicate) {
    throw new ManufacturingError(`work centre code already exists: ${code}`, 'WORK_CENTER_DUPLICATE', 409);
  }
  if (payload.location_id) scopedRow(db, 'stock_locations', payload.location_id, companyId, 'work centre location');

  const id = payload.id || makeId('wc');
  const now = nowIso();
  db.prepare(`
    INSERT INTO work_centers (
      id, company_id, branch_id, code, name, resource_type, asset_id, location_id,
      capacity_per_hour, efficiency_percent, labor_cost_per_hour, machine_cost_per_hour,
      overhead_cost_per_hour, currency, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    id, companyId, payload.branch_id || null, code, name,
    payload.resource_type || 'machine', payload.asset_id || null, payload.location_id || null,
    positive(payload.capacity_per_hour || 1, 'capacity_per_hour'),
    positive(payload.efficiency_percent || 100, 'efficiency_percent'),
    nonNegative(payload.labor_cost_per_hour, 'labor_cost_per_hour'),
    nonNegative(payload.machine_cost_per_hour, 'machine_cost_per_hour'),
    nonNegative(payload.overhead_cost_per_hour, 'overhead_cost_per_hour'),
    payload.currency || 'IQD', now, now,
  );

  for (const window of Array.isArray(payload.calendar) ? payload.calendar : []) {
    const start = Number(window.start_minute);
    const end = Number(window.end_minute);
    if (!(end > start)) {
      throw new ManufacturingError('work centre calendar window must end after it starts', 'INPUT_INVALID');
    }
    db.prepare(`
      INSERT INTO work_center_calendars (id, work_center_id, company_id, weekday, start_minute, end_minute, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(makeId('wccal'), id, companyId, Number(window.weekday), start, end, now);
  }

  return getWorkCenter(db, id, companyId);
}

export function getWorkCenter(db, id, companyId) {
  const row = scopedRow(db, 'work_centers', id, companyId, 'work centre');
  const calendar = db.prepare(
    'SELECT weekday, start_minute, end_minute FROM work_center_calendars WHERE work_center_id = ? ORDER BY weekday, start_minute',
  ).all(id);
  return { ...row, calendar };
}

export function listWorkCenters(db, companyId) {
  return db.prepare(
    'SELECT * FROM work_centers WHERE company_id = ? AND is_active = 1 ORDER BY code',
  ).all(companyId);
}

/**
 * Minutes of nominal capacity a work centre offers in a week. Used by the
 * loading report; it is a derived figure and is never stored.
 */
export function weeklyCapacityMinutes(db, workCenterId) {
  const rows = db.prepare(
    'SELECT start_minute, end_minute FROM work_center_calendars WHERE work_center_id = ?',
  ).all(workCenterId);
  return rows.reduce((total, row) => total + (Number(row.end_minute) - Number(row.start_minute)), 0);
}
