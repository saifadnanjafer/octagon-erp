# Canonical Business Fact Register

Independent status at 2026-07-24. A target disposition is not a completed cutover. `phase04.canonical_cutover` is disabled; every legacy retirement below is conditional on a reconciled migration and browser parity.

Abbreviations: `P` = `platform/commercial`; `I` = `platform/inventory`; `W` = `platform/wms`; `S` = `platform/sales`; `R` = `platform/procurement`; `O` = `platform/pos`; `T` = `platform/work_items`; `F3` = Phase 03 finance.

| Fact | Current representation / readers / writers | Canonical owner, table, command, query | Migration and parity/reconciliation rule | UI / disposition / retirement |
|---|---|---|---|---|
| Parties | customer/supplier arrays and collections; generic CRUD | P; `parties`; `party:create`; `/api/v1/commercial/parties` | stable source map; source roles/count = canonical | customer/supplier views; **MERGE INTO CANONICAL**; deny legacy writes only after pass |
| Customers | `finance.customers`, sales arrays | P; `party_roles(customer)`; `party:create`; parties role filter | one role per source key; 1 source customer included in 7/7 parties | Customers; **READ-ONLY COMPATIBILITY** until cutover |
| Suppliers | `omni.suppliers`, procurement arrays | P; `party_roles(supplier)`; `party:create`; parties role filter | 6 source suppliers included in 7/7 parties | Suppliers; **READ-ONLY COMPATIBILITY** until cutover |
| Contacts | legacy contact fields/arrays | P; `contacts`; party command family; party detail query | migrate only source-backed fields; no invented contacts | Party detail; **MERGE INTO CANONICAL** |
| Addresses | legacy address fields/arrays | P; `addresses`; party command family; party detail query | source-key uniqueness and count parity; no source proof in current rehearsal | Party detail; **DEFER WITH REASON**: source did not expose address facts |
| Products | product/material/POS/retail arrays | P; `product_templates`, `product_variants`; product create actions; products query | stable map, SKU uniqueness, 8/8 parity | Products/Materials/POS catalog; **MERGE INTO CANONICAL** |
| Materials | `omni.materials`, `material.stock` writers | P; product tables; product create; products query | 8/8 product parity; stock fields excluded from authority | Materials filtered view; **READ-ONLY COMPATIBILITY** until stock pass |
| Services | service arrays | P; `product_templates(type=service)`; product create; products query | source count/type parity; no stock facts | Sales/procurement catalog; **MERGE INTO CANONICAL** |
| Categories | material category strings/arrays | P; `product_categories`; category create; products query | normalized stable key; 4 migrated | Product config; **MERGE INTO CANONICAL** |
| Variants | product/material rows | P; `product_variants`; variant create; products query | source key and SKU uniqueness; 8 migrated | Catalogs; **KEEP AS CANONICAL** |
| UOMs | localized unit strings/arrays | P; `uom_categories`, `uoms`; `uom:create`; UOM query | normalized keys/conversion class; 5 migrated | Product config; **MERGE INTO CANONICAL** |
| Barcodes | product/POS barcode fields | P; `product_barcodes`; product actions; barcode query | uniqueness and duplicate rejection; source count 0 | Product/POS; **KEEP AS CANONICAL** |
| Prices | material cost, supplier catalog, retail prices | P; `price_lists`, `price_list_items`; pricing list create; pricing query | source list/item counts 6/8; explanation parity | Sales/POS/procurement; **MERGE INTO CANONICAL** |
| Warehouses | `omni.warehouses`, arrays | I; `warehouses`; `warehouse:create`; warehouse query | source key/company scope; 1/1 | Inventory config; **MERGE INTO CANONICAL** |
| Locations | `locations`, warehouse-stock map keys | I; `stock_locations`; location create; location query | source key/usage/company; 4/4 | Inventory; **MERGE INTO CANONICAL** |
| Quantities | `material.stock`, `omni.warehouseStock`, quants | I; `stock_moves` facts + `stock_quants` projection; stock move; balances query | rebuild equals executed moves; current 401/0 fails | Inventory balances; **DEFER WITH REASON**: opening lineage absent |
| Reservations | aggregate `reservedQty`, empty reservation arrays | I; `stock_reservations` + event ledger; reserve/release/consume; reservations query | source-line ownership and total parity; current 86/0 fails | Availability/worklists; **DEFER WITH REASON**: lineage absent |
| Stock movements | empty material movement arrays/legacy move collections | I; append-only `stock_moves`, `stock_move_facts`; stock move; operations query | stable source/reversal lineage; current source lacks facts | Transfers/drill-down; **KEEP AS CANONICAL** for new facts |
| Lots | legacy lot arrays | I; `stock_lots`; lot create; traceability query | product/company/lot uniqueness and count parity | Traceability; **MERGE INTO CANONICAL** |
| Serials | legacy serial arrays | I; `stock_serials`; serial create; traceability query | company uniqueness and movement link parity | Traceability; **MERGE INTO CANONICAL** |
| Packages | package arrays | I; `stock_packages`; package create; traceability query | package content/move parity | Warehouse view; **MERGE INTO CANONICAL** |
| Valuation | material cost × aggregate stock; old valuation layers | I; `stock_valuation_facts`, FIFO links, projection; stock operation; valuation query | append-only AVCO/FIFO; current IQD 1,963,000/0 fails | Valuation report; **DEFER WITH REASON**: opening GL policy absent |
| Landed cost | `landed_costs` foundation | W; landed-cost tables/adjustment facts; create/post actions; WMS query | receipt link, allocation sum, valuation and GL equality | Cost worklist; **KEEP AS CANONICAL** |
| Leads | `crm_leads` | S; `crm_leads`; lead create/update; sales query | company/source lifecycle parity | CRM; **KEEP AS CANONICAL** |
| Opportunities | CRM lead stage | S; `crm_leads(stage)`; lead update; sales query | stage/history parity | CRM pipeline; **CONVERT TO VIEW** |
| Quotations | `sale_orders(state=draft)` and arrays | S; `sale_orders/lines`; quotation create; sales query | line/price/tax trace parity | Sales; **MERGE INTO CANONICAL** |
| Sales orders | sales arrays and canonical foundation | S; `sale_orders`, fulfilment demand; confirm action; sales query | demand/reservation/delivery/invoice parity | Sales; **KEEP AS CANONICAL** |
| Deliveries | transfer arrays/pickings | W/I; `stock_pickings`, executed move facts; validate picking; operations query | SO-line to reservation/move parity | Sales delivery; **KEEP AS CANONICAL** |
| Customer returns | legacy return/transfer facts | I/F3; linked reverse stock/accounting facts; reversal action foundation | original outbound cost and credit-note link required | Sales returns; **DEFER WITH REASON**: full UI/lifecycle proof absent |
| Requisitions | procurement arrays/table | R; `purchase_requisitions`; requisition create; procurement query | source/status/approval parity | Procurement; **MERGE INTO CANONICAL** |
| RFQs | RFQ arrays/table | R; `purchase_rfqs`; RFQ create; procurement query | line/supplier/status parity | Procurement; **KEEP AS CANONICAL** |
| Supplier quotations | RFQ quotation table/arrays | R; supplier quotation tables; RFQ action family; procurement query | bid/award uniqueness and comparison parity | Procurement comparison; **KEEP AS CANONICAL** |
| Purchase orders | purchase arrays and canonical table | R; `purchase_orders/lines`, fulfilment demand; order confirm; procurement query | line/receipt/bill parity | Procurement; **KEEP AS CANONICAL** |
| Receipts | transfer arrays/pickings | W/I; incoming picking + executed facts; picking validate; operations query | PO-line received qty from moves | Procurement receipt; **KEEP AS CANONICAL** |
| Supplier returns | legacy return/transfer facts | I/F3; linked reverse stock/AP facts; reversal foundation | original receipt cost and debit-note link required | Procurement returns; **DEFER WITH REASON**: full proof absent |
| Three-way matches | summary match table | R; `three_way_match_lines`, exceptions, invoice registry; match action; procurement query | ordered/received/billed/price/tax/currency line parity | Match worklist; **KEEP AS CANONICAL** |
| POS orders | POS arrays/table | O; `pos_orders/lines/payments` + finance links; process order; POS query | session/payment/stock/fiscal/GL/cashbox all-or-none | POS; **KEEP AS CANONICAL** |
| Payments | POS/finance payment arrays | F3/O; Phase 03 payments plus POS links; POS/finance actions; finance query | method totals and GL/cash shift equality | POS/Cashbox; **CONVERT TO VIEW** |
| Invoices | sales invoice arrays | F3; fiscal documents + `commercial_fiscal_requests`; invoice request; finance query | delivered uninvoiced qty, idempotency, GL | Sales/AR; **CONVERT TO VIEW** |
| Supplier bills | procurement bill arrays | F3; AP fiscal documents + requests; bill request; finance query | matched received qty, duplicate invoice, AP GL | Procurement/AP; **CONVERT TO VIEW** |
| Tasks | Task Manager arrays | T; `work_items`; create/update/delete; work-item query | stable source map/history/count; 5 migrated | Task Manager; **MERGE INTO CANONICAL** |
| Kanban cards | `omni.kanban` | T; `work_items`; work-item actions/query | stable source map; 3 migrated; shared version | Kanban; **CONVERT TO VIEW** |
| Project tasks | project task arrays | T; `work_items(source_type=project)`; actions/query | source key/history/relations | Projects; **CONVERT TO VIEW** |
| Work-order tasks | work order activities | T; `work_items(source_type=work_order)`; actions/query | 3 migrated; source link parity | Work Orders; **CONVERT TO VIEW** |
| Workflow work items | workflow runtime records | workflow engine + T projection | workflow action creates/links Work Item | definition remains workflow authority; task parity | Workflow; **CONVERT TO VIEW** |
| Helpdesk assignments | helpdesk arrays | T; `work_items(source_type=helpdesk)` | source/history/assignee parity | Helpdesk; **CONVERT TO VIEW** |
| QC rework | QC arrays | T; `work_items(source_type=qc)` | source/history/status parity | QC; **CONVERT TO VIEW** |
| Maintenance tasks | maintenance arrays | T; `work_items(source_type=maintenance)` | source/history/status parity | Maintenance; **CONVERT TO VIEW** |
| Approvals | workflow/task approval arrays | T + Phase 02 workflow; `work_item_approvals`; approve action | decision/actor/version/audit parity | Worklists; **KEEP AS CANONICAL** |
| Comments | chatter/comment collections | platform collaboration/chatter; linked by resource | resource/company/author parity | all Work Item views; **KEEP AS CANONICAL** |
| Attachments | file/attachment collections | platform file service; resource links | content hash/permission/resource parity | all views; **KEEP AS CANONICAL** |

Archive/removal rule for every `MERGE`, `CONVERT`, or compatibility row: migration reconciliation, UI/API parity, real browser proof, machine-readable writer denial, and an explicit cutover record must all pass. None of the legacy sources above is currently eligible for deletion.
