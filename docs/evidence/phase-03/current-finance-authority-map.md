# Current Finance Authority Map

**Scope:** every financial fact that exists in the current Octagon runtime before Phase 03 canonical implementation.
**Base:** `da0a1a2` on `phase-03/finance-tax-payments-reporting`.

---

## Fact: Accounts and chart of accounts

- **Current Octagon storage:** `collections` → `finance.accounts` (JSON array of `{ id, code, name, type, parentId, is_active, ... }`).
- **Current Octagon writers:** `services/financeService.js` (browser-initiated `PentagonDB.mutate` through `finance-ui.js`).
- **Current Octagon readers/reports:** `services/financeService.js`, `app.js`, `views/finance.html`, trial balance, P&L.
- **Current VNext storage/writers:** `octagon-erp-commercial-vnext/migrations/601_r2_finance_baseline.mjs` creates an `account` table; `octagon-erp-commercial-vnext/vnext/server/finance/finance-engine.js` reads/writes it.
- **Expected canonical target:** `finance_accounts` table owned by `finance_canonical` module, registered entity `finance_account`, command `finance.account:create`.
- **Data volume/count:** varies by tenant; usually < 200 accounts per company.
- **Currency/company scope:** per `companyId` (legacy) / `platform_companies` (canonical).
- **Document states:** N/A (master data).
- **Mutation/deletion behavior:** destructive delete is currently possible; canonical requires deactivate after use.
- **Audit/provenance:** none in current code; canonical adds `platform_audit_log` + `platform_outbox`.
- **Known inconsistencies:** codes may not be unique across companies; canonical enforces `(company_id, code)` uniqueness.
- **Migration/cutover decision:** map legacy `finance.accounts` into `finance_accounts` during migration; seed default Iraq CoA via command.

---

## Fact: Journals

- **Current Octagon storage:** implicit in `account_moves.journal_id` (string keys like `j_sale`, `j_bank`, `j_gen`).
- **Current Octagon writers:** `services/financeService.js` (`createMove`, `createCustomerInvoice`, etc.).
- **Current Octagon readers/reports:** `FinanceService.getMoves`, `app.js`.
- **Current VNext storage/writers:** no separate `journal` table in VNext R2; implicit in `fiscal_doc.move_type`.
- **Expected canonical target:** `finance_journals` table with `id`, `company_id`, `code`, `type`, `sequence_id`, `default_debit_account_id`, `default_credit_account_id`.
- **Migration/cutover decision:** create canonical journals from move_type/journal_id usage; map existing moves to canonical journals.

---

## Fact: Journal entries and lines

- **Current Octagon storage:** `account_moves` (JSON collection) and `journal_entries` (legacy one-row mirror).
- **Current Octagon writers:** `FinanceService.createMove`, `updateMove`, `postMove`, `cancelMove`, `unpostMove`.
- **Current Octagon readers/reports:** `FinanceService.getMoves`, `getLedger`, `getTrialBalance`, `getProfitAndLoss`, `app.js`.
- **Current VNext storage/writers:** `fiscal_doc` / `fiscal_doc_line` / `gl_line` in VNext SQL schema.
- **Expected canonical target:** `finance_documents` (header), `finance_document_lines` (draft/approved lines), `finance_journal_entries` (posted header), `finance_journal_lines` (append-only GL lines).
- **Data volume/count:** depends on tenant history.
- **Currency/company scope:** per `companyId`; currency implicit in `account_moves` (mostly IQD).
- **Document states:** `draft`, `posted`, `cancel` (legacy `cancel` actually means cancelled with reversal).
- **Mutation/deletion behavior:** `unpostMove` mutates posted state back to draft and clears hash; canonical forbids mutable posted entries.
- **Audit/provenance:** `AuditService.createEvent` per action; no hash chain in current code; canonical adds hash chain.
- **Known inconsistencies:** `journal_entries` is a mirror of `account_moves`; risk of double-count if summed together.
- **Migration/cutover decision:** migrate posted `account_moves` into `finance_documents` + `finance_journal_entries` + `finance_journal_lines`; leave `account_moves` as read-only archive after reconciliation.

---

## Fact: Invoices and bills

- **Current Octagon storage:** `account_moves` with `move_type` `out_invoice` / `in_invoice`.
- **Current Octagon writers:** `FinanceService.createCustomerInvoice`, `createVendorBill`.
- **Current Octagon readers/reports:** `app.js`, `views/finance.html`, `modules/finance-ui.js`.
- **Expected canonical target:** `finance_documents` with `move_type` `customer_invoice` / `supplier_bill`.
- **Migration/cutover decision:** map existing move types to canonical document types; preserve partner IDs and totals.

---

## Fact: Payments and allocations

- **Current Octagon storage:** `account_payments` and `account_partial_reconciles` (JSON collections).
- **Current Octagon writers:** `FinanceService.createPayment`, `reconcileLines`.
- **Current Octagon readers/reports:** `FinanceService.getReconciliationSummary`, `getOpenPartnerItems`, `app.js`.
- **Expected canonical target:** `payment_documents`, `payment_lines`, `payment_allocations`, `payment_writeoffs`.
- **Migration/cutover decision:** migrate `account_payments` and `account_partial_reconciles` into canonical tables; reconcile residual state.

---

## Fact: Customer / supplier balances

