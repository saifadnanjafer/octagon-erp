// platform/domains/crm/query-service.mjs — Governed HTTP read queries, Customer 360, and Analytics.

import { getLead } from './lead-service.mjs';
import { getOpportunity } from './opportunity-service.mjs';
import { getActivity } from './activity-service.mjs';

// --- Lead & Opportunity queries ---

export function listLeads(db, { company_id, stage, salesperson_id, source_id, search, limit = 100, offset = 0 }) {
  const filters = ['company_id = ?'];
  const params = [company_id];

  if (stage) { filters.push('stage = ?'); params.push(stage); }
  if (salesperson_id) { filters.push('salesperson_id = ?'); params.push(salesperson_id); }
  if (source_id) { filters.push('source_id = ?'); params.push(source_id); }
  if (search) {
    filters.push('(name LIKE ? OR contact_name LIKE ? OR email LIKE ? OR phone LIKE ?)');
    const s = `%${search}%`;
    params.push(s, s, s, s);
  }

  const where = filters.join(' AND ');
  const rows = db.prepare(`SELECT * FROM crm_leads WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, Number(limit), Number(offset));
  const total = db.prepare(`SELECT COUNT(*) as n FROM crm_leads WHERE ${where}`).get(...params).n;

  return { rows, total };
}

export function listOpportunities(db, { company_id, stage, status, party_id, salesperson_id, pipeline_id, limit = 100, offset = 0 }) {
  const filters = ['company_id = ?'];
  const params = [company_id];

  if (stage) { filters.push('stage = ?'); params.push(stage); }
  if (status) { filters.push('status = ?'); params.push(status); }
  if (party_id) { filters.push('party_id = ?'); params.push(party_id); }
  if (salesperson_id) { filters.push('salesperson_id = ?'); params.push(salesperson_id); }
  if (pipeline_id) { filters.push('pipeline_id = ?'); params.push(pipeline_id); }

  const where = filters.join(' AND ');
  const rows = db.prepare(`SELECT * FROM crm_opportunities WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, Number(limit), Number(offset));
  const total = db.prepare(`SELECT COUNT(*) as n FROM crm_opportunities WHERE ${where}`).get(...params).n;

  return { rows, total };
}

export function listActivities(db, { company_id, party_id, lead_id, opportunity_id, status, assigned_to, limit = 100, offset = 0 }) {
  const filters = ['company_id = ?'];
  const params = [company_id];

  if (party_id) { filters.push('party_id = ?'); params.push(party_id); }
  if (lead_id) { filters.push('lead_id = ?'); params.push(lead_id); }
  if (opportunity_id) { filters.push('opportunity_id = ?'); params.push(opportunity_id); }
  if (status) { filters.push('status = ?'); params.push(status); }
  if (assigned_to) { filters.push('assigned_to = ?'); params.push(assigned_to); }

  const where = filters.join(' AND ');
  const rows = db.prepare(`SELECT * FROM crm_activities WHERE ${where} ORDER BY due_date ASC, created_at DESC LIMIT ? OFFSET ?`).all(...params, Number(limit), Number(offset));
  const total = db.prepare(`SELECT COUNT(*) as n FROM crm_activities WHERE ${where}`).get(...params).n;

  return { rows, total };
}

export function listPipelines(db, { company_id }) {
  return db.prepare("SELECT * FROM crm_pipelines WHERE company_id = ? OR company_id = '*' ORDER BY is_default DESC, name_ar ASC").all(company_id);
}

export function listPipelineStages(db, { pipeline_id, company_id }) {
  if (pipeline_id) {
    return db.prepare('SELECT * FROM crm_pipeline_stages WHERE pipeline_id = ? ORDER BY sequence ASC').all(pipeline_id);
  }
  return db.prepare("SELECT * FROM crm_pipeline_stages WHERE company_id = ? OR company_id = '*' ORDER BY pipeline_id ASC, sequence ASC").all(company_id);
}

// --- Customer 360 View (Section 11) ---

export function getCustomer360(db, partyId, companyId) {
  const party = db.prepare("SELECT * FROM parties WHERE id = ? AND (company_id = ? OR company_id = '*')").get(partyId, companyId);
  if (!party) return null;

  const opportunities = db.prepare('SELECT * FROM crm_opportunities WHERE party_id = ? AND company_id = ? ORDER BY created_at DESC').all(partyId, companyId);

  const leads = db.prepare(`
    SELECT l.* FROM crm_leads l
    JOIN crm_conversion_links cl ON cl.lead_id = l.id
    WHERE cl.party_id = ? AND l.company_id = ?
  `).all(partyId, companyId);

  const activities = db.prepare('SELECT * FROM crm_activities WHERE party_id = ? AND company_id = ? ORDER BY due_date ASC, created_at DESC').all(partyId, companyId);

  const salesOrders = db.prepare('SELECT id, name, state, amount_total, currency_id, created_at FROM sale_orders WHERE partner_id = ? AND company_id = ? ORDER BY created_at DESC LIMIT 50').all(partyId, companyId);

  const openInvoices = db.prepare(`
    SELECT COUNT(*) as count, COALESCE(SUM(amount_total), 0) as total_open_amount
    FROM sale_orders WHERE partner_id = ? AND company_id = ? AND state = 'confirmed'
  `).get(partyId, companyId);

  return {
    party,
    opportunities,
    leads,
    activities,
    sales_orders: salesOrders,
    financial_summary: {
      confirmed_orders_count: openInvoices ? openInvoices.count : 0,
      confirmed_orders_value: openInvoices ? openInvoices.total_open_amount : 0,
      credit_limit: party.credit_limit || 0,
    },
  };
}

