// CRM Lead service — governed lifecycle commands.
//
// Lifecycle:  new → contacted → qualified → converted
// Alternates: unqualified · duplicate · archived
//
// Every transition is its own command with its own preconditions. A generic
// PATCH on `stage` would let a caller skip qualification, resurrect a converted
// lead, or mark a duplicate as won — the guards below are the point of the
// service.
//
// `stage` is the existing 039 column and keeps its meaning; the new columns
// added by 065 carry the facts 039 never had.

import { CRM_ERRORS, fail } from './errors.mjs';
import {
  newId, now, scopeOf, nextReference, validateLeadInput,
  normaliseEmail, normalisePhone, writeAudit, emitEvent,
} from './shared.mjs';
import { detectDuplicates } from './duplicate-service.mjs';
import { scoreLead } from './scoring-service.mjs';

const OPEN_STAGES = new Set(['new', 'contacted', 'qualified']);

export function getLead(db, leadId) {
  const lead = db.prepare('SELECT * FROM crm_leads WHERE id = ?').get(leadId);
  if (!lead) fail(CRM_ERRORS.LEAD_NOT_FOUND, `unknown lead ${leadId}`, { leadId });
  return lead;
}

function assertMutable(lead) {
  if (lead.archived === 1) fail(CRM_ERRORS.LEAD_ARCHIVED, 'lead is archived; restore it first', { leadId: lead.id });
  if (lead.stage === 'converted') fail(CRM_ERRORS.LEAD_ALREADY_CONVERTED, 'lead is already converted', { leadId: lead.id });
  if (lead.stage === 'duplicate') fail(CRM_ERRORS.LEAD_IS_DUPLICATE, 'lead is marked duplicate', { leadId: lead.id, survivor: lead.merged_into_lead_id });
}

/** Optimistic concurrency: callers pass the version they read. */
function assertVersion(lead, expected) {
  if (expected !== undefined && expected !== null && Number(expected) !== Number(lead.version)) {
    fail(CRM_ERRORS.VERSION_CONFLICT, 'lead was modified by someone else', {
      leadId: lead.id, expected: Number(expected), actual: Number(lead.version),
    });
  }
}

function bump(db, leadId, actor) {
  db.prepare('UPDATE crm_leads SET version = version + 1, updated_at = ?, updated_by = ? WHERE id = ?')
    .run(now(), actor, leadId);
}

// ---------------------------------------------------------------------------

export function createLead(db, input) {
  const { companyId, branchId, actor } = scopeOf(input);
  validateLeadInput(input);

  const id = newId('lead');
  const reference = nextReference(db, { kind: 'lead', companyId, prefix: 'LEAD' });
  const ts = now();
  const title = input.name || input.contact_name || input.organization_name;

  db.prepare(`
    INSERT INTO crm_leads (
      id, company_id, branch_id, reference, name, contact_name, organization_name,
      email, phone, alt_contact, city, country, address, currency,
      source_id, campaign_id, team_id, salesperson_id, product_interest,
      expected_revenue, probability, stage, qualification_status, duplicate_state,
      notes, archived, version, created_at, created_by, updated_at, updated_by
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'new', 'pending', 'unchecked', ?, 0, 1, ?, ?, ?, ?)
  `).run(
    id, companyId, branchId, reference, title,
    input.contact_name ?? '', input.organization_name ?? '',
    normaliseEmail(input.email), input.phone ?? '', input.alt_contact ?? '',
    input.city ?? '', input.country ?? '', input.address ?? '', input.currency ?? 'IQD',
    input.source_id ?? null, input.campaign_id ?? null, input.team_id ?? null,
    input.salesperson_id ?? actor, JSON.stringify(input.product_interest ?? []),
    Number(input.expected_revenue ?? 0), Number(input.probability ?? 0),
    input.notes ?? '', ts, actor, ts, actor
  );

  const duplicates = detectDuplicates(db, {
    companyId, email: input.email, phone: input.phone,
    organizationName: input.organization_name, excludeLeadId: id,
  });
  db.prepare('UPDATE crm_leads SET duplicate_state = ? WHERE id = ?').run(duplicates.state, id);

  // Score immediately so the list view is meaningful the moment a lead lands.
  scoreLead(db, { lead_id: id, company_id: companyId, actor, source: 'rules' });

  const lead = getLead(db, id);
  writeAudit(db, { companyId, branchId, actor, action: 'crm.lead.create', resource: 'crm_lead', resourceId: id, after: lead, correlationId: input.correlation_id });
  emitEvent(db, { companyId, actor, eventType: 'crm.lead.created', aggregateId: id, payload: { reference, stage: 'new' }, correlationId: input.correlation_id });

  return { lead, duplicates };
}

