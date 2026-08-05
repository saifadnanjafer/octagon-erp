# Visual Review Routes — Octagon ERP Review Freeze 1

Ten guided tours group the 233 pages in `docs/review/PAGE_INVENTORY.json` into
walkable sequences (spec section 16). Every page lands in exactly one tour —
none are dropped. Roles are the 19 named review logins in
`scripts/review/roles.mjs` (see `TEAM_HANDOFF.md` for sign-in instructions).
Language toggles in the app chrome after sign-in; viewport is set in your
browser/devtools per pass.

**Coverage check:** 15 + 34 + 31 + 22 + 41 + 17 + 18 + 12 + 11 + 32 = **233**,
matching `PAGE_INVENTORY.json` exactly (verified programmatically — no
duplicates, no omissions).

**Viewport spread:** desktop x3 (Tours 1, 5, 7), laptop x3 (Tours 2, 6, 10),
tablet x2 (Tours 4, 8), mobile x2 (Tours 3, 9) — every viewport covered at
least twice.

**Language spread:** alternates Arabic/English tour-by-tour (5 of each) so
both directions get a full-tour pass; reviewers should still spot-check the
other language on any page where `PAGE_INVENTORY.json`'s `rtlStatus` /
`ltrStatus` flags a gap (see `UI_UX_AUDIT_MATRIX.md` checklist notes).

## How moduleDomain/navGroup map to tours (judgment calls)

Most pages map cleanly by `moduleDomain`/`navGroup` in `PAGE_INVENTORY.json`.
Where a page didn't fit one of the 10 tours cleanly, it was placed in the
closest thematic match rather than dropped. Judgment calls made:

- `fleet` (Workshop domain, basic per-workshop fleet directory) → **Tour 10**
  (Fleet theme), not Tour 2, even though its `moduleDomain` is `Workshop`.
- `marketing` and `events` (Workshop domain, simple workshop-level pages,
  distinct from the Build12 `marketing_overview`/`events_overview` suites) →
  **Tour 9**, not Tour 2, to keep all marketing/event-labelled pages together.
- `products`, `parties` (Operations domain master data) → **Tour 2** (daily
  operational master data); `warehouses`, `locations` (Operations domain) →
  **Tour 3** (warehouse master data). The `Operations` moduleDomain itself
  isn't one of the 10 tour names, so its 4 pages were split by nearest fit.
- `scenario_planner` (Manager domain) → **Tour 4** (planning tool, closer to
  Production/Planning than a generic manager page); `approvals` (Manager
  domain) → **Tour 5** (business approval workflows); `analytics`,
  `nl_reports` (Manager domain, but share the "الذكاء والتحليلات"
  Intelligence/Analytics navGroup with the AI pages) → **Tour 7**.
- `device_center` (Admin domain) → **Tour 10** (Devices theme), not Tour 6,
  despite its `moduleDomain` being `Admin`.
- `vertical_packs`, `workshop_pack_setup` (Build12 domain, filed under the
  "AI BUILD-12 Governed Intelligence" navGroup) → **Tour 10** ("...Packs"),
  not Tour 7, because they configure the Al-Warsha pack, not AI behavior.
- `subscriptions` (Commercial domain, but filed under the general business
  navGroup rather than "$ Commercial and SaaS") → **Tour 6** anyway, grouped
  with the rest of the Commercial domain.
- `risk_compliance` (Compliance domain, 1 page) → **Tour 6** (governance/
  administration is the closest fit; it isn't warehouse, production,
  marketing, or AI).
- The `Boards` domain (6 large-screen/board pages) was split by theme rather
  than kept as one block: `alert_board` → Tour 1 (cross-cutting),
  `service_queue_board` → Tour 2, `warehouse_large_screen` → Tour 3,
  `production_large_screen` → Tour 4, `fleet_operations_board` and
  `device_health_board` → Tour 10.
