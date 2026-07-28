// Project / manufacturing effort facts — Checkpoint D1.
//
// ============================ FROZEN ZONE ============================
// This module NEVER reads and NEVER writes payroll, attendance, or
// timesheet facts. The frozen tables are:
//
//   employees                      employee_advances
//   employee_payroll_closings      payroll_payments
//   payroll_periods                omni.employeeAttendance
//   omni.workshopAdvances          omni.workshopTimesheetCases
//
// Effort recorded here is a NEW canonical fact stored in
// project_effort_entries. Cost is derived from the configured standard
// rates in project_cost_rates. `employee_ref` is an opaque, read-only
// reference string used for reporting only — it is never joined back into
// payroll and no payroll value is ever reinterpreted as a cost input.
// =====================================================================

'use strict';

import { fail, requireFields } from './errors.mjs';
import { getProject, makeId } from './projects.mjs';

// Guard list used by the fail-closed frozen-zone test. Any attempt to route
// a write at one of these through this module is a hard denial.
export const FROZEN_TABLES = Object.freeze([
  'employees',
  'employee_advances',
  'employee_payroll_closings',
  'payroll_payments',
  'payroll_periods',
]);

export function assertNotFrozen(tableName) {
  if (FROZEN_TABLES.includes(String(tableName))) {
    fail(
      `${tableName} is in the frozen payroll zone and is read-only`,
      'FROZEN_ZONE_WRITE_DENIED',
      403,
    );
  }
  return true;
}

function now() {
  return new Date().toISOString();
}

/**
 * Resolve the hourly cost for an effort entry from CONFIGURED standard rates
 * only. Resolution order is most-specific first:
 *   1. explicit work_center rate  (entry_type 'machine')
 *   2. explicit employee standard cost rate
 *   3. role rate
 *   4. the 'default' role rate
 * Payroll is never consulted at any step.
 */
export function resolveHourlyCost(db, companyId, input = {}) {
  const lookup = db.prepare(`
    SELECT hourly_cost FROM project_cost_rates
    WHERE rate_scope = ? AND rate_key = ? AND is_active = 1 AND company_id IN (?, '*')
    ORDER BY CASE company_id WHEN '*' THEN 1 ELSE 0 END
    LIMIT 1
  `);

  if (input.work_center_id) {
    const row = lookup.get('work_center', String(input.work_center_id), companyId);
    if (row) return { hourly_cost: Number(row.hourly_cost), rate_source: 'work_center' };
  }
  if (input.employee_ref) {
    const row = lookup.get('employee', String(input.employee_ref), companyId);
    if (row) return { hourly_cost: Number(row.hourly_cost), rate_source: 'employee' };
  }
  const roleKey = String(input.role_key || 'default');
  const roleRow = lookup.get('role', roleKey, companyId);
  if (roleRow) return { hourly_cost: Number(roleRow.hourly_cost), rate_source: 'role' };

  const fallback = lookup.get('role', 'default', companyId);
  if (fallback) return { hourly_cost: Number(fallback.hourly_cost), rate_source: 'role_default' };

  fail(
    'no configured standard cost rate matches this effort entry',
    'PROJECT_COST_RATE_NOT_CONFIGURED',
    409,
  );
  return null;
}

export function recordEffort(db, input = {}) {
  requireFields(input, ['hours']);
  const companyId = input.company_id;
  const hours = Number(input.hours);
  if (!Number.isFinite(hours) || hours <= 0) {
    fail('effort hours must be a positive number', 'PROJECT_EFFORT_HOURS_INVALID', 400);
  }
  if (hours > 24) {
    fail('a single effort entry cannot exceed 24 hours', 'PROJECT_EFFORT_HOURS_INVALID', 400);
  }

  const entryType = String(input.entry_type || 'labor');
  if (!['labor', 'machine'].includes(entryType)) {
    fail(`unsupported effort entry type: ${entryType}`, 'PROJECT_EFFORT_TYPE_INVALID', 400);
  }

  // An effort entry must be anchored to at least one canonical execution
  // context, otherwise it is an unattributable cost.
  const anchors = ['project_id', 'production_order_id', 'work_order_id', 'maintenance_order_id'];
  if (!anchors.some((key) => input[key])) {
    fail(
      'effort must reference a project, production order, work order, or maintenance order',
      'PROJECT_EFFORT_UNANCHORED',
      400,
    );
  }

  let project = null;
  if (input.project_id) {
    project = getProject(db, input.project_id, companyId);
    if (['archived', 'cancelled'].includes(project.status)) {
      fail(`effort cannot be booked to a ${project.status} project`, 'PROJECT_NOT_ACTIVE', 409);
    }
  }
  if (input.cost_code_id && project) {
    const costCode = db.prepare('SELECT id FROM project_cost_codes WHERE id = ? AND project_id = ?')
      .get(input.cost_code_id, project.id);
    if (!costCode) fail('cost code not found on this project', 'PROJECT_COST_CODE_NOT_FOUND', 404);
  }

  const { hourly_cost: hourlyCost, rate_source: rateSource } = resolveHourlyCost(db, companyId, {
    work_center_id: entryType === 'machine' ? input.work_center_id : null,
    employee_ref: input.employee_ref,
    role_key: input.role_key,
  });
  const totalCost = Number((hours * hourlyCost).toFixed(4));

  const id = makeId('prjeff');
  const stamp = now();
  db.prepare(`
    INSERT INTO project_effort_entries (
      id, company_id, branch_id, project_id, phase_id, cost_code_id, work_item_id,
      production_order_id, work_order_id, maintenance_order_id, employee_ref,
      role_key, work_center_id, entry_type, effort_date, hours, hourly_cost,
      total_cost, rate_source, notes, recorded_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, companyId, input.branch_id || null,
    project ? project.id : null, input.phase_id || null, input.cost_code_id || null,
    input.work_item_id || null, input.production_order_id || null,
    input.work_order_id || null, input.maintenance_order_id || null,
    input.employee_ref ? String(input.employee_ref) : null,
    String(input.role_key || 'default'), input.work_center_id || null,
    entryType, String(input.effort_date || stamp.slice(0, 10)),
    hours, hourlyCost, totalCost, rateSource,
    String(input.notes || ''), input.actor || null, stamp,
  );

  return {
    ...db.prepare('SELECT * FROM project_effort_entries WHERE id = ?').get(id),
    // Explicit provenance so evidence and the UI can show that this cost came
    // from configured standard rates, not from payroll.
    cost_basis: 'configured_standard_rate',
    payroll_consulted: false,
  };
}

export function listEffort(db, ctx = {}, query = {}) {
  const filters = ['company_id = ?'];
  const params = [ctx.companyId];
  if (query.project_id) { filters.push('project_id = ?'); params.push(String(query.project_id)); }
  if (query.production_order_id) { filters.push('production_order_id = ?'); params.push(String(query.production_order_id)); }
  if (query.work_order_id) { filters.push('work_order_id = ?'); params.push(String(query.work_order_id)); }
  if (query.maintenance_order_id) { filters.push('maintenance_order_id = ?'); params.push(String(query.maintenance_order_id)); }
  const limit = Math.min(Number(query.limit || 200), 500);
  return db.prepare(
    `SELECT * FROM project_effort_entries WHERE ${filters.join(' AND ')} ORDER BY effort_date DESC, created_at DESC LIMIT ?`,
  ).all(...params, limit);
}
