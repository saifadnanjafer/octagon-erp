# Canonical Authority Map — Wave 3

Engineering reference: `25c24df753962bbf3c13301eed71624bc0ee39b6`
Confidence is bounded by direct source evidence at that SHA.

| Business object / capability | Canonical authority | Primary page(s) | Tables/entities | Evidence | Conflict / unknown |
|---|---|---|---|---|---|
| Customer/supplier party identity | `platform/commercial/parties.mjs` | Parties; Customers | `parties`, `party_roles`, addresses | Commercial API and canonical party module/actions | Customers may be a duplicate view; owner decision for write surface. |
| Quotation/sales order | `platform/sales/orders.mjs` and lifecycle | Sales | `sale_orders`, lines, fulfilment demands | Sales action registry and persistence source | Readiness uses plural `sales_orders` mismatch. |
| Sales contract | `platform/sales/contracts.mjs` intended | Sales Contracts | canonical contract candidate tables | Canonical action registry exists | Current page writes local objects; P0 conflict. |
| Generic task/work item | canonical Work Items | Task Manager; Projects | `work_items`, assignments/comments | Projects source explicitly delegates task creation | Legacy project/task/job surfaces overlap. |
| Project | `platform/projects/*` | Projects | projects, phases, milestones, budgets, billing | Canonical project API/domain | Legacy project-management local fixtures remain visible. |
| Workshop assigned work aggregation | `platform/workshop/my-work-sources.mjs` | My Work | seven explicit source tables | Source registry and scope predicates | Completion/de-duplication across sources needs proof. |
| Workshop job/work order | NOT RESOLVED | Work Orders; service/workshop pages | `work_orders`, shop-floor sessions, possible work items | Page title and adjacent modules only | P1 vocabulary/ownership conflict. |
| Material requirement | Build-09 material-flow authority candidate | Workshop/production and Procurement | material request/shortage entities | Existing Build-09 evidence and procurement domain | Direct procurement request edge not verified. |
| Purchase request/requisition | `platform/procurement/governance.mjs` and lifecycle | Procurement | purchase requests, requisitions, lines | Approval conversion source | Supplier Portal participant boundary incomplete. |
| Purchase order/receipt/return | `platform/procurement/orders.mjs` and lifecycle | Procurement; Logistics | purchase orders, fulfilment demands, pickings, receipts, returns | Exact lifecycle persistence source | Complete AP posting proof pending. |
| Stock movement | Inventory/WMS canonical operations | Logistics; Sales; Procurement | stock pickings/moves/locations/reservations | Sales/procurement call canonical stock operations | Logistics page-specific wiring incomplete. |
| Quality receipt/checkpoint | Quality operational authority | Procurement; Workshop readiness | quality checks/plans/checkpoints | Procurement receipt creates quality checks; readiness consumes catalog | Cross-page browser proof pending. |
| Delivery | Sales fulfilment + WMS picking | Sales; Logistics; Customer Portal | sale fulfilment demands, stock pickings | Sales order confirmation/delivery source | Workshop/service delivery link unknown. |
| Project billing | Projects request; Finance posting | Projects; Finance | project billing requests, finance source facts/documents | Billing approve injects `postSourceFact` | Customer contract/source origin needs proof. |
| AR/AP/GL | `platform/finance/engine.mjs` | Finance; AR/AP | finance documents/journals/payments/reconciliation | Finance engine and action registry | Legacy finance-like writers conflict. |
| Field visit/service job | NOT RESOLVED; current local `omni.fieldService` | Field Service | local visits and finance bridge | Module source | P0 authority conflict. |
| Workshop ledger/payroll-like fact | Finance intended; current local migration writer | Workshop Ledger; Finance | migration JSON/local transactions vs finance documents | Module source and Finance engine | P0 authority conflict. |
| Installment schedule/payment | Finance AR intended; current local plan | Finance Installments; AR/AP | local plans vs finance documents/payments | Module source and Finance actions | P0 authority conflict. |
| Workshop readiness | Read-only evaluator | Workshop Readiness | readiness catalog authorities | readiness.mjs/catalog | Table-name mismatch for Sales delivery. |
