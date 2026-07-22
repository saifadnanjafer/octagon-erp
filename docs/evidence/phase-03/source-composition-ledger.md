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

## Capability: Wave C.1 — Accounting dimensions and analytic distribution (Packet 03.12)

- **Capability ID:** `FN-021` (dimensions), part of `FN-003`/`FN-006` (posting/period integration)
- **Outcome:** Configurable analytic axes (dimensions/values), per-account required/optional/blocked policy, percentage-distribution validation enforced at posting time, immutable posted distributions, P&L/dimension breakdown query.
- **Current Octagon paths inspected:** no dedicated dimension model existed; `account_moves` carried free-form `department`/`project` string fields only (`services/financeService.js`).
- **Current Octagon behavior preserved:** none carried forward as authority (free-form fields are superseded); dimension values are a superset (project/department/cost-center/custom).
- **Current Octagon writers:** `services/financeService.js` (legacy, untouched, not yet cut over).
- **VNext paths inspected:** `octagon-erp-commercial-vnext/vnext/server/finance/finance-engine.js` (`validateDimensionDistribution` shape), `604_r2_accounting_dimensions.mjs`.
- **VNext implementation disposition:** `MERGE-REFACTOR` — distribution-sum validation and per-account policy concept reused; storage moved to `finance_dimensions`/`finance_dimension_values`/`finance_account_dimension_policies` (relational, company-scoped) instead of VNext's JSON-blob shape.
- **VNext tests ported:** none pre-existed for this packet in VNext; new tests written directly against the merged shape.
- **Primary donor repository:** Odoo Community `addons/analytic/models/analytic_mixin.py`, `analytic_plan.py` — clean-room reference for the "plan + applicability + required/optional" concept.
- **Primary donor exact paths:** `odoo/addons/analytic/models/analytic_mixin.py`, `odoo/addons/analytic/models/analytic_plan.py`.
- **Primary donor behavior used:** applicability-by-account concept only (no code copied); Odoo's per-plan required/optional policy language informed `finance_account_dimension_policies.policy`.
- **Secondary donor:** ERPNext `accounting_dimension` doctype — clean-room reference confirming the value/mandatory-per-document-type shape is an industry-common pattern.
- **Secondary donor distinct purpose:** confirms "required per specific account/document type" as a real-world requirement, not Octagon-specific invention.
- **License:** Odoo LGPL and ERPNext GPL both used as behavior/specification only; no code copied.
- **Reuse mode:** `MERGE-REFACTOR` (VNext concept) + `REFERENCE-NEGATIVE` (Odoo/ERPNext).
- **Target Octagon module:** `platform/finance/engine.mjs` (`createDimension`, `createDimensionValue`, `setAccountDimensionPolicy`, `validateDimensionDistribution`, `getDimensionBreakdown`), `database/migrations/016_accounting_dimensions.mjs`.
- **Canonical database authority:** `finance_dimensions`, `finance_dimension_values`, `finance_account_dimension_policies`; distributions stored on `finance_journal_lines.dims` (frozen at post time).
- **Canonical command authority:** `finance_dimension:create`, `finance_dimension:value_create`, `finance_dimension:policy_set`.
- **Canonical query authority:** `getDimensionBreakdown` (net by dimension value, reconciles to posted GL lines).
- **Finance integration:** enforced inside `postDocument` via `validateDimensionDistribution`, which runs before any journal line is written — a required/blocked violation aborts the whole posting.
- **Permission and scope integration:** actions are company-scoped (Phase 02 `required_scope: 'company'`); dimension values are company-scoped and validated with `assertCompanyMatch` semantics via the existing account/company checks.
- **Migration:** `016_accounting_dimensions.mjs` (this migration was present but **uncommitted** at Wave C start; Wave C fixed a real bug in it — see Known risks — and completed it).
- **Reconciliation:** `getDimensionBreakdown` net-by-value sums verified to equal the posted line's debit-credit net in `finance-wave-c.test.mjs`.
- **Legacy writer retirement:** not applicable (no prior canonical dimension writer existed).
- **Compatibility adapter:** none needed.
- **Rollback:** `016_accounting_dimensions.mjs.down()` drops all three tables and deregisters actions/entities.
- **Tests:** `finance-wave-c.test.mjs` — missing required dimension, invalid total, blocked dimension, dimension breakdown reconciliation (4 tests).
- **Known risks:** the migration as found on disk (uncommitted, inherited from a prior session) registered `platform_actions` rows with `entity_id` values that were never inserted into `platform_entities`, which is a foreign-key column — a fresh-install of the migration chain failed with `FOREIGN KEY constraint failed`. This was a real, load-bearing bug (not a hypothetical) and is very likely why the migration was never committed. Fixed by registering the three missing entities before the actions insert, and added a fresh-install regression test (`migrations 016-021 applied and register expected actions`, which explicitly checks for orphaned `entity_id` references across the whole finance module).
- **Final decision:** `MERGE-REFACTOR`.

---

## Capability: Wave C.2 — Currency and exchange-rate engine (Packet 03.09)

