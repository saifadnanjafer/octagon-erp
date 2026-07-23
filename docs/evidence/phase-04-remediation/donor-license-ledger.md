# Phase 04.5 — Donor License Ledger & Clean-Room Compliance

**Executing Model:** Gemini 3.6 Flash (High)  
**Date:** 2026-07-23  

---

## 1. Donor System License Audit

| System | Path | License | License Compatibility | Usage Disposition |
| :--- | :--- | :--- | :--- | :--- |
| **Octagon VNext** | `octagon-erp-commercial-vnext` | Custom / Internal | Fully Compatible | Direct salvage into `platform/` domain modules. |
| **Odoo 19 Community** | `odoo` | LGPL-3.0 | Clean-Room Reference | Reference for state machine logic and 3-way match tolerances. |
| **ERPNext** | `erp-research/erpnext-develop` | GPL-3.0 | Clean-Room Reference | Algorithm specification reference for FIFO queue depletion. |
| **RuoYi Vue Pro** | `erp-research/ruoyi-vue-pro-master` | MIT | Fully Compatible | Reference for multi-tenant data isolation patterns. |
| **NocoBase** | `erp-research/nocobase-main` | Apache-2.0 | Fully Compatible | Reference for action executor contracts. |
| **AureusERP** | `erp-research/aureuserp-master` | MIT | Fully Compatible | Reference for POS cashbox shift close structures. |
| **IDURAR** | `erp-research/idurar-erp-crm-master` | MIT | Fully Compatible | Reference for quotation and invoice payload mapping. |
