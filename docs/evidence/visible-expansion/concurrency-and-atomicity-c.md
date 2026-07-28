# Checkpoint C Concurrency and Atomicity

## Final deterministic result

Command:

`$files = Get-ChildItem tests/checkpoint-c -Filter '*.test.mjs'; node --test $files`

Result: **100 passed, 0 failed, 0 skipped**, 24.5 seconds.

## Proven rollback boundaries

| Domain | Injected boundary | No partial state proven |
|---|---|---|
| Sales | confirmation outbox | order, demand, reservation, picking, audit, idempotency |
| Sales | delivery outbox | stock, reservation, picking, delivery event, audit |
| Sales | invoice-request outbox | fiscal document, Finance, fulfilment, audit, idempotency |
| Procurement | PO approval outbox | approval, commitment, audit, idempotency |
| Procurement | receipt | stock, fulfilment, picking, event, audit, idempotency |
| Procurement | match outbox | match header/lines, exceptions, invoice registry, audit, idempotency |
| Procurement | supplier-bill outbox | fiscal, Finance, commitment/order, audit, idempotency |
| POS | payment/stock/valuation/Finance/cashbox/audit/outbox | sale, payment, stock, GL, cashbox, audit, outbox, session |
| Work Item | transition outbox | work item version/state, audit, outbox, idempotency |
| Control Plane | control mutation outbox | module/feature/license/assignment state, audit, outbox, idempotency |
| Migration 051 | policy update | migration remains unapplied; migration 050 facts remain intact |

## Proven concurrency and idempotency

- duplicate quotation approval and sales confirmation: one winner;
- simultaneous reservation: no over-allocation, partial reserve explicit;
- duplicate PO approval and receipt: one fact set;
- simultaneous POS sale for limited stock: serialized safely;
- repeated POS payment/sale key: one result;
- duplicate Work Item transition and Kanban movement: stale version denied;
- Control Plane repeated key: replay; changed payload fails closed;
- migration runner dependency and concurrent-lock behavior remains green.

SQLite executable proof uses `BEGIN IMMEDIATE` on disposable databases.
PostgreSQL-compatible schema design is present, but PostgreSQL execution is not
claimed.
