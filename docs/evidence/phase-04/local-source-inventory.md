# Local Source Inventory — Phase 04 Inventory, Sales, & Procurement

**Executing Model**: Gemini 3.6 Flash (High)  
**Date**: 2026-07-23  
**Root Location**: `C:\Users\Zahraa dlbooz\Downloads\odoo-19.0`  
**Execution Branch**: `phase-04/inventory-sales-procurement`  
**Source Branch**: `remediation/phase-03-final-cutover` (`e3f23fdecf218c2fe9cc955bf9e9cb7f00057d23`)  

---

## Resolved Local Source Repositories & Packages

| Source Name | Local System Path | Branch / Commit | License | Inspected Phase 04 Paths & Modules | Source Role / Disposition |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Octagon ERP (Current)** | `C:\Users\Zahraa dlbooz\Downloads\odoo-19.0\octagon-erp` | `phase-04/inventory-sales-procurement` (`e3f23fde...`) | Project-Owned | `server.js`, `app.js`, `views/`, `services/`, `platform/` | Target Octagon ERP runtime & canonical monolith |
| **Octagon VNext** | `C:\Users\Zahraa dlbooz\Downloads\odoo-19.0\octagon-erp-commercial-vnext` | `automation/r9-marketplace-distribution` (`72d2c6b...`) | Proprietary | `vnext/server/inventory/`, `vnext/server/sales/`, `vnext/server/procurement/`, `migrations/` | Salvaged into canonical Phase 04 platform (Project-Owned) |
| **Odoo 19 Community** | `C:\Users\Zahraa dlbooz\Downloads\odoo-19.0` | Local extract | LGPL-3.0 | `addons/stock/`, `addons/sale/`, `addons/purchase/`, `addons/product/` | Reference-Negative (Specification & behavior reference) |
| **ERPNext** | `C:\Users\Zahraa dlbooz\Downloads\odoo-19.0\erp-research\erpnext-develop\` | Local extract | GPL-3.0 | `erpnext/stock/`, `erpnext/selling/`, `erpnext/buying/`, `erpnext/crm/` | Reference-Negative (Specification & behavior reference) |
| **Frappe** | **NOT PRESENT LOCALLY** | — | — | Unverifiable locally; excluded from Phase 04 inspection | None possible |
| **RuoYi Vue Pro** | `C:\Users\Zahraa dlbooz\Downloads\odoo-19.0\erp-research\ruoyi-vue-pro-master\` | Local extract | MIT | `yudao-module-crm/`, `yudao-module-mall/` | Reference-Negative (Pattern reference for CRM/WMS UI) |
| **NocoBase** | `C:\Users\Zahraa dlbooz\Downloads\odoo-19.0\erp-research\nocobase-main\` | Local extract | Dual Proprietary / Apache | Configurable view schemas and form rules | Reference-Negative (Clean-room design reference) |
| **AureusERP** | `C:\Users\Zahraa dlbooz\Downloads\odoo-19.0\erp-research\aureuserp-master\` | Local extract | MIT | `plugins/webkul/inventories/`, `plugins/webkul/purchases/`, `plugins/webkul/sales/` | Reference-Negative / Selective MIT clean adaptation |
| **IDURAR** | `C:\Users\Zahraa dlbooz\Downloads\odoo-19.0\erp-research\idurar-erp-crm-master\` | Local extract | AGPL-3.0 | React/Node CRM & product UI concepts | Reference-Negative (UX concept reference only) |

---

## Audit Rules Confirmation

1. All donor source inspection was conducted strictly against local paths listed above.
2. Zero external network requests, cloning, or downloading occurred.
3. No donor repository files were modified, moved, or deleted.
