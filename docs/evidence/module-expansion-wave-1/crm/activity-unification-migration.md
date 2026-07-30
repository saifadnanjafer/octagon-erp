# M2.5E — CRM Activity subject unification

**Migration:** `066_crm_activity_subject_unification`
**Status:** migration + service update COMPLETE AND PROVEN
**Date:** 2026-07-30
**Manifest:** `database/migration-manifests/accepted-066-crm-activity-unification.json`

## What changed

`crm_activities` was rebuilt (SQLite cannot `ALTER` a column's `NOT NULL` or add
a `CHECK` constraint in place — table copy is the only portable route):

- `lead_id` is now **nullable**.
- A new `subject_type` column (`'lead' | 'opportunity' | 'party'`) names the
  **primary** subject and is enforced by a `CHECK` constraint:

  ```sql
  CHECK (
    (subject_type = 'lead' AND lead_id IS NOT NULL AND opportunity_id IS NULL AND party_id IS NULL)
    OR (subject_type = 'opportunity' AND opportunity_id IS NOT NULL AND party_id IS NULL)
    OR (subject_type = 'party' AND party_id IS NOT NULL AND lead_id IS NULL AND opportunity_id IS NULL)
  )
  ```

- An Opportunity-subject Activity **may still carry `lead_id`** for lineage when
  the Opportunity came from a conversion — this was already-tested behaviour
  (`activity-service.mjs` resolves the source Lead) and had to keep working, so
  "exactly one subject" is enforced on `subject_type` + its matching column, not
  on "only one FK column may ever be non-null".
- `crm_opportunity_activities` (from `046_sales_lifecycle_expansion`) is
  imported into the unified table with `legacy_source` recording its
  provenance, then **retired as a writable table** and replaced by a read-only
  compatibility `VIEW` of the same name and 7-column shape, because
  `platform/sales/lifecycle.mjs#getOpportunity` still reads it.
- New indexes: `idx_crm_activity_lead`, `idx_crm_activity_party`,
  `idx_crm_activity_subject`, alongside the two carried over from 065
  (`idx_crm_activity_assignee`, `idx_crm_activity_opp`).

**Dialect: SQLite only.** The rebuild uses `PRAGMA table_info` and
`PRAGMA foreign_key_check`, both documented in
`database/dialects/sql-portability.mjs` as untranslatable to PostgreSQL.
Declaring `postgres` support here would be a claim this migration cannot back
up, so it declares `dialect: ['sqlite']` — consistent with `046`, which also
owns Activity tables and is SQLite-only.

## Rollback policy — honest, not silently lossy

`down()`:

1. Restores `crm_opportunity_activities` as a real table, populated from rows
   where `opportunity_id IS NOT NULL AND lead_id IS NULL` (both the originally
   imported legacy rows and any post-migration direct-Opportunity Activities
   with no Lead lineage — both would only ever have lived there).
2. Rebuilds `crm_activities` to its 065-tip shape (`lead_id` `NOT NULL` again,
   no `subject_type`/`legacy_source`), populated from rows where
   `lead_id IS NOT NULL` (covers both pure Lead-subject rows and
   Opportunity-subject rows that carry Lead lineage).
3. **Refuses** — with a typed `IrreversibleActivityDataError`
   (`code: 'IRREVERSIBLE_ACTIVITY_DATA'`) — if any row has
   `subject_type = 'party'`. A direct Party-linked Activity has no column in
   either pre-migration table to hold it; splitting it back would silently
   drop data. The refusal is checked *before* any table is touched, so a
   refused rollback leaves the database exactly as it was.

## Service update — `platform/domains/crm/activity-service.mjs`

`scheduleActivity()` no longer fails loudly for a Lead-less Opportunity. The
caller supplies exactly one of `lead_id` / `opportunity_id` / `party_id`
(validated — zero or more-than-one is rejected); when `opportunity_id` is
supplied, the Opportunity's source Lead is still resolved and stored for
lineage, but is no longer required.

## Legacy write-site update — `platform/sales/lifecycle.mjs`

`logOpportunityActivity()` and `addOpportunityActivity()` (registered as
ActionExecutor commands `crm:opportunity:update_stage`, `crm:opportunity:close`,
`crm:opportunity:add_activity`) now `INSERT INTO crm_activities` directly
(`subject_type='opportunity'`) instead of the now read-only
`crm_opportunity_activities` view — inserting through the view would fail. No
lineage is invented for these legacy call sites beyond what the Opportunity row
itself already carries (`crm_opportunities.lead_id`).

## Populated-data proof (required by the M2.5E brief)

`tests/module-wave-1/crm/activity-unification-migration.test.mjs` builds a
pre-066 fixture at the 065 tip with: a pure Lead-subject Activity, an
Opportunity-subject Activity that also carries Lead lineage (the
already-working converted-Opportunity case), and a legacy row in the separate
`crm_opportunity_activities` table (the direct-Opportunity case the limitation
blocked). Then:

