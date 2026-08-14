---
page_id: "my_work"
title_en: "My Work"
title_ar: "عملي"
domain: "core"
navigation_group: "core_daily"
kind: "PAGE"
canonical_status: "PRIMARY"
canonical_home: "my_work"
parent_page: null
aliases: []
roles: ["workshop.user","workshop.manager","finance.user","finance.manager"]
permission: "workshop.user, workshop.manager, finance.user, finance.manager"
entitlement: "none/global (not a commercial/SaaS-gated page)"
renderer_type: "page-specific"
renderer_sources: ["modules/workshop-my-work.js"]
view_sources: ["views/my_work.html"]
api_sources: ["GET /api/v1/workshop/my-work"]
domain_sources: ["platform/workshop/my-work.mjs","platform/workshop/my-work-sources.mjs"]
tables_or_entities: ["work_items","wms_warehouse_tasks","wms_pick_tasks_v2","wms_count_sessions_v2","mfg_shopfloor_sessions","quality_ncrs","iot_device_alerts","platform_saved_views"]
test_sources: ["tests/workshop/my-work-contract.test.mjs","tests/workshop/my-work-domain.test.mjs","tests/workshop/browser-flows.test.mjs"]
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

- Page ID: `my_work`; English: My Work; domain: `core`; navigation group: `core_daily`.
- Route: `switchPage('my_work')`; page-specific renderer: `modules/workshop-my-work.js`; view: `views/my_work.html`.
- Canonical status: PRIMARY; this is a primary catalog destination, not an embedded tab or compatibility alias.

# 2. Business Purpose

Operators open My Work to see assigned, still-open work across canonical work, warehouse, picking, cycle-count, shop-floor, quality, and device-alert sources, then jump to the source workspace.

# 3. Primary Users

- Declared client gate: "workshop.user, workshop.manager, finance.user, finance.manager".
- Business roles: owner/operator/reviewer/approver/manager split is partly evidenced by the cited domain boundary but requires direct role-isolation proof.

# 4. Primary User Goal

USER OPENS THIS PAGE TO: Operators open My Work to see assigned, still-open work across canonical work, warehouse, picking, cycle-count, shop-floor, quality, and device-alert sources, then jump to the source workspace.

# 5. AS-IS Runtime Surface

- Renderer/view: `modules/workshop-my-work.js` and `views/my_work.html`.
- Query/action boundary: GET /api/v1/workshop/my-work.
- Current classification: **CONNECTED**; usability: **USABLE**.
- Visible primary actions:
- Refresh/filter/preset -> my-work query and saved-view query
- Open source -> switchPage(source.target)
- The page-specific evidence is separated from navigation proof. A visible route does not prove persistence, permission isolation, or completed workflow.

# 6. Data Sources

- UI to API/query: `GET /api/v1/workshop/my-work`.
- Domain authority: `platform/workshop/my-work.mjs; platform/workshop/my-work-sources.mjs`.
- Persisted entities/tables where source evidence permits: `work_items`, `wms_warehouse_tasks`, `wms_pick_tasks_v2`, `wms_count_sessions_v2`, `mfg_shopfloor_sessions`, `quality_ncrs`, `iot_device_alerts`, `platform_saved_views`.
- Company/branch/warehouse/actor scope: server-derived scope is required where the cited API/domain supports it; page-specific isolation proof remains a separate acceptance item.

# 7. Actions

- Refresh/filter/preset -> my-work query and saved-view query — permission: declared page gate plus server action authorization; persistence: My Work is an orchestration/read surface; work_items and each source domain remain authoritative.
- Open source -> switchPage(source.target) — permission: declared page gate plus server action authorization; persistence: My Work is an orchestration/read surface; work_items and each source domain remain authoritative.

# 8. Inputs

- Required business inputs: record IDs, governed party/product/project/warehouse selectors, lifecycle decisions, quantities/reasons, and source references according to the action.
- Raw IDs must not bypass company, branch, warehouse, actor, maker-checker, or lifecycle validation.
- For connected actions, the server must derive scope and validate stale state before persistence.

# 9. Outputs

Unified assigned-work list with source, status, target page, and saved view state.

# 10. Workflow Position

- Upstream: actor/company/warehouse scope; assigned source records.
- Downstream: task_manager; warehouse_task_queue; picking_execution; mobile_cycle_count; shopfloor_terminal; quality_checkpoint; device_health_monitor.
- Workflow classification: CONNECTED for the cited page-to-domain edge; cross-page completion edges marked in gaps are not assumed.

# 11. States

- LOADING, READY, EMPTY, PARTIAL, DENIED, SERVER_ERROR.
- LOADING, EMPTY, DENIED, VALIDATION_ERROR, SERVER_ERROR, and SUCCESS/HANDOFF must remain visibly distinct wherever the renderer supports the corresponding state.
- State persistence and transition authority: My Work is an orchestration/read surface; work_items and each source domain remain authoritative.