- Finance domain pages (28) have no dedicated Phase A fixture domain of their
  own (`requiredFixture` is `none/global` for all of them in the inventory) —
  Tour 5's "expected fixture" below notes this rather than forcing a
  mismatched tag.

---

## Tour 1 — Core Shell and Navigation

| | |
|---|---|
| Role | `review.viewer` (broadest cross-cutting login; app-chrome/navigation is not role-specific) |
| Language | Arabic (default) |
| Viewport | Desktop (1440x900) |
| Starting page | `home` |
| Expected fixture | `workshop` (Phase A) — the home dashboard and shell pages read from the general workshop fixture; no dedicated "core shell" fixture domain exists |
| Pages | 15 |

**Page sequence:** `home` → `canonical_console` → `command_center` → `my_work`
→ `workshop_tv` → `kiosk` → `customer_portal` → `employee_ui` →
`employee_mobile` → `wfl_home` → `calculator` → `help_manual` →
`route_health` → `deploy_ready` → `alert_board`

**Key UI elements to inspect:** top app chrome (logo, nav groups, language
toggle, user menu), sidebar/nav-group structure and active-state highlighting,
home dashboard cards, kiosk/public-display layouts (no chrome, meant for
unattended screens), employee self-service entry points, system health/deploy
badges.

**Items to inspect:**
- Language toggle button is reachable and visible on every page in this tour, not just `home`.
- Nav group labels and ordering match `navGroup`/`navGroupId` in `PAGE_INVENTORY.json`.
- `kiosk`/`workshop_tv`/`customer_portal` (public-facing, unattended) render sensibly with no signed-in-only chrome leaking through.
- `route_health`/`deploy_ready` are readable by a non-technical reviewer (no raw JSON/stack traces).
- `alert_board` surfaces cross-cutting alerts without requiring a specific role to interpret them.

---

## Tour 2 — Workshop Daily Operations

| | |
|---|---|
| Role | `review.workshop_manager` |
| Language | English |
| Viewport | Laptop (1366x768) |
| Starting page | `workshop_command_center` |
| Expected fixture | `workshop` (Phase A) |
| Pages | 34 |

**Page sequence:** `workshop_command_center` → `workshop_readiness` →
`kanban` → `workflow` → `task_manager` → `work_orders` → `mrp` → `op_packs`
→ `sop` → `machines` → `equipment` → `canonical_inventory` → `inventory` →
`qc_center` → `products` → `parties` → `appointments` → `pos` →
`pos_deepening` → `loyalty` → `assets` → `field_service` → `projects` →
`rental` → `warranty` → `logistics` → `helpdesk` → `service_queue_board` →
`documents` → `esign` → `knowledge` → `knowledge_base` → `surveys` →
`visitors`

**Key UI elements to inspect:** kanban/board views, work-order and task
cards, status badges, primary action buttons (create/assign/complete),
document/e-sign upload flows, POS layout.

