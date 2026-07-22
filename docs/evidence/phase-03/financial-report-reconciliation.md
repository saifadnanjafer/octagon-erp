# Wave E — Budgeting, Expense Claims, and Canonical Report Reconciliation

**Scope:** Packet 03.22 (budgeting), Packet 03.23 (expense claims/advances), Packet 03.24 (canonical financial report queries).
**Evidence date:** 2026-07-22

## What was implemented — budgeting

- `finance_budgets` / `finance_budget_lines` — draft→submitted→approved/rejected lifecycle; an **approved version is structurally immutable**: `updateBudgetLines` explicitly checks `status === 'draft'` and throws `BUDGET_VERSION_IMMUTABLE` otherwise. Correction happens only via `reviseBudget`, which creates a brand-new `finance_budgets` row (`parent_budget_id` + `version + 1`) — the original approved row and its lines are never touched (verified directly: the original line's amount is unchanged after revision).
- `getBudgetVariance` computes actual spend by re-deriving it from `finance_journal_lines` for the budget line's account/period/dimension scope — no separate "actuals" table to drift out of sync. Dimension-scoped budgets correctly prorate by each line's stored `dims` percentage split.

## What was implemented — expense claims and advances

- `finance_expense_claims` / `finance_expense_claim_lines` / `finance_employee_advances`.
- Duplicate-receipt detection is a **real unique database constraint** (`idx_finance_expense_lines_receipt` on `(company_id, receipt_fingerprint)` where not null) — not an application-level check that could be bypassed by a direct insert.
- Over-policy approval requires an explicit `override_reason`; `approveExpenseClaim` posts through the standard document pipeline and is idempotent against reimbursement duplication (the claim's `document_id` and state guard make a second approval attempt fail outright, proven by test).
- `issueEmployeeAdvance` / `settleAdvanceAgainstClaim` support partial-then-full settlement with an explicit "cannot exceed remaining balance" guard.
- **No payroll or attendance table is read or written anywhere in this migration or its engine code** — confirmed by inspection: `finance_expense_claims.payroll_settlement_ref` is a nullable reference column only, and no function in `engine.mjs` queries a payroll/attendance table.

## What was implemented — canonical financial report queries

Ported from VNext `report-engine.js` (project-owned, MERGE-REFACTOR): `getProfitAndLoss`, `getBalanceSheet`, `getCashFlow`, `getPartnerLedger`, `getTaxReport` (adapted to the `tax_role` column already present on `finance_accounts` since Wave A, rather than requiring a new tax-tagging column), `getDimensionProfitLoss`. Reused, not duplicated: `getTrialBalance`/`getGeneralLedger` (Wave A), `getCustomerAging`/`getSupplierAging` (Wave C), `getBudgetVariance` (this wave), `getCurrencyRevaluationReport`/`getBankCashReconciliationStatus`/`getPeriodCloseStatus` (new, thin queries over existing Wave C/D tables).

- `finance_report_definitions` — 15 registered reports covering every report the packet requires (Trial Balance, GL, Journal via GL, P&L, Balance Sheet, Cash Flow, AR/AP aging, partner ledger, tax report, dimension P&L, currency revaluation, bank/cash reconciliation status, budget vs actual, period-close status).
- `runReport(report_code, params)` is a single dispatcher — one canonical query surface, not 15 independent ad-hoc endpoints.
- `snapshotReport` stores an immutable `data_json` copy with a `params_hash`; verified that mutating the ledger after a snapshot does not change the stored snapshot data.

## Files changed

- `database/migrations/029_budgeting_foundation.mjs`
- `database/migrations/030_expense_claims_and_advances.mjs`
- `database/migrations/031_canonical_financial_reports.mjs`
- `platform/finance/engine.mjs` (+27 exported functions)
- `platform/finance/index.mjs` (+15 handler registrations)
- `tests/phase03/finance-wave-e.test.mjs`

## Tests and results

| Test | Result |
|------|--------|
| Approved-budget mutation denied; revision preserves original, creates linked new version | PASS |
| Budget variance reconciles to real GL activity with dimension scoping | PASS |
| Duplicate receipt fingerprint rejected by DB constraint | PASS |
| Over-policy approval requires override reason; rejection requires a reason | PASS |
| Claim approval posts exactly one document (no reimbursement duplication) | PASS |
| Advance partial-then-full settlement, over-settlement denied | PASS |
| P&L and Balance Sheet reconcile to posted GL, Balance Sheet is proven balanced | PASS |
| Cash flow net change reconciles to liquidity account movement | PASS |
| Partner ledger lists partner-linked lines correctly | PASS |
| Tax report reconciles to `tax_role`-tagged account GL balances | PASS |
| Report snapshot is immutable after later ledger activity | PASS |
| Reports never leak across company boundaries | PASS |

Command:

```bash
node tests/phase03/finance-wave-e.test.mjs
# finance-wave-e: 15/15 passed (12 of the 15 are budget/expense/report-specific)
```

## Reconciliation evidence (the load-bearing proof for this packet)

Posted a 5,000 IQD revenue receipt and a 2,000 IQD expense payment: `getProfitAndLoss` reports `income: 5000, expense: 2000, net_result: 3000` exactly. `getBalanceSheet` for the same period reports `current_result: 3000` and `balanced: true` — the accounting equation (assets = liabilities + equity + current result) holds to the cent, computed independently from the same posted `finance_journal_lines` rows the P&L used, proving the two statements are internally consistent rather than independently maintained.

## Scope boundary (explicit, not a gap)

**Packet 03.25 (Financial reporting UI and dashboards) is explicitly deferred to Wave F.** This project's established pattern (Wave B onward) keeps all browser/UI work in Wave F alongside the "Finance UI cutover and route strangler" (Packet 03.29) — building a new dashboard now, before the legacy-data migration and UI cutover exist, would risk exactly the "disconnected admin prototype" the governing document's Section 11 warns against. The query layer this packet's UI would consume (`runReport`, every report function above) is fully built and tested; only the browser-facing pages are deferred. This is recorded as risk #1 in the updated `unresolved-risks.md`, not silently skipped.
