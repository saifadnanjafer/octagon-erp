// CRM lead scoring — deterministic, configurable, explainable.
//
// Every point is traceable to a named rule. There is no model, no inference and
// no demographic guessing: a salesperson must be able to ask "why is this lead
// 65?" and get an itemised answer. AI may later *suggest* a score, but these
// rules remain the authority and the explanation.
//
// Rules live in `crm_scoring_rules` (seeded by migration 065) so scoring can be
// retuned per company without a deploy. Every change writes `crm_score_history`.

import { CRM_ERRORS, fail } from './errors.mjs';
import { newId, now, scopeOf, writeAudit } from './shared.mjs';

/** Resolve the value a rule inspects, from the lead plus derived facts. */
function factorValue(db, lead, factor) {
  switch (factor) {
    case 'interaction_count':
      return db.prepare('SELECT COUNT(*) n FROM crm_interactions WHERE lead_id = ?').get(lead.id).n;
    case 'completed_activity_count':
      return db.prepare("SELECT COUNT(*) n FROM crm_activities WHERE lead_id = ? AND state = 'completed'").get(lead.id).n;
    case 'source_weight': {
      if (!lead.source_id) return 0;
      const s = db.prepare('SELECT score_weight FROM crm_lead_sources WHERE id = ?').get(lead.source_id);
      return s ? Number(s.score_weight) : 0;
    }
    default:
      return lead[factor];
  }
}

function ruleApplies(rule, value) {
  const operand = rule.operand ?? '';
  switch (rule.comparator) {
    case 'present':
      return value !== null && value !== undefined && String(value).trim() !== '';
    case 'absent':
      return value === null || value === undefined || String(value).trim() === '';
    case 'equals':
      return String(value) === operand;
    case 'gte':
      return Number(value) >= Number(operand);
    case 'lte':
      return Number(value) <= Number(operand);
    // `weight` contributes the factor's own numeric value rather than fixed points.
    case 'weight':
      return Number(value) > 0;
    default:
      return false;
  }
}

/**
 * Compute a score without writing it.
 *
 * Returned `explanation` is the contract the UI renders and the audit stores.
 */
export function computeScore(db, lead) {
  const rules = db.prepare(
    `SELECT * FROM crm_scoring_rules
      WHERE is_active = 1 AND (company_id = ? OR company_id = '*')
      ORDER BY sequence`
  ).all(lead.company_id);

  let total = 0;
  const explanation = [];

  for (const rule of rules) {
    const value = factorValue(db, lead, rule.factor);
    if (!ruleApplies(rule, value)) continue;

    // A `weight` rule contributes the factor's value; everything else its points.
    const points = rule.comparator === 'weight' ? Number(value) : Number(rule.points);
    if (!Number.isFinite(points) || points === 0) continue;

    total += points;
    explanation.push({
      rule_code: rule.code,
      label_ar: rule.name_ar,
      label_en: rule.name_en,
      factor: rule.factor,
      comparator: rule.comparator,
      points,
    });
  }

  // Two `VALUE_*` bands can both fire; keep the score bounded and honest.
  const bounded = Math.max(0, Math.min(100, total));
  return { score: bounded, rawTotal: total, explanation, clamped: bounded !== total };
}

export function scoreLead(db, input) {
  const { companyId, actor } = scopeOf(input);
  const lead = db.prepare('SELECT * FROM crm_leads WHERE id = ?').get(input.lead_id);
  if (!lead) fail(CRM_ERRORS.LEAD_NOT_FOUND, `unknown lead ${input.lead_id}`, { leadId: input.lead_id });

  const { score, explanation, clamped, rawTotal } = computeScore(db, lead);
  const old = Number(lead.score);
  if (old === score && lead.score_explanation !== '[]') {
    return { leadId: lead.id, score, explanation, changed: false };
  }

  db.prepare('UPDATE crm_leads SET score = ?, score_explanation = ? WHERE id = ?')
    .run(score, JSON.stringify(explanation), lead.id);
  db.prepare(`
    INSERT INTO crm_score_history (id, lead_id, old_score, new_score, explanation, source, changed_at, changed_by)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(newId('sch'), lead.id, old, score, JSON.stringify(explanation), input.source ?? 'rules', now(), actor);

  return { leadId: lead.id, score, previousScore: old, explanation, clamped, rawTotal, changed: true };
}

/**
 * Manual override.
 *
 * Permission-gated by the action layer (`crm:manage_scoring`) and requires a
 * reason — an unexplained manual score is indistinguishable from a mistake.
 */
export function overrideLeadScore(db, input) {
  const { companyId, branchId, actor } = scopeOf(input);
  const lead = db.prepare('SELECT * FROM crm_leads WHERE id = ?').get(input.lead_id);
  if (!lead) fail(CRM_ERRORS.LEAD_NOT_FOUND, `unknown lead ${input.lead_id}`, { leadId: input.lead_id });

  const score = Number(input.score);
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    fail(CRM_ERRORS.VALIDATION_FAILED, 'score must be between 0 and 100', { score: input.score });
  }
  if (!input.reason || !String(input.reason).trim()) {
    fail(CRM_ERRORS.VALIDATION_FAILED, 'a reason is required for a manual score override');
  }

  const old = Number(lead.score);
  const explanation = [{ rule_code: 'MANUAL_OVERRIDE', label_ar: 'تعديل يدوي', label_en: 'Manual override', factor: 'manual', comparator: 'manual', points: score - old, reason: String(input.reason) }];

  db.prepare('UPDATE crm_leads SET score = ?, score_explanation = ? WHERE id = ?')
    .run(score, JSON.stringify(explanation), lead.id);
  db.prepare(`
    INSERT INTO crm_score_history (id, lead_id, old_score, new_score, explanation, source, changed_at, changed_by)
    VALUES (?,?,?,?,?, 'manual', ?, ?)
  `).run(newId('sch'), lead.id, old, score, JSON.stringify(explanation), now(), actor);

  writeAudit(db, { companyId, branchId, actor, action: 'crm.lead.score_override', resource: 'crm_lead', resourceId: lead.id, before: { score: old }, after: { score }, reason: String(input.reason) });
  return { leadId: lead.id, score, previousScore: old, explanation };
}

export function getScoreHistory(db, leadId) {
  return db.prepare('SELECT * FROM crm_score_history WHERE lead_id = ? ORDER BY changed_at DESC').all(leadId)
    .map((r) => ({ ...r, explanation: JSON.parse(r.explanation || '[]') }));
}
