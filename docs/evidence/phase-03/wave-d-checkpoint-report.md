# Wave D Checkpoint Report

**Phase 03 — Finance, Tax, Payments, and Financial Reporting**
**Date:** 2026-07-22
**Branch:** `phase-03/finance-tax-payments-reporting`

## Scope closed in Wave D

- **Packet 03.15 — Payment documents and methods:** one receive/pay/transfer model, idempotency-key dedup, fee handling, cross-currency.
- **Packet 03.16 — Allocation, advances, refunds, write-offs:** append-only many-to-many settlement lineage; completes the full AR/AP residual calculation Wave C explicitly deferred.
- **Packet 03.17 — Open-item reconciliation engine:** session-based candidate matching (exact/tolerance), confirming through the real allocation path.
- **Packet 03.18 — Banking and statement import:** immutable, deduplicated import; rule-assisted and manual matching; difference posting; undo.
- **Packet 03.19 — Cashboxes, petty cash, custody:** custodian/shift/count/close lifecycle, expected balance derived live from the GL.
- **Packet 03.20 — Payment terms, installments, retainage:** versioned templates generating exact-total-rounded due schedules.
- **Packet 03.21 — Credit exposure and policy foundation:** one explainable exposure query composed from Wave C's AR queries.

## Migrations

- `022_payment_documents` through `028_credit_exposure_and_policy` — 7 new migrations, `dependsOn` chained in sequence from `021_accounts_payable_subledger`.
- All declare `transactionPolicy: 'required'` and `rollbackPolicy: 'reversible'`.
- Fresh install (28/28), full rollback, and re-apply (upgrade path) all verified clean on a disposable database before any engine code was written against them.

## Files added/modified

| File | Purpose |
|------|---------|
| `database/migrations/022_payment_documents.mjs` | New |
| `database/migrations/023_payment_allocation_and_writeoffs.mjs` | New |
| `database/migrations/024_open_item_reconciliation_engine.mjs` | New |
| `database/migrations/025_banking_and_statement_import.mjs` | New |
| `database/migrations/026_cashboxes_and_petty_cash.mjs` | New |
| `database/migrations/027_payment_terms_and_installments.mjs` | New |
| `database/migrations/028_credit_exposure_and_policy.mjs` | New |
| `platform/finance/engine.mjs` | +3 document types (`internal_transfer`, `write_off`; `fx_revaluation` already existed), +`paymentAllocationsTotal`/`getOpenAmountForDocument`, `creditNotesTotal` generalized to net write-offs, +34 exported functions |
| `platform/finance/index.mjs` | +26 handler registrations |
| `tests/phase03/finance-wave-a.test.mjs` | Rollback test made self-maintaining (see below) |
| `tests/phase03/finance-wave-d.test.mjs` | New — 22 tests |
| `docs/evidence/phase-03/source-composition-ledger.md` | +7 capability entries |
| `docs/evidence/phase-03/payment-allocation-report.md` | New |
| `docs/evidence/phase-03/reconciliation-banking-report.md` | New |
| `docs/evidence/phase-03/cash-management-report.md` | New |
| `docs/evidence/phase-03/unresolved-risks.md` | Updated (cumulative through Wave D) |
| `docs/evidence/phase-03/wave-d-checkpoint-report.md` | This file |

## A structural fix: the Wave A rollback test is now self-maintaining

Wave C had already fixed Wave A's rollback test once, hardcoding the reverse-order chain through migration 021. Wave D's 7 new migrations broke it again the same way (FK violation rolling back 020 while 022-028's tables, which reference it, were still present). Rather than hardcode the chain a third time — guaranteeing it breaks again in Wave E — the test now reads the applied-migration list directly from `platform_modules.migrations` (maintained by every migration's own `up()`) and dynamically `import()`s each migration file in reverse order. This test will not need editing again as Waves E and F add more finance migrations.

## Commands and pass counts

```bash
node scripts/precommit.js
# Octagon precommit passed.

node scripts/migrate.mjs fresh --db <tmp>.db   # 28/28 applied
node scripts/migrate.mjs down --db <tmp>.db    # full rollback clean
node scripts/migrate.mjs up --db <tmp>.db      # re-apply clean

node tests/phase03/finance-wave-a.test.mjs     # 0 FAIL lines
node tests/phase03/finance-wave-b.test.mjs     # 0 FAIL lines
node tests/phase03/finance-wave-c.test.mjs     # 29/29 passed
node tests/phase03/finance-wave-d.test.mjs     # 22/22 passed

node tests/migration/runner.test.mjs           # All migration runner tests passed.
node tests/phase02/runtime-strangler.test.mjs  # 6/6 passed
```

## Legacy authorities retired

None in Wave D. `services/financeService.js` (`createPayment`, `reconcileLines`, `processBankReconciliation`) remains the sole operational writer.

## Adapters remaining

None new in Wave D.

## Unresolved risks

See `docs/evidence/phase-03/unresolved-risks.md` for the full, cumulative list. New in Wave D:

- `finance_cashboxes.max_balance` is stored but not enforced as a hard limit.
- Early-payment-discount and retainage fields on payment-term templates are stored but not yet applied by posting logic.
- No live external bank-provider connector was built (import boundary only, matching the existing `bank_test_provider` fixture convention).
- No adversarial suite yet for the new Wave D surfaces (duplicate payment reference under real concurrency beyond the one race test written, hidden-action direct API calls) — Wave F.

Resolved in Wave D (previously open from Wave C):

- ~~AR/AP open-amount only netted credit notes, not payments~~ — now nets payment allocations too via `paymentAllocationsTotal`.
- ~~`computeRealizedFx` existed but was never called~~ — still not called from a live settlement path (Wave D allocation doesn't currently apply FX gain/loss on cross-currency settlement); the pure helper remains tested and ready but unwired. Recorded below as a new, more precise open item replacing the old one.

## Next wave

Wave E: Budgets, expenses, credit foundation follow-through, reports, and asset interfaces (Packets 03.22–03.26).
