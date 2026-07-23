# Phase 04.5 — Page and Module Consolidation Matrix

**Executing Model:** Gemini 3.6 Flash (High)  
**Date:** 2026-07-23  

---

## 1. Complete Page and Navigation Consolidation Audit

| View / Module Name | Source Files / Links | Target Disposition | Authority / Data Source | Cutover Strategy |
| :--- | :--- | :--- | :--- | :--- |
| **Command Center** | `index.html`, `app.js` (`#command-center`) | **PRIMARY WORKSPACE** | Aggregated projections (`/api/v1/work-items`, `/api/v1/inventory/balances`, GL) | Render real-time metrics over canonical facts. |
| **Kanban Board** | `index.html`, `app.js` (`#kanban`) | **SPECIALIZED VIEW** | Canonical `work_items` (`/api/v1/work-items`) | Render Work Items grouped by status/stage columns. |
| **Task Manager** | `index.html`, `app.js` (`#tasks`) | **SPECIALIZED VIEW** | Canonical `work_items` (`/api/v1/work-items`) | Render tabular view over canonical Work Items. |
| **Workflow Operations** | `index.html`, `app.js` (`#workflow`) | **SPECIALIZED VIEW** | Canonical `work_items` + Workflow Templates | Workflow triggers create/transition canonical Work Items. |
| **Work Orders** | `index.html`, `app.js` (`#work-orders`) | **SPECIALIZED VIEW** | Canonical `work_items` (source_type='work_order') | Filtered view over canonical Work Items. |
| **Helpdesk Assignments**| `index.html`, `app.js` (`#helpdesk`) | **SPECIALIZED VIEW** | Canonical `work_items` (source_type='helpdesk') | Filtered view over canonical Work Items. |
| **QC Rework / Inspection**| `index.html`, `app.js` (`#qc-rework`) | **SPECIALIZED VIEW** | Canonical `work_items` (source_type='qc') | Filtered view over canonical Work Items. |
| **Maintenance Actions** | `index.html`, `app.js` (`#maintenance`) | **SPECIALIZED VIEW** | Canonical `work_items` (source_type='maintenance') | Filtered view over canonical Work Items. |
| **Mobile My Tasks** | `index.html`, `app.js` (`#mobile-tasks`) | **MOBILE VIEW** | Canonical `work_items` (assigned_user=currentUser) | Responsive mobile task view over canonical Work Items. |
| **Workshop TV** | `index.html`, `app.js` (`#workshop-tv`) | **DASHBOARD** | Canonical `work_items` (status!='done') | Real-time display board over active Work Items. |
| **Materials View** | `index.html`, `app.js` (`#materials`) | **SPECIALIZED VIEW** | Canonical `product_templates` (`/api/v1/commercial/products`) | Display raw materials as filtered product view. |
| **Inventory / Balances** | `index.html`, `app.js` (`#inventory`) | **PRIMARY WORKSPACE** | Canonical `stock_quants` (`/api/v1/inventory/balances`) | Query canonical stock balances and operations. |
| **Advanced Inventory** | `index.html`, `app.js` (`#adv-inventory`) | **REPORT** | Canonical Valuation & Ledger (`/api/v1/inventory/valuation`) | Report over valuation layers & landed costs. |
| **Stock Transfers** | `index.html`, `app.js` (`#transfers`) | **SPECIALIZED VIEW** | Canonical `stock_pickings` (`/api/v1/inventory/operations`) | Create/execute internal transfer pickings. |
| **Customers Page** | `index.html`, `app.js` (`#customers`) | **SPECIALIZED VIEW** | Canonical `parties` (`/api/v1/commercial/parties?role=customer`) | Render parties with customer role. |
| **Suppliers Page** | `index.html`, `app.js` (`#suppliers`) | **SPECIALIZED VIEW** | Canonical `parties` (`/api/v1/commercial/parties?role=supplier`) | Render parties with supplier role. |
| **Sales CRM / Orders** | `index.html`, `app.js` (`#sales`) | **PRIMARY WORKSPACE** | Canonical `sale_orders` (`/api/v1/sales/orders`) | Manage CRM leads, quotations, and sales orders. |
| **Procurement / PO** | `index.html`, `app.js` (`#procurement`) | **PRIMARY WORKSPACE** | Canonical `purchase_orders` (`/api/v1/procurement/orders`) | Manage requisitions, RFQs, POs, and 3-way matches. |
| **POS Interface** | `index.html`, `app.js` (`#pos`) | **PRIMARY WORKSPACE** | Canonical `pos_sessions` (`/api/v1/pos/*`) | Handle POS checkout, stock deduction, and cashbox. |
| **Finance Dashboard** | `index.html`, `app.js` (`#finance`) | **PRIMARY WORKSPACE** | Phase 03 Canonical GL Facts (`/api/v1/finance/*`) | Financial overview over canonical GL journal entries. |
| **Expenses / Income** | `index.html`, `app.js` (`#expenses`) | **SPECIALIZED VIEW** | Phase 03 Canonical Fiscal Invoices | Worklist view over Phase 03 fiscal documents. |
| **Cashbox / Banking** | `index.html`, `app.js` (`#cashbox`) | **SPECIALIZED VIEW** | Phase 03 Payments / Cash Accounts | View over cash payments & bank reconciliations. |
| **AR / AP Balances** | `index.html`, `app.js` (`#ar-ap`) | **REPORT** | Phase 03 Partner Ledgers | Customer & Supplier outstanding balance reports. |

---

## 2. Navigation Integrity & Deep Linking Guarantee

1. No existing links or route hashes (`#inventory`, `#tasks`, `#kanban`, `#sales`, `#procurement`, `#pos`, `#finance`) are removed.
2. Direct navigation to legacy hashes automatically mounts the corresponding specialized view backed by canonical APIs.
3. User interface maintains exact Arabic RTL identity, styling, and visual structure.
