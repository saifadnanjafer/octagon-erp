# Source Selection and Salvage Ledger

## Summary

**No VNext code and no third-party donor code was salvaged in this wave.**

That is a finding, not an omission. The capability this wave needed — a visible
original-shell surface over the canonical engines — did not require importing a
data model, a workflow, or a UI component from anywhere. Octagon already owned:

- the canonical engines (`platform/commercial`, `platform/inventory`,
  `platform/sales`, `platform/procurement`, `platform/pos`,
  `platform/work_items`);
- the canonical HTTP surface (`platform/api/**`, `/api/v1`);
- the canonical client transport (`services/canonicalClient.js`);
- the shell's own page/nav/permission conventions.

The gap was wiring, not capability. Importing a donor UI would have added a
foreign visual language to an Arabic-first workshop shell for no functional
gain, and would have created a second set of conventions to maintain.

## Per-capability record

### Capability: visible canonical operations surface

| Field | Value |
|---|---|
| Sources compared | Octagon current shell; VNext (considered, not opened); Odoo 19 list/form pattern (conceptual only); NocoBase configurable-view concept (conceptual only) |
| Exact paths inspected | Octagon only: `app.js` (`pageMap` at 4063 and 37140, `ensurePageTemplateLoaded` at 37139, `prefetchAllViews` at 37295), `index.html` nav block, `modules/appointments.js:422-432` (switchPage-wrap pattern), `services/permissionService.js:154,255`, `platform/api/commercial.mjs:31-139`, `platform/api/index.mjs` |
| Ownership / license | Octagon's own code |
| Selected source | **Octagon's own existing conventions** |
| Reuse mode | Followed in-repo pattern; no code copied from any donor |
| Target Octagon path | `views/canonical_console.html`, `modules/canonical-console.js`, `modules/canonical-console.css` |
| Reason | The shell already has a well-defined contract for adding a page (view template → `pageMap` → prefetch → nav button → module with switchPage-wrap → permission mapping). Following it exactly means the new page inherits the existing visual identity, RTL handling, lazy loading and permission model with zero foreign dependencies. |
| Rejected alternatives | **Odoo list/form view** — mature, but importing its widget model would mean importing its CSS and JS conventions into an Arabic-first shell that has its own. **NocoBase configurable views** — attractive long-term for user-defined columns, but it is an architecture, not a snippet; adopting it partially would create two competing view systems. **VNext commercial UI** — not opened this wave: the canonical engines it would have fed already exist in Octagon, so there was nothing to transfer. |
| Tests | `tests/phase04-finalization/canonical_console.test.mjs` — 10 tests |
| Runtime status | Mounted and rendering; verified in a real browser |
| UI status | Visible in the sidebar; opens; bilingual; responsive |

### Pattern adopted in-repo (not a donor)

| Pattern | Source in Octagon | Why |
|---|---|---|
| switchPage wrap + self-activate | `modules/appointments.js:422-432` | Non-core pages are lazily fetched, so the shell's `page-active` reveal runs before the section exists. Every non-core tab in this repo already solves it this way. |
| Scoped module stylesheet | convention after a past regression where an unscoped `.btn-secondary` rule leaked globally | All rules here are scoped under `#pageCanonicalConsole`. |
| Bilingual label pairs + `octagon:language-applied` | `modules/fleet.js` and other recent modules | Matches how the rest of the shell re-renders on language switch. |

## VNext

| Field | Value |
|---|---|
| Paths inspected | none |
| Code salvaged | none |
| Files modified | **none** — 17 dirty files at entry and at exit, untouched |

VNext remains permanently frozen. It was not opened because no capability gap in
this wave pointed at it. When Waves 4–5 reach Manufacturing/Projects/Assets,
VNext is the first place to look, and that inspection will be recorded here.

## Third-party donors

| Field | Value |
|---|---|
| Repositories opened | none |
| Code copied or adapted | none |
| Licenses to preserve | none incurred this wave |

No donor repository was read. Odoo and NocoBase are named above only as
conceptual alternatives that were considered and rejected on architectural
grounds, not inspected file by file.