- **Capability ID:** `FN-022`
- **Outcome:** Versioned multi-currency accounting: dated exchange rates, conversion, unrealized-FX revaluation (posts and is reversible), and a pure realized-FX helper for Wave D's payment engine.
- **Current Octagon paths inspected:** `services/financeService.js` stores `currency` as a plain string on `account_moves`; no rate table, no revaluation.
- **Current Octagon behavior preserved:** `IQD` as implicit base currency; existing `account_moves.currency` field concept carried into `finance_documents.currency`.
- **Current Octagon writers:** `services/financeService.js` (legacy, untouched).
- **VNext paths inspected:** `octagon-erp-commercial-vnext/vnext/server/finance/arap-engine.js` (`fxRate`/`fxDelta` handling inside `createArapDocument`/`createPayment`).
- **VNext implementation disposition:** `MERGE-REFACTOR` — the booked-vs-settlement rate delta concept from `arap-engine.js` was extracted into a standalone, pure, testable function (`computeRealizedFx`) rather than being inlined into a payment function (Wave D will call it once `finance_payments` exists).
- **VNext tests ported:** none pre-existed; new tests written.
- **Primary donor repository:** Odoo Community `base/models/res_currency.py`, `res_currency_rate.py` — clean-room reference for dated-rate lookup (nearest rate on/before a date) and rate-type (`spot`/`average`/`custom`) modeling.
- **Primary donor exact paths:** `odoo/addons/base/models/res_currency.py`, `res_currency_rate.py`.
- **Secondary donor:** ERPNext `accounts/doctype/currency_exchange` — clean-room reference for the revaluation-run/journal shape.
- **Secondary donor distinct purpose:** confirms revaluation should produce its own journal entry rather than mutating historical lines.
- **License:** Odoo LGPL and ERPNext GPL used as behavior/specification only.
- **Reuse mode:** `MERGE-REFACTOR` (VNext) + `REFERENCE-NEGATIVE` (Odoo/ERPNext).
- **Target Octagon module:** `platform/finance/engine.mjs` (`upsertCurrency`, `upsertExchangeRate`, `getExchangeRate`, `convertAmount`, `computeRealizedFx`, `revalueForeignBalances`), `database/migrations/017_currency_and_exchange_rates.mjs`.
- **Canonical database authority:** `finance_currencies`, `finance_exchange_rates`, `finance_fx_revaluation_runs`.
- **Canonical command authority:** `finance_currency:upsert`, `finance_exchange_rate:upsert`, `finance_fx:revalue`.
- **Canonical query authority:** `getExchangeRate`/`convertAmount` (not registered as standalone actions; consumed internally by other finance commands and, in later phases, by tax/pricing quotes).
- **Finance integration:** `revalueForeignBalances` posts through the existing `createDocument`/`submitDocument`/`approveDocument`/`postDocument` pipeline — no separate GL write path; reversal reuses `reverseDocument` unchanged.
- **Permission and scope integration:** company-scoped; `finance_fx:revalue` requires `finance_fx:revalue` permission (Phase 02 registry).
- **Migration:** `017_currency_and_exchange_rates.mjs`; seeds `IQD`/`USD`/`EUR` as starter currencies (`INSERT OR IGNORE`, idempotent).
- **Reconciliation:** revaluation totals (`totalGain`/`totalLoss`) are asserted to balance the posted document's debits/credits before posting is attempted (same `validateDocumentBalanced` gate as every other document).
- **Legacy writer retirement:** not applicable (no prior FX authority existed).
- **Compatibility adapter:** none.
- **Rollback:** `017_currency_and_exchange_rates.mjs.down()` drops all three tables.
- **Tests:** `finance-wave-c.test.mjs` — missing rate, rate change/dated lookup, rounding, realized-FX pure-function gain/loss/none, revaluation posts a balanced reversible document (5 tests).
- **Known risks:** `revalueForeignBalances` requires the caller to pass the specific `account_ids` to revalue rather than auto-discovering every foreign-currency-denominated account company-wide; this is a deliberate foundation-level scope decision (bounded, explicit, testable) — auto-discovery across the whole chart of accounts is deferred and should be revisited once real foreign-currency bank/AR/AP volume exists.
- **Final decision:** `MERGE-REFACTOR`.

---

## Capability: Wave C.3 — Tax definition and calculation engine (Packet 03.10)

