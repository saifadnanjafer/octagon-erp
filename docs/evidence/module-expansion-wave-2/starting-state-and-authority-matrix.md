# Octagon ERP Module Expansion Wave 2 — Starting State & Authority Matrix

**Date:** 2026-07-31
**Repository:** saifadnanjafer/octagon-erp
**Source Worktree:** C:\Users\Zahraa dlbooz\Downloads\odoo-19.0\octagon-module-expansion-wave-1
**Wave 2 Worktree:** C:\Users\Zahraa dlbooz\Downloads\odoo-19.0\octagon-module-expansion-wave-2
**Source SHA:** `a0855abaa830efad7ecd7e8760b8baaf6a5f4c31`
**Starting Branch:** `build/octagon-module-expansion-wave-2`

---

## Canonical Authority Analysis Matrix

Before building Wave 2 modules, the following authoritative map of canonical domain models was established to prevent duplicate authorities:

| Domain / Concept | Canonical Authority Location | Existing Schema / Migrations | Reuse / Extension Strategy for Wave 2 |
|---|---|---|---|
| Identity & Auth | `platform/identity` | `006_identity_authority.mjs`, `007_authorization_registry.mjs` | Reuse existing user_id, roles, permissions. No duplicate auth. |
| Companies & Branches | `platform/organization` | `006`, `050` | Server-derived `company_id`, `branch_id` scoping in all Wave 2 entities. |
| Party (Customers & Vendors) | `platform/party` | `036_party_product_uom_pricing_foundation.mjs` | Link Contracts, Subscriptions, Rental, Expenses, Procurement to canonical `parties`. |
| Products & UOM | `platform/product` | `036` | Reuse `products`, `product_uoms`. Rental and WMS extend canonical Product. |
| Inventory & Stock | `platform/inventory` | `037`, `038`, `044`, `045`, `062` | WMS and Rental operate over canonical `stock_moves`, `stock_quants`, `warehouses`. |
| Sales & Quotations | `platform/sales` | `039`, `046` | Subscriptions, Rental, Contracts generate canonical `sale_orders` & `sale_order_lines`. |
| Procurement & POs | `platform/procurement` | `040`, `047` | Advanced Procurement & Tenders produce canonical `purchase_orders`. |
| Finance & GL | `platform/finance` | `014`–`035` | Budgeting, Treasury, Expenses request GL entries via canonical Finance actions. No direct GL writes. |
| Payments & Banking | `platform/payment` | `022`–`025` | Treasury & Subscriptions route payments through canonical `payment_documents` & `bank_accounts`. |
| Projects & Cost Centers | `platform/projects` | `052_projects_and_project_costing.mjs` | Contracts, Expenses, Budgeting link to `projects` & `cost_centers`. |
| Engineering & MRP | `platform/engineering` | `053`–`056` | PLM extends `engineering_boms`, `engineering_routings`. No duplicate BOM engine. |
| Assets & Maintenance | `platform/assets`, `platform/maintenance` | `057`, `058`, `059` | Rental and HSE link to `assets` and `maintenance_orders`. |
| Work Items & Tasks | `platform/work_items` | `042`, `049` | GRC actions, HSE corrective actions, Onboarding tasks map to `work_items`. |
| Documents & Attachments | `platform/documents` | `010_collaboration_files_jobs.mjs` | Contract files, Supplier documents, Expense receipts link to `sys_files`/`documents`. |
| Audit & Outbox | `platform/audit` | `001`–`005`, `010` | All mutation actions record audit logs and outbox events via ActionExecutor. |

---

## Module Status at Wave 2 Entry

- **Wave 1 CRM (M2):** `INTEGRATION READY` (Migrations 065 & 066 applied, single-write authority closed, governed query API & Customer 360 complete, 6 test suites passing).
- **Wave 2 Target Modules:** W2-M1 to W2-M16 (Contracts, Subscriptions, Rental, Expenses, Procurement, Human Capital, Budgeting, Treasury, WMS, PLM, GRC, HSE, BI, Integration Hub, Iraq Localization, AI Copilot).
