// CRM Opportunity service — governed lifecycle over the canonical Party.
//
// Lifecycle: open → (pipeline stages) → won
//            open → lost → reopened → open
//
// Two rules shape everything here:
//
// 1. Weighted revenue is ALWAYS server-derived (expected × probability ÷ 100).
//    A client-supplied weighted figure is ignored — forecast numbers that a
//    caller can set are not forecasts.
//
// 2. Won requires evidence: a linked quotation, a linked Sales Order, or an
//    explicit privileged override carrying a reason. A salesperson marking a
//    deal won with nothing behind it is how a pipeline stops matching reality.
//
// `status`, `stage`, `expected_value` and `version` are the existing 046
// columns and keep their meaning; 065's additions carry the rest.

import { CRM_ERRORS, fail } from './errors.mjs';
import { newId, now, scopeOf, nextReference, writeAudit, emitEvent } from './shared.mjs';

const OPEN = 'open';

export function getOpportunity(db, id) {
  const opp = db.prepare('SELECT * FROM crm_opportunities WHERE id = ?').get(id);
  if (!opp) fail(CRM_ERRORS.OPPORTUNITY_NOT_FOUND, `unknown opportunity ${id}`, { opportunityId: id });
  return opp;
}

function assertScope(opp, companyId) {
  if (opp.company_id !== companyId) {
    fail(CRM_ERRORS.OPPORTUNITY_NOT_FOUND, 'opportunity belongs to another company', { opportunityId: opp.id });
  }
}

function assertOpen(opp) {
  if (opp.archived === 1) fail(CRM_ERRORS.OPPORTUNITY_NOT_OPEN, 'opportunity is archived; restore it first', { opportunityId: opp.id });
  if (opp.status !== OPEN) fail(CRM_ERRORS.OPPORTUNITY_NOT_OPEN, `opportunity is ${opp.status}`, { opportunityId: opp.id, status: opp.status });
}

function assertVersion(opp, expected) {
  if (expected !== undefined && expected !== null && Number(expected) !== Number(opp.version)) {
    fail(CRM_ERRORS.VERSION_CONFLICT, 'opportunity was modified by someone else', {
      opportunityId: opp.id, expected: Number(expected), actual: Number(opp.version),
    });
  }
}

/** Server-derived. Never read from input. */
export const weighted = (expectedValue, probability) =>
  Math.round(Number(expectedValue || 0) * (Number(probability || 0) / 100) * 100) / 100;

function bump(db, id, actor) {
  db.prepare('UPDATE crm_opportunities SET version = version + 1, updated_at = ?, updated_by = ? WHERE id = ?')
    .run(now(), actor, id);
}

function recalcWeighted(db, id) {
  const o = getOpportunity(db, id);
  db.prepare('UPDATE crm_opportunities SET weighted_revenue = ? WHERE id = ?')
    .run(weighted(o.expected_value, o.probability), id);
}

// ---------------------------------------------------------------------------

