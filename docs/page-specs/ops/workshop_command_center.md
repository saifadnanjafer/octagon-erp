---
page_id: "workshop_command_center"
title_en: "Workshop Command Center"
title_ar: "مركز قيادة الورشة"
domain: "ops"
navigation_group: "ops_control"
kind: "DASHBOARD"
canonical_status: "PRIMARY"
canonical_home: "workshop_command_center"
parent_page: null
aliases: []
roles: ["workshop.user","workshop.manager","finance.manager"]
permission: "workshop.user, workshop.manager, finance.manager"
entitlement: "none/global (not a commercial/SaaS-gated page)"
renderer_type: "page-specific"
renderer_sources: ["modules/workshop-command-center.js"]
view_sources: ["views/workshop_command_center.html"]
api_sources: ["GET /api/v1/workshop/command-center"]
domain_sources: ["platform/workshop/command-center.mjs"]
tables_or_entities: ["platform_companies","platform_branches","warehouses","work_items","wms_warehouse_tasks","wms_pick_tasks_v2","mfg_shopfloor_sessions","quality_ncrs","iot_device_alerts"]
test_sources: ["tests/workshop/command-center-contract.test.mjs","tests/workshop/command-center-domain.test.mjs","tests/workshop/browser-flows.test.mjs"]
catalog_baseline_sha: "3c047bb0d04985cd88a536d4dbb16b74d2d6405a"
last_verified_sha: "25c24df753962bbf3c13301eed71624bc0ee39b6"
engineering_reference_sha: "25c24df753962bbf3c13301eed71624bc0ee39b6"
deep_review_wave: 3
evidence_confidence: "HIGH"
implementation_status: "IMPLEMENTED_AT_ENGINEERING_REFERENCE"
functional_status: "CONNECTED"
usability_status: "USABLE"
review_status: "REQUIRES_PRODUCT_RECOVERY"
---

# 1. Identity

- Page ID: `workshop_command_center`; English: Workshop Command Center; domain: `ops`; navigation group: `ops_control`.
- Route: `switchPage('workshop_command_center')`; page-specific renderer: `modules/workshop-command-center.js`; view: `views/workshop_command_center.html`.
- Canonical status: PRIMARY; this is a primary catalog destination, not an embedded tab or compatibility alias.

# 2. Business Purpose

Supervisors open this page to see the scoped operational briefing, identify unavailable or blocked workshop capabilities, and drill into the canonical workspace that owns the next action.

# 3. Primary Users

- Declared client gate: "workshop.user, workshop.manager, finance.manager".
- Business roles: owner/operator/reviewer/approver/manager split is partly evidenced by the cited domain boundary but requires direct role-isolation proof.

# 4. Primary User Goal

USER OPENS THIS PAGE TO: Supervisors open this page to see the scoped operational briefing, identify unavailable or blocked workshop capabilities, and drill into the canonical workspace that owns the next action.

# 5. AS-IS Runtime Surface

- Renderer/view: `modules/workshop-command-center.js` and `views/workshop_command_center.html`.
- Query/action boundary: GET /api/v1/workshop/command-center.
- Current classification: **CONNECTED**; usability: **USABLE**.
- Visible primary actions:
- Refresh -> workshop command-center query
- Open canonical workspace -> switchPage(target)
- The page-specific evidence is separated from navigation proof. A visible route does not prove persistence, permission isolation, or completed workflow.

# 6. Data Sources

- UI to API/query: `GET /api/v1/workshop/command-center`.
- Domain authority: `platform/workshop/command-center.mjs`.
- Persisted entities/tables where source evidence permits: `platform_companies`, `platform_branches`, `warehouses`, `work_items`, `wms_warehouse_tasks`, `wms_pick_tasks_v2`, `mfg_shopfloor_sessions`, `quality_ncrs`, `iot_device_alerts`.
- Company/branch/warehouse/actor scope: server-derived scope is required where the cited API/domain supports it; page-specific isolation proof remains a separate acceptance item.

# 7. Actions

- Refresh -> workshop command-center query — permission: declared page gate plus server action authorization; persistence: Command-center aggregation is a read-only briefing; the target operational domain owns every mutation.
- Open canonical workspace -> switchPage(target) — permission: declared page gate plus server action authorization; persistence: Command-center aggregation is a read-only briefing; the target operational domain owns every mutation.

# 8. Inputs

- Required business inputs: record IDs, governed party/product/project/warehouse selectors, lifecycle decisions, quantities/reasons, and source references according to the action.
- Raw IDs must not bypass company, branch, warehouse, actor, maker-checker, or lifecycle validation.
- For connected actions, the server must derive scope and validate stale state before persistence.

# 9. Outputs

Scoped total/available/denied/unavailable/partial summary, sections, and target navigation.

# 10. Workflow Position

- Upstream: company/branch/warehouse context; workshop readiness.
- Downstream: task_manager; warehouse_task_queue; picking_execution; quality_checkpoint; device_health_monitor.
- Workflow classification: CONNECTED for the cited page-to-domain edge; cross-page completion edges marked in gaps are not assumed.

