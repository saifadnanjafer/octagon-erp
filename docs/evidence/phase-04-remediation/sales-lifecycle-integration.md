# Sales Lifecycle Integration

Backend path implemented and tested:

quotation -> confirmation -> persistent fulfilment demand -> source-line reservation -> delivery picking -> executed stock/valuation/GL -> delivered quantity projection -> idempotent fiscal invoice request through Phase 03.

Key paths:

- `platform/sales/orders.mjs`
- `platform/sales/index.mjs`
- `platform/wms/operations.mjs`
- `platform/inventory/operations.mjs`
- `platform/finance/engine.mjs`
- `tests/phase04/canonical_sales.test.mjs`

The invoice uses actually delivered, uninvoiced quantities and required income-account mapping. An unscoped direct confirmation is rejected by the legacy Wave D security regression.

Lead/opportunity foundations are preserved. Complete approval/payment/allocation/return/credit-note/profitability UI parity and actual open-sales migration are not proven. The live sales UI/writer cutover remains blocked.
