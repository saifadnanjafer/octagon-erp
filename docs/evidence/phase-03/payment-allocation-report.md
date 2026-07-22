# Wave D — Payments and Allocation Report

**Scope:** Packet 03.15 (payment documents/methods) and Packet 03.16 (allocation, advances, refunds, write-offs).
**Evidence date:** 2026-07-22

## What was implemented — payment documents

- `finance_payments` — one model for receive/pay/transfer, methods cash/bank/clearing, idempotency-key dedup (company-scoped), fee handling, provider-reference hook.
- `createPayment` builds balanced lines through the existing `createDocument` pipeline: `receive` debits cash net of fee + fee expense, credits the counter account for the gross amount; `pay` mirrors it; `transfer` debits the destination account net of fee, credits the source. All three balance regardless of whether a fee is present (verified by direct line-sum assertions, not just document-level balance).
- `postPayment` runs the existing submit→approve→post pipeline; `reversePaymentAction` requires the payment to be **fully unallocated first** (`unallocated_amount === amount`), then reuses `reverseDocument` — no second reversal mechanism.

## What was implemented — allocation, advances, refunds, write-offs

- `finance_payment_allocations` — append-only; `unallocatePayment` never deletes or edits a row, it inserts a reversing row linked via `reversed_allocation_id`, so lineage always survives (verified: 3 rows exist after allocate→unallocate→reallocate, not 1).
- `allocatePayment` decrements `finance_payments.unallocated_amount` with an atomic `UPDATE ... WHERE unallocated_amount >= ?` — over-allocation is denied by the database, not by a racy read-then-write in application code.
- `getOpenAmountForDocument` and Wave C's `openItemsFor` now subtract allocations too (`paymentAllocationsTotal`), completing the "full residual" AR/AP reconciliation Wave C explicitly deferred.
- `finance_write_offs` — resolves the document's actual receivable/payable control-account line (not a hardcoded account code) so the write-off posts against whatever account the original document really used; requires a non-empty reason.

## Files changed

- `database/migrations/022_payment_documents.mjs`
- `database/migrations/023_payment_allocation_and_writeoffs.mjs`
- `platform/finance/engine.mjs` (+`fx_revaluation`... `internal_transfer`/`write_off` document types, +`paymentAllocationsTotal`, +`getOpenAmountForDocument`, +11 exported functions; `creditNotesTotal` generalized to also net write-offs)
- `platform/finance/index.mjs` (+6 handler registrations)
- `tests/phase03/finance-wave-d.test.mjs`

## Tests and results

| Test | Result |
|------|--------|
| Duplicate payment reference replays instead of duplicating | PASS |
| Unsupported method rejected | PASS |
| Cross-currency payment posts balanced local/foreign totals | PASS |
| Fee posting reduces net cash without breaking balance | PASS |
| Internal transfer clears between two accounts | PASS |
| Reversal blocked until fully unallocated, then reverses cleanly | PASS |
| Over-allocation denied atomically; partial allocation leaves correct balance | PASS |
| Unallocate/reallocate preserves full lineage | PASS |
| Write-off requires a reason and posts a balancing document | PASS |
| Concurrent allocation attempts against the same payment cannot over-allocate | PASS |

Command:

```bash
node tests/phase03/finance-wave-d.test.mjs
# finance-wave-d: 22/22 passed (10 of the 22 are payment/allocation-specific)
```

## Reconciliation evidence (concurrency)

Two `Promise.allSettled` allocations of 300 each against a single 500-unallocated payment: exactly one succeeds, the other rejects with `ALLOCATION_EXCEEDS_PAYMENT`, and the payment's `unallocated_amount` never goes negative — proven by direct assertion after both settle, not inferred.
