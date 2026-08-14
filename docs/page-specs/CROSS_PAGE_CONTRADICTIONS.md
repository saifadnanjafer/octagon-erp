# Cross-page Contradictions and Boundaries

Catalog baseline: `aa730dd23462aab3e90b70ad2db1bf6cc945ca99`  
Engineering reference: `25c24df753962bbf3c13301eed71624bc0ee39b6`

## Findings

| ID | Boundary | Evidence | Required reconciliation |
|---|---|---|---|
| C-001 | Canonical stock authority | Receiving, picking, putaway, cross-dock, count adjustment, production material, and scrap modules request/acknowledge canonical results; their WMS tables store workflow state, not a second stock ledger. | Keep request, awaiting_canonical, acknowledged, and completed distinct; never describe a page action as direct stock posting unless the cited canonical handler proves it. |
| C-002 | Warehouse scope | `platform/api/build09.mjs` requires company context and validates active warehouse membership for every resource family. | Client labels and raw IDs are insufficient; every spec and browser proof must show warehouse isolation. |
| C-003 | Receiving versus putaway | Mobile Receiving completes at `putaway_pending`; Putaway Task Queue owns the subsequent physical destination task. | Do not mark a receipt complete merely because canonical Inventory posted the inbound move. |
| C-004 | Wave Planning versus Wave Execution | Planning creates/calculates/reviews; execution releases, refreshes, cancels, and completes. | Keep creator/reviewer and release boundaries separate in UI and acceptance evidence. |
| C-005 | Quality versus Inventory | Quality Hold, Rework, and Scrap decide or request dispositions; canonical Inventory owns stock movement. | Quality pages may acknowledge a verified canonical result but must not invent inventory authority. |
| C-006 | Operational Performance missing data | The performance renderer preserves null/unreliable rates as “not available” and explains the missing evidence. | Never convert absent timing/output evidence into 0% or 100%. |
| C-007 | Traceability identity | Trace queries require lot_id or serial_id and validate product/lot/serial consistency. | Identity mismatch is a validation error; it is not an empty trace. |
| C-008 | Mobile scanner flows | Mobile Receiving and Mobile Picking use stepwise scanning, while desktop queues use list/detail workspaces. | Share domain actions, not assumptions about controls or responsive proof. |

## Duplicate or consolidation candidates

None identified from source evidence. Shared tables/resources are intentional cross-page workflow dependencies, not proof that the primary pages are duplicates.

## Wave 3 findings

| ID | Boundary | Evidence | Required reconciliation | Severity |
|---|---|---|---|---|
| C-009 | Workshop readiness delivery authority | `platform/workshop/readiness-catalog.mjs` checks `sales_orders`, while canonical Sales order persistence and commercial reads use `sale_orders`. | Align the readiness check to the canonical authority or document a compatibility view; add a regression test. | P1 |
| C-010 | Sales Contracts versus canonical contract actions | `modules/sales-contracts.js` stores local objects and has no `/api/v1` call; `platform/sales/index.mjs` registers canonical `sales:contract:create/activate/suspend/terminate`. | Retire/migrate the local writer and choose one contract authority. | P0 |
| C-011 | Contracts versus Sales Contracts navigation | Two primary pages imply contract ownership, but their API/domain/table authority and business distinction are not recovered. | Owner decision required: one canonical contract home, one read view, or an explicit distinct contract taxonomy. | P0 |
| C-012 | Field Service financial handoff | `modules/field-service.js` writes local `omni.fieldService.visits` and calls an `addFinanceTransaction` bridge; canonical Finance owns documents/journals/source facts. | Route service completion through a canonical service source fact and Finance posting; prove customer/contract/warranty links. | P0 |
| C-013 | Workshop Ledger financial authority | `modules/workshop-ledger.js` imports `workshop_migration_data.json` and uses local finance helpers; Finance engine owns GL/journal/hash-chain persistence. | Freeze local financial writes and migrate legacy facts through an idempotent Finance source-document path. | P0 |
| C-014 | Installments versus AR | `modules/finance-installments.js` creates and pays browser-local plans; Finance exposes canonical AR open items, payments, and allocations. | Choose a canonical installment schedule model or retire the local writer; require source invoice and allocation references. | P0 |
| C-015 | Project task authority versus legacy job/task surfaces | Canonical Projects explicitly delegates task creation to Work Items, while legacy project-management/work-order surfaces expose task/job-like local records. | Mark legacy surfaces as adapters/retired and keep Work Items as the task authority. | P1 |
| C-016 | Sales-to-workshop handoff | Canonical Sales proves fulfilment and Finance invoice-request edges, but inspected sales lifecycle/order sources do not prove a workshop job/service source link. | Define and test accepted-sale-to-workshop/service creation or label the handoff manual/external. | P1 |
| C-017 | Workshop-to-procurement handoff | My Work aggregates operational sources and Procurement owns purchase requests/orders, but a direct material-shortage-to-purchase-request link was not verified in this wave. | Define source document/link and prove shortage-to-request-to-receipt flow. | P1 |
| C-018 | Procurement-to-finance handoff | Procurement exposes bill-request and three-way-match actions and Finance owns AP posting, but page-level bill lifecycle proof is incomplete. | Attach one receipt/match/bill/post flow with idempotency and supplier isolation. | P1 |
| C-019 | Field Service versus Work Orders | Field Service comments distinguish visits from in-house workshop jobs, but both remain adjacent operational pages with unclear canonical service-job vocabulary. | Publish glossary and ownership map before adding more actions. | P1 |

## Duplicate or consolidation candidates

- **High confidence:** local `sales_contracts`, `workshop_ledger`, and `finance_installments` are migration/retirement candidates because their write surfaces conflict with canonical domains.
- **Owner decision:** `contracts` versus `sales_contracts`; `customers` versus `parties` if Customers is only a finance-filtered party view.
- **Do not consolidate solely on shared tables:** Sales, Procurement, Projects, WMS, and Finance intentionally share handoff entities while retaining separate lifecycle ownership.
