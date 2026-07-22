# Wave E Checkpoint Report

**Phase 03 — Finance, Tax, Payments, and Financial Reporting**
**Date:** 2026-07-22
**Branch:** `phase-03/finance-tax-payments-reporting`

## Scope closed in Wave E

- **Packet 03.22 — Budgeting foundation:** versioned budgets with structurally-immutable approved versions (revision creates a new linked row; the original is never edited), variance re-derived live from the GL.
- **Packet 03.23 — Expense claims and employee advances:** governed claim/advance lifecycle, duplicate-receipt detection enforced by a real database constraint, zero payroll/attendance modification.
- **Packet 03.24 — Canonical financial report queries:** 15 registered reports (Trial Balance, GL, Journal, P&L, Balance Sheet, Cash Flow, AR/AP aging, partner ledger, tax report, dimension P&L, currency revaluation, bank/cash reconciliation status, budget vs actual, period-close status) behind one dispatcher, with immutable snapshotting.
- **Packet 03.26 — Asset-accounting interface for Phase 05:** capitalize/depreciate/dispose posting contracts, deliberately without an asset register (Phase 05's job).

## Scope explicitly deferred

**Packet 03.25 (Financial reporting UI and dashboards) was not built in Wave E.** Consistent with this project's established pattern since Wave B (browser/UI work stays in Wave F alongside the finance UI cutover, Packet 03.29), building new dashboard pages now — before legacy data migration and UI cutover exist — would risk exactly the "disconnected admin prototype" Section 11 of the governing document warns against. The query layer any such dashboard would consume is fully built (`runReport` and all 15 report functions). This is recorded as an explicit, tracked risk, not a silent omission.

## Migrations

- `029_budgeting_foundation` through `032_asset_accounting_interface` — 4 new migrations, chained from `028_credit_exposure_and_policy`.
- Fresh install (32/32), full rollback, and re-apply all verified clean before engine code was written against them.

## Files added/modified

| File | Purpose |
|------|---------|
| `database/migrations/029_budgeting_foundation.mjs` | New |
| `database/migrations/030_expense_claims_and_advances.mjs` | New |
| `database/migrations/031_canonical_financial_reports.mjs` | New |
| `database/migrations/032_asset_accounting_interface.mjs` | New |
| `platform/finance/engine.mjs` | +37 exported functions |
| `platform/finance/index.mjs` | +19 handler registrations |
| `tests/phase03/finance-wave-e.test.mjs` | New — 15 tests |
| `docs/evidence/phase-03/source-composition-ledger.md` | +4 capability entries |
| `docs/evidence/phase-03/financial-report-reconciliation.md` | New |
| `docs/evidence/phase-03/asset-accounting-interface.md` | New |
| `docs/evidence/phase-03/unresolved-risks.md` | Updated (cumulative through Wave E) |
| `docs/evidence/phase-03/wave-e-checkpoint-report.md` | This file |

## Commands and pass counts

```bash
node scripts/precommit.js
# Octagon precommit passed.

node scripts/migrate.mjs fresh --db <tmp>.db   # 32/32 applied
node scripts/migrate.mjs down --db <tmp>.db    # full rollback clean
node scripts/migrate.mjs up --db <tmp>.db      # re-apply clean

node tests/phase03/finance-wave-a.test.mjs     # 0 FAIL lines (self-maintaining rollback test
                                                #   correctly unwound all 32 migrations)
node tests/phase03/finance-wave-b.test.mjs     # 0 FAIL lines
node tests/phase03/finance-wave-c.test.mjs     # 29/29 passed
node tests/phase03/finance-wave-d.test.mjs     # 22/22 passed
node tests/phase03/finance-wave-e.test.mjs     # 15/15 passed

node tests/migration/runner.test.mjs           # All migration runner tests passed.
node tests/phase02/runtime-strangler.test.mjs  # 6/6 passed
```

## Legacy authorities retired

None in Wave E. `services/financeService.js` remains the sole operational writer for anything not yet cut over.

## Adapters remaining

None new in Wave E.

## Unresolved risks

See `docs/evidence/phase-03/unresolved-risks.md` for the full, cumulative list. New in Wave E:

- Packet 03.25 (dashboard UI) deferred to Wave F, as explained above.
- `getTaxReport` groups by `finance_accounts.tax_role` rather than a per-tax-code queryable column on journal lines — reconciles to GL but is coarser than an ideal tax grid.
- Asset-accounting interface has no calling asset register yet (Phase 05's job, by design).

## Next wave

Wave F: Legacy migration, current-Octagon UI cutover, retirement of duplicate finance authorities, full adversarial/security/browser testing, and — only if every closure gate genuinely passes — Phase 03 closure.