export function updateLead(db, input) {
  const { companyId, branchId, actor } = scopeOf(input);
  const lead = getLead(db, input.lead_id);
  assertMutable(lead);
  assertVersion(lead, input.expected_version);
  validateLeadInput(input, { partial: true });

  const SETTABLE = [
    'name', 'contact_name', 'organization_name', 'email', 'phone', 'alt_contact',
    'city', 'country', 'address', 'currency', 'source_id', 'campaign_id',
    'team_id', 'expected_revenue', 'probability', 'notes',
  ];
  const sets = [];
  const vals = [];
  for (const f of SETTABLE) {
    if (input[f] === undefined) continue;
    sets.push(`${f} = ?`);
    vals.push(f === 'email' ? normaliseEmail(input[f]) : input[f]);
  }
  if (input.product_interest !== undefined) {
    sets.push('product_interest = ?');
    vals.push(JSON.stringify(input.product_interest));
  }
  if (!sets.length) return { lead };

  db.prepare(`UPDATE crm_leads SET ${sets.join(', ')} WHERE id = ?`).run(...vals, lead.id);
  bump(db, lead.id, actor);
  scoreLead(db, { lead_id: lead.id, company_id: companyId, actor, source: 'rules' });

  const after = getLead(db, lead.id);
  writeAudit(db, { companyId, branchId, actor, action: 'crm.lead.update', resource: 'crm_lead', resourceId: lead.id, before: lead, after, correlationId: input.correlation_id });
  return { lead: after };
}

export function assignLead(db, input) {
  const { companyId, branchId, actor } = scopeOf(input);
  const lead = getLead(db, input.lead_id);
  assertMutable(lead);
  assertVersion(lead, input.expected_version);

  db.prepare('UPDATE crm_leads SET salesperson_id = COALESCE(?, salesperson_id), team_id = COALESCE(?, team_id) WHERE id = ?')
    .run(input.salesperson_id ?? null, input.team_id ?? null, lead.id);
  bump(db, lead.id, actor);

  const after = getLead(db, lead.id);
  writeAudit(db, { companyId, branchId, actor, action: 'crm.lead.assign', resource: 'crm_lead', resourceId: lead.id, before: lead, after, correlationId: input.correlation_id });
  emitEvent(db, { companyId, actor, eventType: 'crm.lead.assigned', aggregateId: lead.id, payload: { salesperson_id: after.salesperson_id, team_id: after.team_id } });
  return { lead: after };
}

/** new → contacted. Idempotent once contacted. */
export function contactLead(db, input) {
  const { companyId, branchId, actor } = scopeOf(input);
  const lead = getLead(db, input.lead_id);
  assertMutable(lead);
  if (lead.stage === 'contacted' || lead.stage === 'qualified') return { lead };
  if (lead.stage !== 'new') fail(CRM_ERRORS.LEAD_STATE_INVALID, `cannot contact a lead in stage ${lead.stage}`, { stage: lead.stage });

  db.prepare('UPDATE crm_leads SET stage = ?, last_interaction_at = ? WHERE id = ?').run('contacted', now(), lead.id);
  bump(db, lead.id, actor);
  const after = getLead(db, lead.id);
  writeAudit(db, { companyId, branchId, actor, action: 'crm.lead.contact', resource: 'crm_lead', resourceId: lead.id, before: lead, after });
  return { lead: after };
}

