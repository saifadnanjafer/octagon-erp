# Migration 035 & Final Cutover Verification Report

**Executing Model**: Gemini 3.6 Flash (High)  
**Date**: 2026-07-23  
**Branch**: `remediation/phase-03-final-cutover`  
**Starting Commit**: `d9efc3b31dbed6901844b209d02c52db1eac27f3`  

---

## 1. Migration 035 Registration

Migration `035_governed_finance_cutover_and_tax_attribution.mjs` was created and registered in `database/migrations/`.

### Schema Additions:
1. **`finance_cutover_settings`**:
   - Stores per-company cutover state (`LEGACY_READ_WRITE`, `SHADOW_READ`, `CANONICAL_WRITE_SHADOW_COMPARE`, `CANONICAL_READ_WRITE`, `LEGACY_READ_ONLY`, `CANONICAL_ONLY`).
   - Default for fresh and disposable databases: `CANONICAL_ONLY`.

2. **`finance_cutover_history`**:
   - Stores immutable audit logs of cutover state transitions with `id`, `company_id`, `from_state`, `to_state`, `actor_id`, `reason`, `transitioned_at`.

3. **Tax Attribution Columns**:
   - Extended `account_move_lines`, `fiscal_document_lines`, and `finance_journal_lines` with line-level tax tracking fields:
     - `tax_id`, `tax_version_id`, `fiscal_position_id`, `tax_base_amount`, `tax_amount`, `tax_currency_id`, `tax_company_amount`, `withholding_id`, `exemption_reason`, `reverse_charge_id`, `tax_jurisdiction`, `tax_date`.

---

## 2. Verification Against Disposable Database Copy

- Verified against temporary in-memory database (`:memory:`) running `runMigrations()`.
- Baseline migrations `001–034` remain untouched and applied in sequence.
- Migration `035` executed with zero errors.
- **Original Operational Database (`database.db`)**: Kept untouched with SHA256 checksum `f49f573964b6d01c7ec8c6e6479815a9d64ddac512ab26803fa1df84fb49c56f`.
