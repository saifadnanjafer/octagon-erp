# Octagon ERP — Final Page Catalog · Page Consolidation Register

**Branch:** `build/octagon-final-page-catalog`
**Source SHA:** `237febe23b4192542b4e43e54192c43f88540706`

The §7–§71 target catalog names 65 page families. Octagon already owns 108
registered page IDs. This register records the disposition of **every** target
family against the actual inventory, so no target page is silently dropped and
no existing page is silently duplicated.

Disposition vocabulary:

- **REUSE** — an existing page already owns this workflow. Upgrade in place; do
  not create a new page ID.
- **REUSE + TABS** — an existing page owns it; the target's extra workflows
  become internal tabs of that page.
- **CONSOLIDATE** — two or more existing pages cover the target. One becomes
  canonical; the others become tabs or keep a temporary route alias.
- **NEW** — no existing page owns this workflow. A new page ID is created.
- **NEW (backend exists)** — a Wave 2 backend module exists with no page at all.

---

## A. Target family → Octagon disposition

| # | Target page ID | Disposition | Octagon page(s) | Notes |
|---|---|---|---|---|
| 01 | `enterprise_home` | **NEW** | — | `home` is a resume-launcher (saved-page tile grid), not a work surface. `home` is kept as the boot landing; `enterprise_home` becomes the role workspace. |
| 02 | `executive_cockpit` | **NEW** | (`analytics`, `intelligence` exist but are analytics tools) | Cross-module KPI cockpit with source + timestamp + drill-down per KPI. |
| 03 | `operations_command_center` | **REUSE** | `command_center` | Octagon's workshop-native Command Center is preserved and strengthened. No new page ID. |
| 04 | `my_work` | **NEW** | (`task_manager`, `kanban` are board tools) | Personal cross-module work surface over canonical Work Items. |
| 05 | `unified_inbox` | **CONSOLIDATE → NEW** | `approvals`, `manager_approvals` | `unified_inbox` becomes canonical. `approvals` and `manager_approvals` keep their routes as aliases until callers are migrated. |
| 06 | `global_search` | **NEW** | (`command-palette.js` overlay exists) | The palette stays; the page adds saved/scoped/permission-aware search. |
| 07 | `module_pack_center` | **NEW** | (`op_packs` is workshop operation packs — unrelated) | Reads `platform_modules` / control plane. |
| 08 | `organization_center` | **REUSE + TABS** | `multi_entity` | Tenants/Companies/Branches/Sites already live here. |
| 09 | `identity_center` | **CONSOLIDATE** | `admin_panel` (users tab), `security_center` | Identity tabs consolidate under `security_center`; `admin_panel` keeps its own settings role. |
| 10 | `permission_center` | **NEW** | (`phase6c-security-matrix.js` renders a matrix inside `security_center`) | Needs its own family: roles, record rules, simulation, access explanation. |
| 11 | `authority_governance` | **NEW** | — | Delegation, authority limits, SoD. |
| 12 | `workflow_studio` | **REUSE** | `workflow` | Strong visual Workflow Designer preserved. |
| 13 | `approval_policy_studio` | **REUSE + TABS** | `approvals` | Policy authoring becomes a tab of the approvals family. |
| 14 | `automation_rules` | **REUSE** | `automation` | |
| 15 | `configuration_center` | **CONSOLIDATE** | `system_settings`, `admin_panel`, `settings` (dangling) | `system_settings` is canonical. The dangling `settings` permission key is retired to it. |
| 16 | `customization_studio` | **NEW** | — | Custom fields, layouts, saved views. |
| 17 | `data_import_center` | **CONSOLIDATE** | `import`, `import_center`, `data_quality` | `import_center` canonical; `import` (legacy timesheet import) is a distinct workshop tool and is **kept separate** — it is not the same authority. |
| 18 | `integration_hub` | **REUSE + TABS** | `integration_hub` | Backend `platform/domains/integration` exists and is unwired — connect it. |
| 19 | `audit_security_center` | **REUSE + TABS** | `security_center` | |
| 20 | `release_health` | **CONSOLIDATE** | `deploy_ready`, `route_health` | `deploy_ready` canonical; `route_health` remains as the page-registry doctor tab. |
| 21 | `release_upgrade_center` | **REUSE + TABS** | `deploy_ready` | Backup/restore/migration tabs. |
| 22 | `commercial_control_center` | **NEW** | — | Editions, entitlements, seats, usage meters. |
| 23 | `finance_cockpit` | **REUSE** | `finance` | Existing finance dashboard is the cockpit. |
| 24 | `accounting_setup` | **REUSE + TABS** | `finance` (CoA/journals tabs) | |
| 25 | `tax_localization` | **CONSOLIDATE** | `tax_compliance` | Backend `platform/domains/iraq_localization` exists and is unwired — connect it. |
| 26 | `accounts_receivable` | **REUSE** | `ar_ap` (AR tab) | |
| 27 | `accounts_payable` | **REUSE** | `ar_ap` (AP tab) | |
| 28 | `treasury_center` | **CONSOLIDATE** | `banking`, `cashbox` | Backend `platform/domains/treasury` exists and is unwired — connect it. `banking` becomes the treasury family host. |
| 29 | `expenses_cash_travel` | **REUSE + TABS** | `expenses`, `cashbox` | Backend `platform/domains/expenses` exists and is unwired — connect it. **Employee Advances stay read-only.** |
| 30 | `finance_planning` | **CONSOLIDATE** | `budgeting`, `assets` | Backend `platform/domains/financial_planning` exists and is unwired — connect it. |
| 31 | `financial_reporting` | **REUSE + TABS** | `report`, `finance` | |
| 32 | `crm_workspace` | **REUSE** | `sales` | Wave 1 CRM + Customer 360 already wired here. |
| 33 | `sales_workspace` | **CONSOLIDATE** | `sales`, `sales_price_lists`, `sales_commission`, `sales_contracts` | `sales` canonical; the three satellites become tabs and keep route aliases. |
| 34 | `contracts_subscriptions` | **CONSOLIDATE** | `contracts`, `subscriptions`, `sales_contracts` | Backends `platform/domains/contracts` + `subscriptions` exist and are unwired — connect them. |
| 35 | `marketing_communications` | **CONSOLIDATE** | `marketing`, `whatsapp`, `telegram`, `omni_communications` | `marketing` canonical for campaigns; `omni_communications` canonical for channels. |
| 36 | `appointments_events` | **CONSOLIDATE** | `appointments`, `events`, `surveys` | |
| 37 | `pos_loyalty` | **CONSOLIDATE** | `pos`, `pos_deepening`, `loyalty` | `pos` canonical; `pos_deepening` becomes tabs. |
| 38 | `ecommerce_admin` | **REUSE** | `retail` + `modules/ecommerce-connectors.js` | |
| 39 | `customer_portal_admin` | **REUSE** | `customer_portal` | |
| 40 | `supplier_portal_admin` | **REUSE** | `supplier_portal` | |
| 41 | `supplier_management` | **REUSE + TABS** | `parties` (canonical Party authority) | |
| 42 | `sourcing_workspace` | **REUSE + TABS** | `procurement` | Backend `platform/domains/procurement` (W2) exists and is unwired — connect it. |
| 43 | `procurement_workspace` | **REUSE** | `procurement` | Same family as 42; tabs. |
| 44 | `inventory_control_tower` | **REUSE** | `canonical_inventory` | |
| 45 | `warehouse_location_center` | **REUSE** | `warehouses` / `locations` | Both already point at `views/warehouses_and_locations.html`. |
| 46 | `wms_operations` | **NEW (backend exists)** | — | `platform/domains/wms` has 8 actions and no page. |
| 47 | `inventory_traceability` | **REUSE + TABS** | `canonical_inventory` | |
| 48 | `inventory_cost_control` | **REUSE + TABS** | `canonical_inventory` | |
| 49 | `engineering_plm` | **CONSOLIDATE** | `mrp` (engineering tabs) | Backend `platform/domains/plm` exists and is unwired — connect it. |
| 50 | `mrp_planning` | **REUSE** | `mrp` | |
| 51 | `manufacturing_execution` | **REUSE** | `work_orders` | |
| 52 | `oee_downtime` | **REUSE + TABS** | `machines` | |
| 53 | `quality_workspace` | **REUSE** | `qc_center` | |
| 54 | `asset_maintenance_operations` | **REUSE** | `assets`, `equipment` | |
| 55 | `project_portfolio` | **REUSE** | `projects` | Canonical Projects workspace (Checkpoint D1). |
| 56 | `service_helpdesk` | **REUSE** | `helpdesk` | |
| 57 | `mobile_operations` | **CONSOLIDATE** | `field_service`, `rental`, `fleet` | Backend `platform/domains/rental` exists and is unwired — connect it. |
| 58 | `governance_safety_legal` | **CONSOLIDATE** | `risk_compliance` | Backends `platform/domains/grc` + `hse` exist and are unwired — connect them. |
| 59 | `talent_acquisition` | **REUSE + TABS** | `people_ops` | |
| 60 | `talent_development` | **CONSOLIDATE** | `training_lms` | Backend `platform/domains/human_capital` exists and is unwired — connect it. |
| 61 | `employee_services` | **REUSE + TABS** | `employee_ui`, `people_ops` | **Payroll / attendance / timesheet stay read-only.** |
| 62 | `knowledge_documents` | **CONSOLIDATE** | `documents`, `knowledge`, `knowledge_base`, `sop` | `documents` canonical for files; `knowledge` canonical for articles; `sop` stays separate (workshop-native, machine-linked). |
| 63 | `business_intelligence` | **CONSOLIDATE** | `analytics`, `intelligence`, `nl_reports`, `scenario_planner` | Backend `platform/domains/bi` exists and is unwired — connect it. |
| 64 | `jarvis_ai_center` | **CONSOLIDATE** | `ai_status`, `ai_queue`, `ai_tools`, `ai_factory` | Backend `platform/domains/ai_copilot` exists and is unwired — connect it. |
| 65 | `platform_commercialization` | **NEW** | (`op_packs` is unrelated) | Vertical pack builder. |

