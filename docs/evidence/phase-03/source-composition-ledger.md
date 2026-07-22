# Phase 03 Source-Composition Ledger

**Legend:**
`PRESERVE` | `MERGE-CANONICAL` | `MERGE-REFACTOR` | `DIRECT-ADAPT` | `ADAPTER` | `SPEC-IMPLEMENT` | `PORT-TESTS` | `REFERENCE-NEGATIVE` | `EXCLUDE` | `DEFER`

---

## Capability: Wave A — Finance authority, schema, and chart of accounts

- **Capability ID:** `FN-001`, `FN-002`, `FN-003` (foundation), `FN-007` (periods)
- **Outcome:** One canonical `finance_canonical` module, relational chart of accounts, fiscal-document header/line schema, immutable GL schema, period schema, and first registered commands.
- **Existing Octagon paths inspected:**
  - `octagon-erp/services/financeService.js`
  - `octagon-erp/modules/finance-ui.js`
  - `octagon-erp/modules/finance-selftest.js`
  - `octagon-erp/views/finance.html`
- **Existing Octagon behavior to preserve:**
  - Arabic/RTL labels and account naming convention.
  - `account_moves` as the operational GL for cutover period.
  - Partner/department fields on move lines.
- **VNext paths inspected:**
  - `octagon-erp-commercial-vnext/vnext/server/finance/finance-engine.js`
  - `octagon-erp-commercial-vnext/migrations/601_r2_finance_baseline.mjs`
  - `octagon-erp-commercial-vnext/migrations/602_r2_period_locks.mjs`
- **VNext code/tests disposition:** `MERGE-REFACTOR` — table names aligned to `finance_*`, company references aligned to `platform_companies`, period references aligned to `finance_periods`, sequence uses `platform_sequences` / `x_sequences`, audit uses `platform_audit_log` / `platform_outbox`.
- **Primary donor repository and exact paths:**
  - VNext `finance-engine.js` (project-owned) — posting, reversal, balance, hash chain.
  - VNext `601_r2_finance_baseline.mjs` — schema and CoA seed pattern.
- **Secondary donor and distinct reason:**
  - Odoo Community `account/models/account_move.py` — clean-room reference for balance, immutability, reversal semantics.
- **License/reuse mode:** VNext project-owned; Odoo behavior/spec only.
- **Target Octagon paths:**
  - `database/migrations/014_finance_canonical_schema_and_coa.mjs`
  - `platform/finance/index.mjs`
  - `platform/finance/engine.mjs`
  - `tests/phase03/finance-wave-a.test.mjs`
- **Canonical owner:** `finance_canonical` module / `platform/finance`
- **Legacy/VNext owners:** `services/financeService.js` (legacy); `vnext/server/finance` (VNext, being merged)
- **Data migration:** map legacy `finance.accounts` → `finance_accounts`; seed default Iraq CoA via `finance.account:create` command; create 2026 fiscal periods.
- **Cutover:** Stage 1 — canonical schema and read-only import; Stage 2 — shadow queries; Stage 3 — dry-run commands; Stage 4+ deferred to later waves.
- **Rollback:** migration `down()` drops canonical finance tables and deletes module/entity/action rows; legacy `account_moves` remains untouched.
- **Tests ported:** VNext R2 finance baseline balance/hash tests → `tests/phase03/finance-wave-a.test.mjs`.
- **New tests:** migration fresh/rollback, duplicate account code, hierarchy cycle, cross-company posting denial, period lock, document balance, hash chain integrity.
- **Known conflicts:** `account_moves` JSON collection and canonical `finance_documents` table co-exist during cutover; no dual write.
- **Decision:** `MERGE-REFACTOR` VNext schema and engine into Octagon-native `platform/finance`, aligned with Phase 01/02 registries and Octagon table names.

---

## Capability: Wave B — Fiscal documents, GL posting, reversal, sequence, periods

