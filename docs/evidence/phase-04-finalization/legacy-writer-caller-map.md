# Legacy Writer → Caller Map

**Audit baseline:** `643d9300a87f1376091ecd957a297f91937ec66b`

Every entry below was resolved from source in this session. Line numbers are
against the files at this commit.

## 1. `services/stockService.js` — governed inventory writer

The single largest duplicate authority. It mutates Phase 04 governed facts
directly from the browser, bypassing `/api/v1` entirely, so none of the
canonical guarantees (server-derived scope, permission evaluation, atomic
domain transaction, audit, outbox, idempotency) apply to it.

### Write mechanics

| Mechanism | Location | Governed fact touched |
|---|---|---|
| `RecordService.create('stock_moves', …)` | `services/stockService.js:97` | `stock_moves` |
| `PentagonDB.mutate(db => …)` | `:118`, `:193` | move validation, quant deltas, reservations |
| `adjustQuant(db, …)` | `:72` | on-hand / reserved / available balances |
| `syncMainMaterialStock(db, …)` | `:61` | material master stock totals |

The browser therefore computes authoritative balances and reservation state
locally. This is the exact condition the Phase 04 gate forbids.

### Caller inventory — 16 call sites

| # | Caller file:line | Enclosing function | UI workflow | Legacy method | Canonical replacement |
|---|---|---|---|---|---|
| 1 | `app.js:26362` | `openV5StockMoveModal` | V5 stock move modal | `createStockMove` | `stock:move:post` |
| 2 | `app.js:26374` | `validateV5StockMove` | V5 move validation | `validateMove` | `stock:move:post` (draft→validate) |
| 3 | `app.js:26438` | `openV5InventoryAdjustmentModal` | V5 inventory adjustment | `createInventoryAdjustment` | `stock:move:post` (adjustment) |
| 4 | `app.js:35085` | `openNewTransferModal` | Inventory → new transfer | `createLot` | `stock:lot:create` |
| 5 | `app.js:35089` | `openNewTransferModal` | Inventory → new transfer | `createTransfer` | `stock:move:post` |
| 6 | `app.js:35160` | `validateTransferFrontend` | Transfer validation | `validateTransfer` | `wms:picking:validate` |
| 7 | `app.js:35170` | `cancelTransferFrontend` | Transfer cancel | `cancelTransfer` | `stock:reservation:release` + reversal |
| 8 | `app.js:35322` | `processBarcodeScanFrontend` | Barcode scan move | `createStockMove` | `stock:move:post` |
| 9 | `app.js:35335` | `processBarcodeScanFrontend` | Barcode scan validate | `validateMove` | `stock:move:post` |
| 10 | `app.js:35475` | `releaseReservationFrontend` | Release reservation | `releaseReservation` | `stock:reservation:release` |
| 11 | `app.js:35501` | `renderInventoryValuationSection` | Valuation display | `getMaterialValuation` | `GET /api/v1/inventory/valuation` |
| 12 | `app.js:35503` | `renderInventoryValuationSection` | FIFO valuation | `getMaterialValuation('fifo')` | `GET /api/v1/inventory/valuation` |
| 13 | `app.js:35504` | `renderInventoryValuationSection` | LIFO valuation | `getMaterialValuation('lifo')` | `GET /api/v1/inventory/valuation` |
| 14 | `app.js:35505` | `renderInventoryValuationSection` | AVCO valuation | `getMaterialValuation('avco')` | `GET /api/v1/inventory/valuation` |
| 15 | `omni-ux-v2.js:506` | UX v2 transfer flow | Alt shell transfer | `createTransfer` | `stock:move:post` |
| 16 | `omni-ux-v2.js:514` | UX v2 transfer flow | Alt shell validate | `validateTransfer` | `wms:picking:validate` |

`scripts/test-v5-services.mjs:134-149` also calls `StockService`, but it is a
test harness for the legacy service, not a production shell caller. It is
listed for completeness and is **not** a cutover target; it must be retired or
repointed only when the legacy service itself is removed.

### Classification

Entries 1–10 and 15–16 are **write** paths → `UNSAFE DUPLICATE WRITER`.
Entries 11–14 are **read** paths → may become `READ-ONLY TEMPORARY` projections
over the canonical valuation query.

## 2. Commercial master data — legacy arrays

`app.js` references `omni.materials` / `omni.customers` / `omni.suppliers` at
**79 sites**. These are browser-resident arrays persisted through full-state
`saveData()`, which is not a governed write path: no permission evaluation, no
audit row, no outbox event, no idempotency, no optimistic concurrency.

| Legacy store | Canonical authority | Canonical action | Canonical query |
|---|---|---|---|
| `omni.materials` | `platform/commercial/**` products | `product:template:create`, `product:variant:create` | `GET /api/v1/commercial/products` |
| `omni.customers` | `platform/commercial/**` parties (customer role) | `party:create` | `GET /api/v1/commercial/parties` |
| `omni.suppliers` | `platform/commercial/**` parties (supplier role) | `party:create` | `GET /api/v1/commercial/parties` |

Because the count is high and the call sites are heterogeneous (render, filter,
lookup, and write are interleaved), the cutover strategy is to introduce the
canonical client adapter first and convert **write** sites before **read**
sites, leaving reads on a read-only legacy projection until parity is proven.

## 3. Work Items — parallel task stores

| Legacy store | Canonical authority |
|---|---|
| `tasks` | `work_items` |
| `omni.kanban.cards` | `work_items` |
| `omni.taskManager` | `work_items` |
| work-order / helpdesk / QC task views | `work_items` projections |

All task-like surfaces must read and write through the single `work_item:*`
authority. No second task table or task service may be introduced.

## 4. Frozen zone — must never be touched

`employees`, `employee_advances`, `employee_payroll_closings`,
`payroll_payments`, `payroll_periods`, `omni.employeeAttendance`,
`omni.workshopAdvances`, `omni.workshopTimesheetCases`.

Read-only forever, by owner decision. No migration, no canonical port, no
writer retirement, no adapter. If a requirement appears to need a payroll
write, the requirement is wrong — stop and ask the owner.

## Cutover ordering implied by this map

1. Build the canonical client layer (Wave 1) — no behavior change yet.
2. Convert commercial **writes** (Wave 2), keep legacy reads as projections.
3. Convert inventory **writes** and explicit draft/validate lifecycle (Wave 3).
4. Convert sales / procurement / POS / Work Items (Wave 4).
5. Classify and dispose adapters (Wave 5).
6. Only then activate retirement locks — and only on a disposable database,
   never on the operational one, and never before browser parity passes.
