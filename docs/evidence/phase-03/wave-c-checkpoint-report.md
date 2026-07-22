# Wave C Checkpoint Report

**Phase 03 — Finance, Tax, Payments, and Financial Reporting**
**Date:** 2026-07-22
**Branch:** `phase-03/finance-tax-payments-reporting`

## Starting state (audited before any Wave C work)

Wave C did not start from a clean slate. An audit of the real local clone (`octagon-erp/`, on this branch, in sync with `origin` at commit `89c691b`) found:

- `platform/finance/engine.mjs` and `platform/finance/index.mjs` had **uncommitted** modifications (dimension-related functions and handler registrations).
- `database/migrations/016_accounting_dimensions.mjs` existed on disk but was **untracked** (never `git add`-ed).
- This explains why the GitHub evidence trail stopped at the Wave B checkpoint with no closure documents — Wave C (dimensions) was mid-flight, not started fresh.

A fresh-install test (`node scripts/migrate.mjs fresh`) immediately surfaced a real, load-bearing bug in that uncommitted migration 016: `FOREIGN KEY constraint failed` because its `platform_actions` rows referenced `entity_id`s never registered in `platform_entities`. This is fixed as the first Wave C task — see `dimensions-report.md`.

## Scope closed in Wave C

- **Packet 03.12 — Accounting dimensions** (completing the inherited, buggy, uncommitted work): dimension/value/policy tables, posting-time distribution validation, dimension-breakdown reconciliation query.
- **Packet 03.09 — Currency and exchange-rate engine**: currency master, dated exchange rates, conversion, pure realized-FX helper, reversible unrealized-FX revaluation posting.
- **Packet 03.10 — Tax definition and calculation engine**: declarative tax quote (percent/fixed/group/compound, price-include, repartition), withholding-threshold evaluation (single-transaction and cumulative-window).
- **Packet 03.11 — Fiscal positions and Iraq localization pack**: fiscal-position tax/account remapping, idempotent Iraq pack installer with explicit legal-safety disclaimer.
- **Packet 03.13 — Accounts receivable subledger**: due schedules (draft-only, total-checked), credit-note-aware open items, GL-reconciled aging, partner statements.
- **Packet 03.14 — Accounts payable subledger**: mirror of AR plus duplicate-invoice detection, payment holds, and an approval-authority-limit primitive for the future Phase 04 three-way match.

## Migrations

- `016_accounting_dimensions` — completed (entity registration fix), `dependsOn: ['015_finance_document_lifecycle']`
- `017_currency_and_exchange_rates` — `dependsOn: ['016_accounting_dimensions']`
- `018_tax_definition_and_calculation` — `dependsOn: ['017_currency_and_exchange_rates']`
- `019_fiscal_positions_and_iraq_localization` — `dependsOn: ['018_tax_definition_and_calculation']`
- `020_accounts_receivable_subledger` — `dependsOn: ['019_fiscal_positions_and_iraq_localization']`
- `021_accounts_payable_subledger` — `dependsOn: ['020_accounts_receivable_subledger']`

All six declare `transactionPolicy: 'required'` (atomic up/down under the existing migration-runner's `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK` wrapping) and `rollbackPolicy: 'reversible'` with a working `down()`.

## Files added/modified

| File | Purpose |
|------|---------|
| `database/migrations/016_accounting_dimensions.mjs` | Completed: entity registration fix |
| `database/migrations/017_currency_and_exchange_rates.mjs` | New |
| `database/migrations/018_tax_definition_and_calculation.mjs` | New |
| `database/migrations/019_fiscal_positions_and_iraq_localization.mjs` | New |
| `database/migrations/020_accounts_receivable_subledger.mjs` | New |
| `database/migrations/021_accounts_payable_subledger.mjs` | New |
| `platform/finance/engine.mjs` | +round2 helper, +fx_revaluation document type, +duplicate-reference check in `createDocument`, +32 exported functions |
| `platform/finance/index.mjs` | +21 handler registrations |
| `tests/phase03/finance-wave-a.test.mjs` | Fixed the migration-rollback test to unwind the full 021→014 dependency chain (see Known risks/fixes below) |
| `tests/phase03/finance-wave-c.test.mjs` | New — 29 tests |
| `docs/evidence/phase-03/source-composition-ledger.md` | +6 capability entries |
| `docs/evidence/phase-03/currency-fx-report.md` | New |
| `docs/evidence/phase-03/tax-localization-report.md` | New |
| `docs/evidence/phase-03/dimensions-report.md` | New |
| `docs/evidence/phase-03/ar-ap-report.md` | New |
| `docs/evidence/phase-03/unresolved-risks.md` | New (cumulative through Wave C) |
| `docs/evidence/phase-03/wave-c-checkpoint-report.md` | This file |

## A regression found and fixed in Wave A's own test suite

Wave A's `migration rollback removes finance tables` test called `financeMigration.down(dialect)` (migration 014 alone) and asserted zero `finance_%` tables remained — an assumption that was only ever true because no later migration had added new tables. Wave C's six new migrations added 18 new `finance_%` tables, which correctly remained after 014's own `down()` alone (014 is not responsible for tables it didn't create). Fixed the test to unwind the full dependency chain in reverse (`021 → 020 → 019 → 018 → 017 → 016 → 015 → 014`), matching how the real migration runner unwinds dependents before dependencies. This is a test fix, not a migration change — no applied Phase 01/02/Wave-A/B migration was modified.

