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

## Wave 4 findings

| ID | Boundary | Evidence | Required reconciliation | Severity |
|---|---|---|---|---|
| C-020 | Legacy cashbox/expense/income writers versus Finance | `app.js` maintains local `finance.transactions` and `addFinanceTransaction` helpers while Finance engine owns canonical documents/journals. | Freeze or migrate local financial writers through Finance source facts; distinguish legacy reconciliation from posted truth. | P0 |
| C-021 | Finance page family versus canonical API | Finance API/domain and extensive finance tests exist, but many primary finance pages have no page-specific API/module evidence. | Map each page to a canonical query/action or classify it as a report/view/retirement candidate. | P1 |
| C-022 | Consolidation pages versus consolidation domain | `platform/consolidation/index.mjs` and Build-08 tests exist, but group/run/report/lineage/elimination pages are not individually wired in evidence. | Establish one canonical group/run write home and read-only report/lineage children. | P1 |
| C-023 | Treasury pages versus planning domain | Treasury/liquidity domain exists, but forecast, alert, cash-position, facility, and funding-proposal page lifecycles are not directly proven. | Define forecast freshness, approval, execution, and Finance source-reference contracts. | P1 |
| C-024 | Intercompany pages versus reconciliation/consolidation | Intercompany operations and tests exist, but page-level transaction-to-mismatch-to-reconciliation edges are not verified. | Prove company-pair isolation, matching, reconciliation, and ledger/consolidation lineage. | P1 |
| C-025 | Workflow canvas versus durable runtime | `app.js` local canvas helpers/localStorage coexist with durable WorkflowRegistry/WorkflowRuntime definitions, versions, leases, and instances. | Make the canvas an adapter and prove publish-to-run persistence, frozen-zone enforcement, and idempotency. | P0 |
| C-026 | Service Kiosk versus service/kiosk authorities | Kiosk and service domain/tests cover registry, entitlement, signatures, and offline boards, while page-level route wiring is not fully identified. | Prove device/session/entitlement to service-action handoff and offline recovery. | P1 |
| C-027 | Tax Compliance versus Finance posting | Tax module and Finance authority coexist, but tax-period calculation/submission/source lineage is not fully attributed to the page. | Prove tax report lifecycle, amendments, and Finance source-document links. | P1 |
| C-028 | Content Approvals versus generic Approvals | Content Approvals is a separate primary page while approval domain ownership and content target records are not identified. | Make it a target-specific child/view or document a distinct content approval authority. | P2 |
| C-029 | Purpose overlap in consolidation pages | Groups, runs, reports, lineage, and eliminations are separately navigable but their user-goal hierarchy is unclear. | Publish a bounded consolidation hierarchy and avoid parallel writes. | P2 |

## Consolidation candidates

- Local Cashbox, Expenses, and Income should be migrated into Finance or explicitly retained as non-posting legacy views.
- Workflow should retain its page only as the durable runtime’s governed definition/monitoring home; local canvas storage must not remain a parallel authority.
- Consolidated Reports and Consolidation Lineage are likely read-only children; Consolidation Groups and Runs are the candidate canonical writes.
- Content Approvals may be a filtered child of Approvals unless owner evidence proves a separate content lifecycle.
