# Local Source Inventory — Phase 03 Remediation & Cutover

**Executing Model:** Gemini 3.6 Flash (Medium)  
**Execution Date:** 2026-07-22  
**Root Location:** `C:\Users\Zahraa dlbooz\Downloads\odoo-19.0`

---

## Resolved Local Source Repositories & Packages

| Source Name | Local System Path | Branch / State | License | Inspected Finance Paths & Modules | Disposition |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Octagon ERP (Current)** | `C:\Users\Zahraa dlbooz\Downloads\odoo-19.0\octagon-erp` | `remediation/phase-03-final-closure` (`c793999ec348dde5852b7c1425bdac74d35821e4`) | Project-Owned | `server.js`, `app.js`, `views/finance.html`, `modules/finance-ui.js`, `services/financeService.js`, `platform/finance/`, `platform/api/` | Target Octagon ERP runtime & canonical engine |
| **Octagon VNext** | `C:\Users\Zahraa dlbooz\Downloads\odoo-19.0\octagon-erp-commercial-vnext` | Local Worktree | Project-Owned | `vnext/server/finance/finance-engine.js`, `arap-engine.js`, `bank-engine.js`, `tax-engine.js`, `report-engine.js`, `migrations/601-609` | Salvaged into canonical Phase 03 platform |
| **Odoo 19 Community** | `C:\Users\Zahraa dlbooz\Downloads\odoo-19.0` | Local Extract | LGPL-3.0 | `odoo/addons/account/models/account_move.py`, `account_payment.py`, `account_tax.py`, `account_bank_statement.py` | Reference-Negative (Specification & behavior reference) |
| **ERPNext** | `C:\Users\Zahraa dlbooz\Downloads\odoo-19.0\erpnext-develop.zip` / `erp-research` | Zip Archive | GPL-3.0 | `accounts/doctype/gl_entry/`, `payment_entry/`, `bank_transaction/`, `general_ledger.py` | Reference-Negative (Specification & behavior reference) |
| **Frappe** | `C:\Users\Zahraa dlbooz\Downloads\odoo-19.0\erp-research` | Local Extract | MIT | Document lifecycle hooks, metadata-driven form patterns | Reference-Negative (Pattern reference) |
| **RuoYi Vue Pro** | `C:\Users\Zahraa dlbooz\Downloads\odoo-19.0\ruoyi-vue-pro-master.zip` | Zip Archive | MIT | Admin dashboard, permission tokens, export/file patterns | Reference-Negative (Pattern reference) |
| **NocoBase** | `C:\Users\Zahraa dlbooz\Downloads\odoo-19.0\nocobase-main.zip` | Zip Archive | Proprietary/Apache | Configurable view schema patterns, permission-aware resource actions | Reference-Negative (Clean-room design reference) |
| **AureusERP** | `C:\Users\Zahraa dlbooz\Downloads\odoo-19.0\aureuserp-master.zip` | Zip Archive | MIT | `plugins/webkul/accounting/src/Models/AccountManager.php`, invoice/payment models | Reference-Negative / Selective MIT clean adaptation |
| **IDURAR** | `C:\Users\Zahraa dlbooz\Downloads\odoo-19.0\idurar-erp-crm-master.zip` | Zip Archive | AGPL-3.0 | Node/React payment and invoice presentation UX | Reference-Negative (UX concept reference only) |

---

## Source Composition & Local Search Rules

1. All donor source code was inspected strictly from local paths listed above.
2. No internet fetching, cloning, or external repository access was performed.
3. No donor repository files were modified, moved, or deleted.
4. Only Octagon project-owned VNext and current Octagon ERP code were directly merged or refactored into canonical platform modules.