**Items to inspect:**
- Task/work-order status colors are consistent across `kanban`, `work_orders`, and `task_manager`.
- Primary action per page (e.g., "New work order", "New task") is visible without scrolling on laptop viewport.
- `products`/`parties` master-data tables show readable labels, not raw IDs.
- `service_queue_board` updates/queue ordering makes sense as a daily-ops screen (this workshop-level board, distinct from Tour 4's production board).
- Long lists (e.g., `documents`, `knowledge_base`) have working pagination or filtering.

---

## Tour 3 — Warehouse and Mobile

| | |
|---|---|
| Role | `review.warehouse_operator` |
| Language | Arabic |
| Viewport | Mobile (390x844) |
| Starting page | `warehouse_topology` |
| Expected fixture | `warehouse` (Phase A) |
| Pages | 31 |

**Page sequence:** `warehouse_topology` → `zone_bin_management` →
`locations` → `warehouses` → `putaway_rules` → `putaway_task_queue` →
`replenishment_rules` → `replenishment_proposals` → `mobile_receiving` →
`receiving_discrepancies` → `dock_schedule` → `dock_checkin` →
`staging_board` → `crossdock_workspace` → `mobile_picking` →
`pick_task_queue` → `wave_planning` → `wave_execution` →
`cycle_count_plans` → `count_session` → `variance_review` →
`lot_serial_traceability` → `expiration_queue` → `recall_analysis` →
`warehouse_large_screen` → `offline_client_registry` → `offline_queue` →
`sync_sessions` → `sync_conflicts` → `conflict_resolution` →
`offline_capability_policies`

**Key UI elements to inspect:** mobile-optimized forms (`mobile_receiving`,
`mobile_picking`), touch target sizing on scan/confirm buttons, queue/task
list density on a 390px viewport, offline/sync status indicators.

**Items to inspect:**
- `mobile_receiving`/`mobile_picking`/`count_session` are usable one-handed at mobile width — no horizontal scroll, tap targets >= 44px.
- Offline pages (`offline_queue`, `sync_conflicts`, `conflict_resolution`) clearly communicate connectivity state and pending/failed sync counts.
- `warehouse_large_screen` is checked separately at desktop/large viewport too (it's a large-screen board, not meant for mobile — flag if it only has a mobile layout).
- Dock/staging pages (`dock_schedule`, `dock_checkin`, `staging_board`, `crossdock_workspace`) show time-sensitive data (appointments, staging windows) in a mobile-readable format.
- `recall_analysis`/`expiration_queue` surface urgency (e.g., near-expiry) with clear visual hierarchy, not just a plain table.

---

## Tour 4 — Production and Quality

| | |
|---|---|
| Role | `review.production_operator` (secondary pass: `review.quality_reviewer` for quality-checkpoint pages) |
| Language | English |
| Viewport | Tablet (1024x768) |
| Starting page | `shopfloor_terminal` |
| Expected fixture | `production` (Phase A); `quality` (Phase A) for quality-checkpoint pages |
| Pages | 22 |

**Page sequence:** `shopfloor_terminal` → `workcenter_queue` →
`production_material_requests` → `production_issue_return` →
`production_receipt` → `quality_hold_queue` → `rework_workspace` →
`scrap_approval` → `downtime_board` → `operational_performance` →
`production_large_screen` → `demand_planning` → `forecast_versions` →
`forecast_overrides` → `forecast_accuracy` → `planning_exceptions` → `mps`
→ `mps_proposals` → `supply_demand_balance` → `sop_scenarios` →
`sop_review` → `scenario_planner`

**Key UI elements to inspect:** shop-floor terminal layout (tablet-first,
large touch targets), quality disposition/checkpoint flows, forecast charts
and variance indicators, S&OP scenario comparison views.

**Items to inspect:**
- `shopfloor_terminal`/`workcenter_queue` are legible and operable on a tablet held at arm's length (large text, minimal chrome).
- Quality flow (`quality_hold_queue` → `rework_workspace`/`scrap_approval`) makes the disposition decision (rework vs. scrap) and required approval clear, consistent with `KNOWN_LIMITATIONS.md`'s note on AI/quality proposal governance patterns.
- Forecast/planning pages (`demand_planning`, `forecast_versions`, `mps`) present numeric forecast data with readable units and comparison context, not bare numbers.
- `downtime_board`/`operational_performance` KPIs are labeled clearly enough for a non-specialist reviewer to interpret at a glance.
- `production_large_screen` checked at a genuinely large viewport in a second pass — tablet is the primary pass here for the operator-facing pages, not the board itself.

---

## Tour 5 — Finance and Commercial

| | |
|---|---|
| Role | `review.finance_manager` |
| Language | Arabic |
| Viewport | Desktop (1440x900) |
| Starting page | `finance` |
| Expected fixture | `workshop` general-ledger/cashbox fixture data — Finance domain pages have no dedicated Phase A fixture domain (`requiredFixture` is `none/global` for all 28 in `PAGE_INVENTORY.json`); note this to reviewers rather than assume a "finance" fixture exists |
| Pages | 41 |

**Page sequence:** `finance` → `cashbox` → `income` → `expenses` →
`receipt` → `customers` → `report` → `workshop_ledger` → `budgeting` →
`banking` → `ar_ap` → `finance_installments` → `contracts` →
`tax_compliance` → `treasury_cash_position` → `liquidity_forecast` →
`treasury_alerts` → `payment_funding_proposals` → `financing_facilities`
→ `intercompany_transactions` → `mismatch_queue` →
`intercompany_reconciliation` → `consolidation_groups` →
`account_mapping` → `consolidation_runs` → `eliminations` →
`consolidated_reports` → `consolidation_lineage` → `sales` →
`sales_price_lists` → `sales_commission` → `sales_contracts` →
`approvals` → `procurement` → `supplier_portal` → `pharmacy` → `retail` →
`clinic` → `restaurant` → `real-estate` → `hotel`

**Key UI elements to inspect:** currency/number formatting, financial
statement/report layouts, approval-workflow buttons, treasury/liquidity
charts, vertical-industry module dashboards (pharmacy/retail/clinic/etc.).

**Items to inspect:**
- Currency values are formatted consistently (symbol placement, decimal handling) across `finance`, `cashbox`, `banking`, `ar_ap`.
- Reference numbers (invoice/contract/transaction IDs) are human-readable, not raw database IDs.
- `intercompany_transactions`/`mismatch_queue`/`consolidation_*` pages (sibling-company / financial consolidation) clearly indicate which company/branch context is active, per `KNOWN_LIMITATIONS.md`'s tenant/company isolation notes.
- `approvals` shows pending vs. completed state clearly, with the approving role visible.
- Vertical-industry pages (`pharmacy`, `retail`, `clinic`, `restaurant`, `real-estate`, `hotel`) are consistent with each other in layout even though they serve different verticals — flag divergence as a Consistency finding.

---

## Tour 6 — SaaS Administration

| | |
|---|---|
| Role | `review.tenant_admin` (secondary pass: `review.sysadmin` for `admin_panel`/`security_center`) |
| Language | English |
| Viewport | Laptop (1366x768) |
| Starting page | `admin_panel` |
| Expected fixture | `commercial-saas` (Phase A) |
| Pages | 17 |

**Page sequence:** `admin_panel` → `multi_entity` → `security_center` →
`integration_hub` → `data_quality` → `risk_compliance` → `saas_overview`
→ `tenant_directory` → `tenant_detail` → `subscriptions` →
`commercial_plans` → `entitlements` → `seats_and_limits` →
`usage_and_quotas` → `billing_simulator` → `extension_marketplace` →
`extension_installations`

**Key UI elements to inspect:** tenant/company switcher, entitlement/plan
badges, billing-simulation banners (must be unmistakably simulation-only per
`KNOWN_LIMITATIONS.md`), extension marketplace cards, audit/security log
tables.

**Items to inspect:**
- `billing_simulator` clearly and persistently labels itself as simulation-only ("SIMULATION / NO EXTERNAL CHARGE") — this is a P0 finding if missing or easy to miss, per `KNOWN_LIMITATIONS.md`.
- `tenant_directory`/`tenant_detail` never leak data across tenants — cross-check with `review.isolation_viewer` separately (see `KNOWN_LIMITATIONS.md`'s permission-enforcement visibility gap: confirm server-side rejection, not just UI hiding).
- `entitlements`/`seats_and_limits`/`usage_and_quotas` numbers are internally consistent (used vs. limit).
- `security_center` audit entries are readable (actor, action, timestamp), not raw log dumps.
- `extension_marketplace`/`extension_installations` install/enable actions have clear confirmation and state feedback.

---

## Tour 7 — AI

| | |
|---|---|
| Role | `review.ai_operator` (secondary pass: `review.ai_reviewer` for `ai_proposal_inbox`) |
| Language | Arabic |
| Viewport | Desktop (1440x900) |
| Starting page | `ai_overview` |
| Expected fixture | `ai` (Phase A) |
| Pages | 18 |

**Page sequence:** `ai_overview` → `ai_assistant` → `ai_proposal_inbox` →
`ai_run_history` → `ai_policy_registry` → `ai_prompt_templates` →
`ai_context_sources` → `ai_queue` → `ai_factory` → `ai_tools` →
`ai_status` → `intelligence` → `automation` → `whatsapp` → `telegram` →
`omni_communications` → `analytics` → `nl_reports`

**Key UI elements to inspect:** proposal review cards (approve/reject/
withdraw actions), policy/prompt-template editors, run-history/audit trail,
channel-integration status (WhatsApp/Telegram) indicators, NL-report query
input.

**Items to inspect:**
- `ai_proposal_inbox` clearly separates pending/approved/rejected proposals and requires an explicit approve action before anything takes effect — per `KNOWN_LIMITATIONS.md`, test as `review.viewer` that a write action never happens without an approved proposal (P0 security-scope finding if it does).
- `ai_policy_registry`/`ai_prompt_templates` show who last edited a policy/prompt and when.
- `ai_run_history` entries are human-readable (task description, outcome), not raw model output dumps.
- `whatsapp`/`telegram`/`omni_communications` clearly indicate simulation-only status — no real channel is reachable per `KNOWN_LIMITATIONS.md`.
- `nl_reports` query input has clear affordance for what kinds of questions it accepts.

---

## Tour 8 — People Development

| | |
|---|---|
| Role | `review.people_manager` (secondary pass: `review.employee_self_service` for self-service scope checks) |
| Language | English |
| Viewport | Tablet (1024x768) |
| Starting page | `people_development_overview` |
| Expected fixture | `people-development` (Phase A) |
| Pages | 12 |

**Page sequence:** `people_development_overview` → `skills_catalog` →
`competency_profiles` → `person_skill_evidence` → `development_plans` →
`learning_and_certifications` → `employees` → `people_ops` →
`timesheet` → `calendar` → `import` → `training_lms`

**Key UI elements to inspect:** skill/competency matrices, evidence upload
and review flow, development-plan status transitions, timesheet/calendar
grid layout on tablet width.

**Items to inspect:**
- `skills_catalog`/`competency_profiles` matrices remain legible (not
  cramped) at tablet width — check for horizontal overflow.
- `person_skill_evidence`/`development_plans` clearly show whose record is
  being viewed and prevent one employee's self-service view from reaching
  another's data — sign in as `review.employee_self_service` (scope: `own`)
  and confirm it is genuinely restricted, per `KNOWN_LIMITATIONS.md`'s note
  that People Development fixtures attach to review user identities rather
  than a separate `employees` row (`employees`/payroll/attendance/timesheet
  tables are read-only frozen data — do not attempt to edit them; report any
  UI that appears to allow it as a functional finding).
- `training_lms`/`learning_and_certifications` show completion status with a
  clear visual distinction between completed/in-progress/not-started.
- `timesheet`/`calendar` remain read-only where expected (per the frozen-zone
  note above) — any edit affordance on payroll-adjacent data is a finding.

---

## Tour 9 — Marketing and Events

| | |
|---|---|
| Role | `review.marketing_manager` (secondary pass: `review.content_reviewer` for content approvals, `review.event_manager`/`review.event_checkin` for event pages) |
| Language | Arabic |
| Viewport | Mobile (390x844) |
| Starting page | `marketing_overview` |
| Expected fixture | `marketing` (Phase A); `events` (Phase A) for event pages |
| Pages | 11 |

**Page sequence:** `marketing_overview` → `campaigns` → `content_calendar`
→ `content_approvals` → `attribution_insights` → `marketing` →
`events_overview` → `event_planner` → `event_registrations` →
`event_checkin` → `events`

**Key UI elements to inspect:** campaign cards and status badges, content
calendar grid on mobile width, approval action buttons, event registration
list, check-in scan/confirm flow.

**Items to inspect:**
- `campaigns`/`content_calendar`/`content_approvals` all clearly label
  content as `[SIMULATED CONTENT - never sent to any real recipient]` per
  `KNOWN_LIMITATIONS.md` — flag as P0 if a "send"/"publish" action appears to
  reach anything external.
- `event_checkin` is usable one-handed at mobile width (this is the page
  most likely to be used on an actual phone at a real check-in desk).
  `events_overview`/`event_registrations` states: recall from
  `KNOWN_LIMITATIONS.md` that there is no literal "approved" or "no-show"
  status in the schema — don't file the absence of those exact labels as a
  bug, only genuinely broken status handling.
- `attribution_insights` numbers/charts are labeled clearly enough to
  interpret without raw query output.
- `marketing`/`events` (the simpler workshop-level pages) are visually
  consistent with the fuller `marketing_overview`/`events_overview` suites —
  flag divergence as a Consistency finding.

---

## Tour 10 — Configuration, Devices, Fleet, and Packs

| | |
|---|---|
| Role | `review.sysadmin` (secondary pass: `review.maintenance_fleet` for fleet pages, `review.package_reviewer` for pack install/enable actions) |
| Language | English |
| Viewport | Laptop (1366x768) |
| Starting page | `device_registry` |
| Expected fixture | `al-warsha-pack` (Phase A) for `vertical_packs`/`workshop_pack_setup`; IoT/Fleet/Kiosk pages have no dedicated Phase A fixture domain (`none/global` in `PAGE_INVENTORY.json`) — note this rather than assume one |
| Pages | 32 |

**Page sequence:** `device_registry` → `device_detail` →
`device_enrollment` → `gateway_management` → `sensor_management` →
`telemetry_explorer` → `device_health_center` → `device_alerts` →
`firmware_catalogue` → `rollout_simulator` → `configuration_profiles` →
`device_command_center` → `device_health_board` → `fleet_device_mapping`
→ `fleet_live_map_simulator` → `vehicle_trip_timeline` →
`geofence_management` → `geofence_events` → `speed_and_driver_events` →
`fuel_telemetry` → `suspected_fuel_loss_queue` → `maintenance_triggers`
→ `fleet` → `fleet_operations_board` → `employee_kiosk` →
`kiosk_device_registry` → `service_kiosk` → `shop_floor_kiosk` →
`warehouse_kiosk` → `device_center` → `vertical_packs` →
`workshop_pack_setup`

**Key UI elements to inspect:** device/gateway registry tables, telemetry
charts, firmware rollout progress, live-map/geofence overlays, kiosk-mode
layouts (no chrome, large touch targets), pack install/enable/rollback
action buttons.

**Items to inspect:**
- `fleet_live_map_simulator`/`vehicle_trip_timeline` map rendering doesn't break at laptop width; verify no horizontal overflow.
- `rollout_simulator`/`firmware_catalogue` clearly label simulation-only behavior (no real device is flashed), consistent with the simulation-only pattern in `KNOWN_LIMITATIONS.md`.
- Kiosk pages (`employee_kiosk`, `service_kiosk`, `shop_floor_kiosk`, `warehouse_kiosk`) should be checked in a second mobile/tablet pass too — they're designed for fixed terminals, not laptops; note if a kiosk page assumes desktop-only input (mouse-dependent controls).
- `vertical_packs`/`workshop_pack_setup`/pack install actions (`review.package_reviewer`) show validate → stage → approve → enable steps distinctly, not collapsed into one action.
- `suspected_fuel_loss_queue`/`geofence_events`/`device_alerts` alert severity is visually distinguishable (not just a plain list).
