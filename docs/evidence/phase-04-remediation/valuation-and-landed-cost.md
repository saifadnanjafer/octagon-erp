# Valuation and Landed Cost

`platform/inventory/valuation.mjs` now records append-only valuation facts and projections. AVCO receipts append facts rather than rewriting history. FIFO consumption selects oldest eligible layers and writes explicit consumption links; insufficient layers fail.

`platform/wms/landed_cost.mjs` requires actual receipt linkage, supports quantity/weight/volume/current-value/equal/custom bases, appends adjustments, and invokes the canonical stock-accounting path.

Executable proof includes Wave B AVCO/FIFO, canonical stock atomicity, migration rollback/failure, and existing Wave C landed-cost allocation. The complete requested backdating/currency/return/reversal/concurrency matrix is not fully proven and remains a risk.

Actual legacy valuation is blocked: IQD 1,963,000 is an aggregate material value without executed layers or approved opening accounting policy. Canonical migrated valuation is 0 by design.
