# Phase 03 — Unresolved Risks

**As of:** Wave C checkpoint, 2026-07-22
**Status:** Phase 03 is **not closed**. This is a live, cumulative register — update it at every wave checkpoint and again at closure.

## Open (blocking eventual closure until resolved)

1. **No payment engine yet.** `finance_payments`, `finance_payment_allocations` do not exist (Wave D, Packets 03.15/03.16/03.17). AR/AP open-amount and aging today only net invoices against credit notes, not against payments. `computeRealizedFx` exists as a tested pure function but is not yet called from anywhere.
2. **No banking/reconciliation/cash yet** (Wave D, Packets 03.17–03.20).
3. **No budgets, expense claims, canonical financial reports beyond trial balance/GL, or dashboard** (Wave E, Packets 03.22–03.25).
4. **No asset-accounting interface stub for Phase 05** (Wave E, Packet 03.26).
5. **Legacy finance migration and reconciliation not implemented.** `services/financeService.js` remains the sole operational writer for everything except the new canonical actions introduced in Waves A-C, which currently have no data migrated from the legacy `account_moves`/`journal_entries` JSON collections. No dual write exists (by design — Section 5 forbids uncontrolled dual write), but this also means the canonical tables are currently empty of historical data. Migration is Wave F, Packet 03.27.
6. **Current Octagon finance UI (`views/finance.html`, `modules/finance-ui.js`, `app.js` finance pages) has not been cut over** to the canonical actions/queries. It still reads/writes through `services/financeService.js`. Cutover is Wave F, Packet 03.29.
7. **No duplicate finance authority has been retired.** One canonical authority now exists in parallel with the legacy one; retirement requires migration + reconciliation first (Wave F, Packet 03.31).
8. **Adversarial test suite is incomplete.** Cross-tenant/cross-company override attempts, hidden-action direct API calls, closed-period bypass attempts, and duplicate-webhook/job-retry tests are not yet written (Wave F, Packet 03.30). Wave A-C do cover: cross-company access denial (Wave A/B/C), duplicate source reference (Wave C), period-lock enforcement (Wave A), concurrent posting/due-schedule writes (Wave A/C).
9. **Browser evidence has not been produced for any Wave A-C capability.** No live-browser screenshots or scenario runs exist yet for finance (Wave F, Packet 03.29/30).
10. **Iraq localization pack values are explicit placeholders.** `IQ_SALES_15` and the three seeded fiscal positions are not statutorily validated. Every install/upgrade row is stamped `legal_validation_status: 'pending'`. This must not be presented as filing-ready before accountant/legal sign-off.

## Foundation-level scope decisions (not gaps — documented, deliberate boundaries)

11. `revalueForeignBalances` requires an explicit `account_ids` list; it does not auto-discover every foreign-currency-denominated account across the chart of accounts. Revisit once real multi-currency transaction volume exists.
12. `finance_tax:quote` is registered as action `kind: 'domain'` because the Phase 01 kernel's `ACTION_KINDS` enum (`lifecycle_transition`/`create`/`reverse`/`amend`/`domain`) has no `'query'` kind. It performs no writes despite the `domain` label. A future Phase 01 kernel enhancement could add a proper `query` kind; not a Phase 03 blocker.
13. `checkApprovalAuthority` is unrestricted-by-default (`allowed: true`) when no limit row exists for a role/user. This is a ceiling on top of Phase 02's normal permission checks, not a replacement for them — but it should be hardened (deny-by-default option) before Phase 04's three-way match is built on top of it.
14. Wave C's tax engine computes quotes only; it is not wired into `postDocument`. This is intentional (Section 5: only one posting authority may exist) — future sales/purchase flows compute a quote and pass the resulting lines into the existing `createDocument`.

## Resolved in Wave C (previously open, now closed)

- ~~Migration 016 (dimensions) FK-violation bug~~ — fixed; see `dimensions-report.md`.
- ~~Wave A's rollback test assumed a single-migration finance module~~ — fixed to unwind the full dependency chain.

## Carried forward from Wave B, still accurate

- Failure-injection coverage is partial: Wave A/B/C each added targeted atomicity/concurrency tests, but a systematic failure-injection sweep across every mutation path listed in Section 10 of the governing document (`PHASE_03_FINANCE_TAX_PAYMENTS_AND_REPORTING.md`) is Wave F work.

## Non-risks (explicitly confirmed, not carried as open items)

- Payroll, attendance, and timesheet behavior: untouched by any Phase 03 work, including Wave C.
- No production data was used for any Wave A-C test; all tests run against disposable, per-test SQLite databases created by `tests/phase02/harness.mjs`.
- No Phase 04 (inventory/sales/procurement) implementation was started.