# 12. Permissions & Scope

- Client navigation gate: workshop.user, workshop.manager, finance.user, finance.manager.
- Server authorization: action/resource permission plus company/branch/warehouse/actor scope as enforced by the cited API/domain; exact matrix is partly evidenced, not fully proven here.
- A visible button is not authorization proof. Approver/requester separation is required for governed actions.

# 13. Arabic / English

- English label: My Work; Arabic label source: عملي.
- Every primary action and lifecycle state needs a paired visible Arabic/English label; mojibake or untranslated state text is a usability defect.

# 14. Responsive Requirements

- Desktop: preserve scope, record identity, state, primary action, errors, and handoff reference without hiding the business decision.
- Mobile: if used by workshop, warehouse, field, or supplier staff, prove the smallest complete action with controls and validation visible; direct mobile behavior is NOT VERIFIED.

# 15. AS-IS Functional Assessment

**CONNECTED / USABLE** — Workshop contract/domain/browser test references; direct cross-source browser lifecycle NOT VERIFIED.. This is a source-evidence classification, not a release acceptance claim.

# 16. Target Business Contract

Operators open My Work to see assigned, still-open work across canonical work, warehouse, picking, cycle-count, shop-floor, quality, and device-alert sources, then jump to the source workspace. The target contract is a governed page-specific workflow that loads scoped data, exposes lifecycle-valid actions, persists through **My Work is an orchestration/read surface; work_items and each source domain remain authoritative.**, returns a durable reference, and distinguishes loading, empty, denied, validation, server-error, and success states. The target is not complete until the gaps and acceptance criteria below have evidence.

# 17. Identified Gaps

- **my_work-W3-01** (P1, WORKFLOW_DISCONNECT) — The source registry is explicit, but cross-source completion and de-duplication are not proven in one browser lifecycle. **Required next step:** Prove one canonical work item and one warehouse/picking item retain scope and disappear or change state after completion.

# 18. Consolidation Analysis

- Recommended disposition: **KEEP_PRIMARY**.
- Keep this page separate only when its user goal and lifecycle authority are distinct. Shared tables, tabs, or labels alone are not proof of duplication.
- Canonical authority decision: My Work is an orchestration/read surface; work_items and each source domain remain authoritative.

# 19. Acceptance Criteria

- A permitted user opens the page and sees a non-error page-specific surface in the active scope.
- Each primary action validates required inputs, actor/tenant scope, lifecycle state, and maker-checker rules; its response shows the resulting state and durable reference.
- A direct browser/API/domain test proves the highest-risk transition and confirms persistence; navigation-only evidence is insufficient.
- Cross-page handoffs identified above are either proven in a lifecycle test or explicitly rendered as manual/not verified.
- For this page specifically: Operators open My Work to see assigned, still-open work across canonical work, warehouse, picking, cycle-count, shop-floor, quality, and device-alert sources, then jump to the source workspace.

# 20. Test Evidence

- Evidence class: **Workshop contract/domain/browser test references; direct cross-source browser lifecycle NOT VERIFIED.**
- Cited source/tests:
- `tests/workshop/my-work-contract.test.mjs`
- `tests/workshop/my-work-domain.test.mjs`
- `tests/workshop/browser-flows.test.mjs`
- Navigation audit, if cited by the existing catalog, proves route activation/visible surface only; it does not prove domain mutation, isolation, or persistence.

# 21. Known Limitations

- Catalog baseline: `3c047bb0d04985cd88a536d4dbb16b74d2d6405a`; engineering reference: `25c24df753962bbf3c13301eed71624bc0ee39b6`.
- Wave 3 is documentation-only. No engineering source, tests, migrations, runtime data, navigation, or product implementation was changed.
- Source evidence is current to the recorded engineering reference; uncommitted engineering changes are outside this spec.

# 22. Source Evidence

- `modules/workshop-my-work.js`
- `views/my_work.html`
- `platform/workshop/my-work.mjs`
- `platform/workshop/my-work-sources.mjs`
- `tests/workshop/my-work-contract.test.mjs`
- `tests/workshop/my-work-domain.test.mjs`
- `tests/workshop/browser-flows.test.mjs`

# 23. Change History

- 2026-08-14 — Wave 3 deep review from engineering reference `25c24df753962bbf3c13301eed71624bc0ee39b6`; Wave 2 pages and catalog history were preserved.

## CAPABILITIES OWNED

- My Work is an orchestration/read surface; work_items and each source domain remain authoritative.

## CAPABILITIES CONSUMED

- actor/company/warehouse scope; assigned source records; task_manager; warehouse_task_queue; picking_execution; mobile_cycle_count; shopfloor_terminal; quality_checkpoint; device_health_monitor
