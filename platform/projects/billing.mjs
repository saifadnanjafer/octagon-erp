// Project billing.
//
// Four methods, one posting authority. Every method computes an amount and then
// hands it to the Phase 03 finance pipeline through the registered
// `project_cost_posting` contract. There is no project invoice writer, and
// nothing here touches the GL directly.
//
//   fixed_price       — bill an explicit amount against the contract
//   milestone         — bill an achieved milestone's amount or percentage
//   progress          — bill (percent complete × contract value) − already billed
//   time_and_material — bill unbilled effort at its bill rate
//
// Retainage is withheld from the receivable and parked in a configured
// retainage account until released.

import {
  createDomainError, domainGuards, makeId, nowIso, today, round2,
} from '../kernel/domain/kit.mjs';
import { postSourceFact } from '../finance/engine.mjs';
import { recordCostFact } from './costing.mjs';

export const ProjectBillingError = createDomainError('ProjectBillingError', 'PROJECT_BILLING_ERROR');
const g = domainGuards(ProjectBillingError);

export function setBillingRule(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const actor = g.requireActor(payload);
  const project = g.scopedRow(db, 'projects', payload.project_id, companyId, 'project');
  const method = payload.billing_method;
  if (!['fixed_price', 'time_and_material', 'milestone', 'progress'].includes(method)) {
    throw new ProjectBillingError(`unsupported billing_method: ${method}`, 'INPUT_INVALID');
  }
  for (const field of ['revenue_account_id', 'receivable_account_id', 'retainage_account_id']) {
    if (!payload[field]) continue;
    const account = db.prepare(
      'SELECT id FROM finance_accounts WHERE id = ? AND company_id = ? AND is_active = 1',
    ).get(payload[field], companyId);
    if (!account) {
      throw new ProjectBillingError(`${field} must be an active account in this company`, 'PROJECT_ACCOUNT_INVALID');
    }
  }
  const now = nowIso();
  db.prepare(`
    INSERT INTO project_billing_rules (
      id, project_id, company_id, billing_method, revenue_account_id, receivable_account_id,
      retainage_account_id, retainage_percent, default_bill_rate, updated_at, updated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET
      billing_method = excluded.billing_method,
      revenue_account_id = excluded.revenue_account_id,
      receivable_account_id = excluded.receivable_account_id,
      retainage_account_id = excluded.retainage_account_id,
      retainage_percent = excluded.retainage_percent,
      default_bill_rate = excluded.default_bill_rate,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by
  `).run(
    makeId('prjbr'), project.id, companyId, method,
    payload.revenue_account_id || null, payload.receivable_account_id || null,
    payload.retainage_account_id || null,
    g.nonNegative(payload.retainage_percent ?? project.retainage_percent, 'retainage_percent'),
    g.nonNegative(payload.default_bill_rate, 'default_bill_rate'), now, actor,
  );
  db.prepare('UPDATE projects SET billing_method = ?, updated_at = ?, version = version + 1 WHERE id = ?')
    .run(method, now, project.id);
  return db.prepare('SELECT * FROM project_billing_rules WHERE project_id = ?').get(project.id);
}

function requireRule(db, companyId, project) {
  const rule = db.prepare('SELECT * FROM project_billing_rules WHERE project_id = ? AND company_id = ?')
    .get(project.id, companyId);
  if (!rule) {
    throw new ProjectBillingError(
      'this project has no billing rule; set revenue and receivable accounts first',
      'PROJECT_BILLING_RULE_MISSING',
    );
  }
  if (!rule.revenue_account_id || !rule.receivable_account_id) {
    throw new ProjectBillingError(
      'the billing rule needs both a revenue and a receivable account',
      'PROJECT_BILLING_RULE_MISSING',
    );
  }
  return rule;
}

function billedToDate(db, projectId) {
  return round2(db.prepare(
    "SELECT COALESCE(SUM(amount), 0) AS amount FROM project_billings WHERE project_id = ? AND status = 'posted'",
  ).get(projectId).amount);
}