# 11. States

- READY, PARTIAL, UNAVAILABLE, DENIED, EMPTY, SERVER_ERROR.
- LOADING, EMPTY, DENIED, VALIDATION_ERROR, SERVER_ERROR, and SUCCESS/HANDOFF must remain visibly distinct wherever the renderer supports the corresponding state.
- State persistence and transition authority: Command-center aggregation is a read-only briefing; the target operational domain owns every mutation.

# 12. Permissions & Scope

- Client navigation gate: workshop.user, workshop.manager, finance.manager.
- Server authorization: action/resource permission plus company/branch/warehouse/actor scope as enforced by the cited API/domain; exact matrix is partly evidenced, not fully proven here.
- A visible button is not authorization proof. Approver/requester separation is required for governed actions.

# 13. Arabic / English

- English label: Workshop Command Center; Arabic label source: مركز قيادة الورشة.
- Every primary action and lifecycle state needs a paired visible Arabic/English label; mojibake or untranslated state text is a usability defect.

# 14. Responsive Requirements

- Desktop: preserve scope, record identity, state, primary action, errors, and handoff reference without hiding the business decision.
- Mobile: if used by workshop, warehouse, field, or supplier staff, prove the smallest complete action with controls and validation visible; direct mobile behavior is NOT VERIFIED.

# 15. AS-IS Functional Assessment

**CONNECTED / USABLE** — REAL_BROWSER_VISIBLE_UI plus workshop contract/domain tests; no direct mutation proof.. This is a source-evidence classification, not a release acceptance claim.

# 16. Target Business Contract

Supervisors open this page to see the scoped operational briefing, identify unavailable or blocked workshop capabilities, and drill into the canonical workspace that owns the next action. The target contract is a governed page-specific workflow that loads scoped data, exposes lifecycle-valid actions, persists through **Command-center aggregation is a read-only briefing; the target operational domain owns every mutation.**, returns a durable reference, and distinguishes loading, empty, denied, validation, server-error, and success states. The target is not complete until the gaps and acceptance criteria below have evidence.

# 17. Identified Gaps

- **workshop_command_center-W3-01** (P1, WORKFLOW_DISCONNECT) — The briefing exposes several target pages, but direct action completion remains on the target workspace; no end-to-end supervisor-to-result browser proof is attributed to this page. **Required next step:** Attach a direct browser flow that drills from one non-empty briefing card through the target lifecycle and back.

# 18. Consolidation Analysis

- Recommended disposition: **KEEP_PRIMARY**.
- Keep this page separate only when its user goal and lifecycle authority are distinct. Shared tables, tabs, or labels alone are not proof of duplication.
- Canonical authority decision: Command-center aggregation is a read-only briefing; the target operational domain owns every mutation.

# 19. Acceptance Criteria

- A permitted user opens the page and sees a non-error page-specific surface in the active scope.
- Each primary action validates required inputs, actor/tenant scope, lifecycle state, and maker-checker rules; its response shows the resulting state and durable reference.
- A direct browser/API/domain test proves the highest-risk transition and confirms persistence; navigation-only evidence is insufficient.
- Cross-page handoffs identified above are either proven in a lifecycle test or explicitly rendered as manual/not verified.
- For this page specifically: Supervisors open this page to see the scoped operational briefing, identify unavailable or blocked workshop capabilities, and drill into the canonical workspace that owns the next action.

# 20. Test Evidence

- Evidence class: **REAL_BROWSER_VISIBLE_UI plus workshop contract/domain tests; no direct mutation proof.**
- Cited source/tests:
- `tests/workshop/command-center-contract.test.mjs`
- `tests/workshop/command-center-domain.test.mjs`
- `tests/workshop/browser-flows.test.mjs`
- Navigation audit, if cited by the existing catalog, proves route activation/visible surface only; it does not prove domain mutation, isolation, or persistence.

# 21. Known Limitations

- Catalog baseline: `3c047bb0d04985cd88a536d4dbb16b74d2d6405a`; engineering reference: `25c24df753962bbf3c13301eed71624bc0ee39b6`.
- Wave 3 is documentation-only. No engineering source, tests, migrations, runtime data, navigation, or product implementation was changed.
- Source evidence is current to the recorded engineering reference; uncommitted engineering changes are outside this spec.

# 22. Source Evidence

- `modules/workshop-command-center.js`
- `views/workshop_command_center.html`
- `platform/workshop/command-center.mjs`
- `tests/workshop/command-center-contract.test.mjs`
- `tests/workshop/command-center-domain.test.mjs`
- `tests/workshop/browser-flows.test.mjs`

# 23. Change History

- 2026-08-14 — Wave 3 deep review from engineering reference `25c24df753962bbf3c13301eed71624bc0ee39b6`; Wave 2 pages and catalog history were preserved.

## CAPABILITIES OWNED

- Command-center aggregation is a read-only briefing; the target operational domain owns every mutation.

## CAPABILITIES CONSUMED

- company/branch/warehouse context; workshop readiness; task_manager; warehouse_task_queue; picking_execution; quality_checkpoint; device_health_monitor