## Checkpoint C1 addendum — Sales lifecycle (2026-07-28)

This supersedes the Wave 1 statement that VNext and donor sources were not
opened. They were inspected read-only for C1. No donor file was modified and no
third-party code was copied.

| Source | Exact paths inspected | Ownership / license | Decision |
|---|---|---|---|
| Frozen Octagon VNext | `vnext/server/modules/sales/sales-engine.js`; `vnext/client/modules/sales/index.js`; `migrations/612_r3_sales_core.mjs` | project-owned, proprietary | behavior reference only; clean-room adaptation |
| Odoo 19 | `addons/sale/models/sale_order.py`; `addons/sale/models/sale_order_line.py`; `addons/crm/models/crm_lead.py`; related tests/views | LGPL-3.0 | comparison only; no code copied |
| ERPNext develop | `erpnext/selling/doctype/quotation/quotation.py`; `erpnext/selling/doctype/sales_order/sales_order.py` | GPL-3.0 | comparison only; no code copied |

Selected approach: preserve Octagon's canonical ActionExecutor, Inventory,
Finance, outbox, audit, idempotency, and original-shell conventions, then
clean-room implement the missing Sales lifecycle and visible workspace.

Target paths include migration 046, `platform/sales/lifecycle.mjs`,
`platform/sales/orders.mjs`, `platform/api/commercial.mjs`,
`services/canonicalClient.js`, and `modules/canonical-sales.*`.

Frozen VNext remained read-only.

## Checkpoint C5 addendum — Administration and Module Control (2026-07-28)

The inspection remained targeted and read-only. No frozen or third-party file
was modified, and no donor code was copied.

| Source | Exact paths inspected | Ownership / license | Decision |
|---|---|---|---|
| Current Octagon | `database/migrations/001_platform_kernel_bootstrap.mjs`, `005_platform_kernel_control_plane.mjs`, `006_identity_authority.mjs`, `007_authorization_registry.mjs`, `008_settings_secrets_policies.mjs`, `019_fiscal_positions_and_iraq_localization.mjs`; platform kernel modules/jobs/health; feature flags; identity/users; organizations/memberships; authorization/roles; legacy Administration/marketplace/settings surfaces | project-owned, proprietary | selected Control Plane authority, scope, permission, audit, job, health, and original-shell conventions |
| Frozen Octagon VNext | `vnext/server/modules/module-lifecycle.js`; `module-framework.js`; `packs/pack-sdk-engine.js`; `migrations/619_r3_control_plane_contracts.mjs` | project-owned, proprietary | behavior reference only |
| Odoo 19 | `addons/web/static/src/webclient/settings_form_view/` | LGPL-3.0 | settings interaction comparison only; no code copied |
| ERPNext develop | targeted system-settings and user-permission files | GPL-3.0 | configuration and scope comparison only; no code copied |

Selected approach: extend the existing Octagon module, feature, job, health,
identity, authorization, audit, outbox, and ActionExecutor authorities. Add
only the missing assignment/license facts and a clean-room original-shell
Administration projection.

Target paths include migration 050, `platform/control_plane/index.mjs`,
`platform/kernel/actions/index.mjs`, `platform/api/index.mjs`,
`services/canonicalClient.js`, and `modules/canonical-administration.*`.

Frozen VNext remained read-only at
`cf7ae4ed73eac91a325c964178036290bc0736c1`.

## Checkpoint C4 addendum — Work Item consolidation (2026-07-28)

The inspection was narrow and read-only. No donor or frozen file was modified
and no third-party code was copied.