export function qualifyLead(db, input) {
  const { companyId, branchId, actor } = scopeOf(input);
  const id = input.lead_id || input.id;
  const lead = getLead(db, id);
  assertMutable(lead);
  assertVersion(lead, input.expected_version);
  if (lead.stage === 'qualified') return { lead }; // idempotent
  if (!OPEN_STAGES.has(lead.stage)) fail(CRM_ERRORS.LEAD_STATE_INVALID, `cannot qualify a lead in stage ${lead.stage}`, { stage: lead.stage });

  const ts = now();
  db.prepare(`UPDATE crm_leads SET stage='qualified', qualification_status='qualified', qualified_at=?, qualified_by=? WHERE id=?`)
    .run(ts, actor, lead.id);
  bump(db, lead.id, actor);

  const after = getLead(db, lead.id);
  writeAudit(db, { companyId, branchId, actor, action: 'crm.lead.qualify', resource: 'crm_lead', resourceId: lead.id, before: lead, after, correlationId: input.correlation_id });
  emitEvent(db, { companyId, actor, eventType: 'crm.lead.qualified', aggregateId: lead.id, payload: { reference: after.reference } });
  return { lead: after };
}

export function disqualifyLead(db, input) {
  const { companyId, branchId, actor } = scopeOf(input);
  const lead = getLead(db, input.lead_id);
  assertMutable(lead);
  if (!input.lost_reason_id) fail(CRM_ERRORS.LOST_REASON_REQUIRED, 'a reason is required to disqualify a lead');
  const reason = db.prepare('SELECT id FROM crm_lost_reasons WHERE id = ?').get(input.lost_reason_id);
  if (!reason) fail(CRM_ERRORS.LOST_REASON_NOT_FOUND, `unknown lost reason ${input.lost_reason_id}`);

  const ts = now();
  db.prepare(`UPDATE crm_leads SET stage='unqualified', qualification_status='unqualified', disqualified_at=?, disqualify_reason_id=? WHERE id=?`)
    .run(ts, input.lost_reason_id, lead.id);
  bump(db, lead.id, actor);

  const after = getLead(db, lead.id);
  writeAudit(db, { companyId, branchId, actor, action: 'crm.lead.disqualify', resource: 'crm_lead', resourceId: lead.id, before: lead, after, reason: input.note ?? null });
  emitEvent(db, { companyId, actor, eventType: 'crm.lead.disqualified', aggregateId: lead.id, payload: { lost_reason_id: input.lost_reason_id } });
  return { lead: after };
}

export function reopenLead(db, input) {
  const { companyId, branchId, actor } = scopeOf(input);
  const lead = getLead(db, input.lead_id);
  if (lead.archived === 1) fail(CRM_ERRORS.LEAD_ARCHIVED, 'restore the lead before reopening it', { leadId: lead.id });
  if (lead.stage === 'converted') fail(CRM_ERRORS.LEAD_ALREADY_CONVERTED, 'a converted lead cannot be reopened', { leadId: lead.id });
  if (OPEN_STAGES.has(lead.stage)) return { lead };

  db.prepare(`UPDATE crm_leads SET stage='contacted', qualification_status='pending', disqualified_at=NULL, disqualify_reason_id=NULL WHERE id=?`)
    .run(lead.id);
  bump(db, lead.id, actor);
  const after = getLead(db, lead.id);
  writeAudit(db, { companyId, branchId, actor, action: 'crm.lead.reopen', resource: 'crm_lead', resourceId: lead.id, before: lead, after });
  return { lead: after };
}

export function archiveLead(db, input) {
  const { companyId, branchId, actor } = scopeOf(input);
  const lead = getLead(db, input.lead_id);
  if (lead.archived === 1) return { lead };
  db.prepare('UPDATE crm_leads SET archived = 1, archived_at = ? WHERE id = ?').run(now(), lead.id);
  bump(db, lead.id, actor);
  const after = getLead(db, lead.id);
  writeAudit(db, { companyId, branchId, actor, action: 'crm.lead.archive', resource: 'crm_lead', resourceId: lead.id, before: lead, after });
  return { lead: after };
}

