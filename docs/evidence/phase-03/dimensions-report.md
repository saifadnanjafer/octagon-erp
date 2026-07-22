# Wave C — Accounting Dimensions Report

**Scope:** Packet 03.12 — Accounting dimensions and analytic distribution.
**Evidence date:** 2026-07-22

## What was implemented

- `finance_dimensions` / `finance_dimension_values` — configurable analytic axes (project/department/cost-center/branch/machine/vehicle/custom), company-scoped, unique per `(company_id, code)`.
- `finance_account_dimension_policies` — per-account `required`/`optional`/`blocked` policy per dimension.
- `validateDimensionDistribution` — enforced **inside `postDocument`**, before any journal line is written: parses each line's `dims` JSON (`{ dimensionValueId: percent }`), checks each dimension's percentages sum to 100 (±0.01 tolerance), and checks the account's `required`/`blocked` policy per dimension. A violation aborts the entire posting.
- `getDimensionBreakdown` — reconciliation query: net (debit − credit) by dimension value, sourced only from posted `finance_journal_lines.dims`, never a duplicated dimension-balance table.

## A real bug found and fixed

This migration (`016_accounting_dimensions.mjs`) already existed on disk as **uncommitted** work from a prior session — this is the exact file the earlier repository audit (see `docs/evidence/phase-03/wave-c-checkpoint-report.md`) found modified-but-never-committed. A fresh-install test (`node scripts/migrate.mjs fresh`) run at the start of Wave C failed with:

```
MigrationRunnerError: Migration "016_accounting_dimensions" failed during up: FOREIGN KEY constraint failed
```

Root cause: the migration registered three `platform_actions` rows with `entity_id` values (`finance_dimension`, `finance_dimension_value`, `finance_account_dimension_policy`) that were never inserted into `platform_entities` — and `platform_actions.entity_id` is a foreign key to `platform_entities(id)`. This is very likely why the migration was never committed. Fixed by registering the three missing entities before the actions insert (matching the pattern already used in `014_finance_canonical_schema_and_coa.mjs`), and added a permanent regression test that scans for orphaned `entity_id` references across the whole `finance_canonical` module so this class of bug cannot silently recur in a later migration.

## Files changed

- `database/migrations/016_accounting_dimensions.mjs` (completed: entity registration added to `up()` and `down()`)
- `platform/finance/engine.mjs` (+`getDimensionBreakdown`)
- `platform/finance/index.mjs` (no change needed — dimension handlers were already registered)
- `tests/phase03/finance-wave-c.test.mjs`

## Tests and results

| Test | Result |
|------|--------|
| Fresh install of migrations 016-021 succeeds with no orphaned `entity_id` references | PASS |
| Missing required dimension is rejected at posting time | PASS |
| Invalid distribution total (≠100) is rejected; a valid total posts | PASS |
| Posted distribution reconciles exactly to `getDimensionBreakdown` | PASS |
| Blocked dimension rejects a distribution | PASS |

Command:

```bash
node tests/phase03/finance-wave-c.test.mjs
# 29/29 passed (5 of the 29 are dimension-specific)
```

## Reconciliation evidence

Posted a 100 IQD expense line distributed 60%/40% across two `DEPT` values. `getDimensionBreakdown({ dimension_id })` returns `net = 60` and `net = 40` respectively — sum 100, matching the posted line exactly.