## Commands and pass counts

```bash
node scripts/precommit.js
# Octagon precommit passed.

node scripts/migrate.mjs fresh --db <tmp>.db
# 21/21 migrations applied (001-021)

node scripts/migrate.mjs down --db <tmp>.db
node scripts/migrate.mjs up --db <tmp>.db
# full rollback and re-apply (upgrade path) both clean

node tests/phase03/finance-wave-a.test.mjs
# 0 FAIL lines (all pass; suite's own internal counter has a pre-existing double-count
# cosmetic bug inherited from before Wave C — the "26/14" in raw output is not a real failure)

node tests/phase03/finance-wave-b.test.mjs
# 0 FAIL lines (same pre-existing cosmetic counter behavior)

node tests/phase03/finance-wave-c.test.mjs
# finance-wave-c: 29/29 passed

# Full non-browser regression sweep (Phase 01 unit + migration runner, Phase 02 all
# 8 suites, Phase 03 contract/concurrency/rollback/security/provenance + all 3 finance
# wave suites):
for f in $(find tests/unit tests/migration tests/phase02 tests/contract tests/concurrency \
  tests/rollback tests/security tests/provenance tests/phase03 -iname "*.test.mjs" | grep -v browser); do
  node "$f"
done
# 22 files run, 0 failed
```

## Legacy authorities retired

None in Wave C. `services/financeService.js` remains the sole operational writer for AR/AP/tax/currency-adjacent legacy behavior. Retirement is Wave F, after migration, reconciliation, and UI cutover.

## Adapters remaining

None new in Wave C beyond what Wave A/B already declared.

## Unresolved risks

See `docs/evidence/phase-03/unresolved-risks.md` for the full, cumulative list. New in Wave C:

- Full payment-allocation-based AR/AP residual is deferred to Wave D (no `finance_payments` table exists yet); today's open-amount only nets invoices against credit notes.
- `revalueForeignBalances` requires an explicit `account_ids` list rather than auto-discovering every foreign-currency account.
- The Iraq localization pack's tax rate/fiscal positions are explicit placeholders (`legal_validation_status: 'pending'`) pending accountant/legal review.
- `finance_tax:quote` is registered as action `kind: 'domain'` because the Phase 01 `ACTION_KINDS` enum has no `'query'` kind — cosmetic mismatch, not a security or correctness issue, flagged for a future Phase 01 kernel enhancement.
- `checkApprovalAuthority` is unrestricted-by-default when no limit is configured; acceptable as a Wave C foundation but should be hardened before Phase 04's three-way match treats it as a hard control.

Carried forward from Wave B (still open):

- Failure-injection suite is partial (one atomicity test added in Wave C; full coverage across all Wave A-C mutation paths is still Wave F).
- Browser evidence not yet produced (Wave F).
- Legacy finance bridge not yet implemented (Wave F).
- No adversarial (cross-tenant override, hidden-action direct API) test suite yet (Wave F).

## Next wave

Wave D: Payments, allocations, reconciliation, banking, cash, and payment terms (Packets 03.15–03.21).
