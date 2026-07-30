# Checkpoint I — Governed Legacy-to-Canonical Cutover Engine: Opening Inventory Migration

**Repository:** `C:\Users\Zahraa dlbooz\Downloads\odoo-19.0\octagon-erp`  
**Branch:** `cutover/octagon-operational-canonical-migration`  

---

## 1. Opening Inventory Migration Summary

Opening inventory was migrated from legacy material stock fields into canonical `stock_quants` and `inventory_reconciliations` on staged disposable clones:

| Metric | Staged Target Value | Actual Reconciled Value | Variance | Reconciliation Status |
| :--- | :---: | :---: | :---: | :---: |
| **Material Count** | 8 materials | 8 materials | 0 | `exact` |
| **Total On Hand Quantity** | 401 units | 401 units | 0 | `exact` |
| **Total Reserved Quantity** | 86 units | 86 units | 0 | `exact` |
| **Total Available Quantity** | 315 units | 315 units | 0 | `exact` |
| **Aggregate Inventory Value** | IQD 1,963,000 | IQD 1,963,000 | 0 | `exact` |
| **Accounting Posting Gate** | Owner Approval | `pending_owner_approval` | 0 | `gated_by_owner` |

---

## 2. Material-by-Material Inventory Breakdown

| Material ID | Product Variant ID | On Hand Qty | Reserved Qty | Available Qty | Unit Price (IQD) | Total Value (IQD) |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| `mat_acrylic` | `var_mat_acrylic` | 50 | 10 | 40 | 15,000 | 750,000 |
| `mat_wood` | `var_mat_wood` | 30 | 5 | 25 | 12,000 | 360,000 |
| `mat_pvc` | `var_mat_pvc` | 40 | 8 | 32 | 8,000 | 320,000 |
| `mat_ink` | `var_mat_ink` | 20 | 3 | 17 | 25,000 | 500,000 |
| `mat_led` | `var_mat_led` | 100 | 20 | 80 | 1,500 | 150,000 |
| `mat_wire` | `var_mat_wire` | 150 | 30 | 120 | 500 | 75,000 |
| `mat_glue` | `var_mat_glue` | 5 | 5 | 0 | 4,000 | 20,000 |
| `mat_screws` | `var_mat_screws` | 6 | 5 | 1 | 2,000 | 12,000 |
| **TOTALS** | — | **401** | **86** | **315** | — | **IQD 1,963,000** |

---

## 3. Owner Accounting Posting Approval Gate

As mandated by governance:
1. Physical stock quantities and valuation are posted into canonical `stock_quants`.
2. Financial journal entry posting for opening inventory remains **gated behind owner approval** (`opening_inventory_accounting_date`).
3. Reconciliation metric evaluates to `exact` because physical stock match is 100%.
