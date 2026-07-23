# Tax Attribution Report — Phase 03 Final Cutover

**Executing Model**: Gemini 3.6 Flash (High)  
**Date**: 2026-07-23  
**Branch**: `remediation/phase-03-final-cutover`  

---

## 1. Line-Level Tax Attribution Schema

Line-level tax fields are schema-enforced across operational and ledger tables:
- `account_move_lines`
- `fiscal_document_lines`
- `finance_journal_lines`

### Preserved Tax Attribution Attributes:
- `tax_id`: Foreign key reference to `finance_taxes` table.
- `tax_version_id`: Immutable version reference for historical rate compliance.
- `fiscal_position_id`: Fiscal mapping identifier (e.g. Domestic, Exempt, Export).
- `tax_base_amount`: Base amount subject to tax computation.
- `tax_amount`: Calculated tax amount in line currency.
- `tax_currency_id`: Currency in which tax is computed.
- `tax_company_amount`: Tax amount in company reporting currency.
- `withholding_id`: Withholding tax rate identifier.
- `exemption_reason`: Formal statutory exemption description.
- `reverse_charge_id`: Reverse charge mechanism tracking ID.
- `tax_jurisdiction`: Tax jurisdiction identifier.
- `tax_date`: Tax recognition date.

---

## 2. Verification & Lineage

- Posting document through `platform/finance/engine.mjs` populates all tax fields directly onto `finance_journal_lines`.
- Verified by `tests/phase03/finance-final-cutover.test.mjs`:
  - `Line-Level Tax Attribution: document and journal line tax identity` — **PASSED**.
