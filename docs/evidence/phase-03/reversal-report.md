# Wave A — Reversal Report

**Scope:** `FN-005` Linked reversals and adjustments.
**Evidence date:** 2026-07-22

## What was implemented

- `reverseDocument(dialect, ctx, { document_id, reverse_date, reason })` creates a new reversal document with swapped debit/credit lines, posts it, and links it to the original.
- Original document state moves to `reversed`; `reversal_id` points to the new document.
- `finance_reversal_links` table records `original_document_id`, `reversal_document_id`, `reversal_type`, `reason`.
- Reversal preserves the original document immutable.
- `amendDocument` creates a new draft document linked to the original/reversal via `source_type`/`source_id`; does not mutate the original.

## Files changed

- `platform/finance/engine.mjs` — `reverseDocument`, `amendDocument`.
- `database/migrations/014_finance_canonical_schema_and_coa.mjs` — `finance_reversal_links` table.
- `tests/phase03/finance-wave-a.test.mjs`.

## Tests and results

| Test | Result |
|------|--------|
| Reversal creates linked document | PASS |
| Original state becomes `reversed` | PASS |
| Trial balance net-zero after reversal | PASS |

Command:

```bash
node tests/phase03/finance-wave-a.test.mjs
```

## Reconciliation evidence

Original entry:
- Expense 800 debit / Cash 800 credit.

Reversal entry:
- Expense 800 credit / Cash 800 debit.

Net trial balance: zero for both accounts.
