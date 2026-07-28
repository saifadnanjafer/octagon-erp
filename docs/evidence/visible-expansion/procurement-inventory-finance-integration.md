# Procurement → Inventory → Finance Integration

## Authority boundaries

Procurement owns requests, requisitions, RFQs, supplier quotations, comparison,
purchase orders, commitments, receipt/quality lineage, match facts, returns,
and scorecards. It does not create parallel stock, AP, supplier-balance, or
payment authorities.

| Procurement transition | Canonical authority used | Atomic consequence |
|---|---|---|
| Confirm purchase order | Inventory / WMS | incoming picking and fulfilment demand |
| Post full or partial receipt | Inventory ledger and valuation | stock move, quant, valuation, receipt event, quality fact, optional backorder |
| Run three-way match | Procurement match policy over PO/receipt/invoice facts | matched result or explicit line-level exceptions |
| Create supplier bill request | Finance fiscal documents | posted supplier bill and closed commitment |
| Return accepted goods | Inventory plus Finance | reverse stock move and supplier credit/debit-note request |

## Failure and concurrency proof

- receipt outbox failure rolls back stock, fulfilment, picking, receipt event,
  audit, and idempotency;
- purchase-order approval outbox failure leaves neither approval nor
  commitment;
- repeated idempotency keys return one fact set;
- duplicate purchase-order approval and duplicate receipt each have exactly one
  winner;
- company scope fails closed for requests, RFQs, orders, and reads;
- a bill request is rejected until a clean line-level three-way match exists.

## Data safety

Chromium acceptance ran against the authenticated disposable preview launcher.
It staged byte copies of SQLite, WAL, SHM, and JSON to the OS temporary
directory, migrated and mutated only that copy, and seeded only throwaway test
identities. Operational hashes after C2 are identical to the C1 baseline.

The missing owner-approved opening inventory accounting date remains
fail-closed and was not invented. It is unrelated to the disposable C2 proof.

## C6 rollback closure

Injected three-way-match outbox failure leaves no match header, lines, variance
exceptions, invoice registry, audit, outbox, or idempotency residue.
Supplier-bill outbox failure leaves no fiscal, Finance, commitment/order,
audit, outbox, or idempotency residue. The final aggregate is 100/100.