// --- Reporting & Scoring Queries (Section 12) ---

export function getScoringRules(db, { company_id }) {
  return db.prepare("SELECT * FROM crm_scoring_rules WHERE company_id = ? OR company_id = '*' ORDER BY sequence ASC").all(company_id);
}

export function getScoreHistory(db, { lead_id }) {
  return db.prepare('SELECT * FROM crm_score_history WHERE lead_id = ? ORDER BY changed_at DESC').all(lead_id);
}

export function getPipelineSummaryReport(db, { company_id, pipeline_id = null }) {
  const wherePipeline = pipeline_id ? ' AND pipeline_id = ?' : '';
  const params = pipeline_id ? [company_id, pipeline_id] : [company_id];

  const stages = db.prepare(`
    SELECT stage, COUNT(*) as opportunity_count,
           COALESCE(SUM(expected_value), 0) as total_revenue,
           COALESCE(SUM(expected_value * probability / 100.0), 0) as weighted_revenue
    FROM crm_opportunities
    WHERE company_id = ? AND status = 'open'${wherePipeline}
    GROUP BY stage
  `).all(...params);

  const totals = db.prepare(`
    SELECT COUNT(*) as total_open,
           COALESCE(SUM(expected_value), 0) as total_pipeline_value,
           COALESCE(SUM(expected_value * probability / 100.0), 0) as total_weighted_value
    FROM crm_opportunities
    WHERE company_id = ? AND status = 'open'${wherePipeline}
  `).get(...params);

  const wonLost = db.prepare(`
    SELECT status, COUNT(*) as count, COALESCE(SUM(expected_value), 0) as value
    FROM crm_opportunities
    WHERE company_id = ?${wherePipeline}
    GROUP BY status
  `).all(...params);

  const winRate = (() => {
    const won = wonLost.find(r => r.status === 'won')?.count || 0;
    const lost = wonLost.find(r => r.status === 'lost')?.count || 0;
    const totalClosed = won + lost;
    return totalClosed > 0 ? (won / totalClosed) * 100 : 0;
  })();

  return {
    by_stage: stages,
    totals: {
      ...totals,
      win_rate_percent: winRate,
    },
    by_status: wonLost,
  };
}

export function getLeadConversionReport(db, { company_id }) {
  const bySource = db.prepare(`
    SELECT s.name_ar as source_name, COUNT(l.id) as total_leads,
           SUM(CASE WHEN l.stage = 'converted' THEN 1 ELSE 0 END) as converted_leads
    FROM crm_leads l
    LEFT JOIN crm_lead_sources s ON l.source_id = s.id
    WHERE l.company_id = ?
    GROUP BY l.source_id
  `).all(company_id);

  const totals = db.prepare(`
    SELECT COUNT(*) as total_leads,
           SUM(CASE WHEN stage = 'converted' THEN 1 ELSE 0 END) as converted_leads,
           SUM(CASE WHEN stage = 'qualified' THEN 1 ELSE 0 END) as qualified_leads,
           SUM(CASE WHEN stage = 'unqualified' THEN 1 ELSE 0 END) as disqualified_leads
    FROM crm_leads
    WHERE company_id = ?
  `).get(company_id);

  const conversionRate = totals.total_leads > 0 ? (totals.converted_leads / totals.total_leads) * 100 : 0;

  return {
    totals: {
      ...totals,
      conversion_rate_percent: conversionRate,
    },
    by_source: bySource,
  };
}

export function getActivitySummaryReport(db, { company_id }) {
  const byType = db.prepare(`
    SELECT activity_type, COUNT(*) as total_count,
           SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_count,
           SUM(CASE WHEN status = 'planned' AND due_date < DATE('now') THEN 1 ELSE 0 END) as overdue_count
    FROM crm_activities
    WHERE company_id = ?
    GROUP BY activity_type
  `).all(company_id);

  const bySalesperson = db.prepare(`
    SELECT assigned_user_id, COUNT(*) as total_count,
           SUM(CASE WHEN state = 'completed' THEN 1 ELSE 0 END) as completed_count
    FROM crm_activities
    WHERE company_id = ? AND assigned_user_id IS NOT NULL
    GROUP BY assigned_user_id
  `).all(company_id);

  return {
    by_type: byType,
    by_salesperson: bySalesperson,
  };
}