- **Current Octagon storage:** derived from `account_moves` lines on `receivables_customers`, `payables_people`, `accrued_payroll` minus `account_partial_reconciles`.
- **Current Octagon writers:** `FinanceService` (posting moves and reconciles).
- **Expected canonical target:** derived from `finance_journal_lines` on control accounts minus `payment_allocations`.
- **Migration/cutover decision:** no static balance field; canonical truth is ledger + allocations.

---

## Fact: Taxes

- **Current Octagon storage:** none dedicated; tax is implicit in transaction amounts or not recorded.
- **Expected canonical target:** `tax_definitions`, `tax_versions`, `tax_repartition_lines`, `tax_report_tags`, `tax_fiscal_positions`, `tax_mapping_rules`, `tax_document_lines`.
- **Migration/cutover decision:** clean install of Iraq localization pack; no legacy tax data to migrate.

---

## Fact: Fiscal years / periods / locks

- **Current Octagon storage:** `db._lock_date` global string; no period table.
- **Current Octagon writers:** `FinanceService.setLockDate`.
- **Current VNext storage/writers:** `fiscal_periods` and `company_lock_dates` tables.
- **Expected canonical target:** `finance_fiscal_years`, `finance_periods`, `finance_locks`.
- **Migration/cutover decision:** create 2026 fiscal year and periods from lock date; migrate lock date to `finance_locks`.

---

## Fact: Exchange rates

- **Current Octagon storage:** none; all amounts treated as integer IQD.
- **Expected canonical target:** `finance_exchange_rates`, `finance_revaluations`.
- **Migration/cutover decision:** seed deterministic test fixtures; no legacy FX data.

---

## Fact: Dimensions / cost centers / projects / jobs

- **Current Octagon storage:** `department_id` field on move lines; project/job fields in operational modules.
- **Expected canonical target:** `finance_dimensions`, `finance_dimension_values`, `finance_analytic_distributions`.
- **Migration/cutover decision:** map `department_id` to a default analytic dimension; preserve project/job fields as dimension snapshots.

---

## Fact: Bank accounts and statements

- **Current Octagon storage:** `account_moves` with `journal_id: 'j_bank'` and `cash_workshop` account; no statement table.
- **Current Octagon writers:** `FinanceService.createPayment`, `processBankReconciliation`.
- **Expected canonical target:** `bank_accounts`, `bank_statements`, `bank_statement_lines`, `bank_reconciliation_sessions`, `bank_reconciliation_matches`.
- **Migration/cutover decision:** create canonical bank accounts from cash/bank moves; import legacy bank evidence as first statement batch.

---

## Fact: Cashboxes and petty cash

- **Current Octagon storage:** `account_moves` with cash effects; workshop cash JSON.
- **Current Octagon writers:** `FinanceService.postFinanceTransaction`, `services/financeService.js` cashbox branch.
- **Expected canonical target:** `cashboxes`, `cash_shifts`, `cash_counts`, `cash_variances`.
- **Migration/cutover decision:** preserve workshop cash behavior through explicit adapter until cash module is canonical.

---

## Fact: Budgets

- **Current Octagon storage:** legacy JSON collections.
- **Expected canonical target:** `budget_models`, `budget_versions`, `budget_lines`.
- **Migration/cutover decision:** deferred to Wave E; create extension points only.

---

## Fact: Expenses and employee advances

- **Current Octagon storage:** legacy JSON collections; payroll bridge.
- **Expected canonical target:** `expense_claims`, `expense_claim_lines`.
- **Migration/cutover decision:** no payroll/attendance behavior change; finance-side AP/payment command integration only.

---

## Fact: Workshop ledger

- **Current Octagon storage:** `finance.transactions` JSON collection → `account_moves`.
- **Current Octagon writers:** `FinanceService.postFinanceTransaction`, `postAllUnpostedFinanceTransactions`.
- **Expected canonical target:** source-module posting envelope (`finance.source_post`) through `SalesPostingPort`, `PurchasePostingPort`, `WorkshopPostingPort`.
- **Migration/cutover decision:** adapter from legacy `finance.transactions` to canonical `finance_documents`.

---

## Fact: Payroll-finance bridge

- **Current Octagon storage:** `FinanceService.generatePayrollEntry` writes `account_moves`.
- **Expected canonical target:** `PayrollPostingPort` + `finance.document:post` via source envelope.
- **Migration/cutover decision:** keep payroll/attendance frozen; route existing payroll entries through canonical posting command with explicit origin.

---

## Fact: Opening balances

- **Current Octagon storage:** initial account balances in `finance.accounts` or first moves.
- **Expected canonical target:** `finance_opening_balance_batches` + balanced opening journal entry.
- **Migration/cutover decision:** generate opening-balance batch from legacy account balances and open items.

---

## Fact: Financial reports

- **Current Octagon storage:** derived from `account_moves` on demand.
- **Current Octagon readers/reports:** `FinanceService.getTrialBalance`, `getProfitAndLoss`, `getLedger`, `getPartnerAgingSummary`, `app.js`.
- **Expected canonical target:** `financial_report_definitions`, `financial_report_formula_versions`, query functions over `finance_journal_lines`.
- **Migration/cutover decision:** re-implement reports over canonical ledger; reconcile totals to legacy reports before cutover.

---

## JSON mirrors / fallback stores

- `collections` → `finance.accounts`, `finance.transactions`, `account_moves`, `account_payments`, `account_partial_reconciles` are the legacy authority.
- `journal_entries` is a one-row mirror of `account_moves` and will become a documented compatibility reader only.
- No legacy data is deleted before backup, source mapping, reconciliation, rollback path, and owner approval.