function computeAmount(db, companyId, project, rule, payload) {
  const method = payload.billing_method || rule.billing_method;

  if (method === 'fixed_price') {
    const amount = g.positive(payload.amount, 'billing amount');
    const remaining = round2(Number(project.contract_value) - billedToDate(db, project.id));
    if (Number(project.contract_value) > 0 && amount - remaining > 0.005 && !payload.allow_over_billing) {
      throw new ProjectBillingError(
        `billing ${amount} exceeds the remaining contract value of ${remaining}`,
        'PROJECT_OVER_BILLING',
      );
    }
    return { method, amount, milestoneId: null, percentComplete: null, effortIds: [] };
  }

  if (method === 'milestone') {
    const milestone = g.scopedRow(db, 'project_milestones', payload.milestone_id, companyId, 'milestone');
    if (milestone.project_id !== project.id) {
      throw new ProjectBillingError('milestone does not belong to this project', 'PROJECT_LINK_MISMATCH');
    }
    if (milestone.status !== 'achieved') {
      throw new ProjectBillingError('only an achieved milestone can be billed', 'PROJECT_MILESTONE_NOT_ACHIEVED');
    }
    if (!Number(milestone.is_billable)) {
      throw new ProjectBillingError('this milestone is not billable', 'PROJECT_MILESTONE_NOT_BILLABLE');
    }
    const amount = Number(milestone.billing_amount) > 0
      ? round2(milestone.billing_amount)
      : round2(Number(project.contract_value) * (Number(milestone.billing_percent) / 100));
    if (!(amount > 0)) {
      throw new ProjectBillingError('the milestone has no billable amount', 'PROJECT_BILLING_AMOUNT_INVALID');
    }
    return { method, amount, milestoneId: milestone.id, percentComplete: null, effortIds: [] };
  }

  if (method === 'progress') {
    const percent = payload.percent_complete === undefined
      ? Number(project.percent_complete)
      : g.nonNegative(payload.percent_complete, 'percent_complete');
    if (percent > 100) throw new ProjectBillingError('percent_complete cannot exceed 100', 'INPUT_INVALID');
    const earned = round2(Number(project.contract_value) * (percent / 100));
    const amount = round2(earned - billedToDate(db, project.id));
    if (!(amount > 0)) {
      throw new ProjectBillingError(
        `progress billing produced no new amount (earned ${earned}, already billed ${billedToDate(db, project.id)})`,
        'PROJECT_BILLING_AMOUNT_INVALID',
      );
    }
    return { method, amount, milestoneId: null, percentComplete: percent, effortIds: [] };
  }

  if (method === 'time_and_material') {
    const entries = db.prepare(`
      SELECT id, hours, bill_rate_per_hour FROM project_effort_entries
      WHERE project_id = ? AND company_id = ? AND is_billable = 1 AND billed_document_id IS NULL
      ORDER BY effort_date, id
    `).all(project.id, companyId);
    if (!entries.length) {
      throw new ProjectBillingError('there is no unbilled billable effort on this project', 'PROJECT_NOTHING_TO_BILL');
    }
    let amount = 0;
    const effortIds = [];
    for (const entry of entries) {
      const rate = Number(entry.bill_rate_per_hour) > 0
        ? Number(entry.bill_rate_per_hour)
        : Number(rule.default_bill_rate || 0);
      if (!(rate > 0)) {
        throw new ProjectBillingError(
          `effort ${entry.id} has no bill rate and the project has no default bill rate`,
          'PROJECT_BILL_RATE_MISSING',
        );
      }
      amount = round2(amount + Number(entry.hours) * rate);
      effortIds.push(entry.id);
    }
    if (!(amount > 0)) {
      throw new ProjectBillingError('billable effort produced a zero amount', 'PROJECT_BILLING_AMOUNT_INVALID');
    }
    return { method, amount, milestoneId: null, percentComplete: null, effortIds };
  }

  throw new ProjectBillingError(`unsupported billing_method: ${method}`, 'INPUT_INVALID');
}

/**
 * Bill the project. The finance document is created, submitted, approved and
 * posted by the Phase 03 pipeline; this function contributes only the lines.
 */
