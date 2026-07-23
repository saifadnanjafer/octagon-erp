# Phase 04.5 — Canonical Business Fact Register & Authority Dispositions

**Executing Model:** Gemini 3.6 Flash (High)  
**Date:** 2026-07-23  

---

## 1. Complete Business Fact Register & Authority Dispositions

| Fact Category | Business Fact Name | Legacy Tables / Collections | Target Canonical Table | Canonical Owner Service / Command | Disposition | Deletion / Archive Criterion |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Party** | Person / Individual | `customers[]`, `contacts[]` | `parties` (kind='person') | `platform/commercial/parties.mjs` | **MERGE INTO CANONICAL** | Archive legacy array after verified migration. |
| **Party** | Organization / Business | `suppliers[]`, `customers[]` | `parties` (kind='organization') | `platform/commercial/parties.mjs` | **MERGE INTO CANONICAL** | Archive legacy array after verified migration. |
| **Party** | Customer Role | `customers[]` | `party_roles` (role='customer') | `platform/commercial/parties.mjs` | **MERGE INTO CANONICAL** | Read-only compatibility adapter for legacy queries. |
| **Party** | Supplier Role | `suppliers[]` | `party_roles` (role='supplier') | `platform/commercial/parties.mjs` | **MERGE INTO CANONICAL** | Read-only compatibility adapter for legacy queries. |
| **Party** | Contact Detail | `contacts[]` | `contacts` | `platform/commercial/parties.mjs` | **KEEP AS CANONICAL** | Unified under canonical `parties`. |
| **Party** | Address / Location | `addresses[]` | `addresses` | `platform/commercial/parties.mjs` | **KEEP AS CANONICAL** | Unified under canonical `parties`. |
| **Product** | Product Template | `omni.materials`, `products[]` | `product_templates` | `platform/commercial/products.mjs` | **MERGE INTO CANONICAL** | Retire direct `omni.materials` writes; map view to canonical. |
| **Product** | Product Variant | `materials[]`, `products[]` | `product_variants` | `platform/commercial/products.mjs` | **KEEP AS CANONICAL** | Unified variant model. |
| **Product** | Service | `services[]` | `product_templates` (type='service') | `platform/commercial/products.mjs` | **MERGE INTO CANONICAL** | Service product template with zero inventory requirement. |
| **Product** | Category | `categories[]` | `product_categories` | `platform/commercial/products.mjs` | **KEEP AS CANONICAL** | Hierarchical categories. |
| **Product** | Unit of Measure (UOM) | `uom[]` | `uoms` / `uom_categories` | `platform/commercial/uom.mjs` | **KEEP AS CANONICAL** | Standardized UOM conversions. |
| **Product** | Product Barcode | `barcodes[]` | `product_barcodes` | `platform/commercial/products.mjs` | **KEEP AS CANONICAL** | Unique global barcode constraint. |
| **Product** | Price List / Pricing | `prices[]` | `price_lists` / `price_list_items` | `platform/commercial/pricing.mjs` | **KEEP AS CANONICAL** | Tiered price calculation engine. |
| **Inventory** | Warehouse | `warehouses[]` | `warehouses` | `platform/inventory/warehouses.mjs` | **KEEP AS CANONICAL** | Warehouse master definition. |
| **Inventory** | Location | `stock_locations[]` | `stock_locations` | `platform/inventory/warehouses.mjs` | **KEEP AS CANONICAL** | Hierarchical storage locations. |
| **Inventory** | Executed Stock Fact | `stock_moves` | `stock_moves` | `platform/inventory/ledger.mjs` | **KEEP AS CANONICAL** | Immutable append-only movement ledger. |
| **Inventory** | On-Hand Quantity | `quants[]`, `material.stock` | `stock_quants` | `platform/inventory/ledger.mjs` | **KEEP AS CANONICAL** | Rebuildable projection from `stock_moves`. |
| **Inventory** | Reservation Fact | `material.reserved`, `quants.reserved` | `stock_reservations` | `platform/inventory/ledger.mjs` | **MERGE INTO CANONICAL** | Canonical Reservation Ledger (`reserve`/`release`/`consume`). |
| **Inventory** | Lot / Serial / Package | `lots[]`, `serials[]` | `stock_packages`, `lots` | `platform/inventory/ledger.mjs` | **KEEP AS CANONICAL** | Package and serial tracking. |
| **Inventory** | Valuation Layer | `stock_valuation_layers` | `stock_valuation_layers` | `platform/inventory/valuation.mjs` | **KEEP AS CANONICAL** | AVCO / FIFO valuation layer ledger. |
| **Inventory** | Landed Cost | `landed_costs` | `landed_costs` | `platform/wms/landed_cost.mjs` | **KEEP AS CANONICAL** | Landed cost allocation and GL posting. |
| **Commercial** | CRM Lead / Opportunity | `crm_leads` | `crm_leads` | `platform/sales/crm.mjs` | **KEEP AS CANONICAL** | CRM pipeline facts. |
| **Commercial** | Sales Quotation / Order | `sale_orders` | `sale_orders` / `sale_order_lines` | `platform/sales/orders.mjs` | **KEEP AS CANONICAL** | Commercial sales lifecycle facts. |
| **Commercial** | Delivery Picking | `stock_pickings` | `stock_pickings` (type='outbound') | `platform/wms/operations.mjs` | **KEEP AS CANONICAL** | Fulfillment picking demand. |
| **Commercial** | Requisition / RFQ / PO | `purchase_orders` | `purchase_orders` / `lines` | `platform/procurement/orders.mjs` | **KEEP AS CANONICAL** | Commercial procurement facts. |
| **Commercial** | Receipt Picking | `stock_pickings` | `stock_pickings` (type='inbound') | `platform/wms/operations.mjs` | **KEEP AS CANONICAL** | Incoming receipt demand. |
| **Commercial** | Three-Way Match | `three_way_matches` | `three_way_matches` | `platform/procurement/matching.mjs` | **KEEP AS CANONICAL** | Matching validation record. |
| **Commercial** | POS Order | `pos_orders` | `pos_orders` / `pos_payments` | `platform/pos/session.mjs` | **KEEP AS CANONICAL** | Point-of-Sale transactions. |
| **Tasks** | Work Item / Task | `tasks[]`, `kanban[]`, `work_orders[]` | `work_items` | `platform/work_items/work_items.mjs` | **MERGE INTO CANONICAL** | Single Work Item authority for all task views. |
| **Finance** | General Ledger Postings | `gl_entries[]`, `journals[]` | Phase 03 `journal_entries` | Phase 03 `AccountingEngine` | **KEEP AS CANONICAL** | Single GL authority from Phase 03. |
