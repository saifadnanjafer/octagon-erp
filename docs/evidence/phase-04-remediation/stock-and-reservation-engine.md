# Stock and Reservation Engine

Canonical implementation:

- `platform/inventory/ledger.mjs`: append stock move facts and rebuild quant projection;
- `platform/inventory/reservations.mjs`: reserve, partial reserve, release, expire, reallocate, consume, reverse with version/idempotency/source linkage;
- `platform/inventory/operations.mjs`: one coordinator for stock, reservation, valuation, Phase 03 GL, audit/outbox transaction ownership;
- `platform/inventory/traceability.mjs`: lot, serial, package facts;
- migration 043: immutable/source/reversal/linkage tables and triggers.

Proof:

- stock receipt is idempotent and rebuilds to the same balance;
- insufficient/over-reservation is rejected;
- partial reservation is explicit;
- injected finance-port failure leaves no move, quant, valuation, audit, outbox, or idempotency record;
- ActionExecutor outbox failure rolls back the business mutation.

Operational migration is blocked: 401 aggregate units and 86 reserved units lack source movement/reservation lineage. The engine is valid for governed new facts, but exclusive live authority is not activated.