### Disposition totals

| Disposition | Count |
|---|---:|
| REUSE / REUSE + TABS | 34 |
| CONSOLIDATE | 19 |
| NEW | 11 |
| NEW (backend exists) | 1 |
| **Total target families** | **65** |

**New sidebar entries created by this wave: at most 12**, not 65. Everything
else upgrades an existing owner.

---

## B. Consolidation detail — per merged page

Recorded for each consolidation: old page ID, new owner, old routes, alias,
data authority, writer authority, caller map, migration impact, retirement
condition.

### B1. `approvals` + `manager_approvals` → `unified_inbox`

| Field | Value |
|---|---|
| Old page IDs | `approvals`, `manager_approvals` |
| New canonical page ID | `unified_inbox` |
| Old owner | `modules/approvals.js` |
| New owner | `modules/unified-inbox.js` |
| Old routes | `switchPage('approvals')`, `switchPage('manager_approvals')` |
| Compatibility alias | both retained; they resolve to `unified_inbox` |
| Data authority | `platform/approvals` (approval engine) + `platform/notifications` |
| Writer authority | ActionExecutor only — no generic approval writes |
| Caller map | `app.js` (2 `switchPage` call sites), `modules/approvals.js`, sidebar `admin_org`/`resources_supply` |
| Migration impact | none — no schema change |
| Retirement condition | remove aliases only after zero `switchPage('approvals')` / `('manager_approvals')` call sites remain and the permission keys are migrated |

