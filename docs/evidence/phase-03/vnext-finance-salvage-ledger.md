# VNext Finance Salvage Ledger

**Source root:** `octagon-erp-commercial-vnext/`
**All VNext code is project-owned and may be reused or refactored into Octagon.**

| VNext path | Disposition | Target Octagon path | Reason / notes |
|------------|-------------|---------------------|----------------|
| `vnext/server/finance/finance-engine.js` | `MERGE-REFACTOR` | `platform/finance/engine.mjs` | Core posting, reversal, balance, hash-chain, lock-date logic. Table names and company references refactored to Octagon platform. |
| `vnext/server/finance/arap-engine.js` | `MERGE-REFACTOR` | `platform/finance/arap.mjs` | AR/AP schedules, allocation, residual, aging. Will be integrated in Wave C/D. |
| `vnext/server/finance/bank-engine.js` | `MERGE-REFACTOR` | `platform/finance/banking.mjs` | Bank statement import, matching, reconciliation. Wave D. |
| `vnext/server/finance/tax-engine.js` | `MERGE-REFACTOR` | `platform/tax/engine.mjs` | Tax calculation, repartition, fiscal positions. Wave C. |
| `vnext/server/finance/report-engine.js` | `MERGE-REFACTOR` | `platform/finance/reporting.mjs` | Trial balance, GL, P&L, balance sheet. Wave E. |
| `vnext/server/finance/finance-routes.js` | `EXCLUDE` | — | Replaced by Phase 01 `ActionExecutor` + existing shell routes. |
| `vnext/server/finance/r2-finance-routes.js` | `EXCLUDE` | — | Replaced by Phase 01/02 runtime. |
| `vnext/server/finance/tax-routes.js` | `EXCLUDE` | — | Replaced by registered tax actions. |
| `vnext/server/compat/LegacyFinanceBridge.mjs` | `ADAPTER` | `platform/finance/legacy-bridge.mjs` | Time-bounded adapter from legacy `account_moves` / `finance.transactions` to canonical documents. Wave F. |
| `migrations/601_r2_finance_baseline.mjs` | `MERGE-REFACTOR` | `database/migrations/014_finance_canonical_schema_and_coa.mjs` | Schema adapted to Octagon table names and platform references. |
| `migrations/602_r2_period_locks.mjs` | `MERGE-REFACTOR` | `database/migrations/014_finance_canonical_schema_and_coa.mjs` | `company_lock_dates` merged into `finance_locks` and `finance_periods`. |
| `migrations/603_r2_tax_engine.mjs` | `MERGE-REFACTOR` | `database/migrations/016_tax_engine_and_localization.mjs` (planned) | Wave C. |
| `migrations/604_r2_accounting_dimensions.mjs` | `MERGE-REFACTOR` | `database/migrations/017_accounting_dimensions.mjs` (planned) | Wave C. |
| `migrations/608_r2_arap_bank_reconciliation.mjs` | `MERGE-REFACTOR` | `database/migrations/019_arap_payments_banking.mjs` (planned) | Wave D. |
| `migrations/609_r2_localization_framework.mjs` | `MERGE-REFACTOR` | `database/migrations/016_tax_engine_and_localization.mjs` (planned) | Wave C. |
| `migrations/705_r7_maintenance.mjs` | `DEFER` | — | Phase 05 asset interface only. |
| `migrations/801_*` consolidation | `DEFER` | — | Phase 08. |
| VNext R2 finance tests | `PORT-TESTS` | `tests/phase03/finance-wave-*.test.mjs` | Adapted to Octagon action executor and dialect. |

## Salvage rules applied

1. No VNext finance runtime remains as a separate product.
2. No VNext route is copied into Octagon; only algorithms, validators, and table contracts are reused.
3. SQL table names are aligned to Octagon `finance_*` namespace to avoid collision with legacy `account_moves`.
4. Company/tenant references use `platform_companies` / `platform_branches` / `organization_memberships`.
5. Audit/outbox use `platform_audit_log` / `platform_outbox`.
6. Sequence authority uses `platform_sequences`.
7. VNext `fiscal_doc` → `finance_documents`; `fiscal_doc_line` → `finance_document_lines`; `gl_line` → `finance_journal_lines`.
