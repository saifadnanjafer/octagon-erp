# Page and Module Consolidation Matrix

These are audited target dispositions, not completed cutover claims. Current cutover status for every Phase 04 page is `BLOCKED` because `phase04.canonical_cutover` is disabled.

| Page/module | Source surface | Target class | Canonical authority/view | Current decision |
|---|---|---|---|---|
| Command Center | `index.html`, `app.js` | PRIMARY WORKSPACE | Work Item/inventory/finance projections | retain shell; cutover blocked |
| Kanban | `app.js`, metadata | SPECIALIZED VIEW | Work Items by stage/status | merge legacy writer; blocked |
| Workflow | `app.js`, workflow modules | CONFIGURATION | workflow definitions/runtime; linked Work Items | keep distinct from task authority |
| Operation Packs | operation-pack modules | SPECIALIZED VIEW | creates canonical Work Items | adapter parity not proven |
| Work Orders | work-order views/arrays | SPECIALIZED VIEW | Work Items filtered by source | 3 records migrated; UI blocked |
| Task Manager | metadata/task views | PRIMARY WORKSPACE | Work Items | 5 records migrated; UI blocked |
| Projects | project modules | SPECIALIZED VIEW | project-filtered Work Items | conversion pending |
| Helpdesk | helpdesk modules | ROLE VIEW | helpdesk-filtered Work Items | conversion pending |
| Field Service | field-service views | MOBILE VIEW | source-filtered Work Items | conversion pending |
| QC rework | QC views | ROLE VIEW | QC-filtered Work Items | conversion pending |
| Maintenance tasks | maintenance views | ROLE VIEW | maintenance-filtered Work Items | conversion pending |
| Employee Mobile Tasks | mobile task view | MOBILE VIEW | assigned Work Items | responsive parity pending |
| Workshop TV | TV view | DASHBOARD | active Work Item projection | conversion pending |
| Calendar | calendar view | SPECIALIZED VIEW | Work Item dates | conversion pending |
| Finance Dashboard | finance shell | DASHBOARD | Phase 03 finance queries | preserve Phase 03 |
| Cashbox | cashbox view | SPECIALIZED VIEW | Phase 03 cashboxes/shifts/payments | POS links implemented; UI preserve |
| Workshop Ledger | ledger view | REPORT | workshop-filtered Phase 03 GL | no second ledger |
| Expenses | expense arrays/view | SPECIALIZED VIEW | fiscal-document worklist | conversion pending |
| Income | income arrays/view | SPECIALIZED VIEW | fiscal-document worklist | conversion pending |
| Customer Balances | customer-balance view | REPORT | Phase 03 AR | convert to canonical query |
| Supplier Balances | supplier-balance view | REPORT | Phase 03 AP | convert to canonical query |
| Receipt Creation | receipt print view | REPORT | fiscal/payment output | no ledger ownership |
| Banking | banking view | PRIMARY WORKSPACE | Phase 03 reconciliation | preserve |
| AR/AP | AR/AP views | PRIMARY WORKSPACE | Phase 03 partner ledgers | preserve |
| Budgeting | budget view | PRIMARY WORKSPACE | Phase 03 budget/commitment | procurement commitment parity pending |
| Installments | installment view | SPECIALIZED VIEW | Phase 03 payment schedules | convert |
| POS financial screens | POS/cash views | ROLE VIEW | POS links + Phase 03 cashbox/GL | backend integrated; UI blocked |
| Materials | material view/`omni.materials` | SPECIALIZED VIEW | product query filtered as materials | legacy write remains; blocked |
| Inventory | inventory view/stock service | PRIMARY WORKSPACE | balances and governed operations | legacy write remains; blocked |
| Advanced Inventory | advanced inventory views | REPORT | valuation/traceability/worklists | blocked |
| Products | product views | PRIMARY WORKSPACE | canonical product master | backend ready; blocked |
| Equipment | equipment/material views | SPECIALIZED VIEW | product/equipment projection | parity pending |
| Retail catalog | retail arrays | ROLE VIEW | canonical product/pricing query | conversion pending |
| POS catalog | POS product arrays | ROLE VIEW | canonical products/pricing/tax | backend ready; blocked |
| Sales product views | sales arrays | SPECIALIZED VIEW | canonical products/pricing | backend ready; blocked |
| Procurement product views | supplier/material arrays | SPECIALIZED VIEW | canonical products/supplier pricing | backend ready; blocked |
| Warehouses | warehouse views | CONFIGURATION | canonical warehouse/location query | backend ready; blocked |
| Transfers | transfer arrays | PRIMARY WORKSPACE | WMS picking and stock operations | legacy write remains; blocked |
| Reorder previews | reorder view | REPORT | replenishment proposal | proposal parity not implemented |
| Customers | customer arrays | SPECIALIZED VIEW | parties with customer role | legacy write remains; blocked |
| Suppliers | supplier arrays | SPECIALIZED VIEW | parties with supplier role | legacy write remains; blocked |
| Sales | CRM/sales views | PRIMARY WORKSPACE | canonical sales query/actions | backend integrated; blocked |
| Procurement | procurement views | PRIMARY WORKSPACE | canonical procurement query/actions | backend integrated; blocked |
| POS | POS view | PRIMARY WORKSPACE | canonical POS actions and Phase 03 finance | backend integrated; blocked |

No page is assigned `HIDE` or `ARCHIVE` because parity/cutover has not passed. Deep links, Arabic RTL, English LTR, role views, mobile behavior, and workshop terminology must be verified during the future acceptance cutover.