- **Capability ID:** `FN-002`, `FN-003`, `FN-004`, `FN-005`, `FN-006`, `FN-007`
- **Outcome:** Atomic posting pipeline, linked reversal, concurrency-safe numbering, period locks.
- **VNext paths:** `finance-engine.js`, `arap-engine.js`, `report-engine.js` (partial).
- **Disposition:** `MERGE-CANONICAL` — posting engine becomes the single authority; sequences use `platform_sequences`; periods use `finance_periods`.
- **Primary donor:** VNext `finance-engine.js` (project-owned).
- **Secondary donor:** Odoo `account_move.py` (clean-room), ERPNext `general_ledger.py` (clean-room).
- **Decision:** `MERGE-CANONICAL`.

---

## Capability: Wave C — Currency, tax, localization, dimensions, AR/AP

- **Capability ID:** `FN-008`–`FN-014`, `FN-011`
- **VNext paths:** `tax-engine.js`, `tax-routes.js`, `arap-engine.js`, `report-engine.js`.
- **Disposition:** `MERGE-REFACTOR` for tax and AR/AP engines; `SPEC-IMPLEMENT` for Iraq localization pack (accountant validation required); `MERGE-CANONICAL` for dimensions.
- **Primary donor:** VNext `tax-engine.js`, `arap-engine.js` (project-owned).
- **Secondary donor:** Odoo `account_tax.py`, `account_partial_reconcile.py` (clean-room).
- **Decision:** `MERGE-REFACTOR` + `SPEC-IMPLEMENT` localization.

---

## Capability: Wave D — Payments, allocations, reconciliation, banking, cash

- **Capability ID:** `FN-015`–`FN-019`
- **VNext paths:** `bank-engine.js`, `finance-engine.js` (cash/bank sections), `arap-engine.js` (allocations).
- **Disposition:** `MERGE-CANONICAL` for payments/allocations/reconciliation; `MERGE-REFACTOR` for bank statement import; `ADAPTER` for workshop cash until full cash module is ready.
- **Primary donor:** VNext `bank-engine.js`, `arap-engine.js` (project-owned).
- **Secondary donor:** Odoo `account_payment.py`, `account_bank_statement_line.py` (clean-room); ERPNext `payment_entry` (clean-room).
- **Decision:** `MERGE-CANONICAL`.

---

## Capability: Wave E — Budgets, expenses, credit foundation, reports, asset interfaces

- **Capability ID:** `FN-020`–`FN-026`
- **VNext paths:** `report-engine.js`.
- **Disposition:** `SPEC-IMPLEMENT` for budgets/expenses/credit foundation; `MERGE-REFACTOR` for report query contracts; `SPEC-IMPLEMENT` for asset accounting interfaces only.
- **Primary donor:** VNext `report-engine.js` (project-owned); ERPNext budgets/expenses (clean-room).
- **Secondary donor:** Odoo Community report facts (clean-room).
- **Decision:** `SPEC-IMPLEMENT` + `MERGE-REFACTOR` reports.

---

## Capability: Wave F — Migration, UI cutover, adversarial tests, closure

- **Capability ID:** `FN-027` (migration/cutover)
- **VNext paths:** `compat/LegacyFinanceBridge.mjs`.
- **Disposition:** `ADAPTER` for legacy finance bridge; `PORT-TESTS` for VNext R2 finance tests; `SPEC-IMPLEMENT` for adversarial tests.
- **Primary donor:** VNext `LegacyFinanceBridge.mjs` (project-owned).
- **Decision:** `ADAPTER` + `PORT-TESTS` + `SPEC-IMPLEMENT`.

---

## Excluded / deferred

- VNext `vnext/server/finance/finance-routes.js` and `r2-finance-routes.js` → `EXCLUDE`; Octagon uses Phase 01 action executor and existing shell routes.
- VNext `consolidation-engine.js` / migration 801 → `DEFER` to Phase 08.
- VNext `manufacturing/landed-cost-engine.js` → `DEFER` to Phase 04/05; only posting ports defined in Phase 03.
- Full asset lifecycle → `DEFER` to Phase 05; only asset accounting interfaces in Phase 03.
- Full POS settlement, payroll posting replacement, e-invoicing → `DEFER`.
