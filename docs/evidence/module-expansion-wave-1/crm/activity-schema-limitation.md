# CRM Activity schema limitation — before migration 066

**Date:** 2026-07-30
**Status:** FIXED by `066_crm_activity_subject_unification` (see `activity-unification-migration.md`)

## The limitation

`crm_activities.lead_id` has been `NOT NULL REFERENCES crm_leads(id) ON DELETE
CASCADE` since `039_crm_sales_contracts_commissions`. Migration `065` added a
nullable `opportunity_id` column to the same table (`ADD COLUMN` cannot lift a
`NOT NULL` constraint on an existing column in SQLite), so an Activity could be
scheduled against an Opportunity only if that Opportunity had a resolvable
source Lead:

```js
// platform/domains/crm/activity-service.mjs, pre-066
let leadId = input.lead_id ?? null;
if (!leadId && input.opportunity_id) {
  const opp = db.prepare('SELECT lead_id FROM crm_opportunities WHERE id = ?').get(input.opportunity_id);
  leadId = opp?.lead_id ?? null;
}
if (!leadId) {
  fail(CRM_ERRORS.VALIDATION_FAILED, 'crm_activities.lead_id is NOT NULL (migration 039); ...');
}
```

An Opportunity created directly (no source Lead — the normal path once direct
Opportunity creation ships) could not carry an Activity at all. The code failed
loudly rather than inventing a sentinel Lead, and the limitation was covered by
a test asserting the failure (`tests/module-wave-1/crm/opportunity.test.mjs`,
now updated to assert the fix instead — see below).

## A second, independently-discovered problem

While investigating this limitation, a second Activity write authority surfaced
that the original brief did not mention: `platform/sales/lifecycle.mjs` — a
pre-Wave-1 Sales module (Checkpoint C / Phase 03-04 era) — writes directly to
`crm_opportunity_activities` via `logOpportunityActivity()` and
`addOpportunityActivity()`, registered as ActionExecutor commands
`crm:opportunity:update_stage`, `crm:opportunity:close`, and
`crm:opportunity:add_activity` (colon-segmented ids, a different naming
convention than the underscore-segmented `crm:opportunity_*` ids this wave's
brief specifies). This is a genuine second writer for Opportunity Activities,
independent of `platform/domains/crm/activity-service.mjs`.

This migration and its service update retire `crm_opportunity_activities` as a
*table* and redirect both legacy write sites to the unified `crm_activities`
table. It does **not** consolidate the two competing Opportunity-lifecycle
write authorities themselves (`platform/sales/lifecycle.mjs`'s
`convertLead`/`updateOpportunityStage`/`closeOpportunity` vs.
`platform/domains/crm/opportunity-service.mjs` / `conversion-service.mjs`) —
that is a separate, pre-existing architectural problem, out of this
migration's scope, and recorded in `unresolved-risks.md`.

## Fix

See `activity-unification-migration.md` for the schema change, the service
update, and full test evidence.
