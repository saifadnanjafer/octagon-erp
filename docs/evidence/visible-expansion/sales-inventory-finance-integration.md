# Sales → Inventory → Finance Integration

## Authority chain

The visible Sales workspace writes through registered `ActionExecutor` actions.
It reuses canonical Parties, Products, Pricing, Inventory, Reservations,
Valuation, Fiscal Documents, Finance, Audit, and Outbox authorities.

| Sales step | Canonical consequence |
|---|---|
| `sales_order:confirm` | creates the order, demand, reservation, and picking transition in one transaction |
| `sales_order:reserve` | calls the canonical stock-reservation authority and exposes shortage/partial reservation |
| `sales_delivery:create` | consumes the reservation through canonical WMS/Inventory and records valuation |
| `sales_invoice:request` | creates the fiscal/Finance request from fulfilled quantities |
| `sales_return:create` | restores stock and creates the linked credit-note consequence |

No customer, product, stock, invoice, payment, or ledger authority was added.

## Failure and concurrency proof

`tests/checkpoint-c/sales_lifecycle.test.mjs` proves:

- confirmation outbox failure leaves no order, reservation, demand, picking,
  audit, or idempotency residue;
- delivery outbox failure rolls back stock, reservation, picking, and event
  facts;
- invoice-request outbox failure rolls back fiscal, Finance, fulfilment, audit,
  and idempotency facts;
- duplicate approval and confirmation serialize to one winner;
- repeated idempotency keys replay one stored result.

The final Checkpoint C aggregate passed 100/100. Authenticated Chromium executed
quotation → approval → confirmation → reservation → delivery → invoice request
→ return, with visible stock and Finance links, in the 90/90 trace at
`test-artifacts/checkpoint-c-2026-07-28T07-34-22-151Z/`.
