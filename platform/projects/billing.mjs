// Project billing requests — Checkpoint D1.
//
// Billing is a two-step governed workflow:
//   1. projects:billing:request  -> raises a DRAFT request (no GL effect)
//   2. projects:billing:approve  -> approves it and, when an AR account
//      mapping is available, posts revenue through the canonical Phase 03
//      Finance authority via postSourceFact('sales_invoice_posting').
//
// This module never writes journals or ledger lines itself. Finance remains
// the only GL writer.

'use strict';

import { fail, requireFields } from './errors.mjs';
import { getProject, makeId } from './projects.mjs';

const BILLING_METHODS = new Set(['fixed_price', 'milestone', 'time_and_material']);

function now() {
  return new Date().toISOString();
}

function round(value) {
  return Number(Number(value || 0).toFixed(4));
}

/**
 * Uninvoiced time-and-material effort value for a project. Used to size and
 * validate T&M billing requests so a project cannot bill effort it never
 * recorded.
 */
export function billableEffortValue(db, companyId, projectId) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(total_cost), 0) AS cost, COALESCE(SUM(hours), 0) AS hours
    FROM project_effort_entries
    WHERE company_id = ? AND project_id = ?
  `).get(companyId, projectId);
  const billed = db.prepare(`
    SELECT COALESCE(SUM(effort_hours), 0) AS hours
    FROM project_billing_requests
    WHERE company_id = ? AND project_id = ? AND state IN ('approved','invoiced')
      AND billing_method = 'time_and_material'
  `).get(companyId, projectId).hours;
  return { total_hours: round(row.hours), total_cost: round(row.cost), billed_hours: round(billed), unbilled_hours: round(row.hours - billed) };
}

export function requestBilling(db, input = {}) {
  requireFields(input, ['project_id', 'amount']);
  const companyId = input.company_id;
  const project = getProject(db, input.project_id, companyId);
  if (!['active', 'completed'].includes(project.status)) {
    fail(
      `billing can only be requested on an active or completed project (project is ${project.status})`,
      'PROJECT_NOT_BILLABLE',
      409,
    );
  }

  const gross = Number(input.amount);
  if (!Number.isFinite(gross) || gross <= 0) {
    fail('billing amount must be a positive number', 'PROJECT_BILLING_AMOUNT_INVALID', 400);
  }

  const method = String(input.billing_method || project.billing_method);
  if (!BILLING_METHODS.has(method)) {
    fail(`unsupported billing method: ${method}`, 'BILLING_METHOD_INVALID', 400);
  }

  let milestone = null;
  if (method === 'milestone') {
    requireFields(input, ['milestone_id']);
    milestone = db.prepare('SELECT * FROM project_milestones WHERE id = ? AND project_id = ?')
      .get(input.milestone_id, project.id);
    if (!milestone) fail('milestone not found on this project', 'PROJECT_MILESTONE_NOT_FOUND', 404);
    if (milestone.status !== 'achieved') {
      fail('milestone billing requires an achieved milestone', 'PROJECT_MILESTONE_NOT_ACHIEVED', 409);
    }
    const existing = db.prepare(`
      SELECT id FROM project_billing_requests
      WHERE milestone_id = ? AND state IN ('draft','approved','invoiced')
    `).get(milestone.id);
    if (existing) {
      fail('this milestone already has an open or invoiced billing request', 'PROJECT_MILESTONE_ALREADY_BILLED', 409);
    }
  }

  let effortHours = 0;
  if (method === 'time_and_material') {
    const billable = billableEffortValue(db, companyId, project.id);
    effortHours = input.effort_hours !== undefined ? Number(input.effort_hours) : billable.unbilled_hours;
    if (!(effortHours > 0)) {
      fail('no unbilled effort is available for time-and-material billing', 'PROJECT_NO_BILLABLE_EFFORT', 409);
    }
    if (effortHours > billable.unbilled_hours + 1e-9) {
      fail(
        `requested ${effortHours}h exceeds unbilled effort ${billable.unbilled_hours}h`,
        'PROJECT_EFFORT_OVER_BILLED',
        409,
      );
    }
  }

  // Fixed-price and milestone billing may not exceed the contract value in
  // aggregate; that would bill revenue the contract never authorised.
  if (method !== 'time_and_material' && Number(project.contract_value) > 0) {
    const already = db.prepare(`
      SELECT COALESCE(SUM(gross_amount), 0) AS total
      FROM project_billing_requests
      WHERE company_id = ? AND project_id = ? AND state IN ('draft','approved','invoiced')
        AND billing_method != 'time_and_material'
    `).get(companyId, project.id).total;
    if (already + gross > Number(project.contract_value) + 1e-9) {
      fail(
        `billing ${gross} would exceed the contract value ${project.contract_value} (already requested ${already})`,
        'PROJECT_BILLING_EXCEEDS_CONTRACT',
        409,
      );
    }
  }

  const retentionPercent = input.retention_percent !== undefined
    ? Number(input.retention_percent)
    : Number(project.retention_percent || 0);
  if (retentionPercent < 0 || retentionPercent >= 100) {
    fail('retention percent must be between 0 and 100', 'PROJECT_RETENTION_INVALID', 400);
  }
  const retentionAmount = round(gross * (retentionPercent / 100));
  const netAmount = round(gross - retentionAmount);

  const id = makeId('prjbr');
  const stamp = now();
  db.prepare(`
    INSERT INTO project_billing_requests (
      id, company_id, project_id, milestone_id, billing_method, description,
      gross_amount, retention_percent, retention_amount, net_amount, effort_hours,
      state, requested_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)
  `).run(
    id, companyId, project.id, milestone ? milestone.id : null, method,
    String(input.description || ''), round(gross), retentionPercent, retentionAmount,
    netAmount, round(effortHours), input.actor || null, stamp, stamp,
  );

  if (milestone) {
    db.prepare('UPDATE project_milestones SET billing_request_id = ?, updated_at = ? WHERE id = ?')
      .run(id, stamp, milestone.id);
  }
  return db.prepare('SELECT * FROM project_billing_requests WHERE id = ?').get(id);
}

/**
 * Approve a billing request. When `post_revenue` is requested and the caller
 * supplies the canonical account mapping, revenue is posted through the
 * Phase 03 Finance authority — this module never writes the GL itself.
 *
 * The finance posting is injected so the Projects domain keeps no direct
 * dependency on a specific finance implementation and stays testable in
 * isolation.
 */
export function approveBilling(db, input = {}, deps = {}) {
  requireFields(input, ['billing_request_id']);
  const companyId = input.company_id;
  const request = db.prepare('SELECT * FROM project_billing_requests WHERE id = ? AND company_id = ?')
    .get(input.billing_request_id, companyId);
  if (!request) fail('billing request not found', 'PROJECT_BILLING_REQUEST_NOT_FOUND', 404);
  if (request.state !== 'draft') {
    fail(`billing request is already ${request.state}`, 'PROJECT_BILLING_REQUEST_CLOSED', 409);
  }
  const project = getProject(db, request.project_id, companyId);

  const stamp = now();
  db.prepare(`
    UPDATE project_billing_requests
    SET state = 'approved', approved_by = ?, approved_at = ?, updated_at = ?
    WHERE id = ?
  `).run(input.actor || null, stamp, stamp, request.id);

  // Revenue posting is optional and fully delegated. Without an explicit
  // account mapping the request stays 'approved' and Finance remains
  // untouched — no browser-generated accounting, no implicit GL guesses.
  let financeDocumentId = null;
  if (input.post_revenue && typeof deps.postSourceFact === 'function') {
    if (!input.revenue_account_id || !input.receivable_account_id) {
      fail(
        'posting project revenue requires revenue_account_id and receivable_account_id',
        'PROJECT_BILLING_ACCOUNTS_REQUIRED',
        400,
      );
    }
    if (!project.party_id) {
      fail('project revenue cannot be posted without a customer party', 'PROJECT_PARTY_REQUIRED', 409);
    }
    const posted = deps.postSourceFact(db, { companyId, userId: input.actor }, {
      fact_type: 'sales_invoice_posting',
      move_type: 'customer_invoice',
      doc_date: String(input.doc_date || stamp.slice(0, 10)),
      partner_id: project.party_id,
      currency: project.currency_code || 'IQD',
      source_id: request.id,
      source_document_type: 'project_billing_request',
      lines: [
        { account_id: input.receivable_account_id, debit: request.net_amount, credit: 0, description: `Project ${project.project_number} billing` },
        { account_id: input.revenue_account_id, debit: 0, credit: request.net_amount, description: `Project ${project.project_number} revenue` },
      ],
    });
    financeDocumentId = posted && posted.id ? posted.id : null;
    db.prepare(`
      UPDATE project_billing_requests SET state = 'invoiced', finance_document_id = ?, updated_at = ?
      WHERE id = ?
    `).run(financeDocumentId, stamp, request.id);
  }

  return {
    ...db.prepare('SELECT * FROM project_billing_requests WHERE id = ?').get(request.id),
    finance_document_id: financeDocumentId,
    gl_writer: 'platform.finance',
  };
}

export function listBillingRequests(db, ctx = {}, query = {}) {
  const filters = ['company_id = ?'];
  const params = [ctx.companyId];
  if (query.project_id) { filters.push('project_id = ?'); params.push(String(query.project_id)); }
  if (query.state) { filters.push('state = ?'); params.push(String(query.state)); }
  const limit = Math.min(Number(query.limit || 200), 500);
  return db.prepare(
    `SELECT * FROM project_billing_requests WHERE ${filters.join(' AND ')} ORDER BY created_at DESC LIMIT ?`,
  ).all(...params, limit);
}