export function createOpportunity(db, input) {
  const { companyId, branchId, actor } = scopeOf(input);
  if (!input.party_id) fail(CRM_ERRORS.VALIDATION_FAILED, 'an opportunity requires a canonical party', { field: 'party_id' });

  const party = db.prepare("SELECT id FROM parties WHERE id = ? AND company_id = ? AND status = 'active'")
    .get(input.party_id, companyId);
  if (!party) fail(CRM_ERRORS.PARTY_NOT_FOUND, `unknown or inactive party ${input.party_id}`, { partyId: input.party_id });

  const pipeline = input.pipeline_id
    ? db.prepare('SELECT * FROM crm_pipelines WHERE id = ? AND is_active = 1').get(input.pipeline_id)
    : db.prepare("SELECT * FROM crm_pipelines WHERE is_active = 1 AND (company_id = ? OR company_id = '*') ORDER BY is_default DESC LIMIT 1").get(companyId);
  if (!pipeline) fail(CRM_ERRORS.PIPELINE_NOT_FOUND, 'no active pipeline available', {});

  const stage = db.prepare(
    'SELECT * FROM crm_pipeline_stages WHERE pipeline_id = ? AND is_active = 1 AND is_won = 0 AND is_lost = 0 ORDER BY sequence LIMIT 1'
  ).get(pipeline.id);
  if (!stage) fail(CRM_ERRORS.PIPELINE_HAS_NO_OPEN_STAGE, 'pipeline has no active open stage', { pipelineId: pipeline.id });

  const id = newId('opp');
  const reference = nextReference(db, { kind: 'opportunity', companyId, prefix: 'OPP' });
  const expected = Number(input.expected_value ?? 0);
  const ts = now();

  db.prepare(`
    INSERT INTO crm_opportunities (
      id, company_id, branch_id, reference, lead_id, party_id, name,
      pipeline_id, stage_id, stage, team_id, owner_user_id, source_id, campaign_id, segment_id,
      currency, expected_value, weighted_revenue, probability, expected_close_date,
      product_interest, status, archived, version, created_at, created_by, updated_at, updated_by
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'open', 0, 1, ?, ?, ?, ?)
  `).run(
    id, companyId, branchId, reference, input.lead_id ?? null, input.party_id,
    input.name ?? 'فرصة بيع', pipeline.id, stage.id, stage.code,
    input.team_id ?? null, input.owner_user_id ?? actor,
    input.source_id ?? null, input.campaign_id ?? null, input.segment_id ?? null,
    input.currency ?? 'IQD', expected, weighted(expected, stage.probability), Number(stage.probability),
    input.expected_close_date ?? null, JSON.stringify(input.product_interest ?? []),
    ts, actor, ts, actor
  );

  db.prepare(`
    INSERT INTO crm_stage_history (id, opportunity_id, from_stage_id, to_stage_id, from_probability, to_probability, from_status, to_status, changed_at, changed_by, note)
    VALUES (?,?,NULL,?,NULL,?,NULL,'open',?,?,'created')
  `).run(newId('sh'), id, stage.id, Number(stage.probability), ts, actor);

  const opp = getOpportunity(db, id);
  writeAudit(db, { companyId, branchId, actor, action: 'crm.opportunity.create', resource: 'crm_opportunity', resourceId: id, after: opp });
  emitEvent(db, { companyId, actor, eventType: 'crm.opportunity.created', aggregateId: id, payload: { reference, partyId: input.party_id } });
  return { opportunity: opp };
}

export function updateOpportunity(db, input) {
  const { companyId, branchId, actor } = scopeOf(input);
  const opp = getOpportunity(db, input.opportunity_id);
  assertScope(opp, companyId);
  assertOpen(opp);
  assertVersion(opp, input.expected_version);

  const SETTABLE = ['name', 'expected_value', 'expected_close_date', 'currency', 'segment_id', 'source_id', 'campaign_id'];
  const sets = [];
  const vals = [];
  for (const f of SETTABLE) {
    if (input[f] === undefined) continue;
    if (f === 'expected_value') {
      const n = Number(input[f]);
      if (!Number.isFinite(n) || n < 0) fail(CRM_ERRORS.INVALID_AMOUNT, 'expected value must be a non-negative number', { value: input[f] });
    }
    sets.push(`${f} = ?`); vals.push(input[f]);
  }
  if (input.product_interest !== undefined) { sets.push('product_interest = ?'); vals.push(JSON.stringify(input.product_interest)); }

  // Probability may be adjusted only by an authorised caller; the action layer
  // gates that. Weighted revenue is never taken from input.
  if (input.probability !== undefined) {
    const p = Number(input.probability);
    if (!Number.isFinite(p) || p < 0 || p > 100) fail(CRM_ERRORS.VALIDATION_FAILED, 'probability must be between 0 and 100', { probability: input.probability });
    sets.push('probability = ?'); vals.push(p);
  }
  if (!sets.length) return { opportunity: opp };

  db.prepare(`UPDATE crm_opportunities SET ${sets.join(', ')} WHERE id = ?`).run(...vals, opp.id);
  recalcWeighted(db, opp.id);
  bump(db, opp.id, actor);

  const after = getOpportunity(db, opp.id);
  writeAudit(db, { companyId, branchId, actor, action: 'crm.opportunity.update', resource: 'crm_opportunity', resourceId: opp.id, before: opp, after });
  return { opportunity: after };
}

