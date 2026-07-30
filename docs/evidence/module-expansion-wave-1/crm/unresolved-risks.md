# CRM — unresolved risks

**Date:** 2026-07-30 (M2.5E checkpoint)

> **Superseded at CRM Integration-Ready closure:** Risk 1 is fixed by
> `opportunity-write-authority-map.md`, the delegating compatibility adapters,
> and `single-write-authority.test.mjs`. Risk 2 remains an intentional read-only
> compatibility view, not a competing writer. Risk 3 is outside CRM and remains
> a later-wave regression item. Current CRM deferrals are recorded in
> `../DEFERRED_INTEGRATION_AND_HARDENING.md`.

## 1. Two competing Opportunity-lifecycle write authorities (discovered, not fixed)

`platform/sales/lifecycle.mjs` — a pre-Wave-1 module (Checkpoint C / Phase
03-04 era) — implements its own `convertLead()`, `updateOpportunityStage()`,
`addOpportunityActivity()`, and `closeOpportunity()`, writing directly to
`crm_leads` and `crm_opportunities` with minimal validation (e.g.
`updateOpportunityStage` increments `version` unconditionally with no
client-supplied expected-version check — no optimistic concurrency guard at
all). These are registered as ActionExecutor commands under a
**colon-segmented** naming convention:

```
crm:lead:convert
crm:opportunity:update_stage
crm:opportunity:add_activity
crm:opportunity:close
```

Separately, `platform/domains/crm/opportunity-service.mjs` and
`conversion-service.mjs` (the Wave 1 M2 CRM work this brief continues) implement
the same conceptual operations — Lead conversion, stage/pipeline changes,
Won/Lost/Reopen — with real validation: optimistic concurrency via
`crm_opportunities.version`, typed errors, audit, outbox, idempotency keys. As
of this commit **none of these are registered as ActionExecutor commands at
all** (confirmed: `grep -rln "crm:lead_\|crm:opportunity_\|crm:activity_\|crm:pipeline_"`
across non-test `.mjs` files returns nothing beyond a comment).

Both sets of functions write to the *same tables* (`crm_leads`,
`crm_opportunities`) with different vocabularies for "how a stage change is
validated." Right now this is latent rather than actively harmful only because
the Wave 1 services are unregistered and therefore unreachable by any real
caller — but M2.5G (ActionExecutor registration) is explicitly the next
milestone, and registering the underscore-segmented actions *without*
resolving this will leave two live, reachable write paths for the same rows.

**This migration (066) does not attempt to resolve it.** It was discovered
while investigating the Activity schema limitation, is a pre-existing
condition, and touching it was out of scope for a schema-unification
migration. It should be the first thing M2.5G's ActionExecutor-registration
work reconciles — either by registering the Wave 1 services under the
requested ids and formally deprecating the legacy `crm:opportunity:*` ids (with
a migration path for anything already depending on them), or by an explicit,
recorded decision to keep both and document why.

## 2. `crm_opportunity_activities` compatibility view is a transitional shim

The view is read-only by construction (any `INSERT`/`UPDATE`/`DELETE` against it
fails). `platform/sales/lifecycle.mjs#getOpportunity` is its only remaining
reader. Once that reader is moved onto `crm_activities` directly (naturally,
whenever the dual-authority problem above is resolved), the view can be
dropped. It is not needed for anything else in this repository as of this
commit.

## 3. Pre-existing, unrelated test failure

`tests/checkpoint-f/canonical_authority_coverage.test.mjs` — `module
'appointments' has no declared canonical authority domain`. Confirmed present
on the pre-066 baseline via `git stash`; unrelated to CRM Activity work.
Recorded here rather than silently left for a future session to rediscover.
