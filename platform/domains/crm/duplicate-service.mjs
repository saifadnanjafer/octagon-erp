// CRM duplicate detection.
//
// Deterministic and explainable — no fuzzy scoring nobody can audit. Each match
// carries the basis it was found on, and the confidence band decides what the
// caller is allowed to do automatically:
//
//   exact           email or normalised phone identical → may reuse a Party
//   high_confidence organisation + one contact channel  → may reuse a Party
//   possible        organisation only                   → requires user choice
//   none                                                → create a new Party
//
// Nothing here auto-merges. Two people at one company are a legitimate pair of
// leads, and collapsing them silently destroys a real contact.

import { normaliseEmail, normalisePhone, normaliseOrg } from './shared.mjs';

export const CONFIDENCE = Object.freeze({
  EXACT: 'exact',
  HIGH: 'high_confidence',
  POSSIBLE: 'possible',
  NONE: 'none',
});

/** Rank so callers can pick the strongest match without re-deriving order. */
const RANK = { exact: 3, high_confidence: 2, possible: 1, none: 0 };
export const strongest = (matches) =>
  matches.reduce((best, m) => (RANK[m.confidence] > RANK[best?.confidence ?? 'none'] ? m : best), null);

function classify({ emailHit, phoneHit, orgHit }) {
  if (emailHit || phoneHit) return CONFIDENCE.EXACT;
  if (orgHit && (emailHit || phoneHit)) return CONFIDENCE.HIGH;
  if (orgHit) return CONFIDENCE.POSSIBLE;
  return CONFIDENCE.NONE;
}

/** Candidate canonical Parties for a lead-shaped record. */
export function findMatchingParties(db, { companyId, email, phone, organizationName }) {
  const e = normaliseEmail(email);
  const p = normalisePhone(phone);
  const o = normaliseOrg(organizationName);
  if (!e && !p && !o) return [];

  const rows = db.prepare(
    `SELECT id, name, email, phone, status FROM parties WHERE company_id = ? AND status = 'active'`
  ).all(companyId);

  const matches = [];
  for (const r of rows) {
    const emailHit = Boolean(e) && normaliseEmail(r.email) === e;
    const phoneHit = Boolean(p) && normalisePhone(r.phone) === p;
    const orgHit = Boolean(o) && normaliseOrg(r.name) === o;
    const confidence = classify({ emailHit, phoneHit, orgHit });
    if (confidence === CONFIDENCE.NONE) continue;

    const basis = [emailHit && 'email', phoneHit && 'phone', orgHit && 'organization'].filter(Boolean);
    matches.push({ partyId: r.id, name: r.name, confidence, basis });
  }
  return matches.sort((a, b) => RANK[b.confidence] - RANK[a.confidence]);
}

/** Candidate duplicate leads, excluding closed and archived ones. */
export function findDuplicateLeads(db, { companyId, email, phone, organizationName, excludeLeadId = null }) {
  const e = normaliseEmail(email);
  const p = normalisePhone(phone);
  const o = normaliseOrg(organizationName);
  if (!e && !p && !o) return [];

  const rows = db.prepare(
    `SELECT id, reference, name, contact_name, organization_name, email, phone, stage
       FROM crm_leads
      WHERE company_id = ? AND archived = 0 AND stage NOT IN ('converted','duplicate')`
  ).all(companyId);

  const matches = [];
  for (const r of rows) {
    if (r.id === excludeLeadId) continue;
    const emailHit = Boolean(e) && normaliseEmail(r.email) === e;
    const phoneHit = Boolean(p) && normalisePhone(r.phone) === p;
    const orgHit = Boolean(o) && normaliseOrg(r.organization_name) === o;
    const confidence = classify({ emailHit, phoneHit, orgHit });
    if (confidence === CONFIDENCE.NONE) continue;
    matches.push({
      leadId: r.id, reference: r.reference, name: r.name, stage: r.stage,
      confidence, basis: [emailHit && 'email', phoneHit && 'phone', orgHit && 'organization'].filter(Boolean),
    });
  }
  return matches.sort((a, b) => RANK[b.confidence] - RANK[a.confidence]);
}

/**
 * Full duplicate report for a lead: both other leads and canonical parties.
 *
 * `autoReusableParty` is non-null only for exact/high confidence — the bands
 * where reusing an existing customer is safe without asking a human.
 */
export function detectDuplicates(db, { companyId, email, phone, organizationName, excludeLeadId = null }) {
  const leads = findDuplicateLeads(db, { companyId, email, phone, organizationName, excludeLeadId });
  const parties = findMatchingParties(db, { companyId, email, phone, organizationName });
  const best = strongest(parties);
  return {
    leads,
    parties,
    bestPartyMatch: best,
    autoReusableParty: best && (best.confidence === CONFIDENCE.EXACT || best.confidence === CONFIDENCE.HIGH) ? best : null,
    requiresUserChoice: Boolean(best && best.confidence === CONFIDENCE.POSSIBLE),
    state: leads.length || parties.length ? 'suspected' : 'clear',
  };
}