export function assignOpportunity(db, input) {
  const { companyId, branchId, actor } = scopeOf(input);
  const opp = getOpportunity(db, input.opportunity_id);
  assertScope(opp, companyId);
  assertOpen(opp);
  assertVersion(opp, input.expected_version);

  db.prepare('UPDATE crm_opportunities SET owner_user_id = COALESCE(?, owner_user_id), team_id = COALESCE(?, team_id) WHERE id = ?')
    .run(input.owner_user_id ?? null, input.team_id ?? null, opp.id);
  bump(db, opp.id, actor);

  const after = getOpportunity(db, opp.id);
  writeAudit(db, { companyId, branchId, actor, action: 'crm.opportunity.assign', resource: 'crm_opportunity', resourceId: opp.id, before: opp, after });
  emitEvent(db, { companyId, actor, eventType: 'crm.opportunity.assigned', aggregateId: opp.id, payload: { owner_user_id: after.owner_user_id, team_id: after.team_id } });
  return { opportunity: after };
}

/**
 * Stage transition.
 *
 * Idempotent: moving to the stage the opportunity is already in returns without
 * writing a second history row, which is what makes a replayed drag-and-drop
 * safe.
 */
export function changeStage(db, input) {
  const { companyId, branchId, actor } = scopeOf(input);
  const opp = getOpportunity(db, input.opportunity_id);
  assertScope(opp, companyId);
  assertOpen(opp);
  assertVersion(opp, input.expected_version);

  const stage = db.prepare('SELECT * FROM crm_pipeline_stages WHERE id = ?').get(input.stage_id);
  if (!stage) fail(CRM_ERRORS.STAGE_NOT_FOUND, `unknown stage ${input.stage_id}`, { stageId: input.stage_id });
  if (stage.pipeline_id !== opp.pipeline_id) {
    fail(CRM_ERRORS.STAGE_PIPELINE_MISMATCH, 'stage belongs to a different pipeline', {
      stagePipeline: stage.pipeline_id, opportunityPipeline: opp.pipeline_id,
    });
  }
  if (stage.is_active !== 1) fail(CRM_ERRORS.STAGE_INACTIVE, 'stage is archived', { stageId: stage.id });
  if (stage.id === opp.stage_id) return { opportunity: opp, changed: false };

  // Won/Lost stages are reached through their own commands, which carry the
  // evidence and reason requirements. Dragging into them would bypass both.
  if (stage.is_won === 1 || stage.is_lost === 1) {
    fail(CRM_ERRORS.WON_EVIDENCE_REQUIRED, 'use mark_won or mark_lost to close an opportunity', { stageId: stage.id });
  }

  const ts = now();
  const prior = db.prepare('SELECT changed_at FROM crm_stage_history WHERE opportunity_id = ? ORDER BY changed_at DESC LIMIT 1').get(opp.id);
  const durationSeconds = prior ? Math.max(0, Math.round((Date.parse(ts) - Date.parse(prior.changed_at)) / 1000)) : null;

  db.prepare('UPDATE crm_opportunities SET stage_id = ?, stage = ?, probability = ? WHERE id = ?')
    .run(stage.id, stage.code, Number(stage.probability), opp.id);
  recalcWeighted(db, opp.id);
  bump(db, opp.id, actor);

  db.prepare(`
    INSERT INTO crm_stage_history (id, opportunity_id, from_stage_id, to_stage_id, from_probability, to_probability, from_status, to_status, duration_seconds, changed_at, changed_by, note)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(newId('sh'), opp.id, opp.stage_id, stage.id, Number(opp.probability), Number(stage.probability), opp.status, opp.status, durationSeconds, ts, actor, input.note ?? '');

  const after = getOpportunity(db, opp.id);
  writeAudit(db, { companyId, branchId, actor, action: 'crm.opportunity.change_stage', resource: 'crm_opportunity', resourceId: opp.id, before: { stage_id: opp.stage_id }, after: { stage_id: stage.id } });
  emitEvent(db, { companyId, actor, eventType: 'crm.opportunity.stage_changed', aggregateId: opp.id, payload: { from: opp.stage_id, to: stage.id, probability: stage.probability } });
  return { opportunity: after, changed: true };
}

export function changePipeline(db, input) {
  const { companyId, branchId, actor } = scopeOf(input);
  const opp = getOpportunity(db, input.opportunity_id);
  assertScope(opp, companyId);
  assertOpen(opp);
  assertVersion(opp, input.expected_version);

  const pipeline = db.prepare('SELECT * FROM crm_pipelines WHERE id = ? AND is_active = 1').get(input.pipeline_id);
  if (!pipeline) fail(CRM_ERRORS.PIPELINE_NOT_FOUND, `unknown or inactive pipeline ${input.pipeline_id}`, { pipelineId: input.pipeline_id });
  if (pipeline.id === opp.pipeline_id) return { opportunity: opp, changed: false };

  const stage = db.prepare(
    'SELECT * FROM crm_pipeline_stages WHERE pipeline_id = ? AND is_active = 1 AND is_won = 0 AND is_lost = 0 ORDER BY sequence LIMIT 1'
  ).get(pipeline.id);
  if (!stage) fail(CRM_ERRORS.PIPELINE_HAS_NO_OPEN_STAGE, 'target pipeline has no active open stage', { pipelineId: pipeline.id });

  const ts = now();
  db.prepare('UPDATE crm_opportunities SET pipeline_id = ?, stage_id = ?, stage = ?, probability = ? WHERE id = ?')
    .run(pipeline.id, stage.id, stage.code, Number(stage.probability), opp.id);
  recalcWeighted(db, opp.id);
  bump(db, opp.id, actor);
  db.prepare(`
    INSERT INTO crm_stage_history (id, opportunity_id, from_stage_id, to_stage_id, from_probability, to_probability, from_status, to_status, changed_at, changed_by, note)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(newId('sh'), opp.id, opp.stage_id, stage.id, Number(opp.probability), Number(stage.probability), opp.status, opp.status, ts, actor, `pipeline changed to ${pipeline.code}`);

  const after = getOpportunity(db, opp.id);
  writeAudit(db, { companyId, branchId, actor, action: 'crm.opportunity.change_pipeline', resource: 'crm_opportunity', resourceId: opp.id, before: opp, after });
  return { opportunity: after, changed: true };
}

// --- competitors -----------------------------------------------------------

export function addCompetitor(db, input) {
  const { companyId, actor } = scopeOf(input);
  const opp = getOpportunity(db, input.opportunity_id);
  assertScope(opp, companyId);
  const comp = db.prepare('SELECT id FROM crm_competitors WHERE id = ?').get(input.competitor_id);
  if (!comp) fail(CRM_ERRORS.VALIDATION_FAILED, `unknown competitor ${input.competitor_id}`, { competitorId: input.competitor_id });

  db.prepare(`INSERT INTO crm_opportunity_competitors (opportunity_id, competitor_id, threat_level, notes, created_at)
              VALUES (?,?,?,?,?) ON CONFLICT(opportunity_id, competitor_id) DO UPDATE SET threat_level = excluded.threat_level`)
    .run(opp.id, input.competitor_id, input.threat_level ?? 'unknown', input.notes ?? '', now());
  return { opportunityId: opp.id, competitorId: input.competitor_id };
}

export function removeCompetitor(db, input) {
  const { companyId } = scopeOf(input);
  const opp = getOpportunity(db, input.opportunity_id);
  assertScope(opp, companyId);
  db.prepare('DELETE FROM crm_opportunity_competitors WHERE opportunity_id = ? AND competitor_id = ?')
    .run(opp.id, input.competitor_id);
  return { opportunityId: opp.id, competitorId: input.competitor_id };
}

// --- close / reopen --------------------------------------------------------

/**
 * Mark won. Requires evidence, or an explicit override carrying a reason.
 *
 * `allow_override` is supplied by the action layer only when the caller holds
 * the privileged permission — the service refuses to infer it.
 */
export function markWon(db, input) {
  const { companyId, branchId, actor } = scopeOf(input);
  const opp = getOpportunity(db, input.opportunity_id);
  assertScope(opp, companyId);
  if (opp.status === 'won') return { opportunity: opp, changed: false }; // idempotent
  assertOpen(opp);
  assertVersion(opp, input.expected_version);

  const hasQuotation = Boolean(opp.quotation_order_id);
  const hasOrder = Boolean(opp.sale_order_id);
  let evidence = hasOrder ? 'sale_order' : hasQuotation ? 'quotation' : null;

  if (!evidence) {
    if (!input.allow_override) {
      fail(CRM_ERRORS.WON_EVIDENCE_REQUIRED, 'a linked quotation or sales order is required to mark won', {
        opportunityId: opp.id, hint: 'link a quotation or sales order, or use a privileged override with a reason',
      });
    }
    if (!input.override_reason || !String(input.override_reason).trim()) {
      fail(CRM_ERRORS.WON_EVIDENCE_REQUIRED, 'an override reason is required to mark won without evidence', { opportunityId: opp.id });
    }
    evidence = 'override';
  }

  const wonStage = db.prepare('SELECT * FROM crm_pipeline_stages WHERE pipeline_id = ? AND is_won = 1 ORDER BY sequence DESC LIMIT 1').get(opp.pipeline_id);
  const ts = now();

  db.prepare(`
    UPDATE crm_opportunities
       SET status='won', won_at=?, won_evidence=?, won_override_reason=?, probability=100,
           stage_id=COALESCE(?, stage_id), stage=COALESCE(?, stage)
     WHERE id=?
  `).run(ts, evidence, evidence === 'override' ? String(input.override_reason) : '', wonStage?.id ?? null, wonStage?.code ?? null, opp.id);
  recalcWeighted(db, opp.id);
  bump(db, opp.id, actor);

  db.prepare(`
    INSERT INTO crm_stage_history (id, opportunity_id, from_stage_id, to_stage_id, from_probability, to_probability, from_status, to_status, changed_at, changed_by, note)
    VALUES (?,?,?,?,?,100,?, 'won',?,?,?)
  `).run(newId('sh'), opp.id, opp.stage_id, wonStage?.id ?? opp.stage_id, Number(opp.probability), opp.status, ts, actor, `won via ${evidence}`);

  const after = getOpportunity(db, opp.id);
  writeAudit(db, { companyId, branchId, actor, action: 'crm.opportunity.mark_won', resource: 'crm_opportunity', resourceId: opp.id, before: opp, after, reason: evidence === 'override' ? String(input.override_reason) : evidence });
  emitEvent(db, { companyId, actor, eventType: 'crm.opportunity.won', aggregateId: opp.id, payload: { evidence, partyId: opp.party_id, amount: opp.expected_value } });
  return { opportunity: after, changed: true, evidence };
}

export function markLost(db, input) {
  const { companyId, branchId, actor } = scopeOf(input);
  const opp = getOpportunity(db, input.opportunity_id);
  assertScope(opp, companyId);
  if (opp.status === 'lost') return { opportunity: opp, changed: false }; // idempotent
  assertOpen(opp);
  assertVersion(opp, input.expected_version);

  if (!input.lost_reason_id) fail(CRM_ERRORS.LOST_REASON_REQUIRED, 'a lost reason is required', { opportunityId: opp.id });
  const reason = db.prepare('SELECT id, code FROM crm_lost_reasons WHERE id = ?').get(input.lost_reason_id);
  if (!reason) fail(CRM_ERRORS.LOST_REASON_NOT_FOUND, `unknown lost reason ${input.lost_reason_id}`, { lostReasonId: input.lost_reason_id });

  const lostStage = db.prepare('SELECT * FROM crm_pipeline_stages WHERE pipeline_id = ? AND is_lost = 1 ORDER BY sequence DESC LIMIT 1').get(opp.pipeline_id);
  const ts = now();

  db.prepare(`
    UPDATE crm_opportunities
       SET status='lost', lost_at=?, lost_reason_id=?, lost_reason=?, probability=0,
           stage_id=COALESCE(?, stage_id), stage=COALESCE(?, stage)
     WHERE id=?
  `).run(ts, reason.id, reason.code, lostStage?.id ?? null, lostStage?.code ?? null, opp.id);
  recalcWeighted(db, opp.id);
  bump(db, opp.id, actor);

  if (input.competitor_id) {
    db.prepare(`INSERT INTO crm_opportunity_competitors (opportunity_id, competitor_id, threat_level, notes, created_at)
                VALUES (?,?, 'won_against_us', ?, ?) ON CONFLICT(opportunity_id, competitor_id) DO UPDATE SET threat_level='won_against_us'`)
      .run(opp.id, input.competitor_id, input.note ?? '', ts);
  }

  db.prepare(`
    INSERT INTO crm_stage_history (id, opportunity_id, from_stage_id, to_stage_id, from_probability, to_probability, from_status, to_status, changed_at, changed_by, note)
    VALUES (?,?,?,?,?,0,?, 'lost',?,?,?)
  `).run(newId('sh'), opp.id, opp.stage_id, lostStage?.id ?? opp.stage_id, Number(opp.probability), opp.status, ts, actor, input.note ?? reason.code);

  const after = getOpportunity(db, opp.id);
  writeAudit(db, { companyId, branchId, actor, action: 'crm.opportunity.mark_lost', resource: 'crm_opportunity', resourceId: opp.id, before: opp, after, reason: reason.code });
  emitEvent(db, { companyId, actor, eventType: 'crm.opportunity.lost', aggregateId: opp.id, payload: { lostReason: reason.code, competitorId: input.competitor_id ?? null } });
  return { opportunity: after, changed: true };
}

/**
 * Reopen a lost opportunity.
 *
 * Won is final: a won deal has downstream Sales facts, and reopening it would
 * desynchronise them. The prior lost reason is retained in history rather than
 * erased — why it was lost stays answerable.
 */
export function reopenOpportunity(db, input) {
  const { companyId, branchId, actor } = scopeOf(input);
  const opp = getOpportunity(db, input.opportunity_id);
  assertScope(opp, companyId);
  if (opp.archived === 1) fail(CRM_ERRORS.OPPORTUNITY_NOT_OPEN, 'restore the opportunity before reopening it', { opportunityId: opp.id });
  if (opp.status === OPEN) return { opportunity: opp, changed: false };
  if (opp.status === 'won') fail(CRM_ERRORS.OPPORTUNITY_WON_IS_FINAL, 'a won opportunity cannot be reopened', { opportunityId: opp.id });

  const stage = input.stage_id
    ? db.prepare('SELECT * FROM crm_pipeline_stages WHERE id = ? AND pipeline_id = ? AND is_active = 1 AND is_won = 0 AND is_lost = 0').get(input.stage_id, opp.pipeline_id)
    : db.prepare('SELECT * FROM crm_pipeline_stages WHERE pipeline_id = ? AND is_active = 1 AND is_won = 0 AND is_lost = 0 ORDER BY sequence LIMIT 1').get(opp.pipeline_id);
  if (!stage) fail(CRM_ERRORS.PIPELINE_HAS_NO_OPEN_STAGE, 'no valid open stage to reopen into', { pipelineId: opp.pipeline_id });

  const ts = now();
  db.prepare(`
    UPDATE crm_opportunities
       SET status='open', reopened_at=?, reopen_count=reopen_count+1,
           stage_id=?, stage=?, probability=?, lost_at=NULL, lost_reason_id=NULL
     WHERE id=?
  `).run(ts, stage.id, stage.code, Number(stage.probability), opp.id);
  recalcWeighted(db, opp.id);
  bump(db, opp.id, actor);

  db.prepare(`
    INSERT INTO crm_stage_history (id, opportunity_id, from_stage_id, to_stage_id, from_probability, to_probability, from_status, to_status, changed_at, changed_by, note)
    VALUES (?,?,?,?,?,?,?, 'open',?,?,?)
  `).run(newId('sh'), opp.id, opp.stage_id, stage.id, Number(opp.probability), Number(stage.probability), opp.status, ts, actor, `reopened (was ${opp.lost_reason || 'lost'})`);

  const after = getOpportunity(db, opp.id);
  writeAudit(db, { companyId, branchId, actor, action: 'crm.opportunity.reopen', resource: 'crm_opportunity', resourceId: opp.id, before: opp, after });
  emitEvent(db, { companyId, actor, eventType: 'crm.opportunity.reopened', aggregateId: opp.id, payload: { reopenCount: after.reopen_count } });
  return { opportunity: after, changed: true };
}

export function archiveOpportunity(db, input) {
  const { companyId, branchId, actor } = scopeOf(input);
  const opp = getOpportunity(db, input.opportunity_id);
  assertScope(opp, companyId);
  if (opp.archived === 1) return { opportunity: opp };
  db.prepare('UPDATE crm_opportunities SET archived = 1, archived_at = ? WHERE id = ?').run(now(), opp.id);
  bump(db, opp.id, actor);
  const after = getOpportunity(db, opp.id);
  writeAudit(db, { companyId, branchId, actor, action: 'crm.opportunity.archive', resource: 'crm_opportunity', resourceId: opp.id, before: opp, after });
  return { opportunity: after };
}

export function restoreOpportunity(db, input) {
  const { companyId, branchId, actor } = scopeOf(input);
  const opp = getOpportunity(db, input.opportunity_id);
  assertScope(opp, companyId);
  if (opp.archived === 0) return { opportunity: opp };
  db.prepare('UPDATE crm_opportunities SET archived = 0, archived_at = NULL WHERE id = ?').run(opp.id);
  bump(db, opp.id, actor);
  const after = getOpportunity(db, opp.id);
  writeAudit(db, { companyId, branchId, actor, action: 'crm.opportunity.restore', resource: 'crm_opportunity', resourceId: opp.id, before: opp, after });
  return { opportunity: after };
}
