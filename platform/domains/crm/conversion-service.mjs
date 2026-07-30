// Lead → canonical Party → Opportunity conversion.
//
// This is the command where CRM touches the customer master, so it is the one
// that must never half-succeed. The caller wraps it in a single transaction;
// every failure path below throws before any subsequent write, so a rollback
// leaves no orphan Party, no orphan Opportunity, and a lead still marked
// qualified and retryable.
//
// Party reuse is decided by deterministic duplicate detection, not by a guess:
//   exact / high confidence → reuse the existing canonical Party
//   possible                → refuse and require an explicit party_id
//   none                    → create one Party
//
// Refusing the ambiguous case is deliberate. Silently creating a second Party
// for an existing customer is the failure mode that produces two answers to
// "who is this customer", which is what the whole cutover programme exists to
// prevent.

import { CRM_ERRORS, fail } from './errors.mjs';
import { newId, now, scopeOf, nextReference, writeAudit, emitEvent, recallIdempotent, rememberIdempotent } from './shared.mjs';
import { detectDuplicates, CONFIDENCE } from './duplicate-service.mjs';

export function convertLead(db, input) {
  const { companyId, branchId, actor } = scopeOf(input);
  const ACTION = 'crm:lead_convert';

  // 0. Idempotent replay returns the original outcome rather than converting twice.
  const cached = recallIdempotent(db, { companyId, actor, action: ACTION, key: input.idempotency_key });
  if (cached) return { ...cached, replayed: true };

  // 1. Read and revalidate under the caller's transaction.
  const lead = db.prepare('SELECT * FROM crm_leads WHERE id = ?').get(input.lead_id);
  if (!lead) fail(CRM_ERRORS.LEAD_NOT_FOUND, `unknown lead ${input.lead_id}`, { leadId: input.lead_id });
  if (lead.company_id !== companyId) {
    fail(CRM_ERRORS.LEAD_NOT_FOUND, 'lead belongs to another company', { leadId: lead.id });
  }
  if (lead.archived === 1) fail(CRM_ERRORS.LEAD_ARCHIVED, 'lead is archived', { leadId: lead.id });
  if (lead.stage === 'converted') {
    fail(CRM_ERRORS.LEAD_ALREADY_CONVERTED, 'lead has already been converted', {
      leadId: lead.id, partyId: lead.converted_party_id, opportunityId: lead.converted_opportunity_id,
    });
  }
  if (lead.stage !== 'qualified') {
    fail(CRM_ERRORS.LEAD_NOT_QUALIFIED, 'only a qualified lead may be converted', { leadId: lead.id, stage: lead.stage });
  }
  if (input.expected_version !== undefined && Number(input.expected_version) !== Number(lead.version)) {
    fail(CRM_ERRORS.VERSION_CONFLICT, 'lead was modified by someone else', {
      leadId: lead.id, expected: Number(input.expected_version), actual: Number(lead.version),
    });
  }

  const ts = now();

  // 2. Resolve the canonical Party.
  const duplicates = detectDuplicates(db, {
    companyId, email: lead.email, phone: lead.phone,
    organizationName: lead.organization_name, excludeLeadId: lead.id,
  });

  let partyId = input.party_id ?? null;
  let partyCreated = false;
  let matchBasis = 'none';

  if (partyId) {
    const chosen = db.prepare("SELECT id FROM parties WHERE id = ? AND company_id = ? AND status = 'active'").get(partyId, companyId);
    if (!chosen) fail(CRM_ERRORS.PARTY_NOT_FOUND, `unknown or inactive party ${partyId}`, { partyId });
    matchBasis = 'explicit';
  } else if (duplicates.autoReusableParty) {
    partyId = duplicates.autoReusableParty.partyId;
    matchBasis = duplicates.autoReusableParty.basis.join('+');
  } else if (duplicates.requiresUserChoice) {
    // Ambiguous: a human must pick. Refusing beats guessing.
    fail(CRM_ERRORS.PARTY_AMBIGUOUS, 'possible existing customers found; choose one explicitly or confirm a new party', {
      leadId: lead.id, candidates: duplicates.parties,
    });
  } else {
    partyId = newId('party');
    db.prepare(`
      INSERT INTO parties (id, company_id, is_company, name, status, phone, email, currency, created_at, updated_at)
      VALUES (?,?,?,?, 'active', ?, ?, ?, ?, ?)
    `).run(
      partyId, companyId, lead.organization_name ? 1 : 0,
      lead.organization_name || lead.contact_name || lead.name,
      lead.phone ?? '', lead.email ?? '', lead.currency ?? 'IQD', ts, ts
    );
    partyCreated = true;
    matchBasis = 'created';
  }

  // 3. Customer role is additive — a Party may already be a supplier.
  const hasRole = db.prepare('SELECT id FROM party_roles WHERE party_id=? AND role=? AND company_id=?')
    .get(partyId, 'customer', companyId);
  if (!hasRole) {
    db.prepare('INSERT INTO party_roles (id, party_id, role, company_id, created_at) VALUES (?,?,?,?,?)')
      .run(newId('prole'), partyId, 'customer', companyId, ts);
  }

  // 4. Pipeline and opening stage.
  const pipeline = input.pipeline_id
    ? db.prepare('SELECT * FROM crm_pipelines WHERE id = ? AND is_active = 1').get(input.pipeline_id)
    : db.prepare("SELECT * FROM crm_pipelines WHERE is_active = 1 AND (company_id = ? OR company_id = '*') ORDER BY is_default DESC LIMIT 1").get(companyId);
  if (!pipeline) fail(CRM_ERRORS.PIPELINE_NOT_FOUND, 'no active pipeline is available for conversion', { pipelineId: input.pipeline_id ?? null });

  const stage = db.prepare(
    'SELECT * FROM crm_pipeline_stages WHERE pipeline_id = ? AND is_active = 1 AND is_won = 0 AND is_lost = 0 ORDER BY sequence LIMIT 1'
  ).get(pipeline.id);
  if (!stage) fail(CRM_ERRORS.PIPELINE_HAS_NO_OPEN_STAGE, 'pipeline has no active open stage', { pipelineId: pipeline.id });

  // 5. Opportunity, carrying the lead's commercial facts forward.
  const opportunityId = newId('opp');
  const reference = nextReference(db, { kind: 'opportunity', companyId, prefix: 'OPP' });
  const expected = Number(input.expected_revenue ?? lead.expected_revenue ?? 0);
  const weighted = expected * (Number(stage.probability) / 100);

  db.prepare(`
    INSERT INTO crm_opportunities (
      id, company_id, branch_id, reference, lead_id, party_id, name,
      pipeline_id, stage_id, stage, team_id, owner_user_id, source_id, campaign_id,
      currency, expected_value, weighted_revenue, probability, expected_close_date,
      product_interest, status, archived, version, created_at, created_by, updated_at, updated_by
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'open', 0, 1, ?, ?, ?, ?)
  `).run(
    opportunityId, companyId, lead.branch_id ?? branchId, reference, lead.id, partyId,
    input.name ?? lead.name, pipeline.id, stage.id, stage.code,
    lead.team_id, lead.salesperson_id ?? actor, lead.source_id, lead.campaign_id,
    lead.currency ?? 'IQD', expected, weighted, Number(stage.probability),
    input.expected_close_date ?? null, lead.product_interest ?? '[]',
    ts, actor, ts, actor
  );

  db.prepare(`
    INSERT INTO crm_stage_history
      (id, opportunity_id, from_stage_id, to_stage_id, from_probability, to_probability, from_status, to_status, changed_at, changed_by, note)
    VALUES (?,?,NULL,?,NULL,?,NULL,'open',?,?,?)
  `).run(newId('sh'), opportunityId, stage.id, Number(stage.probability), ts, actor, 'created by lead conversion');

  // 6. Conversion lineage. The unique index on lead_id is what makes a second
  //    concurrent conversion collide rather than duplicate.
  db.prepare(`
    INSERT INTO crm_conversion_links
      (id, company_id, lead_id, party_id, opportunity_id, party_was_created, match_basis, idempotency_key, converted_at, converted_by)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(newId('cvl'), companyId, lead.id, partyId, opportunityId, partyCreated ? 1 : 0, matchBasis, input.idempotency_key ?? null, ts, actor);

  // 7. Lead state last, so a failure above leaves it retryable.
  db.prepare(`
    UPDATE crm_leads
       SET stage='converted', qualification_status='converted', converted_at=?, converted_by=?,
           converted_party_id=?, converted_opportunity_id=?, version=version+1, updated_at=?, updated_by=?
     WHERE id=?
  `).run(ts, actor, partyId, opportunityId, ts, actor, lead.id);

  const opportunity = db.prepare('SELECT * FROM crm_opportunities WHERE id = ?').get(opportunityId);

  writeAudit(db, {
    companyId, branchId, actor, action: 'crm.lead.convert', resource: 'crm_lead', resourceId: lead.id,
    before: lead, after: { partyId, opportunityId, partyCreated, matchBasis }, correlationId: input.correlation_id,
  });
  emitEvent(db, {
    companyId, actor, eventType: 'crm.lead.converted', aggregateId: lead.id,
    payload: { leadId: lead.id, partyId, opportunityId, partyCreated, matchBasis }, correlationId: input.correlation_id,
  });

  const result = {
    leadId: lead.id, partyId, opportunityId, partyCreated, matchBasis,
    opportunity, duplicates, replayed: false,
  };
  rememberIdempotent(db, { companyId, actor, action: ACTION, key: input.idempotency_key, result });
  return result;
}