### B2. `settings` (dangling) → `system_settings`

| Field | Value |
|---|---|
| Old page ID | `settings` (permission key only; no section, no view, no controller) |
| New canonical page ID | `system_settings` |
| Compatibility alias | `settings` permission key retained, mapped to the `system_settings` page |
| Retirement condition | remove once no code reads `PAGE_PERMISSIONS.settings` |

### B3. `system_check` (dangling) → `deploy_ready`

| Field | Value |
|---|---|
| Old page ID | `system_check` (permission key only) |
| New canonical page ID | `deploy_ready` (which already hosts the stabilization self-test) |
| Compatibility alias | `system_check` permission key retained |
| Retirement condition | remove once `modules/system-check.js` renders inside `deploy_ready` and no caller references `system_check` |

### B4. Sales satellites → `sales`

| Field | Value |
|---|---|
| Old page IDs | `sales_price_lists`, `sales_commission`, `sales_contracts` |
| New canonical page ID | `sales` (tabs) |
| Compatibility alias | all three route IDs retained |
| Data authority | canonical Sales + Pricing + Party |
| Writer authority | ActionExecutor (`sales:*`) |
| Retirement condition | after tab migration + caller sweep |

> Sales satellite consolidation is scheduled in FP-4 and is **not** claimed
> complete in FP-0.

---

## C. Rules applied

1. No new page was created where an existing page already owned the workflow.
2. No existing page was deleted in this wave. Consolidation is additive:
   the canonical page gains tabs; the old route stays as an alias.
3. No canonical business authority was duplicated. Where a Wave 2 backend
   overlaps an existing page (e.g. `procurement`), the page is connected to the
   canonical domain rather than given a second writer.
4. Every consolidation above lists an explicit retirement condition. None are
   retired in FP-0.
