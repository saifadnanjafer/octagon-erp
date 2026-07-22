# Wave F — Legacy Finance Migration and Cross-Module Adapter Report

**Scope:** Packet 03.27 (legacy finance bridge and opening-balance migration) and Packet 03.28 (cross-module accounting test adapters).
**Evidence date:** 2026-07-22

## Important scope note (read first)

**This packet builds and thoroughly tests the migration engine. It does not execute a migration against the live application database.** Every function below takes legacy records as plain JS arrays passed as input — none of them reach into `PentagonDB.getCached()` or `database.db` themselves. This was a deliberate design choice: it makes the engine fully testable against synthetic fixtures without any risk to the running application, and it keeps the "read legacy data" step (which does need to touch the live store) as a separate, explicit, reviewable action rather than baked into logic that already ran once and can't be un-run. Running the actual live extraction (reading `PentagonDB.getCached().finance.accounts` / `.account_moves` and calling `migrateLegacyAccounts`/`migrateLegacyMoves` with that real data) has **not** been done and requires explicit owner authorization plus a maintenance window — this is exactly the kind of action Phase 03 Section 13's hard-stop rule ("production data is the only available test target") warns against improvising around.

## What was implemented — legacy migration engine (Packet 03.27)

- Current legacy store confirmed by inspection: `services/financeService.js` reads/writes `PentagonDB.getCached().finance.accounts` (array) and `db.account_moves` (array) — a JSON document store, matching the project's existing "Finance DB paths" documentation, not a relational legacy schema.
- `finance_migration_runs` / `finance_migration_source_map` / `finance_migration_quarantine` — the source map has a **unique index on `(company_id, source_system, source_id)`**, so re-running an import is guaranteed idempotent at the database level, not just by application logic.
- `migrateLegacyAccounts` — maps legacy account-type vocabulary (`asset`/`revenue`/`bank`/etc.) to canonical `ACCOUNT_TYPES`; unmappable types or missing required fields are quarantined with a reason and the raw record preserved, never silently dropped. Two-pass import correctly resolves parent/child hierarchy even when a child references a parent processed later in the same batch.
- `migrateLegacyMoves` — validates each move balances (debit = credit) and that every referenced account was already migrated (via the source map), then posts through the **existing** `createDocument`/`submitDocument`/`approveDocument`/`postDocument` pipeline with `source_type: 'legacy_migration'` and a `source_canonical_key` — reusing Wave C's duplicate-reference check for import idempotency rather than inventing a second mechanism.
- `reconcileMigrationTrialBalance` — compares a legacy trial balance against `getTrialBalance` (the same canonical query every other report uses) and reports per-account diffs; a genuine mismatch is surfaced, not hidden.
- `rollbackMigrationRun` — reverses every document a completed run posted (via the existing `reverseDocument`), then marks the run `rolled_back`; a second rollback attempt on the same run is rejected.

## What was implemented — cross-module source-fact adapters (Packet 03.28)

- `finance_source_fact_schemas` — a versioned registry of 12 accepted fact types across sales, procurement, inventory, manufacturing, project, payroll, POS, and asset "source modules" — with an explicit required-field contract per type. **No operational module was built** (the packet's own rule: "Do not create the operational source module inside Phase 03").
- `postSourceFact` / `reverseSourceFact` — one narrow adapter used by every future source module, not one per module. Validates the fact against its registered schema, then posts through the same single `createDocument` pipeline with idempotency via `source_canonical_key` (`${fact_type}:${source_id}`).
- Proven: a later phase's real module can replace the fixture-style call with a real one without any GL-side code changing, because the adapter's contract (fact_type + required fields + lines) is the only surface a caller ever touches.

## Files changed

- `database/migrations/033_legacy_finance_migration_registry.mjs`
- `database/migrations/034_cross_module_source_fact_adapters.mjs`
- `platform/finance/engine.mjs` (+17 exported functions)
- `platform/finance/index.mjs` (+7 handler registrations)
- `tests/phase03/finance-wave-f-migration.test.mjs`

## Tests and results

| Test | Result |
|------|--------|
| Legacy account-type vocabulary mapping (positive and unmappable cases) | PASS |
| Valid accounts import; unmappable type / missing name quarantined, not dropped | PASS |
| Duplicate account import is idempotent (source map prevents re-insert) | PASS |
| Legacy parent/child account hierarchy preserved | PASS |
| Balanced legacy moves post; unbalanced and account-not-migrated moves quarantined | PASS |
| Duplicate move import is idempotent | PASS |
| Reconciliation surfaces a genuine trial-balance mismatch, not just the happy path | PASS |
| Migration run rollback reverses every posted document; double-rollback rejected | PASS |
| Migrated data stays company-isolated | PASS |
| Source-fact adapter rejects unknown fact_type and missing required fields | PASS |
| Source-fact posting is idempotent by source reference and reversible | PASS |
| Source-fact posting respects period locks like every other document | PASS |

Command:

```bash
node tests/phase03/finance-wave-f-migration.test.mjs
# finance-wave-f-migration: 12/12 passed
```

## Row/count/hash reconciliation evidence

Migrated 2 legacy accounts and 1 legacy move (a 400 IQD expense/cash entry): `reconcileMigrationTrialBalance` against the correct legacy trial balance (`[{code:'10100',balance:-400},{code:'50100',balance:400}]`) reports `fully_reconciled: true`. Feeding a deliberately wrong legacy balance (`-350` instead of `-400`) correctly reports `fully_reconciled: false` with the exact diff — proving the reconciliation check would catch a real discrepancy, not just pass by construction.

## Duplicate-run idempotency evidence

Running `migrateLegacyAccounts` twice with the identical fixture: first run `imported: 1`, second run `imported: 0, skipped: 1`; exactly one row exists in `finance_accounts` for that code. Same pattern proven for `migrateLegacyMoves` (second run does not create a second posted document for the same legacy move ID).
