# Wave A — Fiscal Document Report

**Scope:** `FN-002` Unified fiscal-document family.
**Evidence date:** 2026-07-22

## What was implemented

- `finance_documents` header table with typed `move_type`, company, journal, currency, partner, source references, and lifecycle state (`draft`, `submitted`, `approved`, `posted`, `cancelled`, `reversed`).
- `finance_document_lines` table with account, debit/credit, foreign currency amounts, tax refs, dimensions, partner, description.
- Document lifecycle registered in `x_doc_state_defs` for `finance_document`.
- Engine functions: `createDocument`, `postDocument`, `reverseDocument`, `amendDocument`.
- No generic update/delete on posted documents; corrections use linked reversal or amendment.

## Document types supported in Wave A

- `manual_entry` — general journal entry
- `customer_invoice` / `customer_credit_note` / `supplier_bill` / `supplier_credit_note` — invoice family (typed but not yet full AR/AP tax)
- `cash_receipt` / `cash_payment` — cash documents
- `opening_entry`, `period_close`, `tax_adjustment`, `source_post` — extension points for later waves

## Files changed

- `database/migrations/014_finance_canonical_schema_and_coa.mjs`
- `platform/finance/engine.mjs`
- `platform/finance/index.mjs`
- `tests/phase03/finance-wave-a.test.mjs`

## Tests and results

| Test | Result |
|------|--------|
| Unbalanced document rejected | PASS |
| Post document assigns number and state | PASS |
| Reversal creates linked document | PASS |
| Amendment creates linked draft | supported by `amendDocument` (test in Wave B) |

Command:

```bash
node tests/phase03/finance-wave-a.test.mjs
```

## Source-composition note

VNext `fiscal_doc` → `finance_documents` / `finance_document_lines`.
Odoo `account_move` behavior used as clean-room reference for state rules and immutability.


## Wave B update

Wave B added the full document lifecycle and deepened period/lock/sequence semantics.

- Added `finance_document:create`, `finance_document:submit`, `finance_document:approve`, `finance_document:cancel` actions in migration `015_finance_document_lifecycle`.
- Engine now enforces `draft → submitted → approved → posted`.
- Cancellation is allowed from `draft`, `submitted`, or `approved`; not from `posted` (use reversal instead).
- Reversal document goes through the same lifecycle internally.

### Tests added

| Test | Suite | Result |
|------|-------|--------|
| Document lifecycle via engine | `finance-wave-b.test.mjs` | PASS |
| Post denied if not approved | `finance-wave-b.test.mjs` | PASS |
| Document lifecycle via action executor | `finance-wave-b.test.mjs` | PASS |
| Reversal preserves original immutability | `finance-wave-b.test.mjs` | PASS |

Command:

```bash
node tests/phase03/finance-wave-b.test.mjs
# PASS: 9/9
```
