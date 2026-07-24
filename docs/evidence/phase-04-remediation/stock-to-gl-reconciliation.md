# Stock-to-GL Reconciliation

New governed stock operations call `platform/finance/ports/stock-accounting.mjs`, which maps inventory input/output/COGS/adjustment/landed-cost facts into Phase 03 `postSourceFact`. Inventory code does not directly insert finance journal rows.

`canonical_stock.test.mjs` proves:

- successful receipt creates stock, valuation, and linked GL facts;
- injected finance-port failure rolls back stock, quant, valuation, audit, outbox, and idempotency;
- idempotent replay does not duplicate effects.

Actual-data reconciliation:

- source aggregate stock value: IQD 1,963,000;
- canonical inventory journal debit after migration: IQD 0;
- match: false.

The correct status is `BLOCKED`, not 100% matched. An approved opening-stock account/date/dimension/currency policy is required before a journal can be created.
