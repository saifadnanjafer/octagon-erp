# Phase 02 Donor License Ledger

**Verified:** 2026-07-21  
**Octagon baseline:** `f5f4cf559b2301e57401fbd3e6dc0d098f9291c3`

No donor source file was copied into Octagon. Donor repositories were used as
behavior specifications; all target code is an independent Octagon JavaScript
implementation. VNext is project-owned source and was salvaged under the
dispositions recorded in `source-composition-ledger.md` and
`vnext-salvage-ledger.md`.

| Source | Exact local paths inspected | License / mode | Result |
|---|---|---|---|
| Odoo | `addons/auth_password_policy/`, `addons/auth_totp_portal/`, `odoo/addons/base/models/ir_rule.py`, `odoo/addons/base/models/res_groups.py`, `odoo/addons/base/models/ir_model.py`, `addons/mail/models/mail_thread.py`, `addons/mail/models/mail_activity.py`, `addons/mail/models/mail_followers.py` | LGPL-3 core; clean-room behavior only | `SPEC-IMPLEMENT`; no file copied |
| Odoo scheduler/calendar references | `odoo/addons/base/models/ir_cron.py` and `odoo/addons/resource/models/resource_calendar.py` | LGPL-3; path availability checked | `SPEC-IMPLEMENT`; unavailable path is explicitly recorded where absent |
| NocoBase | `erp-research/nocobase-main/packages/core/acl/src/acl.ts`, `packages/plugins/@nocobase/plugin-workflow/src/server/Processor.ts`, workflow dispatcher and configuration/plugin paths | AGPL-3 | clean-room behavior only |
| RuoYi | `erp-research/ruoyi-vue-pro-master/yudao-framework/`, `yudao-module-system/`, `yudao-module-bpm/`, `yudao-ui/yudao-ui-admin-vue3/src/directives/permission/` | MIT | behavior reference; Java/Vue behavior independently rewritten |
| AureusERP | `erp-research/aureuserp-master/plugins/webkul/chatter/src/Traits/HasChatter.php`, table/field/export paths | MIT | behavior reference; no PHP copied |
| ERPNext | `erp-research/erpnext-develop/` selected workflow/SLA/document examples | GPL-3 | clean-room behavior only |
| Frappe | Expected `FRAPPE_ROOT` is absent; no direct path was available | not applicable | `SPEC-IMPLEMENT` from Phase 02 contract and ERPNext usage; no Frappe code copied |
| IDURAR | `erp-research/idurar-erp-crm-master/` route/model/controller references | GPL-3 | supporting behavior reference only |

The only direct code salvage was from `octagon-erp-commercial-vnext`, whose
project-owned status permits `MERGE-CANONICAL`, `MERGE-REFACTOR`, and
`PORT-TESTS`. Restricted or copyleft donor implementations were not imported.