export function billProject(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const actor = g.requireActor(payload);
  const project = g.scopedRow(db, 'projects', payload.project_id, companyId, 'project');
  g.assertState(project.state, ['active', 'on_hold', 'completed'], 'project', 'PROJECT_STATE_INVALID');
  const rule = requireRule(db, companyId, project);

  const { method, amount, milestoneId, percentComplete, effortIds } =
    computeAmount(db, companyId, project, rule, payload);

  const retainagePercent = payload.retainage_percent === undefined
    ? Number(rule.retainage_percent || 0)
    : g.nonNegative(payload.retainage_percent, 'retainage_percent');
  const retainage = round2(amount * (retainagePercent / 100));
  if (retainage > 0 && !rule.retainage_account_id) {
    throw new ProjectBillingError(
      'a retainage percentage is configured but no retainage account is set',
      'PROJECT_RETAINAGE_ACCOUNT_MISSING',
    );
  }
  const receivable = round2(amount - retainage);

  const lines = [
    { account_id: rule.receivable_account_id, debit: receivable, credit: 0, description: `project_billing:${project.code}` },
    { account_id: rule.revenue_account_id, debit: 0, credit: amount, description: `project_billing:${project.code}` },
  ];
  if (retainage > 0) {
    lines.splice(1, 0, {
      account_id: rule.retainage_account_id,
      debit: retainage,
      credit: 0,
      description: `project_retainage:${project.code}`,
    });
  }

  const posted = postSourceFact(db, g.financeContext(payload), {
    fact_type: 'project_cost_posting',
    source_id: `${project.id}:billing:${milestoneId || method}:${billedToDate(db, project.id)}:${amount}`,
    doc_date: payload.doc_date || today(),
    currency: payload.currency || project.currency || 'IQD',
    partner_id: project.customer_party_id || null,
    lines,
  });

  const id = payload.id || makeId('prjbill');
  const now = nowIso();
  db.prepare(`
    INSERT INTO project_billings (
      id, project_id, company_id, billing_method, milestone_id, amount, retainage_amount,
      currency, percent_complete, finance_document_id, status, billed_by, billed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?)
  `).run(
    id, project.id, companyId, method, milestoneId, amount, retainage,
    payload.currency || project.currency || 'IQD', percentComplete,
    posted.document_id, actor, now,
  );

  if (milestoneId) {
    db.prepare("UPDATE project_milestones SET status = 'billed', billed_document_id = ? WHERE id = ?")
      .run(posted.document_id, milestoneId);
  }
  if (effortIds.length) {
    const mark = db.prepare('UPDATE project_effort_entries SET billed_document_id = ? WHERE id = ?');
    for (const effortId of effortIds) mark.run(posted.document_id, effortId);
  }
  if (percentComplete !== null) {
    db.prepare('UPDATE projects SET percent_complete = ?, updated_at = ?, version = version + 1 WHERE id = ?')
      .run(percentComplete, now, project.id);
  }

  // Revenue is recorded as a project fact so profitability reads one table.
  recordCostFact(db, {
    companyId, projectId: project.id, costType: 'revenue', amount,
    currency: payload.currency || project.currency || 'IQD',
    financeDocumentId: posted.document_id, sourceReference: id, actor,
  });

  return {
    billing_id: id,
    project_id: project.id,
    billing_method: method,
    amount,
    retainage_amount: retainage,
    receivable_amount: receivable,
    finance_document_id: posted.document_id,
    milestone_id: milestoneId,
    effort_entries_billed: effortIds.length,
  };
}

/**
 * Release withheld retainage: move it from the retainage account into the
 * ordinary receivable, again through the Phase 03 pipeline.
 */
export function releaseRetainage(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const actor = g.requireActor(payload);
  const project = g.scopedRow(db, 'projects', payload.project_id, companyId, 'project');
  const rule = requireRule(db, companyId, project);
  if (!rule.retainage_account_id) {
    throw new ProjectBillingError('no retainage account is configured', 'PROJECT_RETAINAGE_ACCOUNT_MISSING');
  }
  const withheld = round2(db.prepare(
    "SELECT COALESCE(SUM(retainage_amount), 0) AS amount FROM project_billings WHERE project_id = ? AND status = 'posted'",
  ).get(project.id).amount);
  const amount = payload.amount === undefined ? withheld : g.positive(payload.amount, 'release amount');
  if (!(amount > 0)) throw new ProjectBillingError('there is no retainage to release', 'PROJECT_NOTHING_TO_RELEASE');
  if (amount - withheld > 0.005) {
    throw new ProjectBillingError(
      `cannot release ${amount}; only ${withheld} is withheld`,
      'PROJECT_RETAINAGE_EXCEEDED',
    );
  }
  const posted = postSourceFact(db, g.financeContext(payload), {
    fact_type: 'project_cost_posting',
    source_id: `${project.id}:retainage-release:${amount}:${nowIso()}`,
    doc_date: payload.doc_date || today(),
    currency: payload.currency || project.currency || 'IQD',
    partner_id: project.customer_party_id || null,
    lines: [
      { account_id: rule.receivable_account_id, debit: amount, credit: 0, description: `retainage_release:${project.code}` },
      { account_id: rule.retainage_account_id, debit: 0, credit: amount, description: `retainage_release:${project.code}` },
    ],
  });
  return { project_id: project.id, amount, finance_document_id: posted.document_id, released_by: actor };
}

export function listBillings(db, { company_id, project_id }) {
  return db.prepare(
    'SELECT * FROM project_billings WHERE company_id = ? AND project_id = ? ORDER BY billed_at',
  ).all(company_id, project_id);
}
