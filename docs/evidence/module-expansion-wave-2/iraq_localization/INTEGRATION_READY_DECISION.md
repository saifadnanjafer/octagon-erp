# Integration Ready Decision — Iraq Localization and Tax Foundation (W2-M15)

## Status
- **Status:** INTEGRATION READY
- **Module ID:** `W2-M15`
- **Domain:** Iraq Localization & Tax Foundation
- **Date:** 2026-07-30

---

## 1. Executive Summary
The **Iraq Localization and Tax Foundation** module provides official Iraqi tax rules (`TAXR-2026-XXXX`) for sales tax, withholding tax, payroll tax, and stamp duty; Iraqi Governorates territorial registry (Baghdad, Basra, Erbil, Ninawa, etc.); quarterly/annual tax filing declarations (`IQ-TAX-2026-XXXX`); Central Bank of Iraq (CBI) official vs. market exchange rate tracking (`FX-2026-XXXX`); and bilingual (Arabic/English) document templates (`TMP-2026-XXXX`).

---

## 2. Implemented Components

### Database Schema (Migration 081)
- `database/migrations/081_iraq_localization_and_tax.mjs`
- 5 Schema Entities:
  1. `iq_tax_rules`: Tax authority rules (`TAXR-2026-XXXX`), tax type, Arabic & English names, percentage rates, and validity windows.
  2. `iq_governorates`: Pre-seeded catalog of 18 Iraqi Governorates with governorate codes (`BGD`, `BSR`, `EBL`, etc.), Arabic/English titles, and regional groupings.
  3. `iq_tax_filings`: Iraqi Tax Authority quarterly & annual tax declarations (`IQ-TAX-2026-XXXX`), gross taxable revenues in IQD, calculated tax due in IQD, and filing statuses (`draft`, `submitted`, `paid`).
  4. `iq_currency_conversions`: Central Bank of Iraq (CBI) official exchange rate tracking vs. market rates (`FX-2026-XXXX`).
  5. `iq_bilingual_templates`: Dual-language (Arabic/English) tax invoice, purchase receipt, and pay slip document header/footer templates (`TMP-2026-XXXX`).

### Domain Service (`platform/domains/iraq_localization/service.mjs`)
- `createTaxRule`: Iraqi tax authority rule definition.
- `getGovernorates`: Governorate catalog lookup.
- `fileTaxDeclaration`: Tax declaration filing submission (`IQ-TAX-2026-XXXX`).
- `recordCBIRate`: Central Bank of Iraq exchange rate recording.
- `configureBilingualTemplate`: Dual-language document template configuration.

### ActionExecutor & Permissions (`platform/domains/iraq_localization/index.mjs`)
- Registered Actions:
  1. `iraq_localization:create-tax-rule`
  2. `iraq_localization:get-governorates`
  3. `iraq_localization:file-tax-declaration`
  4. `iraq_localization:record-cbi-rate`
  5. `iraq_localization:configure-bilingual-template`
- Granted Permissions:
  1. `iraq.tax.manage`
  2. `iraq.tax.file`
  3. `iraq.fx.manage`
  4. `iraq.template.manage`

---

## 3. Verification Evidence
- **Test File:** `tests/module-wave-2/iraq_localization/iraq_localization.test.mjs`
- **Result:** 4/4 Passing Tests
  - `✔ 1. Migration 081: Up, rerun, and schema verification`
  - `✔ 2. Iraq Governorates Catalog Seeding Verification`
  - `✔ 3. Iraq Tax Rule Creation & Tax Declaration Filing`
  - `✔ 4. CBI FX Conversion Rate & Bilingual Template Configuration`

---

## 4. Architectural & Governance Attestation
- Idempotent migration 081 with seed data for Iraqi governorates (`INSERT OR IGNORE`).
- Single Write Authority for tax declarations and FX rates.
- Multi-company scoping via `company_id`.
