# Donor License Ledger

**Rule:** Only project-owned VNext code is reused without additional license work. All other donors are used as clean-room behavior/specification sources unless an exact file-level MIT verification is performed and recorded here.

| Donor | License | Files used | Reuse mode | Notice / justification |
|-------|---------|------------|------------|------------------------|
| VNext (`octagon-erp-commercial-vnext`) | Project-owned | `vnext/server/finance/finance-engine.js`, `arap-engine.js`, `bank-engine.js`, `tax-engine.js`, `report-engine.js`, `migrations/601_r2_finance_baseline.mjs`, `602_r2_period_locks.mjs`, `603_r2_tax_engine.mjs`, `604_r2_accounting_dimensions.mjs`, `608_r2_arap_bank_reconciliation.mjs`, `609_r2_localization_framework.mjs`, `compat/LegacyFinanceBridge.mjs` | `MERGE-REFACTOR`, `MERGE-CANONICAL`, `ADAPTER`, `PORT-TESTS` | Project-owned; no third-party notice required. |
| Octagon current (`services/financeService.js`, `modules/finance-ui.js`, etc.) | Project-owned | `services/financeService.js`, `modules/finance-ui.js`, `modules/finance-selftest.js`, `views/finance.html`, `app.js` finance pages | `PRESERVE`, `ADAPTER` | Project-owned. |
| Odoo Community (`odoo/addons/account`) | LGPL | `models/account_move.py`, `account_move_line.py`, `sequence_mixin.py`, `account_lock_exception.py`, `account_tax.py`, `chart_template.py`, `l10n_*/data/template/`, `l10n_*/models/template_*.py`, `account_payment.py`, `account_partial_reconcile.py`, `account_full_reconcile.py`, `account_bank_statement_line.py`, `account_reconcile_model.py`, `analytic/models/analytic_mixin.py`, `analytic/models/analytic_plan.py` | `REFERENCE-NEGATIVE` / behavior/specification only | No code copied; only mature behavioral patterns studied. Odoo Enterprise/OEEL not inspected. |
| ERPNext (`erp-research/erpnext-develop/accounts/`) | GPL | `doctype/gl_entry/gl_entry.py`, `general_ledger.py`, `payment_entry/`, `payment_reconciliation/`, `bank_transaction/`, `tax_withholding_category/`, `accounting_dimension/`, `budget/`, `expense_claim/`, `asset/` | `REFERENCE-NEGATIVE` / behavior/specification only | No GPL business code copied into proprietary target by default. |
| AureusERP (`erp-research/aureuserp-master/plugins/webkul/accounting/`) | MIT | `src/Models/AccountManager.php`, journal/move-line, invoice, bill, payment, tax, currency, payment-term code, `Filament/Clusters/Reporting/Pages/` | `REFERENCE-NEGATIVE` for now; direct adapt only after exact file-level MIT verification | No direct adaptation in Wave A; if reused later, MIT notices will be added to `THIRD_PARTY_NOTICES.md`. |
| IDURAR (`erp-research/idurar-erp-crm-master/`) | AGPL | `backend/src/controllers/appControllers/paymentController/create.js`, invoice/payment Mongoose models, `frontend/src/modules/CrudModule/`, `ErpPanelModule/`, invoice/payment/PDF UI | `REFERENCE-NEGATIVE` | UX concepts only; no AGPL code copied. |
| Frappe (`erp-research/frappe/`) | MIT | framework-level document lifecycle, form/list metadata, print formats, version history, imports/exports | `REFERENCE-NEGATIVE` / pattern reference | No framework runtime imported. |
| NocoBase (`erp-research/nocobase-main/`) | proprietary+Apache | report/view schema separation, permission-aware resource/action APIs | `REFERENCE-NEGATIVE` / clean-room | Only concepts, no code. |
| RuoYi (`erp-research/ruoyi-vue-pro-master/`) | MIT | admin page patterns, permission tokens, export/file, jobs, audit | `REFERENCE-NEGATIVE` / pattern reference | No code copied. |

## License-safety checklist

- [x] No Odoo Enterprise/OEEL code inspected or used.
- [x] No ERPNext GPL business code copied into target by default.
- [x] No IDURAR AGPL code copied.
- [x] No Aureus code used without exact file-level MIT verification.
- [x] VNext project-owned code is freely merged.
- [x] If Aureus files are adapted later, `THIRD_PARTY_NOTICES.md` will be updated before commit.

## Legal/tax values disclaimer

No Iraqi tax rate, legal form, filing form, e-invoice requirement, or statutory interpretation is treated as final solely because it appears in a donor or old MD file. The Iraq localization pack will support accountant/legal validation and signed configuration approval before release.