- **Capability ID:** `FN-023`
- **Outcome:** Declarative tax engine (percent/fixed/group/compound, price-include, repartition, withholding-threshold evaluation) fully separate from posting — `finance_tax:quote` never writes a document; callers turn the quote into document lines themselves.
- **Current Octagon paths inspected:** `services/financeService.js` had ad-hoc tax-amount fields on moves with no declarative definition, no repartition, no withholding.
- **Current Octagon behavior preserved:** none carried forward as authority; this is new canonical capability.
- **Current Octagon writers:** `services/financeService.js` (legacy, untouched).
- **VNext paths inspected:** `octagon-erp-commercial-vnext/vnext/server/finance/tax-engine.js` (`computeTaxes`, `checkAndApplyWithholding`, `getTaxReport`).
- **VNext implementation disposition:** `MERGE-REFACTOR` — `computeTaxes`'s price-include/repartition math and `checkAndApplyWithholding`'s single-transaction + cumulative-window threshold logic were ported near-verbatim (project-owned code, direct reuse permitted) into `computeTax`/`evaluateWithholding`, retargeted from VNext's `tax`/`tax_repartition_line`/`withholding_category` tables to `finance_taxes`/`finance_tax_repartition_lines`/`finance_withholding_categories`, and extended with a new compound-group evaluation loop VNext did not have.
- **VNext tests ported:** none pre-existed; new tests written.
- **Primary donor repository:** Odoo Community `account/models/account_tax.py` — clean-room reference for repartition-line semantics (`base`/`tax` repartition type, factor percent, tags) and price-include math.
- **Primary donor exact paths:** `odoo/addons/account/models/account_tax.py`.
- **Secondary donor:** ERPNext `accounts/doctype/tax_withholding_category` — clean-room reference for cumulative-threshold-window (monthly/yearly) withholding.
- **Secondary donor distinct purpose:** confirms the cumulative-window withholding shape VNext already implemented against a second independent source.
- **License:** Odoo LGPL and ERPNext GPL used as behavior/specification only; VNext code is project-owned and was directly reused/refactored.
- **Reuse mode:** `MERGE-REFACTOR` (VNext) + `REFERENCE-NEGATIVE` (Odoo/ERPNext).
- **Target Octagon module:** `platform/finance/engine.mjs` (`createTax`, `setTaxRepartitionLines`, `computeTax`, `createWithholdingCategory`, `evaluateWithholding`), `database/migrations/018_tax_definition_and_calculation.mjs`.
- **Canonical database authority:** `finance_taxes`, `finance_tax_repartition_lines`, `finance_tax_group_members`, `finance_withholding_categories`, `finance_withholding_certificates`.
- **Canonical command authority:** `finance_tax:create`, `finance_tax:repartition_set`, `finance_withholding:category_create`, `finance_withholding:evaluate`.
- **Canonical query authority:** `finance_tax:quote` (registered on the action executor as `kind: 'domain'` — the executor's `ACTION_KINDS` list from Phase 01 does not include a `'query'` kind, so a read-only quote is registered and dispatched the same way as any other domain handler; it simply performs no writes).
- **Finance integration:** deliberately **not** wired into `postDocument` in Wave C — a tax quote is computed by the caller (future sales/purchase flows) and the resulting base/tax lines are passed into `createDocument` like any other line, preserving one posting authority.
- **Permission and scope integration:** company-scoped; `finance_tax:quote` requires `finance_tax:quote` permission distinct from `finance_tax:manage` (read vs. configure separation, Phase 02 registry).
- **Migration:** `018_tax_definition_and_calculation.mjs`.
- **Reconciliation:** tax-version mutation after a quote was computed is proven not to affect the already-returned quote object (frozen JS object, no live recomputation) — see the `tax-version change after posting` test.
- **Legacy writer retirement:** not applicable (no prior tax authority existed).
- **Compatibility adapter:** none.
- **Rollback:** `018_tax_definition_and_calculation.mjs.down()` drops all five tables.
- **Tests:** `finance-wave-c.test.mjs` — exclusive percent, price-included, compound group, fiscal-position exemption, single-transaction withholding threshold, cumulative withholding threshold, tax-version-after-posting immutability (7 tests).
- **Known risks:** `finance_tax:quote`'s `kind: 'domain'` registration means it goes through the same idempotency/audit machinery as a write action even though it performs no writes; this is a minor mismatch inherited from the Phase 01 `ACTION_KINDS` enum (`lifecycle_transition`/`create`/`reverse`/`amend`/`domain` — no `query`), not something Wave C should fix by modifying already-closed Phase 01 kernel code. Flagged for a future Phase 01 kernel enhancement, not a Phase 03 blocker.
- **Final decision:** `MERGE-REFACTOR`.

---

## Capability: Wave C.4 — Fiscal positions and Iraq localization pack (Packet 03.11)

- **Capability ID:** `FN-024`
- **Outcome:** Context-driven tax/account remapping (fiscal positions) plus a first, explicitly-provisional Iraq localization pack (idempotent install/upgrade) with a binding legal-safety disclaimer.
- **Current Octagon paths inspected:** none — no fiscal-position concept existed in current Octagon.
- **Current Octagon behavior preserved:** existing bilingual (`name`/`name_ar`) labeling convention on `finance_accounts` (Wave A) carried through to `finance_fiscal_positions.name_ar`.
- **Current Octagon writers:** none pre-existing.
- **VNext paths inspected:** `octagon-erp-commercial-vnext/vnext/server/finance/tax-engine.js` (`fiscal_position_tax_map`/`fiscal_position_account_map` lookup inside `computeTaxes`).
- **VNext implementation disposition:** `MERGE-REFACTOR` — the src→dest tax/account mapping lookup pattern was ported directly (project-owned) into `mapFiscalPositionTax`/`mapFiscalPositionAccount` and `computeTax`'s fiscal-position resolution branch.
- **VNext tests ported:** none pre-existed; new tests written.
- **Primary donor repository:** Odoo Community `account/models/account_fiscal_position.py` and the `l10n_*` localization-pack module structure — clean-room reference for "fiscal position = criteria + tax map + account map" and "localization pack = versioned, installable, chart/tax/position bundle."
- **Primary donor exact paths:** `odoo/addons/account/models/account_fiscal_position.py`; `odoo/addons/l10n_generic_coa/` (structure only, not the Enterprise per-country packs).
- **Secondary donor:** ERPNext regional/tax templates — clean-room reference confirming per-country tax-template bundling as a common pattern.
- **Secondary donor distinct purpose:** cross-checks the pack-install shape against a second independent donor.
- **License:** Odoo LGPL, ERPNext GPL — behavior/specification only. Odoo Enterprise/OEEL localization packs were **not** inspected or used (binding rule, `donor-license-ledger.md`).
- **Reuse mode:** `MERGE-REFACTOR` (VNext) + `REFERENCE-NEGATIVE` (Odoo/ERPNext).
- **Target Octagon module:** `platform/finance/engine.mjs` (`createFiscalPosition`, `mapFiscalPositionTax`, `mapFiscalPositionAccount`, `installLocalizationPack`), `database/migrations/019_fiscal_positions_and_iraq_localization.mjs`.
- **Canonical database authority:** `finance_fiscal_positions`, `finance_fiscal_position_tax_map`, `finance_fiscal_position_account_map`, `finance_localization_packs`.
- **Canonical command authority:** `finance_fiscal_position:create`, `finance_fiscal_position:map_tax`, `finance_fiscal_position:map_account`, `finance_localization:install`.
- **Canonical query authority:** fiscal-position resolution happens inline inside `computeTax` (no separate "resolve" action registered in Wave C; sufficient for the current quote-time use).
- **Finance integration:** consumed by `computeTax` only in Wave C; account-map application to posted document lines is a Wave D/Phase 04 sales-and-purchase concern (explicitly out of Wave C scope per the packet).
- **Permission and scope integration:** company-scoped; `finance_localization:install` is a distinct permission from `finance_fiscal_position:manage`.
- **Migration:** `019_fiscal_positions_and_iraq_localization.mjs`.
- **Reconciliation:** `installLocalizationPack('iraq')` re-run twice in the same company is proven not to duplicate the seeded tax or the three fiscal positions (idempotency test).
- **Legacy writer retirement:** not applicable.
- **Compatibility adapter:** none.
- **Rollback:** `019_fiscal_positions_and_iraq_localization.mjs.down()` drops all four tables.
- **Tests:** `finance-wave-c.test.mjs` — fiscal-position exemption (shared with the tax test group), install idempotency/reinstall-no-duplication, manual-override remapping (3 tests directly, plus the exemption test counted under tax).
- **Known risks:** every rate, tax name, and fiscal-position label in the Iraq pack is an explicit **placeholder** (`IQ_SALES_15` = 15% general sales tax placeholder) with `legal_validation_status: 'pending'` recorded on every install/upgrade row. This must not be treated as a real, filing-ready localization until an accountant/legal reviewer signs off — see the legal safety rule already recorded in `donor-license-ledger.md` and repeated verbatim in the migration's own header comment and in `installLocalizationPack`'s doc comment.
- **Final decision:** `MERGE-REFACTOR`.

---

## Capability: Wave C.5 — Accounts receivable subledger (Packet 03.13)

- **Capability ID:** `FN-025`
- **Outcome:** Canonical customer subledger derived from the GL (no parallel AR ledger copy): due schedules, credit-note-aware open items, aging buckets, partner statements.
- **Current Octagon paths inspected:** `services/financeService.js` (`getOpenPartnerItems`, `getPartnerAgingSummary`) — legacy AR derivation logic operating on the `account_moves` JSON collection.
- **Current Octagon behavior preserved:** the "derive from GL, don't duplicate" principle already used by the legacy `FinanceService` aging functions is preserved and made canonical (Section 5 of the governing spec: "No second... reporting engine may exist").
- **Current Octagon writers:** `services/financeService.js` (`createCustomerInvoice`) remains the legacy operational writer; not yet retired (retirement is Wave F, after parity/reconciliation is proven).
- **VNext paths inspected:** `octagon-erp-commercial-vnext/vnext/server/finance/arap-engine.js` (`documentOpenAmount`, due-date/credit-note handling in `createArapDocument`).
- **VNext implementation disposition:** `MERGE-REFACTOR` for the *shape* (due date, credit-note offset, open-amount derivation) — full payment-allocation-based residual from VNext's `documentOpenAmount` is **not** ported in Wave C because `finance_payments`/`payment_allocation` do not exist yet (that is Wave D, Packets 03.15/03.16/03.17 by the governing spec's own wave split). Wave C's open-amount = total minus posted credit notes only.
- **VNext tests ported:** none pre-existed; new tests written.
- **Primary donor repository:** Odoo Community `account/models/account_move.py` (`amount_residual`, `payment_state`) — clean-room reference for residual/payment-state naming and semantics (to be completed once payments land in Wave D).
- **Primary donor exact paths:** `odoo/addons/account/models/account_move.py`.
- **Secondary donor:** ERPNext `accounts` receivables + payment-terms doctypes — clean-room reference for due-schedule (installment) and aging-bucket shape.
- **Secondary donor distinct purpose:** cross-checks the aging-bucket boundaries (current/1-30/31-60/61-90/90+) against a second independent donor.
- **License:** Odoo LGPL, ERPNext GPL — behavior/specification only.
- **Reuse mode:** `MERGE-REFACTOR` (VNext shape) + `REFERENCE-NEGATIVE` (Odoo/ERPNext) + `DEFER` (full payment-based residual, to Wave D).
- **Target Octagon module:** `platform/finance/engine.mjs` (`setDueSchedule`, `getCustomerOpenItems`, `getCustomerAging`, `getPartnerStatement`, `createCreditNote`), `database/migrations/020_accounts_receivable_subledger.mjs`.
- **Canonical database authority:** `finance_due_schedules` only — open items/aging/statement are computed queries over `finance_documents` + `finance_journal_lines`, never a duplicated balance table.
- **Canonical command authority:** `finance_due_schedule:set`.
- **Canonical query authority:** `finance_ar:open_items`, `finance_ar:aging`.
- **Finance integration:** `createCreditNote` reuses `createDocument` unchanged (adds `source_type: 'credit_note_of'` / `source_id` convention); due schedules can only be set while a document is `draft` (frozen at post time, matching the ledger-invariant rule that posted facts are immutable).
- **Permission and scope integration:** company-scoped; `getCustomerOpenItems`/`getCustomerAging` filter by `company_id` inside the query, verified cross-company isolated in tests.
- **Migration:** `020_accounts_receivable_subledger.mjs`.
- **Reconciliation:** proven directly — after a partial credit note, `getCustomerAging(...).total` is asserted equal to a raw `SUM(debit)-SUM(credit)` query against `finance_journal_lines` for that receivable control account and partner (see `finance-wave-c.test.mjs`, "aging reconciles to the receivable GL balance").
- **Legacy writer retirement:** deferred to Wave F.
- **Compatibility adapter:** none yet; `services/financeService.js` remains the sole writer until Wave F cutover.
- **Rollback:** `020_accounts_receivable_subledger.mjs.down()` drops `finance_due_schedules`.
- **Tests:** `finance-wave-c.test.mjs` — due-schedule pre-post-only lock and total-mismatch rejection, credit-note-aware open items + GL-reconciled aging, partner statement running balance, cross-company isolation (4 tests).
- **Known risks:** full residual/open-item reconciliation against actual payments does not exist until Wave D; today's "open amount" only nets out credit notes, not payments — this is by design per the governing spec's wave split and is recorded as an open risk in `unresolved-risks.md`, not hidden.
- **Final decision:** `MERGE-REFACTOR` + `DEFER` (payment-based residual to Wave D).

