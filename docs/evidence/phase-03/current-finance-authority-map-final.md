# Final Finance Authority Map — Phase 03 Remediation & Final Cutover

**Executing Model:** Gemini 3.6 Flash (Medium)  
**Execution Date:** 2026-07-22  
**Repository:** `saifadnanjafer/octagon-erp`  
**Branch:** `remediation/phase-03-final-closure`  
**HEAD Commit:** `c793999ec348dde5852b7c1425bdac74d35821e4`

---

## 1. Governance Principle & Cutover Strategy

Every financial fact in Octagon ERP has **exactly one canonical write authority** backed by SQLite transactions (`platform/finance/engine.mjs`), Phase 01 kernel actions, and Phase 02 identity and authorization evaluator.

Legacy writers (`services/financeService.js` mutating raw JSON/PentagonDB directly) are retired in Wave F and converted to read-only compatibility wrappers or canonical command proxies.

---

## 2. Per-Fact Authority Ledger

| Financial Fact | Legacy Writer | Legacy Reader | Canonical Target Writer | Canonical Target Reader | Migration Engine | Parity & Reconciliation | Feature Flag | Rollback Path | Retirement Criterion |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Chart of Accounts** | `PentagonDB.finance.accounts` | `services/financeService.js:getAccounts` | `platform/finance/engine.mjs:createAccount` / `updateAccount` | `platform/api/finance.mjs:GET /api/v1/finance/accounts` | `033_legacy_finance_migration_registry.mjs` | Code & type match | `FF_CANONICAL_FINANCE` | Read legacy cache fallback | No raw JSON mutation in `PentagonDB.finance.accounts` |
| **Journals** | `PentagonDB.finance.journals` | `services/financeService.js` | `platform/finance/engine.mjs:createJournal` | `platform/api/finance.mjs:GET /api/v1/finance/journals` | `033_legacy_finance_migration_registry.mjs` | ID & type match | `FF_CANONICAL_FINANCE` | Legacy array fallback | Legacy journal array read-only |
| **Fiscal Documents / Moves** | `services/financeService.js:createMove` / `postMove` | `services/financeService.js:getMoves` | `platform/finance/engine.mjs:createFiscalDocument` / `postFiscalDocument` | `platform/finance/engine.mjs:getGeneralLedger` | `033_legacy_finance_migration_registry.mjs` | Trial balance debit = credit | `FF_CANONICAL_FINANCE` | Revert to draft | `account_moves` sole GL authority; `journal_entries` mirror read-only |
| **Journal Lines** | `services/financeService.js:normalizeLine` | `services/financeService.js:getMoves` | `platform/finance/engine.mjs` transaction atomic insert | `platform/finance/engine.mjs:getGeneralLedger` | `033_legacy_finance_migration_registry.mjs` | Line count & line sum match | `FF_CANONICAL_FINANCE` | Document unpost | No direct line array mutation |
| **Customer Invoices** | `services/financeService.js:createCustomerInvoice` | `services/financeService.js:getMoves` | `platform/finance/engine.mjs:createFiscalDocument(out_invoice)` | `platform/finance/engine.mjs:getGeneralLedger` | `033_legacy_finance_migration_registry.mjs` | Invoice totals & AR match | `FF_CANONICAL_FINANCE` | Reversal document | `services/financeService.js` proxying to canonical API |
| **Vendor Bills** | `services/financeService.js:createVendorBill` | `services/financeService.js:getMoves` | `platform/finance/engine.mjs:createFiscalDocument(in_invoice)` | `platform/finance/engine.mjs:getGeneralLedger` | `033_legacy_finance_migration_registry.mjs` | Bill totals & AP match | `FF_CANONICAL_FINANCE` | Reversal document | `services/financeService.js` proxying to canonical API |
| **Credit / Debit Notes** | `services/financeService.js:cancelMove` | `services/financeService.js:getMoves` | `platform/finance/engine.mjs:reverseFiscalDocument` | `platform/finance/engine.mjs:getGeneralLedger` | `033_legacy_finance_migration_registry.mjs` | Reversal link verified | `FF_CANONICAL_FINANCE` | None (immutable reversal) | Reversal linked in canonical store |
| **Payments & Receipts** | `services/financeService.js:createPayment` | `services/financeService.js:getReconciliationSummary` | `platform/finance/engine.mjs:createPayment` | `platform/finance/engine.mjs:getPayments` | `033_legacy_finance_migration_registry.mjs` | Payment count & total match | `FF_CANONICAL_FINANCE` | Unpost payment | `account_payments` sole authority |
| **Payment Allocations** | `services/financeService.js:reconcileLines` | `services/financeService.js:lineOpenAmount` | `platform/finance/engine.mjs:allocatePayment` | `platform/finance/engine.mjs:getOpenPartnerItems` | `033_legacy_finance_migration_registry.mjs` | Residual balance match | `FF_CANONICAL_FINANCE` | Deallocate payment | `account_partial_reconciles` sole authority |
| **AR & AP Aging** | `services/financeService.js:getPartnerLedger` | `services/financeService.js:getPartnerAgingSummary` | `platform/finance/engine.mjs:getAgedPartnerReport` | `platform/finance/engine.mjs:getAgedPartnerReport` | On-the-fly from canonical lines | Aging total matches AR/AP GL accounts | `FF_CANONICAL_FINANCE` | Legacy calculation | Direct SQL line aggregation |
| **Taxes & Localization** | `services/financeService.js` inline | Local JS helpers | `platform/finance/engine.mjs:quoteTax` / line taxes | `platform/finance/engine.mjs:getTaxReport` | `033_legacy_finance_migration_registry.mjs` | Tax summary matches GL tax accounts | `FF_CANONICAL_FINANCE` | Standard tax rates | Tax breakdown saved per line |
| **Currencies & FX Rates** | Hardcoded/Inline | Inline JS | `platform/finance/engine.mjs:createCurrency` / `setExchangeRate` / `computeRealizedFx` | `platform/finance/engine.mjs:getExchangeRates` | Initial seed migration | Realized FX gain/loss reconciles to GL | `FF_CANONICAL_FINANCE` | Base currency fallback | Multi-currency FX gain/loss calculated on settlement |
| **Fiscal Periods & Locks** | `services/financeService.js:setLockDate` | `services/financeService.js:isLocked` | `platform/finance/engine.mjs:createFiscalPeriod` / `closeFiscalPeriod` | `platform/finance/engine.mjs:getFiscalPeriods` | Migrations 013 & 034 | Lock dates strictly enforced | `FF_CANONICAL_FINANCE` | Period reopen by admin | Lock date enforced in `platform/finance/engine.mjs` |
| **Bank Statements & Match** | `services/financeService.js:processBankReconciliation` | `services/financeService.js` | `platform/finance/engine.mjs:importBankStatement` / `reconcileBankStatementLine` | `platform/finance/engine.mjs:getBankReconciliationSummary` | `033_legacy_finance_migration_registry.mjs` | Matched statement totals = Bank GL | `FF_CANONICAL_FINANCE` | Unmatch statement line | Statement lines stored in canonical SQLite tables |
| **Cashboxes & Petty Cash** | `services/financeService.js:cashboxEffect` | `services/financeService.js` | `platform/finance/engine.mjs:createCashboxSession` / `closeCashboxSession` | `platform/finance/engine.mjs:getCashboxSummary` | `033_legacy_finance_migration_registry.mjs` | Session balance <= max_balance | `FF_CANONICAL_FINANCE` | Session reopen | Cashbox max balance enforced in backend |
| **Budgets & Controls** | None | None | `platform/finance/engine.mjs:createBudget` / `getBudgetVariance` | `platform/finance/engine.mjs:getBudgetVariance` | N/A | Variance = Budget - Actual GL | `FF_CANONICAL_FINANCE` | Informational mode | Fail-closed budget approval controls |
| **Expenses & Advances** | `services/financeService.js` | `services/financeService.js` | `platform/finance/engine.mjs:createExpenseClaim` / `approveExpenseClaim` | `platform/finance/engine.mjs:getExpenseClaims` | `033_legacy_finance_migration_registry.mjs` | Expense total = GL debit | `FF_CANONICAL_FINANCE` | Draft claim | Governed claim workflow in canonical engine |
| **Financial Reports** | `services/financeService.js:getTrialBalance` / `getProfitAndLoss` | `views/finance.html` | `platform/finance/engine.mjs:getTrialBalance` / `getProfitAndLoss` / `getBalanceSheet` / `getCashFlow` | `platform/api/finance.mjs` | Real-time canonical query | Report net income = P&L net income | `FF_CANONICAL_FINANCE` | Legacy report query | All reports query `account_moves` directly |

---

## 3. Legacy Identification & Retirement Verification

1. **`services/financeService.js`**: All mutation methods (`createMove`, `postMove`, `cancelMove`, `unpostMove`, `createPayment`, `reconcileLines`, `createCustomerInvoice`, `createVendorBill`) are re-routed to canonical `/api/v1/finance/*` endpoints.
2. **`PentagonDB.finance` Direct Cache Mutation**: Disabled. `PentagonDB` reads legacy finance state only through read-only compatibility adapters.
3. **Client-side Authority Removal**: Browser JS never computes or sets posting status, journal sequence numbers, tax amounts, or lock checks independently. All business rules execute on the server inside SQLite transactions in `platform/finance/engine.mjs`.
