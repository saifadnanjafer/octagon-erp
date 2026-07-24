# Procurement Lifecycle Integration

Backend path implemented and tested:

purchase order -> confirmation -> persistent fulfilment demand -> incoming picking -> executed receipt/valuation/GL -> received quantity projection -> line-level three-way match -> persisted exceptions/duplicate-invoice registry -> idempotent supplier-bill request through Phase 03.

Key paths:

- `platform/procurement/orders.mjs`
- `platform/procurement/matching.mjs`
- `platform/procurement/index.mjs`
- `platform/wms/operations.mjs`
- `tests/phase04/canonical_procurement.test.mjs`

Matching compares ordered, received, and billed quantities, unit price, discount, tax, currency, freight/tolerance inputs, and duplicate invoice reference. An unscoped direct PO confirmation is rejected.

Requisition/RFQ foundations are preserved. Budget commitments, payments, supplier returns/debit notes, service acceptance, complete UI parity, and actual open-procurement migration are not fully proven. Live writer/UI cutover remains blocked.
