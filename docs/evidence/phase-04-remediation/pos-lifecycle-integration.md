# POS Lifecycle Integration

`platform/pos/session.mjs` implements a governed transaction:

cash-shift ownership -> POS session -> canonical customer/product/pricing/tax -> payment configuration -> stock operation -> fiscal/GL posting -> cashbox link -> paid order -> counted close.

`tests/phase04/canonical_pos.test.mjs` proves the success path and injected rollback: after the injected failure, no paid order, stock deduction, fiscal link, GL effect, or cashbox close survives. The legacy Wave F test now verifies that a cashier cannot open a POS session without an active owned Phase 03 cash shift.

Idempotency keys cover POS and per-line stock effects; payment totals must equal the server-computed fiscal total. Session/cash-shift cashier identity is server context.

Offline replay UI, complete payment-method/cash-difference approval matrix, actual source POS reconciliation, and browser checkout remain unproven. Live POS cutover is blocked.
