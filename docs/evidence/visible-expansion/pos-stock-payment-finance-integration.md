# POS → Stock → Payment → Finance Integration

## Atomic authority chain

The visible POS workspace uses the canonical POS session/order handlers and one
transactional chain:

`POS order → payment → stock → valuation → tax/fiscal → Finance → cashbox → audit → outbox → session state → commit`.

The handlers reuse canonical Products, Pricing, Inventory, Valuation, Payments,
Fiscal Documents, Finance, Cashbox, Audit, and Outbox. No second stock, payment,
tax, cash, or ledger authority exists.

## Rollback and serialization proof

`tests/checkpoint-c/pos_atomic_lifecycle.test.mjs` injects failures at payment,
stock, valuation, Finance, cashbox, audit, and outbox. Each failure leaves no
completed sale, payment, stock movement, GL entry, incorrect cash balance,
audit event, outbox event, or idempotency residue.

The same suite proves:

- a repeated sale/payment idempotency key produces one fact set;
- simultaneous limited-stock sales serialize safely;
- session-close cashbox failure rolls back the close;
- refund restores stock and posts the linked payment/credit consequence.

Authenticated Chromium executed session open, catalogue/barcode lookup,
split cash/card sale, fiscal receipt, return/refund, reconciliation, and close.
The final result is 90/90 using Chrome 150.0.7871.24; trace:
`test-artifacts/checkpoint-c-2026-07-28T07-34-22-151Z/`.