```
PASS: populatedUpgradePreservesEveryRow        — 2 existing + 1 imported = 3 rows, none lost, none duplicated
PASS: crmOpportunityActivitiesBecomesReadOnlyView — INSERT through the view fails; SELECT still works
PASS: directOpportunityActivityAfterMigration  — the previously-blocked case now inserts; a
                                                   mismatched subject_type/lead_id row is rejected by CHECK
PASS: rerunIsIdempotentAndForeignKeysClean     — rerun is a no-op; PRAGMA foreign_key_check is clean
PASS: rollbackRestoresOriginalShapeWhenPossible — round trip (up → down → up) returns to the same row count
PASS: rollbackRefusesOnIrreversiblePartyData   — a party-subject row blocks rollback with the typed error,
                                                   and the failed attempt leaves the database unchanged
```

## Regression

```
node --test tests/module-wave-1/crm/*.test.mjs                           → 4 files, all pass
  domain.test.mjs (14), migration.test.mjs (8), opportunity.test.mjs (11 + new activity coverage),
  activity-unification-migration.test.mjs (6, new)
node --test tests/migration/*.test.mjs                                   → 5 files, 5 pass, 0 fail
node --test tests/module-expansion/registry.test.mjs                     → 6/6 pass
node --test tests/checkpoint-c/migration_046.test.mjs                    → 4/4 pass (fixed — see below)
node --test tests/unit/*.test.mjs                                        → 9 files, all pass
node --test tests/checkpoint-d-e/*.test.mjs                              → 56/56 pass
node --test tests/phase04/*.test.mjs                                     → 47/47 pass (incl. Wave D CRM Lead lifecycle)
node scripts/permission-regression.mjs                                   → 35/35 pass
node scripts/precommit.js                                                → passed
```

### Test files updated for the new tip, not weakened

- `tests/module-wave-1/crm/opportunity.test.mjs` — the assertion that scheduling
  an Activity on a Lead-less Opportunity *throws* is replaced with an assertion
  that it now *succeeds* (the whole point of this migration), plus new coverage
  for direct Party-subject Activities and the "more than one subject supplied"
  rejection.
- `tests/module-wave-1/crm/domain.test.mjs` — a manual `crm_activities` INSERT
  in the lead-merge test needed `subject_type='lead'` added (NOT NULL column).
- `tests/module-wave-1/crm/migration.test.mjs` — three assertions hard-coded
  "065 is the tip" / "rollback 1 step reaches pre-065" / "rollback lands at
  064 with steps:1"; all three now account for 066 sitting above 065
  (tip check, `steps: 2`, `target` param).
- `tests/module-expansion/registry.test.mjs` — same shape of fix: unwinding the
  registry now needs `steps: 3`, not `steps: 2`.
- `tests/checkpoint-c/migration_046.test.mjs` — this suite calls `046.down()`
  and `046.up()` **directly**, bypassing the dependency-aware migration runner
  (which would normally unwind 066 before 046 and reapply it after). `046.down()`
  does `DROP TABLE IF EXISTS crm_opportunity_activities`, which now fails
  (`use DROP VIEW to delete view crm_opportunity_activities`) because that name
  is a view post-066. Fixed by calling `066.down()`/`066.up()` around the manual
  `046.down()`/`046.up()` calls in this test only — **migration 046 itself was
  not edited**, per the explicit instruction not to touch it. This is a test
  fixed to reflect a real dependency that did not exist when the test was
  written, not a weakened assertion — every original assertion in that file
  still holds.

### Pre-existing, unrelated failure — not introduced by this work

`tests/checkpoint-f/canonical_authority_coverage.test.mjs` fails one case
(`module 'appointments' has no declared canonical authority domain`). Verified
via `git stash` that this failure is present on the pre-066 baseline as well —
it predates this migration and is out of scope for it.

## Honest scope

**Delivered (M2.5E):** the migration, its manifest acceptance, the Activity
service fix, the legacy write-site fix, and full test coverage for all of the
above, including a populated-data upgrade proof and an honest (refuse, not
silently lossy) rollback policy.

**Not delivered in this checkpoint:** ActionExecutor registration for the CRM
underscore-segmented action ids (M2.5G — none of `crm:lead_*`, `crm:opportunity_*`,
`crm:activity_*`, `crm:pipeline_*` are registered as of this commit; only the
legacy colon-segmented `crm:lead:convert` / `crm:opportunity:update_stage` /
`crm:opportunity:add_activity` / `crm:opportunity:close` exist), runtime
permissions (M2.5H), HTTP query layer and Customer 360 (M2.7A), scoring
configuration and reporting (M2.7B), original-shell UI (M2.8), atomicity /
failure injection / multi-process concurrency suites (M2.9), and Chromium
browser acceptance (M2.10).

**Classification: PARTIAL — REMEDIATION REQUIRED.** (Unchanged from before this
checkpoint at the CRM-module level; M2.5E itself is complete and proven.)
