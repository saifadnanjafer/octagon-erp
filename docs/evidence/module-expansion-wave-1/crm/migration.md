# M2 CRM — Migration

**Migration:** `065_crm_pipeline_leads_opportunities_and_activities`
**Status:** migration COMPLETE AND PROVEN · **three regression suites RED — open defect**
**Date:** 2026-07-30

## Approach: extend, do not duplicate

A CRM already exists. `crm_leads` and `crm_activities` come from
`039_crm_sales_contracts_commissions`; `crm_opportunities` and
`crm_opportunity_activities` from `046_sales_lifecycle_expansion`.
`sale_orders.source_opportunity_id` already exists.

065 therefore **ALTERs** the three existing tables and **CREATEs** only the 18
tables that genuinely did not exist. The existing vocabulary — `name`, `stage`,
`status`, `expected_value`, `version` — is preserved, so nothing already reading
those columns breaks.

`crm_opportunities.version` already existed and is the optimistic-concurrency
token; the concurrency suite should use it rather than adding a second guard.

### Columns added

| Table | Added |
|---|---:|
| `crm_leads` | 33 — reference, branch, organization, address, source, campaign, team, product interest, score + explanation, qualification, conversion lineage, duplicate state, archive, version, actors |
| `crm_opportunities` | 24 — reference, pipeline, stage, team, source, campaign, segment, currency, weighted revenue, quotation/order links, won evidence + override reason, lost/reopen facts, archive, actors |
| `crm_activities` | 15 — company, opportunity, party, assignee, state, priority, due, completion, outcome, work_item_id, cancellation, actors |

`addColumn()` checks `PRAGMA table_info` first, so the migration is idempotent and
safe on databases that already carry some of these columns.

### Tables created (18)

`crm_pipelines` · `crm_pipeline_stages` · `crm_sales_teams` · `crm_team_members` ·
`crm_lead_sources` · `crm_campaigns` · `crm_customer_segments` ·
`crm_competitors` · `crm_lost_reasons` · `crm_tags` · `crm_lead_tags` ·
`crm_opportunity_tags` · `crm_opportunity_competitors` · `crm_interactions` ·
`crm_stage_history` · `crm_conversion_links` · `crm_scoring_rules` ·
`crm_score_history`

### Seed data

1 default pipeline · 6 stages (NEW 10% → QUALIFY 25% → PROPOSAL 50% →
NEGOTIATION 75% → WON 100% / LOST 0%) · 6 lead sources · 6 lost reasons ·
8 deterministic scoring rules. All bilingual; a test asserts every user-visible
label carries real Arabic.

A default pipeline is seeded because a CRM without one cannot accept a
conversion.

## Tests — `tests/module-wave-1/crm/migration.test.mjs`

```
PASS: appliesAsTip (65 migrations)
PASS: extendsExistingTablesRatherThanDuplicating (22 crm tables)
PASS: newConfigurationTablesExist (18 tables)
PASS: seedData (1 pipeline, 6 stages, 6 sources, 6 lost reasons, 8 scoring rules)
PASS: moduleLifecycleFlips
PASS: rerunIsIdempotent
PASS: rollbackAndReapply
PASS: existingDataSurvivesTheUpgrade

All CRM migration tests passed.
```

Two assertions carry most of the weight:

- **`extendsExistingTablesRatherThanDuplicating`** checks semantically, not by
  name: exactly one table carries both `contact_name` and `stage` (the lead
  store), and exactly one carries both `party_id` and `expected_value` (the
  opportunity store). A name match would have been fooled by `crm_lead_sources`.
- **`existingDataSurvivesTheUpgrade`** inserts a 039-shaped lead at tip 064, runs
  065, and asserts the row survives with its original values while the new
  columns arrive at their defaults.

## Rollback semantics — deliberate asymmetry

`down()` drops the 18 new tables and returns the module to `planned`, but does
**not** drop `crm_leads` / `crm_opportunities` / `crm_activities`. Those predate
this migration; dropping them would destroy data 065 never owned. SQLite cannot
portably `DROP COLUMN`, so the added columns remain as inert defaults, which a
re-run reclaims idempotently. The test asserts both halves of this.

---

## OPEN DEFECT — three regression suites red

Adding 065 turned three previously-green suites red:

```
✖ tests/migration/health-only-mode.test.mjs
✖ tests/migration/rollback-remediation.test.mjs
✖ tests/migration/startup-policy.test.mjs
```

`rollback-remediation` fails with `FOREIGN KEY constraint failed` during a deep
rollback (`testRollbackToTarget`, unwinding to 013). The other two very likely
share the cause, since all three perform multi-step rollbacks of the full chain.

### Contributing cause found and fixed

`064.down()` deleted its `platform_modules` rows while `platform_entities` still
held rows referencing them. Once 065 registered 7 CRM entities, that became a
live foreign-key violation. 064 now clears `platform_entities` for its module ids
before deleting the modules, and 064 was re-accepted in its manifest with the
reason recorded.

I enumerated every table with a foreign key to `platform_modules`:
`platform_entities` (7 Wave-1 rows) is the only one carrying any. So that fix
addresses the only referencing rows I could find.

### Still failing — not diagnosed

The deep-rollback failure persists after that fix. I ran out of context before
isolating it. **I have not established whether it is caused by 065 or was already
latent and merely exposed by a longer chain** — that attribution question is the
first thing the next session should settle, by running these three suites at
`7f5f204` (before 065) and comparing.

This is recorded as an open defect rather than worked around. The suites were
green before this checkpoint and are red now; that is a regression regardless of
root cause, and it blocks any CRM completion claim.

## Honest scope

Delivered: the migration, its manifest acceptance, and its 8-case suite.

**Not delivered:** domain services, ActionExecutor commands, HTTP API,
permissions enforcement, Party conversion runtime, Sales/Work Item integration,
Customer 360, scoring runtime, reporting, shell UI, atomicity, failure injection,
concurrency, and browser acceptance. M2.3 through M2.10 remain.

**Classification: PARTIAL — REMEDIATION REQUIRED.**
