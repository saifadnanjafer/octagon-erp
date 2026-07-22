# Phase 03 — Unresolved Risks

**As of:** Wave D checkpoint, 2026-07-22
**Status:** Phase 03 is **not closed**. This is a live, cumulative register — update it at every wave checkpoint and again at closure.

## Open (blocking eventual closure until resolved)

1. **No budgets, expense claims, canonical financial reports beyond trial balance/GL, or dashboard** (Wave E, Packets 03.22–03.25).
2. **No asset-accounting interface stub for Phase 05** (Wave E, Packet 03.26).
3. **Legacy finance migration and reconciliation not implemented.** `services/financeService.js` remains the sole operational writer. No historical data has been migrated from the legacy `account_moves`/`journal_entries` JSON collections into the canonical tables. No dual write exists (by design — Section 5 forbids uncontrolled dual write), but this also means the canonical tables are currently empty of historical data. Migration is Wave F, Packet 03.27.
4. **Current Octagon finance UI (`views/finance.html`, `modules/finance-ui.js`, `app.js` finance pages) has not been cut over** to the canonical actions/queries. It still reads/writes through `services/financeService.js`. Cutover is Wave F, Packet 03.29.
5. **No duplicate finance authority has been retired.** One canonical authority now exists in parallel with the legacy one; retirement requires migration + reconciliation first (Wave F, Packet 03.31).
6. **Adversarial test suite is incomplete.** Cross-tenant/cross-company override attempts, hidden-action direct API calls, closed-period bypass attempts, and duplicate-webhook/job-retry tests are not yet written (Wave F, Packet 03.30). Waves A-D do cover: cross-company access denial (A/B/C/D), duplicate source reference (C/D), period-lock enforcement (A), concurrent posting/due-schedule/allocation writes (A/C/D).
7. **Browser evidence has not been produced for any Wave A-D capability.** No live-browser screenshots or scenario runs exist yet for finance (Wave F, Packet 03.29/30).
8. **Iraq localization pack values are explicit placeholders.** `IQ_SALES_15` and the three seeded fiscal positions are not statutorily validated. Every install/upgrade row is stamped `legal_validation_status: 'pending'`. This must not be presented as filing-ready before accountant/legal sign-off.
9. **`computeRealizedFx` (Wave C) is still not called from any live settlement path.** Payment allocation (Wave D) currently allocates at face value only; cross-currency invoice-vs-payment settlement does not yet compute or post a realized FX gain/loss. The pure helper is tested and ready; wiring it into `allocatePayment` for cross-currency allocations is outstanding.
10. **`finance_cashboxes.max_balance` is stored but not enforced.** No "negative/over limit policy" rejection exists yet (Packet 03.19 test requirement not yet covered).
11. **Payment-term early-discount and retainage fields are stored but not applied.** No posting logic reads `early_discount_percent`/`early_discount_days`/`retainage_percent` yet.

## Foundation-level scope decisions (not gaps — documented, deliberate boundaries)

12. `revalueForeignBalances` requires an explicit `account_ids` list; it does not auto-discover every foreign-currency-denominated account across the chart of accounts.
13. `finance_tax:quote` is registered as action `kind: 'domain'` because the Phase 01 kernel's `ACTION_KINDS` enum has no `'query'` kind. Cosmetic mismatch, not a Phase 03 blocker.
14. `checkApprovalAuthority` is unrestricted-by-default when no limit row exists for a role/user — a ceiling on top of Phase 02 permission checks, not a replacement. Should be hardened before Phase 04's three-way match relies on it.
15. Wave C's tax engine computes quotes only; not wired into `postDocument` (Section 5: one posting authority).
16. No live external bank-provider connector was built in Wave D — only the normalized import-array boundary (matching the `bank_test_provider` fixture convention already established in `source-lock.md`).

## Resolved in Wave D (previously open, now closed)

- ~~AR/AP open-amount only netted credit notes, not payments~~ — now nets payment allocations too via `paymentAllocationsTotal` (see `payment-allocation-report.md`).
- ~~Wave A's rollback test needed hand-editing every wave~~ — made self-maintaining: it now discovers the applied-migration chain from `platform_modules.migrations` and dynamically imports each migration in reverse order (see `wave-d-checkpoint-report.md`).

## Resolved in Wave C (previously open, now closed)

- ~~Migration 016 (dimensions) FK-violation bug~~ — fixed; see `dimensions-report.md`.

## Carried forward from Wave B, still accurate

- Failure-injection coverage is partial: Waves A-D each added targeted atomicity/concurrency tests, but a systematic failure-injection sweep across every mutation path listed in Section 10 of the governing document is Wave F work.

## Non-risks (explicitly confirmed, not carried as open items)

- Payroll, attendance, and timesheet behavior: untouched by any Phase 03 work, including Wave D.
- No production data was used for any Wave A-D test; all tests run against disposable, per-test SQLite databases created by `tests/phase02/harness.mjs`.
- No Phase 04 (inventory/sales/procurement) implementation was started.
