# VNext Salvage Ledger

The Phase 04 source attempt already contained domain structures attributed to earlier Commercial VNext work. This independent run did not copy additional VNext files.

| Pattern | Current Octagon destination | Decision |
|---|---|---|
| Party/product/UOM/pricing domain shape | `platform/commercial/**`, migrations 036/043 | preserve and harden |
| Stock ledger/valuation shape | `platform/inventory/**`, migrations 037/043 | preserve concepts; replace mutable/non-atomic behavior |
| WMS operations/landed cost | `platform/wms/**`, migrations 038/043 | preserve and link to canonical stock/GL |
| Sales/procurement | `platform/sales/**`, `platform/procurement/**` | preserve and complete source-line fulfilment/fiscal integration |
| POS | `platform/pos/**` | preserve and complete cash-shift/payment/stock/fiscal/GL transaction |

Authority always remains in this Octagon repository. VNext is not a runtime dependency, writer, database, or deployed service.
