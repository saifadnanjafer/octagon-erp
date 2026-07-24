# Legacy Writer Retirement

Status: **IMPLEMENTED AS A DORMANT STRANGLER; NOT RETIRED**

`server.js` maps protected legacy paths to:

- `COMMERCIAL_CANONICAL_AUTHORITY_REQUIRED`
- `INVENTORY_CANONICAL_AUTHORITY_REQUIRED`
- `SALES_CANONICAL_AUTHORITY_REQUIRED`
- `PROCUREMENT_CANONICAL_AUTHORITY_REQUIRED`
- `POS_CANONICAL_AUTHORITY_REQUIRED`
- `WORK_ITEM_CANONICAL_AUTHORITY_REQUIRED`

It guards `/api/db`, `/api/collection`, and `/api/record`, including bulk/full-state writes. Finance protection remains active from Phase 03. Phase 04 protection activates only when `phase04.canonical_cutover` is enabled.

The flag is intentionally disabled. Therefore `omni.materials`, stock service writes, legacy quants/moves/transfers/reservations, customer/supplier/sales/purchase/POS/task arrays, Kanban mutation, and protected generic CRUD are not claimed retired.

Removal criterion: successful migration/reconciliation, read parity, real browser proof, action/runtime security proof, then explicit cutover activation.