export function restoreLead(db, input) {
  const { companyId, branchId, actor } = scopeOf(input);
  const lead = getLead(db, input.lead_id);
  if (lead.archived === 0) return { lead };
  db.prepare('UPDATE crm_leads SET archived = 0, archived_at = NULL WHERE id = ?').run(lead.id);
  bump(db, lead.id, actor);
  const after = getLead(db, lead.id);
  writeAudit(db, { companyId, branchId, actor, action: 'crm.lead.restore', resource: 'crm_lead', resourceId: lead.id, before: lead, after });
  return { lead: after };
}

export function detectLeadDuplicates(db, input) {
  const { companyId } = scopeOf(input);
  const lead = getLead(db, input.lead_id);
  const report = detectDuplicates(db, {
    companyId, email: lead.email, phone: lead.phone,
    organizationName: lead.organization_name, excludeLeadId: lead.id,
  });
  db.prepare('UPDATE crm_leads SET duplicate_state = ? WHERE id = ?').run(report.state, lead.id);
  return report;
}

/**
 * Merge duplicate leads into a survivor.
 *
 * Losers become `duplicate` and are kept, never deleted — their history is why
 * anyone can later explain where a customer came from. Activities, interactions
 * and tags move to the survivor so nothing is stranded on a record the UI hides.
 */
export function mergeLeads(db, input) {
  const { companyId, branchId, actor } = scopeOf(input);
  const survivor = getLead(db, input.survivor_lead_id);
  assertMutable(survivor);

  const loserIds = (input.duplicate_lead_ids ?? []).filter(Boolean);
  if (loserIds.includes(survivor.id)) fail(CRM_ERRORS.LEAD_MERGE_SELF, 'a lead cannot be merged into itself', { leadId: survivor.id });

  const merged = [];
  for (const loserId of loserIds) {
    const loser = getLead(db, loserId);
    if (loser.company_id !== survivor.company_id) {
      fail(CRM_ERRORS.LEAD_STATE_INVALID, 'cannot merge leads across companies', { survivor: survivor.id, loser: loserId });
    }
    if (loser.stage === 'converted') fail(CRM_ERRORS.LEAD_ALREADY_CONVERTED, 'a converted lead cannot be merged away', { leadId: loserId });

    db.prepare('UPDATE crm_activities SET lead_id = ? WHERE lead_id = ?').run(survivor.id, loserId);
    db.prepare('UPDATE crm_interactions SET lead_id = ? WHERE lead_id = ?').run(survivor.id, loserId);
    db.prepare('INSERT OR IGNORE INTO crm_lead_tags (lead_id, tag_id, created_at) SELECT ?, tag_id, ? FROM crm_lead_tags WHERE lead_id = ?')
      .run(survivor.id, now(), loserId);
    db.prepare('DELETE FROM crm_lead_tags WHERE lead_id = ?').run(loserId);

    // Fill blanks on the survivor rather than overwrite decided facts.
    for (const f of ['email', 'phone', 'organization_name', 'city', 'country', 'address', 'source_id', 'campaign_id']) {
      db.prepare(`UPDATE crm_leads SET ${f} = ? WHERE id = ? AND (${f} IS NULL OR ${f} = '')`)
        .run(loser[f], survivor.id);
    }

    db.prepare(`UPDATE crm_leads SET stage='duplicate', duplicate_state='merged', merged_into_lead_id=?, duplicate_of_lead_id=? WHERE id=?`)
      .run(survivor.id, survivor.id, loserId);
    bump(db, loserId, actor);
    merged.push(loserId);

    writeAudit(db, { companyId, branchId, actor, action: 'crm.lead.merged_away', resource: 'crm_lead', resourceId: loserId, before: loser, after: { merged_into: survivor.id } });
  }

  bump(db, survivor.id, actor);
  const after = getLead(db, survivor.id);
  writeAudit(db, { companyId, branchId, actor, action: 'crm.lead.merge', resource: 'crm_lead', resourceId: survivor.id, before: survivor, after, reason: `merged ${merged.length} duplicate(s)` });
  emitEvent(db, { companyId, actor, eventType: 'crm.lead.merged', aggregateId: survivor.id, payload: { survivor: survivor.id, merged } });

  return { survivor: after, merged };
}
