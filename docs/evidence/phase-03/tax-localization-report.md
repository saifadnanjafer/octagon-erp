# Wave C — Tax, Fiscal Positions, and Iraq Localization Report

**Scope:** Packet 03.10 (tax definition/calculation) and Packet 03.11 (fiscal positions / Iraq localization pack).
**Evidence date:** 2026-07-22

## What was implemented — tax engine

- `finance_taxes` — declarative tax definitions: `percent`/`fixed`/`group`, `price_include`, `is_withholding`, `is_reverse_charge`, `is_recoverable`, `rounding`, `version`.
- `finance_tax_repartition_lines` — `base`/`tax` repartition rows with `factor_percent`, target `account_id`, `tag_ids`, `sign`.
- `finance_tax_group_members` — ordered child taxes for `amount_type = 'group'` (compound taxation).
- `finance_withholding_categories` / `finance_withholding_certificates` — single-transaction and cumulative (monthly/yearly window) withholding-threshold evaluation, writing a certificate row on every evaluation (triggered or not) for audit trail.
- `computeTax` — declarative quote function. Never writes a document. Resolves an optional fiscal position's tax/account maps before computing. Supports price-included and price-excluded percent/fixed taxes, repartition-line fan-out, and compound groups (each child tax's amount rolls into the base of the next child).
- `evaluateWithholding` — ports VNext's `checkAndApplyWithholding` threshold logic (single-transaction and cumulative-window) onto `finance_withholding_categories`/`finance_withholding_certificates`.

## What was implemented — fiscal positions and Iraq pack

- `finance_fiscal_positions` — criteria (JSON), exemption reason, `allow_manual_override`.
- `finance_fiscal_position_tax_map` / `finance_fiscal_position_account_map` — src→dest remapping (dest `NULL` = exempt).
- `finance_localization_packs` — per-company install/upgrade ledger with `legal_validation_status` (`pending` by default).
- `installLocalizationPack('iraq')` — idempotent: seeds one placeholder 15% sales tax and three fiscal positions (`IQ_DOMESTIC`, `IQ_EXPORT`, `IQ_EXEMPT`), mapping the placeholder tax to exempt (`NULL`) for export/exempt positions. Re-running install/upgrade does not duplicate rows.

## Legal safety rule (binding)

No Iraqi tax rate, legal form, filing form, or e-invoice requirement in this pack is final. `IQ_SALES_15` is explicitly named and commented as a placeholder; every `finance_localization_packs` row carries `legal_validation_status: 'pending'` until an accountant/legal reviewer signs off. This rule is recorded in `donor-license-ledger.md`, the migration's own header, and `installLocalizationPack`'s doc comment — three independent places, not just this evidence file.

## Files changed

- `database/migrations/018_tax_definition_and_calculation.mjs`
- `database/migrations/019_fiscal_positions_and_iraq_localization.mjs`
- `platform/finance/engine.mjs` (+11 exported functions)
- `platform/finance/index.mjs` (8 new handler registrations)
- `tests/phase03/finance-wave-c.test.mjs`

## Tests and results

| Test | Result |
|------|--------|
| Exclusive percent tax with default repartition | PASS |
| Price-included tax backs the base out of the gross price | PASS |
| Compound group applies child taxes on top of each other | PASS |
| Fiscal position resolves exemption (tax→NULL mapping) | PASS |
| Withholding: single-transaction threshold triggers/does not | PASS |
| Withholding: cumulative monthly threshold triggers across transactions | PASS |
| Tax-version change after posting does not affect an already-computed quote | PASS |
| Localization pack install is idempotent; reinstall/upgrade does not duplicate rows | PASS |
| Manual override: fiscal-position tax remapping changes the computed tax | PASS |
| Tax quote is callable through the action executor with no document side effect | PASS |

Command:

```bash
node tests/phase03/finance-wave-c.test.mjs
# 29/29 passed (10 of the 29 are tax/fiscal-position-specific)
```

## Worked example (compound group)

Base price 1,000, `GROUP` = `GROUP_A` (10%) then `GROUP_B` (5%) compound:

- `GROUP_A`: 1,000 × 10% = 100 (compound base now 1,100)
- `GROUP_B`: 1,100 × 5% = 55
- `total_tax` = 155, matches the posted test assertion exactly.

## Worked example (price-included)

Gross price 115, 15% price-included tax: `base = 115 / 1.15 = 100`, `tax = 15`. Matches the test assertion exactly.

## Scope boundary (explicit, not a gap)

`finance_tax:quote` is deliberately not wired into `postDocument`. The tax engine produces a quote; the caller (a future sales/purchase flow) turns the quote lines into ordinary `finance_document` lines and posts through the one existing posting authority. This preserves "no second... tax engine may exist" (Phase 03 Section 5) by construction — there is exactly one posting path regardless of whether tax was involved.
