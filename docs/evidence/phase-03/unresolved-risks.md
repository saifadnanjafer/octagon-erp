# Phase 03 — Unresolved Risks

**As of:** Wave E checkpoint, 2026-07-22
**Status:** Phase 03 is **not closed**. This is a live, cumulative register — update it at every wave checkpoint and again at closure.

## Open (blocking eventual closure until resolved)

1. **No finance dashboard/reporting UI (Packet 03.25) was built.** Deliberately deferred to Wave F alongside the finance UI cutover (Packet 03.29) — see `wave-e-checkpoint-report.md` for the rationale. The query layer (`runReport` + all report functions) is complete and tested; only the browser-facing pages are outstanding.
2. **Legacy finance migration and reconciliation not implemented.** `services/financeService.js` remains the sole operational writer. No historical data has been migrated from the legacy `account_moves`/`journal_entries` JSON collections into the canonical tables. Migration is Wave F, Packet 03.27.
3. **Current Octagon finance UI (`views/finance.html`, `modules/finance-ui.js`, `app.js` finance pages) has not been cut over** to the canonical actions/queries. Cutover is Wave F, Packet 03.29.
4. **No duplicate finance authority has been retired.** Wave F, Packet 03.31.
5. **Adversarial test suite is incomplete.** Cross-tenant/cross-company override attempts, hidden-action direct API calls, closed-period bypass attempts, duplicate-webhook/job-retry tests are not yet written (Wave F, Packet 03.30). Waves A-E do cover: cross-company access denial (A/B/C/D/E), duplicate source reference (C/D), period-lock enforcement (A, and now proven for the asset interface too in E), concurrent posting/due-schedule/allocation writes (A/C/D).
6. **Browser evidence has not been produced for any Wave A-E capability.** Wave F, Packet 03.29/30.
7. **Iraq localization pack values are explicit placeholders**, pending accountant/legal sign-off.
8. **`computeRealizedFx` (Wave C) is still not called from any live settlement path.** Payment allocation (Wave D) allocates at face value only.
9. **`finance_cashboxes.max_balance` is stored but not enforced.**
10. **Payment-term early-discount and retainage fields are stored but not applied** by any posting logic.
11. **`getTaxReport` groups by `finance_accounts.tax_role`, not a per-tax-code column on journal lines.** Reconciles to GL by construction but is coarser than an ideal per-tax grid; revisit once Wave F's real sales/purchase tax flows exist to justify the extra column.
12. **The asset-accounting interface (Wave E) has no caller yet.** By design — Phase 05 owns the asset register that will call `capitalizeAsset`/`postAssetDepreciation`/`disposeAsset`. Not a Phase 03 defect, but the contract is unexercised outside test fixtures until then.

## Foundation-level scope decisions (not gaps — documented, deliberate boundaries)

13. `revalueForeignBalances` requires an explicit `account_ids` list; no auto-discovery.
14. `finance_tax:quote` is registered as action `kind: 'domain'` (Phase 01 kernel has no `'query'` kind). Cosmetic, not a blocker.
15. `checkApprovalAuthority` is unrestricted-by-default when no limit row exists.
16. Wave C's tax engine computes quotes only; not wired into `postDocument`.
17. No live external bank-provider connector was built in Wave D.
18. `getBudgetVariance`'s dimension scoping trusts the `dims` JSON on journal lines exactly as posted (no re-validation at read time) — consistent with the ledger being the single source of truth; a malformed `dims` value (which `postDocument`'s `validateDimensionDistribution` should already prevent from ever being posted) would silently contribute zero to a dimension-scoped budget rather than erroring.

## Resolved in Wave E (previously open, now closed)

- N/A — Wave E's own fixes (the `finance_employee_advances.updated_at` column, the partner-ledger test assumption) were caught and corrected within the same wave before commit, not carried forward as risks.

## Resolved in Wave D (previously open, now closed)

- ~~AR/AP open-amount only netted credit notes, not payments~~ — now nets payment allocations too.
- ~~Wave A's rollback test needed hand-editing every wave~~ — made self-maintaining; proven again in Wave E (correctly unwound all 32 migrations with zero test-file changes).

## Resolved in Wave C (previously open, now closed)

- ~~Migration 016 (dimensions) FK-violation bug~~ — fixed.

## Carried forward from Wave B, still accurate

- Failure-injection coverage is partial: Waves A-E each added targeted atomicity/concurrency tests, but a systematic sweep across every mutation path in Section 10 of the governing document is Wave F work.

## Non-risks (explicitly confirmed, not carried as open items)

- Payroll, attendance, and timesheet behavior: untouched by any Phase 03 work, including Wave E's expense-claim/advance flows (verified by code inspection — no payroll/attendance table is referenced anywhere in `platform/finance/engine.mjs`).
- No production data was used for any Wave A-E test; all tests run against disposable, per-test SQLite databases.
- No Phase 04 (inventory/sales/procurement) implementation was started.
