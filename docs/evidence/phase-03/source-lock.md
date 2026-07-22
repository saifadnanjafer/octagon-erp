# Phase 03 Source Lock

**Lock date:** 2026-07-22
**Verifier:** autonomous Phase 03 agent

## Root directories

| Root | Path | Branch / commit | License |
|------|------|-----------------|---------|
| `OCTAGON_ROOT` | `octagon-erp/` | `phase-03/finance-tax-payments-reporting` @ `da0a1a2` | proprietary / project-owned |
| `VNEXT_ROOT` | `octagon-erp-commercial-vnext/` | `main` (local mirror) | project-owned |
| `ODOO_ROOT` | `odoo/` | `19.0` | LGPL / Community only |
| `FRAPPE_ROOT` | `erp-research/frappe/` | not present; ERPNext ships its own Frappe fork | — |
| `ERPNEXT_ROOT` | `erp-research/erpnext-develop/` | `develop` | GPL (behavior/spec reference only) |
| `RUOYI_ROOT` | `erp-research/ruoyi-vue-pro-master/` | `master` | MIT (patterns only) |
| `RUOYI_UI_ROOT` | `erp-research/ruoyi-vue-pro-master/ruoyi-ui/` | `master` | MIT (patterns only) |
| `NOCOBASE_ROOT` | `erp-research/nocobase-main/` | `main` | proprietary+Apache (clean-room by default) |
| `AUREUS_ROOT` | `erp-research/aureuserp-master/` | `master` | MIT (direct adapt only after file-level notice) |
| `IDURAR_ROOT` | `erp-research/idurar-erp-crm-master/` | `master` | AGPL (reference only) |

## Runtime environment

| Item | Value |
|------|-------|
| Node.js | `v24.14.1` |
| npm | `11.11.0` |
| Database | SQLite via `node:sqlite` (`DatabaseSync`) |
| Active adapter | `SqliteDialect` (`database/dialects/sqlite-dialect.mjs`) |
| PostgreSQL adapter | stub only (`database/dialects/postgres-dialect.mjs`) |
| Disposable DB pattern | `os.tmpdir()` / `octagon-p03-*.db` |
| WAL mode | `PRAGMA journal_mode = WAL` |
| Foreign keys | `PRAGMA foreign_keys = ON` |

## Financial fixtures and defaults

| Fixture | Value |
|---------|-------|
| Base currency | `IQD` (Iraqi Dinar) |
| Test currencies | `IQD`, `USD`, `EUR` |
| Exchange-rate fixture period | 2026-01-01 to 2026-12-31 |
| Deterministic rate fixture | `USD` = 1,310.00 IQD; `EUR` = 1,430.00 IQD (test-only) |
| Open fiscal year | 2026 |
| Open periods | 2026-01 through 2026-12 |
| Fake bank provider | `bank_test_provider` (idempotent import, no real network) |
| Fake payment provider | `payment_test_provider` (no real network) |
| Browser profile | existing Octagon shell (`index.html`, `app.js`, `server.js`) |

## Current finance authorities

| Fact | Storage | Writer | Reader |
|------|---------|--------|--------|
| Chart of accounts | `collections` → `finance.accounts` (JSON) | `services/financeService.js` / `PentagonDB.mutate` | `services/financeService.js`, `app.js`, `views/finance.html` |
| Journals | implicit in `account_moves` journal_id | `services/financeService.js` | `services/financeService.js` |
| Journal entries / moves | `account_moves` (JSON collection) | `services/financeService.js` (`createMove`, `postMove`, `updateMove`) | `services/financeService.js`, `app.js` reports |
| Legacy mirror | `journal_entries` (JSON collection) | `services/financeService.js` (`upsertLegacyJournalEntry`) | legacy "القيود اليومية" screen |
| Customer invoices | `account_moves` with `move_type: 'out_invoice'` | `FinanceService.createCustomerInvoice` | `app.js`, `modules/finance-ui.js` |
| Supplier bills | `account_moves` with `move_type: 'in_invoice'` | `FinanceService.createVendorBill` | `app.js` |
| Payments | `account_payments`, `account_partial_reconciles` (JSON) | `FinanceService.createPayment`, `reconcileLines` | `app.js`, `modules/finance-ui.js` |
| AR/AP open items | derived from `account_moves` + partials | `FinanceService` | `FinanceService.getOpenPartnerItems`, `getPartnerAgingSummary` |
| Trial balance / P&L | derived from `account_moves` | `FinanceService.getTrialBalance`, `getProfitAndLoss` | `app.js`, `views/finance.html` |
| Bank reconciliation | `processBankReconciliation` | `FinanceService` | `app.js` |
| Budgets / expenses | legacy JSON collections | `services/financeService.js` indirectly | `app.js` |
| Workshop ledger | legacy JSON collections | `services/financeService.js` (`postFinanceTransaction`) | `app.js` |

## Missing / renamed donor paths

- VNext finance engine was originally under `vnext/server/finance/`; it is being merged into `platform/finance/`.
- VNext finance migrations were originally `octagon-erp-commercial-vnext/migrations/601_r2_finance_baseline.mjs` etc.; they are being rewritten as Octagon migrations `014_*` and onward.
- Odoo Enterprise/OEEL paths are **not inspected** and **not used**.

## Exact file-level license ledger

See `donor-license-ledger.md` for every directly adapted file.
All VNext code is project-owned and may be reused.
All Odoo Community use is clean-room behavior/specification only.
ERPNext/IDURAR business code is treated as behavior/specification only unless a separate reuse decision is approved and recorded.
AureusERP reuse requires MIT file-level verification and `THIRD_PARTY_NOTICES.md` recording.
