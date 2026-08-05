'use strict';

// Review Freeze — marketing fixtures (BUILD-12 marketing simulation pack).
//
// Disposable, fictional demo data for human UI/functional review of the
// marketing:* actions registered in platform/build12/index.mjs, against the
// tables created by
// database/migrations/089_build12_ai_people_marketing_events_pack.mjs:
//   marketing_campaigns, marketing_content, marketing_content_reviews,
//   marketing_attribution.
//
// This platform's marketing communication is simulation-only — nothing here
// is ever sent to a real recipient or published externally. Every content
// row and campaign carries an explicit "SIMULATED" / "SIMULATION ONLY"
// marker, matching the literal simulation_label defaults the migration
// bakes into the schema.
//
// All rows are idempotent (ON CONFLICT(id) DO NOTHING) and every id is
// prefixed `rev_` so they are trivially distinguishable from operational
// data and easy to purge from a disposable review database.

const REVIEW_ACTOR = 'system:review-fixture';

function isoPlusDays(baseIso, days) {
  return new Date(new Date(baseIso).getTime() + days * 86400000).toISOString();
}

/**
 * Seed a handful of fictional marketing fixtures: a draft campaign, an
 * approved campaign, content awaiting review, approved content, and a
 * simulated attribution record.
 *
 * @returns {Promise<{summary: object}>}
 */
export async function seedMarketingFixtures(dialect, { tenantId, companyId, branchId, now } = {}) {
  // companyId/branchId are accepted for signature symmetry with the other
  // review fixture seeders, but marketing_* tables (migration 089) are
  // tenant-scoped only — there is no company_id/branch_id column to write.
  void companyId;
  void branchId;
  const ts = now || new Date().toISOString();

  const insertCampaign = dialect.prepare(`
    INSERT INTO marketing_campaigns
      (id, tenant_id, name, status, audience_id, objective, budget, simulation_label, starts_at, ends_at, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `);

  const draftCampaignId = 'rev_mkt_campaign_draft';
  insertCampaign.run(
    draftCampaignId, tenantId, '[DEMO] Spring Promo Campaign (Draft)', 'draft',
    'Fictional demo objective: raise awareness of a spring workshop promotion. Review environment only.',
    5000, 'SIMULATION ONLY - NO EXTERNAL PUBLISHING',
    isoPlusDays(ts, 14), isoPlusDays(ts, 45), REVIEW_ACTOR, ts, ts,
  );

  const approvedCampaignId = 'rev_mkt_campaign_approved';
  insertCampaign.run(
    approvedCampaignId, tenantId, '[DEMO] Al-Warsha Loyalty Relaunch (Approved)', 'approved',
    'Fictional demo objective: relaunch a loyalty program for review-only walkthroughs.',
    8000, 'SIMULATION ONLY - NO EXTERNAL PUBLISHING',
    isoPlusDays(ts, 7), isoPlusDays(ts, 60), REVIEW_ACTOR, ts, ts,
  );

  const insertContent = dialect.prepare(`
    INSERT INTO marketing_content
      (id, tenant_id, campaign_id, title, body, channel, status, created_by, approved_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `);

  const contentAwaitingReviewId = 'rev_mkt_content_awaiting_review';
  insertContent.run(
    contentAwaitingReviewId, tenantId, approvedCampaignId,
    '[DEMO] Spring Promo Email Draft (Simulated Send)',
    '[SIMULATED CONTENT - never sent to any real recipient] Fictional promotional copy, for review environment walkthroughs only.',
    'email', 'submitted', REVIEW_ACTOR, null, ts, ts,
  );

  const contentApprovedId = 'rev_mkt_content_approved';
  insertContent.run(
    contentApprovedId, tenantId, approvedCampaignId,
    '[DEMO] Loyalty Relaunch Social Post (Simulated Send)',
    '[SIMULATED CONTENT - never sent to any real recipient] Fictional social copy, for review environment walkthroughs only.',
    'social', 'approved', REVIEW_ACTOR, REVIEW_ACTOR, ts, ts,
  );

  dialect.prepare(`
    INSERT INTO marketing_content_reviews
      (id, tenant_id, content_id, reviewer_id, decision, reason, created_at)
    VALUES (?, ?, ?, ?, 'approved', ?, ?)
    ON CONFLICT(id) DO NOTHING
  `).run(
    'rev_mkt_content_review_approved', tenantId, contentApprovedId, REVIEW_ACTOR,
    '[DEMO] Approved via review fixture (simulated review decision, no real distribution).', ts,
  );

  const attributionId = 'rev_mkt_attribution_simulated';
  dialect.prepare(`
    INSERT INTO marketing_attribution
      (id, tenant_id, campaign_id, source, medium, leads, conversions, simulated_revenue, simulation_label, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `).run(
    attributionId, tenantId, approvedCampaignId, 'demo_newsletter', 'email',
    42, 7, 1500.0, 'SIMULATION ONLY - CANONICAL SALES DATA UNCHANGED', ts,
  );

  const summary = {
    tenantId,
    campaigns: { draft: draftCampaignId, approved: approvedCampaignId },
    content: { awaitingReview: contentAwaitingReviewId, approved: contentApprovedId },
    contentReview: 'rev_mkt_content_review_approved',
    attribution: attributionId,
  };
  return { summary };
}
