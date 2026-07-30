# M2.5B–M2.6B — Opportunity, Stage, Activity, Sales and Work Item

**Status:** domain services **COMPLETE AND PROVEN**
**Date:** 2026-07-30

## Files

| File | Responsibility |
|---|---|
| `platform/domains/crm/opportunity-service.mjs` | create, update, assign, stage, pipeline, competitors, won/lost/reopen, archive/restore |
| `platform/domains/crm/sales-integration.mjs` | canonical Sales quotation and order linkage |
| `platform/domains/crm/activity-service.mjs` | activity lifecycle + canonical Work Item bridge |

## Two rules that shape the Opportunity service

**Weighted revenue is always server-derived** — `expected × probability ÷ 100`.
A client-supplied `weighted_revenue` is ignored, proven by passing
`999999999` and asserting the stored value is `200000`. A forecast a caller can
set is not a forecast.

**Won requires evidence** — a linked quotation, a linked Sales Order, or an
explicit privileged override carrying a reason. Proven:

| Attempt | Result |
|---|---|
| No evidence, no override | `WON_EVIDENCE_REQUIRED`, stays open |
| Override without reason | `WON_EVIDENCE_REQUIRED` |
| Override with reason | won, `evidence: 'override'`, reason stored |
| Linked Sales Order | won, `evidence: 'sale_order'`, no override needed |

Won is **final** — reopening returns `OPPORTUNITY_WON_IS_FINAL`, because a won
deal has downstream Sales facts that reopening would desynchronise.

## Stage transitions

Proven: probability and weighted revenue recalculate on move; the legacy `stage`
column stays in sync with `stage_id`; moving to the same stage is idempotent and
writes **no second history row**.

Denials: cross-pipeline stage (`STAGE_PIPELINE_MISMATCH`), archived stage
(`STAGE_INACTIVE`), stale version (`VERSION_CONFLICT`), and — deliberately —
dragging into a Won or Lost stage, which returns `WON_EVIDENCE_REQUIRED`.
Closing must go through the commands that carry the evidence and reason
requirements; a Kanban drag must not bypass them.

`changePipeline` lands on the target's first open stage and refuses a pipeline
with none (`PIPELINE_HAS_NO_OPEN_STAGE`).

## Lost and reopen

Lost requires a *valid* reason id; the legacy `lost_reason` column carries the
code so anything already reading it keeps working. An optional competitor is
recorded at `won_against_us`. Reopen restores an open stage, increments
`reopen_count`, clears the active lost reason — and **history retains why it was
lost**, asserted by scanning `crm_stage_history`.

## Sales integration — CRM stores a link, nothing more

`buildQuotationRequest` returns a payload for the canonical Sales action; the
test asserts it carries **no `amount_total`, no `tax`, no `discount`**. Pricing,
tax, stock, delivery, invoicing and GL stay in Sales.

`sale_orders.source_opportunity_id` already existed, so linkage is recorded on
both sides with no bridge table. Proven: replay returns `replayed: true` and
creates no duplicate; a *different* quotation cannot silently displace the first
(`QUOTATION_ALREADY_LINKED`); a party mismatch is refused
(`QUOTATION_PARTY_MISMATCH`).

## Work Item integration

One activity creates **at most one** Work Item, via the canonical
`work_items.source_type`/`source_id` columns — no bridge table. Proven:

- replay returns the existing Work Item, `created: false`, and the row count stays 1
- a different Work Item cannot displace the link (`WORK_ITEM_ALREADY_LINKED`)
- **cancelling the activity does not delete the Work Item** — it may already
  carry execution facts CRM does not own
- `onWorkItemCompleted` closes the activity through a governed event, so the
  Work Item stays authoritative for execution rather than CRM polling it

## Activities

Eight types, states `planned | in_progress | completed | cancelled`.
**Overdue is derived**, never stored — a stored flag goes stale the moment the
clock moves, proven by asserting a completed past-due activity is not overdue.
Views: today, overdue, upcoming, completed, open; all company-scoped.

### Schema limitation found — recorded, not worked around

`crm_activities.lead_id` is **`NOT NULL` with a foreign key to `crm_leads`**
(migration 039). Migration 046 did not extend it; it added a separate
`crm_opportunity_activities` table instead.

So an activity must hang off a lead. For an opportunity created by conversion
the source lead resolves automatically, which covers the normal path. An
opportunity created **directly** has no lead, and its activity cannot be stored
in this table.

That case now **fails loudly** with the constraint named in the error, rather
than inventing a sentinel lead id or silently writing to the other table. A
forward migration relaxing the constraint is required to close it — deliberately
not attempted here, since a `crm_activities` table rebuild carries FK and data
risk that needs its own tested slice.

## Atomicity

A stage change that fails mid-command (unknown stage) rolls back with the stage
unchanged and **no stage-history row written**.

## Tests

`tests/module-wave-1/crm/opportunity.test.mjs` — 11 cases:

```
PASS: createAndWeightedRevenue        PASS: salesIntegration
PASS: stageTransitions                PASS: activityLifecycle
PASS: changePipeline                  PASS: workItemIntegration
PASS: wonRequiresEvidence             PASS: crossCompanyDenied
PASS: lostAndReopen                   PASS: atomicityOfStageChange
PASS: archiveRestoreAndCompetitors
```

### Regression

```
CRM domain        14/14      CRM migration   8/8
CRM opportunity   11/11      registry        6/6
migration suite   5 files, 5 pass, 0 fail
precommit         passed
```

## Corrections made this slice

1. My `scheduleActivity` computed a resolved `leadId` but the INSERT still bound
   `input.lead_id`, so the guard passed and the database rejected the row. Fixed
   in both the insert and the next-activity update.
2. The test helper created opportunities without a source lead, which the 039
   constraint forbids for activities; a lead-backed helper was added and the
   limitation given its own explicit assertion.

## Not yet done

ActionExecutor registration, runtime permission enforcement, HTTP query layer,
Customer 360, reporting, shell UI, multi-process concurrency, browser
acceptance, and the forward migration for opportunity-only activities.

**Classification: PARTIAL — REMEDIATION REQUIRED.**
