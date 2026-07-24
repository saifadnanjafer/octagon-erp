# Current Authority Map

| Fact | Canonical backend owner now | Runtime status | Live UI/write status |
|---|---|---|---|
| Parties/products/UOM/pricing | `platform/commercial/**` | registered and raw-HTTP reachable | legacy arrays remain because cutover disabled |
| Warehouses/locations | `platform/inventory/warehouses.mjs` | registered and reachable | legacy pages/writers remain |
| Stock facts/balances | `platform/inventory/ledger.mjs`, `operations.mjs` | append-only operation path tested | operational legacy data not migrated |
| Reservations | `platform/inventory/reservations.mjs` | serialized ledger tested | legacy aggregate fields remain read/write |
| Traceability | `platform/inventory/traceability.mjs` | registered | UI parity not proven |
| Valuation | `platform/inventory/valuation.mjs` | AVCO/FIFO facts tested | opening valuation blocked |
| Stock accounting | `platform/finance/ports/stock-accounting.mjs` -> Phase 03 | atomic failure rollback tested | opening GL blocked |
| WMS/landed cost | `platform/wms/**` | registered; receipt-linked implementation | full UI/failure matrix incomplete |
| Sales | `platform/sales/**` | canonical confirmation/delivery/invoice tested | UI/legacy writer cutover blocked |
| Procurement | `platform/procurement/**` | receipt/match/AP tested | UI/legacy writer cutover blocked |
| POS | `platform/pos/**` + Phase 03 finance | payment/stock/fiscal/GL/cashbox/close tested | UI/legacy writer cutover blocked |
| Work Items | `platform/work_items/**` | canonical versioned engine tested | Task Manager/Kanban UI writers remain |
| Finance | Phase 03 `platform/finance/**` | preserved | legacy finance pages remain views/worklists |

The system therefore has one proved canonical backend path for new governed Phase 04 actions, but it does not yet have one exclusive live authority. Exclusive authority requires reconciliation, feature-flag activation, UI conversion, and writer denial.
