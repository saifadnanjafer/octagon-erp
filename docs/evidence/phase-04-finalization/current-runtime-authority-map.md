# Current Runtime Authority Map

**Audit baseline:** `643d9300a87f1376091ecd957a297f91937ec66b`

Status values describe **current runtime truth**, verified from source in this
session — not intended architecture and not inherited narrative.

## Canonical HTTP contract (verified)

| Aspect | Value | Source |
|---|---|---|
| Prefix | `/api/v1` | `server.js:2704`, `platform-runtime-bridge.mjs:528` |
| Queries | `GET /api/v1/{namespace}/{resource}[/{id}]` | `platform/api/index.mjs:156-170` |
| Commands | `POST /api/v1/action/{actionId}` | `platform/api/index.mjs:172-201` |
| Envelope | `{ success, data, error, meta, correlationId }` | `platform/api/index.mjs:44-46` |
| Correlation | `x-correlation-id` header or `?correlation_id=` | `platform-runtime-bridge.mjs:550` |
| Idempotency | `x-idempotency-key` header → `body.idempotency_key` | `platform/api/index.mjs:182` |
| Governed denial | 403 on `AUTHORITY|PERMISSION|NO_GRANT|DENIED`, else 422 | `platform/api/index.mjs:191-198` |

### Identity is server-derived — verified

`resolveApiContext` (`platform-runtime-bridge.mjs:541-554`) builds context
**only** from the `octagon_session` cookie via `resolveContextFromRequest`
(`:247-276`). That function calls `stripUntrustedContext(opts.requestBody)`
(`:254`), so caller-supplied identity fields cannot override session-derived
scope. `companyId`/`branchId` come from `session.activeCompanyId` /
`activeBranchId`, which are written only by `handleContextSwitch` after an
explicit membership check (`:464-488`). No session → `null` → HTTP 401.

**Consequence for the client layer:** the browser must send
`credentials: 'same-origin'` and must never transmit actor, tenant, company,
branch, role, or permission. Those are already unspoofable at the API boundary.
The remaining exposure is not the API — it is the legacy in-browser writers
below, which bypass the API entirely.

## Registered canonical actions (Phase 04 scope)

Enumerated from `platform/**` source and confirmed against the Phase 04 test
suite.

| Domain | Action IDs |
|---|---|
| Parties | `party:create` |
| Products/UOM | `product:template:create`, `product:variant:create`, `uom:create` |
| Warehouses/locations | `warehouse:create`, `stock:location:create` |
| Stock movement | `stock:move:post`, `stock:quants:rebuild` |
| Traceability | `stock:lot:create`, `stock:serial:create`, `stock:package:create` |
| Reservations | `stock:reservation:reserve`, `:release`, `:consume`, `:expire`, `:reallocate`, `:reverse` |
| WMS | `wms:picking:validate` |
| Sales | `sales:quotation:create`, `sales:order:confirm`, `sales:invoice_request:create` |
| Procurement | `procurement:order:create`, `procurement:order:confirm`, `procurement:threewaymatch:perform`, `procurement:bill_request:create` |
| POS | `pos:session:open`, `pos:session:close`, `pos:order:process` |
| Work Items | `work_item:create`, `work_item:update`, `work_item:approve`, `work_item:delete` |

## Registered canonical query resources

From `platform/api/commercial.mjs:31-139`:

`parties`, `products`, `uoms`, `warehouses`, `locations`, `quants`/`balances`,
`inventory/operations`, `inventory/reservations`, `inventory/valuation`,
`inventory/{lots,serials,packages}`, `sales/orders`, `procurement/orders`,
`pos/orders`, `work-items`.

Finance queries are separate, via `platform/api/finance.mjs`
(`GET /api/v1/finance/*`).

## Authority table

| Domain / fact | Canonical authority | Legacy writer still active | Runtime status | Required disposition |
|---|---|---|---|---|
| Platform registries | `platform/kernel/**` | platform runtime bridge | Canonical mounted | Preserve, regression-test |
| Identity / session / permissions | `platform/governance/**`, `platform-runtime-bridge.mjs` | compatibility projections | Canonical mounted; server-derived scope verified this session | No change needed for scope safety |
| Finance documents / GL | `platform/finance/**` | `services/financeService.js` | Server-authoritative selection already closed via `__octagonBootstrap.cutover.finance.enforced` | Model to follow for other domains |
| Parties / products / pricing | `platform/commercial/**` | legacy arrays + full-state `saveData()` | **Duplicate active authority** | Build client adapter, then retire writer |
| Inventory moves / quants / valuation | `platform/inventory/**`, `platform/finance/ports/stock-accounting.mjs` | `services/stockService.js`, `modules/phase6a-core.js` | **Duplicate active authority** | Build client adapter, then retire writer |
| Reservations | `platform/inventory/reservations.mjs` | reservation arrays in `services/stockService.js` | **Duplicate active authority** | Canonicalize reserve/release/read |
| Sales / CRM | `platform/sales/**` | legacy sales/CRM collections | Backend exists; shell not cut over | Client adapter + browser parity |
| Procurement | `platform/procurement/**` | legacy PO/supplier collections | Backend exists; shell not cut over | Client adapter + browser parity |
| POS | `platform/pos/**` | legacy POS collections | Backend exists; shell not cut over | Client adapter + browser parity |
| Work Items | canonical `work_items` | `tasks`, `omni.kanban.cards`, `omni.taskManager` | Backend exists; views persist legacy state | Convert views to projections |
| Audit / outbox / idempotency | kernel runtime transaction | legacy audit helpers | Canonical for platform actions; legacy mutations create parallel evidence | Retire legacy governed mutations |
| Manufacturing / projects / assets | none on this branch | legacy modules | Phase 05 work exists only on `phase-05/...` branch (`cd86a05`), not here | Out of scope until Phase 04 gate passes |
| Payroll / attendance / timesheet | frozen legacy | existing legacy runtime | Sole preserved authority by owner decision | **Read-only forever; no migration, no write** |

## Cutover control

`platform/cutover/legacy-writer-retirement.mjs` is the runtime authority for
Phase 04 legacy-writer denial; `server.js` consults `enforced(domain)`. Finance
generic-write denial is unconditional (`server.js:1955`). A Phase 04 domain is
denied only when the global cutover flag **and** its exact retirement
lock/target agree — a two-key design proven by
`tests/phase04/remediation_phase04.test.mjs`.

Read-only inspection found no Phase 04 cutover flag row and no Phase 04
opening/retirement tables in the operational database. This is correct and
intentional: the operational database must not be migrated or cut over
automatically.

## Authority invariant

One business fact may have many read projections but exactly one write
authority. A feature flag stages a strangler cutover; a flag is **not** a
closure. The original shell, server guards, data migration, browser flow, and
rollback must all agree on the same authority before a domain is considered cut
over.
