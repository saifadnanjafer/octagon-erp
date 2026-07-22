# Phase 03 — Unresolved Risks

**As of:** Wave F (partial) checkpoint, 2026-07-22
**Status:** Phase 03 is **not closed**. This is a live, cumulative register — update it at every wave checkpoint and again at closure.

## Open (blocking eventual closure until resolved) — in priority order

1. **No live legacy data migration has been run.** Packet 03.27's migration engine is built and tested against synthetic fixtures (`legacy-migration-report.md`), but it has never read from the real `PentagonDB.getCached().finance.accounts`/`.account_moves` store. This requires explicit owner authorization and a maintenance window before it can run — it is not something to improvise into an autonomous session. **This is the largest remaining risk in the phase.**
2. **The current Octagon finance UI has not been cut over** (Packet 03.29). `views/finance.html`, `modules/finance-ui.js`, and the finance sections of `app.js` still read/write exclusively through `services/financeService.js`. No canonical action or query is wired into anything a user can click. This also has not been started, for the same reason as #1: it means editing live, in-use application surface, and deserves an explicit go-ahead and a tested rollout plan (the packet itself requires a feature flag and a parity test per page/action), not a blind cutover.
3. **No duplicate finance authority has been retired** (Packet 03.31). Retirement can only happen after #1 and #2 are done, reconciled, and observed — the packet's own rules require "no deletion before backup, reconciliation, and owner approval."
4. **No finance dashboard/reporting UI (Packet 03.25)** — deferred to sit alongside #2 for the same reason.
5. **Browser evidence has not been produced for any Wave A-F capability** — depends on #2 existing first.
6. **`docs/evidence/phase-03/finance-authority-cutover.md` (Packet 03.31's required per-fact authority table) does not exist yet** — it can only be filled in honestly once #1-#3 have real answers, not placeholders.
7. **Iraq localization pack values are explicit placeholders**, pending accountant/legal sign-off.
8. **`computeRealizedFx` is still not called from any live settlement path.**
9. **`finance_cashboxes.max_balance` is stored but not enforced.**
10. **Payment-term early-discount and retainage fields are stored but not applied.**
11. **`getTaxReport` groups by `finance_accounts.tax_role`, not a per-tax-code column on journal lines.**
12. **The asset-accounting interface has no caller yet** (Phase 05's job, by design).

## Foundation-level scope decisions (not gaps — documented, deliberate boundaries)

13. `revalueForeignBalances` requires an explicit `account_ids` list; no auto-discovery.
14. `finance_tax:quote` is registered as action `kind: 'domain'` (Phase 01 kernel has no `'query'` kind).
15. `checkApprovalAuthority` is unrestricted-by-default when no limit row exists.
16. Wave C's tax engine computes quotes only; not wired into `postDocument`.
17. No live external bank-provider connector was built in Wave D.
18. `getBudgetVariance`'s dimension scoping trusts posted `dims` JSON as-is.
19. Wave F's adversarial suite (Packet 03.30) is the packet's own mandatory case list, not a professional penetration test.

## Resolved in Wave F so far (previously open, now closed)

- N/A yet for the live-data/UI items (still open, see #1-#6 above). The migration *engine* itself (as opposed to a live run of it) is complete and tested — see `legacy-migration-report.md`.

## Resolved in Wave D (previously open, now closed)

- ~~AR/AP open-amount only netted credit notes, not payments~~ — now nets payment allocations too.
- ~~Wave A's rollback test needed hand-editing every wave~~ — self-maintaining; proven correct again through 34 migrations in Wave F with zero test-file changes needed.

## Resolved in Wave C (previously open, now closed)

- ~~Migration 016 (dimensions) FK-violation bug~~ — fixed.

## Non-risks (explicitly confirmed, not carried as open items)

- Payroll, attendance, and timesheet behavior: untouched by any Phase 03 work through Wave F — now backed by a **static regression test** (`finance-wave-f-adversarial.test.mjs`) that scans `platform/finance/engine.mjs` for any payroll/attendance/timesheet/employee table reference and fails the suite if one is ever introduced.
- No production data was used for any Wave A-F test; all tests run against disposable, per-test SQLite databases. The legacy-migration tests specifically use synthetic fixtures shaped like the real legacy data, never the real data itself.
- No Phase 04 (inventory/sales/procurement) implementation was started.