| Source | Exact paths inspected | Ownership / license | Decision |
|---|---|---|---|
| Current Octagon | `database/migrations/042_canonical_work_item_and_authority_retirement.mjs`; `043_phase04_canonical_registry_and_lineage.mjs`; `platform/work_items/work_items.mjs`; `platform/work_items/index.mjs`; legacy Task Manager/Kanban/Calendar/Workshop TV views and renderers | project-owned, proprietary | selected authority and shell conventions |
| Frozen Octagon VNext | `vnext/server/modules/projects/project-engine.js`; `migrations/617_r3_services_helpdesk.mjs`; `migrations/620_r3_sla_business_clock.mjs` | project-owned, proprietary | dependency and SLA behavior reference only |
| Odoo 19 | `addons/project/models/project_task.py`; `addons/project/static/src/views/project_task_kanban/project_task_kanban_renderer.js` | LGPL-3.0 | interaction comparison only; no code copied |
| ERPNext develop | `erpnext/projects/doctype/task/task.py`; `task.js`; `task.json` | GPL-3.0 | lifecycle and dependency comparison only; no code copied |

Selected approach: retain Octagon's canonical Work Item table, ActionExecutor,
audit, outbox, idempotency and company scope, then clean-room add the missing
operating fields, relations, reports and original-shell views.

Target paths include migration 049, `platform/work_items/lifecycle.mjs`,
`platform/api/commercial.mjs`, `services/canonicalClient.js`, and
`modules/canonical-work-management.*`.

## Checkpoint C2 addendum — Procurement lifecycle (2026-07-28)

Targeted files were inspected read-only. No donor repository was broadly
rescanned, no donor file was modified, and no third-party code was copied.

| Source | Exact paths inspected | Ownership / license | Decision |
|---|---|---|---|
| Frozen Octagon VNext | `vnext/server/modules/procurement/procurement-engine.js`; `vnext/client/modules/procurement/index.js`; `migrations/613_r3_procurement_core.mjs` | project-owned, proprietary | behavior reference only; clean-room adaptation into original Octagon |
| Odoo 19 | `addons/purchase/models/purchase_order.py`; `addons/purchase/models/purchase_order_line.py`; related purchase views | LGPL-3.0 | lifecycle comparison only; no code copied |
| ERPNext develop | `erpnext/buying/doctype/request_for_quotation/request_for_quotation.py`; `supplier_quotation.py`; `purchase_order.py` | GPL-3.0 | comparison and validation concepts only; no code copied |

Selected approach: extend Octagon's existing Procurement ActionExecutor domain
and preserve canonical Inventory, Finance, Parties, Products, Warehouses,
audit, outbox, idempotency, and original-shell conventions.

Target paths include migration 047, `platform/procurement/lifecycle.mjs`,
the existing Procurement governance/RFQ/order/matching modules,
`platform/api/commercial.mjs`, `services/canonicalClient.js`, and
`modules/canonical-procurement.*`.

Frozen VNext remained read-only at its pre-existing dirty state.

## Checkpoint C3 addendum — POS lifecycle and reconciliation (2026-07-28)

The source inspection was narrow and read-only. No donor file was modified and
no third-party code was copied.

| Source | Exact paths inspected | Ownership / license | Decision |
|---|---|---|---|
| Frozen Octagon VNext | `vnext/server/modules/pos/pos-engine.js`; `migrations/631_r6_pos_v2.mjs`; `migrations/903_r9_retail_pos.mjs` through `906_r9_retail_pos*.mjs`; related retail pack files | project-owned, proprietary | behavior reference only; no VNext client POS index existed |
| Odoo 19 | `addons/point_of_sale/models/pos_order.py`; `addons/point_of_sale/models/pos_session.py`; `addons/point_of_sale/tests/test_point_of_sale_flow.py` | LGPL-3.0 | lifecycle and reconciliation comparison only; no code copied |
| ERPNext develop | `erpnext/accounts/doctype/pos_invoice/pos_invoice.py`; `erpnext/selling/page/point_of_sale/` | GPL-3.0 | validation and interaction comparison only; no code copied |

Selected approach: preserve Octagon's canonical ActionExecutor, Finance,
Inventory, audit, outbox, idempotency, and original-shell conventions, then
clean-room implement terminal configuration, sessions, split tender, receipts,
refund lineage, stock restoration, and cash reconciliation.

Target paths include migration 048, `platform/pos/session.mjs`,
`platform/pos/refunds.mjs`, `platform/api/commercial.mjs`,
`services/canonicalClient.js`, and `modules/canonical-pos.*`.

Frozen VNext remained read-only.