---

## Capability: Wave C.6 — Accounts payable subledger (Packet 03.14)

- **Capability ID:** `FN-026`
- **Outcome:** Canonical supplier subledger mirroring AR: due schedules, credit-note-aware open items, aging, duplicate-invoice detection, payment holds, and a forward-looking approval-authority-limit primitive for the future three-way match (Phase 04).
- **Current Octagon paths inspected:** `services/financeService.js` (`createVendorBill`) — no duplicate-reference detection, no hold concept.
- **Current Octagon behavior preserved:** none specific; new canonical capability layered next to the preserved legacy writer.
- **Current Octagon writers:** `services/financeService.js` (`createVendorBill`), not yet retired.
- **VNext paths inspected:** `octagon-erp-commercial-vnext/vnext/server/finance/arap-engine.js` (`document_kind` branching for `supplier_bill`/`supplier_debit_note`).
- **VNext implementation disposition:** `MERGE-REFACTOR` for the supplier-side open-item shape (shared `openItemsFor`/`agingFor` helpers with AR); hold/duplicate-detection/authority-limit are new capability not present in VNext, built as forward hooks for the Phase 04 three-way-match extension the governing spec calls out explicitly.
- **VNext tests ported:** none pre-existed; new tests written.
- **Primary donor repository:** Odoo/ERPNext/Aureus supplier-bill and duplicate-reference-detection behavior — clean-room reference (no code copied; Aureus not directly adapted in Wave C since no exact MIT file-level verification was performed for this specific behavior — see `donor-license-ledger.md`, which records Aureus as `REFERENCE-NEGATIVE for now`).
- **Primary donor exact paths:** `odoo/addons/account/models/account_move.py` (`ref` uniqueness check pattern, clean-room); `erp-research/erpnext-develop/accounts/doctype/purchase_invoice` (clean-room).
- **Secondary donor:** none distinct beyond the above.
- **License:** Odoo LGPL, ERPNext GPL — behavior/specification only; Aureus not used pending MIT file-level verification.
- **Reuse mode:** `MERGE-REFACTOR` (VNext shape) + `SPEC-IMPLEMENT` (hold/duplicate-detection/authority-limit, independently implemented from the governing spec's own required-behavior list, not copied from any donor).
- **Target Octagon module:** `platform/finance/engine.mjs` (`getSupplierOpenItems`, `getSupplierAging`, `holdPayment`, `releasePaymentHold`, `isDocumentOnHold`, `setApprovalAuthorityLimit`, `checkApprovalAuthority`), `database/migrations/021_accounts_payable_subledger.mjs`; duplicate detection lives in the shared `createDocument` (`source_canonical_key` uniqueness check, additive to Wave A/B code).
- **Canonical database authority:** `finance_payment_holds`, `finance_approval_authority_limits`; duplicate detection uses `finance_documents.source_canonical_key` (existing column) plus a new supporting index.
- **Canonical command authority:** `finance_ap:hold`, `finance_ap:release_hold`, `finance_authority_limit:set`.
- **Canonical query authority:** `finance_ap:open_items`, `finance_ap:aging`.
- **Finance integration:** `createDocument`'s duplicate check is gated on `input.source_canonical_key` being present, so Wave A/B documents that never pass it are completely unaffected (proven by the full Wave A/B regression staying green).
- **Permission and scope integration:** company-scoped; `finance_ap:manage` vs `finance_ap:read` permission separation mirrors the AR pattern.
- **Migration:** `021_accounts_payable_subledger.mjs`.
- **Reconciliation:** supplier aging total proven equal to `SUM(credit)-SUM(debit)` on the payable control account for the same partner (`finance-wave-c.test.mjs`, "supplier aging reconciles to the payable GL balance").
- **Legacy writer retirement:** deferred to Wave F.
- **Compatibility adapter:** none yet.
- **Rollback:** `021_accounts_payable_subledger.mjs.down()` drops both tables and the supporting index.
- **Tests:** `finance-wave-c.test.mjs` — duplicate supplier invoice rejection (with correct per-partner scoping), hold/release lifecycle including double-release rejection, GL-reconciled aging, approval-authority-limit enforcement (4 tests).
- **Known risks:** `checkApprovalAuthority` returns `allowed: true` when no limit is configured for a role/user (unrestricted-by-default) rather than deny-by-default; this mirrors how Phase 02 permission checks work (explicit grants required for the underlying action, this is an additional *ceiling* on top, not a replacement for permission checks) but should be revisited before Phase 04's three-way match relies on it as a hard control.
- **Final decision:** `MERGE-REFACTOR` + `SPEC-IMPLEMENT`.

---

## Capability: Wave D.1 — Payment documents and methods (Packet 03.15)

- **Capability ID:** `FN-027`
- **Outcome:** One receive/pay/transfer payment document model with idempotency-key dedup, fee handling, and cross-currency support, posting through the existing single GL authority.
- **Current Octagon paths inspected:** `services/financeService.js` (`createPayment`, `reconcileLines`).
- **Current Octagon behavior preserved:** payment-as-a-document concept; cash/bank distinction.
- **Current Octagon writers:** `services/financeService.js`, not yet retired.
- **VNext paths inspected:** `octagon-erp-commercial-vnext/vnext/server/finance/arap-engine.js` (`createPayment`, idempotency-key replay, fx-rate handling).
- **VNext implementation disposition:** `MERGE-REFACTOR` — replay-on-duplicate-key and gross/net fee split concepts ported; VNext's version couples payment creation with allocation in one call, split apart in Octagon into `createPayment`/`postPayment` (Packet 03.15) and `allocatePayment` (Packet 03.16) to match the governing document's own packet boundary.
- **Primary donor repository:** Odoo Community `account/models/account_payment.py` — clean-room reference for method/payer-payee shape.
- **Primary donor exact paths:** `odoo/addons/account/models/account_payment.py`.
- **Secondary donor:** ERPNext `accounts/doctype/payment_entry` — clean-room reference confirming the fee-line and reference-idempotency shape.
- **License:** VNext project-owned (direct reuse); Odoo/ERPNext behavior/specification only.
- **Reuse mode:** `MERGE-REFACTOR`.
- **Target Octagon module:** `platform/finance/engine.mjs` (`createPayment`, `postPayment`, `reversePaymentAction`), `database/migrations/022_payment_documents.mjs`.
- **Canonical database authority:** `finance_payments`.
- **Canonical command authority:** `finance_payment:create`, `finance_payment:post`, `finance_payment:reverse`.
- **Finance integration:** posts through `createDocument`/`postDocument` exclusively; no separate GL write path.
- **Migration:** `022_payment_documents.mjs`.
- **Legacy writer retirement:** deferred to Wave F.
- **Tests:** idempotency replay, unsupported method, cross-currency balance, fee posting, internal transfer, reversal-requires-unallocation (6 tests).
- **Known risks:** none new beyond what's tracked in `unresolved-risks.md`.
- **Final decision:** `MERGE-REFACTOR`.

---

## Capability: Wave D.2 — Allocation, advances, refunds, write-offs (Packet 03.16)

- **Capability ID:** `FN-028`
- **Outcome:** Immutable many-to-many settlement lineage between payments and AR/AP documents, completing the full residual/open-item calculation Wave C deferred.
- **Current Octagon paths inspected:** `services/financeService.js` (`reconcileLines`, `account_partial_reconciles`).
- **VNext paths inspected:** `arap-engine.js` (`payment_allocation` table, `documentOpenAmount`'s allocated-amount subtraction).
- **VNext implementation disposition:** `MERGE-REFACTOR` — allocation-table shape reused directly; unallocation is new (VNext had no unallocate path) built as an append-only reversing row, matching the ledger-wide "never edit, always append a reversal" invariant already established in Wave A/B.
- **Primary donor repository:** Odoo Community `account/models/account_partial_reconcile.py` — clean-room reference for many-to-many lineage.
- **Secondary donor:** ERPNext Payment Entry references — clean-room reference for advance/unapplied-credit handling.
- **License:** VNext project-owned; Odoo/ERPNext behavior/specification only.
- **Reuse mode:** `MERGE-REFACTOR`.
- **Target Octagon module:** `platform/finance/engine.mjs` (`allocatePayment`, `unallocatePayment`, `writeOffOpenItem`, `getOpenAmountForDocument`, `paymentAllocationsTotal`), `database/migrations/023_payment_allocation_and_writeoffs.mjs`.
- **Canonical database authority:** `finance_payment_allocations`, `finance_write_offs`.
- **Canonical command authority:** `finance_payment:allocate`, `finance_payment:unallocate`, `finance_document:write_off`.
- **Finance integration:** `openItemsFor` (Wave C) now subtracts `paymentAllocationsTotal` alongside credit notes/write-offs — one open-item calculation, not two.
- **Migration:** `023_payment_allocation_and_writeoffs.mjs`.
- **Reconciliation:** over-allocation denial is enforced by an atomic `UPDATE ... WHERE unallocated_amount >= ?`, verified under concurrent `Promise.allSettled` allocation attempts (exactly one of two competing 300-against-500 allocations succeeds).
- **Tests:** over-allocation denial, partial allocation open-amount correctness, unallocate/reallocate lineage (3 rows survive), write-off reason requirement and control-account resolution, concurrent allocation race (5 tests).
- **Final decision:** `MERGE-REFACTOR`.

---

## Capability: Wave D.3 — Open-item reconciliation engine (Packet 03.17)

- **Capability ID:** `FN-029`
- **Outcome:** Session-based candidate matching (exact/tolerance) between unallocated payments and AR/AP open items, confirming through the real `allocatePayment` path — no parallel settlement mechanism.
- **VNext paths inspected:** `octagon-erp-commercial-vnext/vnext/server/finance/bank-engine.js` (`matchBankLine`, `manualReconcile`, `unreconcile`).
- **VNext implementation disposition:** `MERGE-REFACTOR`, generalized from "bank line vs. payment" to "unallocated payment vs. AR/AP open item" — the session/candidate/confirm/undo shape is identical, retargeted.
- **Primary donor repository:** Odoo Community `account/models/account_partial_reconcile.py` / `account_full_reconcile.py` — clean-room reference for partial/full status semantics.
- **Secondary donor:** ERPNext Payment Reconciliation Tool — clean-room reference for the session/candidate-list/confirm workflow shape.
- **License:** VNext project-owned; Odoo/ERPNext behavior/specification only.
- **Reuse mode:** `MERGE-REFACTOR`.
- **Target Octagon module:** `platform/finance/engine.mjs` (`openReconciliationSession`, `suggestReconciliationCandidates`, `confirmReconciliationMatch`, `undoReconciliationMatch`, `closeReconciliationSession`), `database/migrations/024_open_item_reconciliation_engine.mjs`.
- **Canonical database authority:** `finance_reconciliation_sessions`, `finance_reconciliation_matches`.
- **Finance integration:** `confirmReconciliationMatch` calls `allocatePayment` internally; `undoReconciliationMatch` calls `unallocatePayment` internally — the reconciliation engine has zero independent GL or balance logic of its own.
- **Migration:** `024_open_item_reconciliation_engine.mjs`.
- **Tests:** exact-match suggestion/confirm/undo/closed-session rejection, GL-reconciled aging after session-based allocation (2 tests).
- **Final decision:** `MERGE-REFACTOR`.

---

## Capability: Wave D.4 — Banking and statement import (Packet 03.18)

- **Capability ID:** `FN-030`
- **Outcome:** Immutable, deduplicated bank statement import with rule-assisted and manual matching, difference posting, and undo — direct near-verbatim port of project-owned VNext code.
- **Current Octagon paths inspected:** `services/financeService.js` (`processBankReconciliation`).
- **Current Octagon behavior preserved:** none carried forward as authority (legacy function stays as the operational writer until Wave F cutover).
- **VNext paths inspected:** `octagon-erp-commercial-vnext/vnext/server/finance/bank-engine.js` (entire file: `createBankAccount`, `createMatchRule`, `importStatement`, `matchBankLine`, `manualReconcile`, `recordBankDifference`, `unreconcile`).
- **VNext implementation disposition:** `MERGE-REFACTOR` — near-verbatim port (project-owned code, direct reuse permitted); table/column names retargeted to `finance_bank_*`; `hashLine`'s dedup-fingerprint approach kept unchanged.
- **Primary donor repository:** Odoo Community `account/models/account_bank_statement.py` — clean-room reference for opening/closing-balance batch shape.
- **Secondary donor:** ERPNext Bank Transaction + Bank Reconciliation Tool — clean-room reference confirming the import-fingerprint-dedup pattern independently.
- **License:** VNext project-owned; Odoo/ERPNext behavior/specification only.
- **Reuse mode:** `MERGE-REFACTOR`.
- **Target Octagon module:** `platform/finance/engine.mjs` (7 exported functions), `database/migrations/025_banking_and_statement_import.mjs`.
- **Canonical database authority:** `finance_bank_accounts`, `finance_bank_match_rules`, `finance_bank_statement_batches`, `finance_bank_statement_lines`, `finance_bank_reconciliations`.
- **Migration:** `025_banking_and_statement_import.mjs`.
- **Tests:** repeated-import no-op, duplicate-line rejection, malformed-line rejection, tolerance-based auto-match + unmatch, bank-difference posting (4 tests).
- **Known risks:** no live external provider connector was built; only the normalized import-array boundary (`bank_test_provider` fixture pattern already established in `source-lock.md`).
- **Final decision:** `MERGE-REFACTOR`.

---

## Capability: Wave D.5 — Cashboxes, petty cash, and custody (Packet 03.19)

- **Capability ID:** `FN-031`
- **Outcome:** Custodian/shift/count/variance/close lifecycle for cash, with expected balance always derived live from the GL (never a separately tracked running total).
- **Current Octagon paths inspected:** `services/financeService.js` (`cashboxEffect()`, `'cashbox'` sourceType/category fields).
- **Current Octagon behavior preserved:** the "cash moves are first-class" concept; superseded by a canonical custodian/shift model rather than a free-form category field.
- **VNext paths inspected:** no dedicated cashbox/shift model existed in VNext finance; this packet is foundation-level new capability.
- **Primary donor repository:** ERPNext / generic POS opening-and-closing-entry behavior — clean-room reference for the shift-open/count/close/variance shape.
- **License:** clean-room reference only (no code copied); custodian/shift/count lifecycle is `SPEC-IMPLEMENT`, built directly from the Phase 03 governing document's Packet 03.19 requirement list.
- **Reuse mode:** `PRESERVE` (current Octagon cash-move concept) + `SPEC-IMPLEMENT` (shift lifecycle).
- **Target Octagon module:** `platform/finance/engine.mjs` (`createCashbox`, `openCashShift`, `recordCashCount`, `closeCashShift`, `expectedShiftBalance`), `database/migrations/026_cashboxes_and_petty_cash.mjs`.
- **Canonical database authority:** `finance_cashboxes`, `finance_cash_shifts`, `finance_cash_counts`.
- **Migration:** `026_cashboxes_and_petty_cash.mjs`.
- **Tests:** single-open-shift enforcement, count/close variance against live GL-derived expected balance, closed-shift rejection, reopen after close (1 comprehensive test covering the full lifecycle).
- **Known risks:** `max_balance` on `finance_cashboxes` is stored but not yet enforced as a hard limit (no "negative/over limit policy" rejection implemented) — recorded in `unresolved-risks.md`.
- **Final decision:** `PRESERVE` + `SPEC-IMPLEMENT`.

---

## Capability: Wave D.6 — Payment terms, installments, retainage (Packet 03.20)

- **Capability ID:** `FN-032`
- **Outcome:** Versioned, reusable payment-term templates that generate a `finance_due_schedules` (Wave C) set at document-creation time, with exact-total rounding.
- **VNext paths inspected:** `arap-engine.js`'s single `due_date` field on `arap_document` — generalized here into a multi-line, rule-based template.
- **VNext implementation disposition:** `MERGE-REFACTOR` of the concept (due-date-per-document), extended to due-date-per-installment.
- **Primary donor repository:** Odoo Community `account/models/account_payment_term.py` — clean-room reference for percent/fixed/balance line types and day/month-end due rules.
- **Secondary donor:** ERPNext Payment Terms Template — clean-room reference confirming the installment + early-discount shape.
- **License:** VNext project-owned; Odoo/ERPNext behavior/specification only.
- **Reuse mode:** `MERGE-REFACTOR`.
- **Target Octagon module:** `platform/finance/engine.mjs` (`createPaymentTermTemplate`, `generateDueScheduleFromTerm`, `computeDueDate`), `database/migrations/027_payment_terms_and_installments.mjs`.
- **Canonical database authority:** `finance_payment_term_templates`, `finance_payment_term_lines`.
- **Finance integration:** `generateDueScheduleFromTerm` calls Wave C's `setDueSchedule` — no separate schedule-writing path; inherits the existing "draft-only" and "total-must-match" rules for free.
- **Migration:** `027_payment_terms_and_installments.mjs`.
- **Tests:** exact-total rounding across a 33.33/33.33/balance split, month-end-plus-days due-date calculation (2 tests).
- **Known risks:** early-payment-discount and retainage fields are stored on the template but not yet applied by any posting logic (no discount-on-early-payment computation exists yet) — recorded in `unresolved-risks.md`; this is foundation-level per the packet's own "versioned due schedules" outcome statement, which does not require discount application in Phase 03.
- **Final decision:** `MERGE-REFACTOR`.

---

## Capability: Wave D.7 — Credit exposure and policy foundation (Packet 03.21)

- **Capability ID:** `FN-033`
- **Outcome:** One explainable, real-time credit-exposure query composed entirely from Wave C's AR queries — Finance supplies the query; Phase 04 will consume it for sales-order blocking (explicitly out of Phase 03 scope per the governing document).
- **VNext paths inspected:** VNext's AR/sales-policy exploration (project-owned, foundation-level, no shippable code) informed the profile/limit/hold shape.
- **Primary donor repository:** Odoo Community `res.partner` credit-limit fields — clean-room reference.
- **Secondary donor:** ERPNext Customer Credit Limit — clean-room reference confirming the temporary-override-with-expiry pattern.
- **License:** clean-room reference only; the exposure query itself is `SPEC-IMPLEMENT` (a composition of already-canonical Wave C queries, not new balance logic).
- **Reuse mode:** `SPEC-IMPLEMENT`.
- **Target Octagon module:** `platform/finance/engine.mjs` (`setCreditProfile`, `holdCredit`, `releaseCreditHold`, `getCreditExposure`), `database/migrations/028_credit_exposure_and_policy.mjs`.
- **Canonical database authority:** `finance_credit_profiles`, `finance_credit_holds`.
- **Finance integration:** `getCreditExposure` calls `getCustomerOpenItems`/`getCustomerAging` (Wave C) directly — zero independent receivables-balance computation, so it can never drift out of sync with AR.
- **Migration:** `028_credit_exposure_and_policy.mjs`.
- **Tests:** exposure-vs-limit calculation, expired-temporary-override-ignored, hold/release lifecycle with payment-releases-exposure, cross-company isolation (4 tests).
- **Known risks:** "unposted/approved orders through a later Phase 04 port" and "guarantees/deposits" beyond a flat stored number are explicitly deferred to Phase 04 per the governing document's own text ("Sales-order blocking and release are implemented in Phase 04").
- **Final decision:** `SPEC-IMPLEMENT`.

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
