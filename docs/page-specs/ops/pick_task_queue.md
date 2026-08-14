---
page_id: "pick_task_queue"
title_en: "Pick Task Queue"
title_ar: ""
domain: "ops"
navigation_group: "ops_inventory"
kind: QUEUE
canonical_status: "PRIMARY"
canonical_home: "pick_task_queue"
parent_page: null
aliases: []
roles: ["workshop.user"]
permission: "workshop.user"
entitlement: "none/global"
renderer_type: "javascript"
renderer_sources: ["modules/build09-pick-task-queue-workspace.js"]
view_sources: []
api_sources: ["platform/api/build09.mjs"]
domain_sources: ["modules/build09-pick-task-queue-workspace.js", "platform/wms/index.mjs", "platform/wms/picking.mjs"]
tables_or_entities: ["wms_pick_tasks_v2"]
test_sources: ["tests/build-09/pick-task-queue-denial-browser.test.mjs", "tests/build-09/pick-task-warehouse-isolation.test.mjs", "tests/build-09/operational-32-page-matrix-chromium.test.mjs"]
catalog_baseline_sha: "aa730dd23462aab3e90b70ad2db1bf6cc945ca99"
last_verified_sha: "25c24df753962bbf3c13301eed71624bc0ee39b6"
engineering_reference_sha: "25c24df753962bbf3c13301eed71624bc0ee39b6"
evidence_confidence: "HIGH"
implementation_status: "IMPLEMENTED_AT_ENGINEERING_REFERENCE"
functional_status: "CONNECTED"
usability_status: "USABLE"
review_status: "REQUIRES_PRODUCT_RECOVERY"
---

# 1. Identity

- Page ID: `pick_task_queue`; English: Pick Task Queue; domain: `ops`; navigation group: `ops_inventory`.
- Route: `switchPage('pick_task_queue')`; page-specific renderer is `modules/build09-pick-task-queue-workspace.js`.
- Canonical status: PRIMARY. Embedded tabs and compatibility aliases are not treated as separate pages.

# 2. Business Purpose

Dispatch ready and assigned pick work to warehouse operators while showing wave, product, quantity, and exception state.

# 3. Primary Users

- Declared client gate: `workshop.user`.
- Operational roles implied by the renderer/domain boundary: warehouse operator, reviewer/approver, and manager; exact role-to-action matrix remains a server-governance concern.

# 4. Primary User Goal

Complete the named operational workflow inside the active company and warehouse scope, with the page showing the resulting lifecycle state and any canonical handoff reference.

# 5. AS-IS Runtime Surface

- Renderer: `modules/build09-pick-task-queue-workspace.js`; the module registers a page-specific BUILD-09 workspace/override rather than relying on the generic table shell.
- Data loading: `pick-tasks` through the governed Build-09 API/query boundary; mobile picking additionally uses the explicit pick-task GET route.
- Primary actions exposed by this page: wms:pick_task_assign.
- Visible behavior: page-specific loading, empty/muted, status/badge, validation/error, and success or handoff panels are present where the workflow reaches them.
- The page is operationally connected, but route activation alone is not persistence or isolation proof; this spec attributes those claims only to the cited domain and browser tests.

# 6. Data Sources

- UI → query/action boundary: `platform/api/build09.mjs`; every Build-09 query requires company context and an active warehouse belonging to that company.
- Renderer/domain source: `modules/build09-pick-task-queue-workspace.js` → `picking.listPickTasks/assignPickTask`.
- Persisted entities/tables: wms_pick_tasks_v2.
- Warehouse scope is injected as `warehouse_id`; server code rejects missing or out-of-scope warehouses instead of trusting client labels.

# 7. Actions

- `wms:pick_task_assign`

- Each mutation is routed through `/api/v1/action/:actionId` (or the explicit governed API used by the mobile renderer), carries warehouse scope and idempotency where applicable, and is owned by the WMS/shop-floor/quality domain rather than by the page.
- Canonical boundary: where the action is a request or acknowledgement, this page records the request/result reference; canonical Inventory or Quality remains authoritative for the stock/inspection effect.

# 8. Inputs

- Governed selectors are used for warehouse locations/products where the renderer requires them; raw IDs are not sufficient evidence of authorization.
- Operational inputs include the record identifier, barcode/product/lot/serial evidence, quantity/reason, status decision, or canonical result reference according to the page family.
- Validation must reject missing required IDs, invalid quantities, warehouse mismatch, stale state, and maker-checker violations.

# 9. Outputs

- The page renders scoped records from `pick-tasks`, lifecycle/status badges, quantities and operational KPIs where applicable.
- Mutations persist into wms_pick_tasks_v2 and refresh the query result; canonical handoff pages expose the returned request/result reference without claiming ownership of the canonical side effect.

# 10. Workflow Position

- Upstream: wave_planning, replenishment_proposals.
- Downstream: mobile_picking, wave_execution.
- Workflow edges above are taken from renderer query/action wiring and domain ownership, not from title similarity.

# 11. States

- LOADING: async query/action in progress; controls must be guarded against duplicate submission.
- READY: scoped records or an actionable form are visible.
- EMPTY: the page explains that no records/tasks/proposals exist in the current warehouse scope and offers the next valid action where the renderer supports one.
- DENIED: permission or warehouse-scope failure is rendered as a denied/error state; client navigation is not treated as authorization proof.
- VALIDATION_ERROR: missing required barcode/ID, invalid quantity, stale state, or maker-checker violation.
- SERVER_ERROR: API/domain failure remains visible and recoverable without inventing a success state.
- SUCCESS/HANDOFF: resulting status and canonical reference are shown after the domain operation succeeds.
- Domain status vocabulary is page-specific and is defined by the cited WMS/shop-floor/quality handler; do not collapse request, approved, awaiting_canonical, and completed into one state.

# 12. Permissions & Scope

- Client gate: `workshop.user`; server resource permission is mapped in `BUILD09_RESOURCE_PERMISSIONS` for the relevant resource family.
- Required server context: `companyId` plus an active `warehouse_id` that belongs to that company. The handler injects `company_id` and `warehouse_id` into domain reads.
- Mutations and approvals require action-specific authorization; a visible button is not proof that every role may execute it.

# 13. Arabic / English

- English label: Pick Task Queue; Arabic label is owned by the navigation/module localization layer and must remain paired with the visible English action/state label.
- Any mojibake or missing translation in the inspected renderer is a usability defect, not a reason to infer a different business capability.

# 14. Responsive Requirements

- Desktop: list/detail or operational board must preserve scope, status, primary action, and error copy without horizontal loss.
- Mobile/scanner: controls must keep scan inputs, quantity/reason fields, and next action visible; direct mobile behavior is required for the two scanner workspaces and remains an explicit gap elsewhere.

# 15. AS-IS Functional Assessment

**ALREADY_IMPLEMENTED / CONNECTED / USABLE** — The engineering reference contains a page-specific renderer, the cited Build-09 query/action boundary, and domain persistence evidence. This does not claim that every target contract or browser lifecycle is complete; the gaps below are the remaining proof/reconciliation work.

# 16. Target Business Contract

The page must load data for the active company/warehouse, expose only the actions appropriate to the current lifecycle state, persist through the named domain authority, show explicit loading/empty/denied/validation/server-error/success states, and preserve canonical ownership boundaries. A target implementation is not complete until the relevant lifecycle, permission/isolation, and browser evidence is attached.

# 17. Identified Gaps

- **PAGE-pick_task_queue-GAP-001** (P1, PERMISSION) — the viewer read path must be demonstrably scoped while mutation remains denied where required
- **PAGE-pick_task_queue-GAP-002** (P1, TEST) — prove assignment race handling when two operators select the same ready task

# 18. Consolidation Analysis

- Remain a primary workspace: YES, pending owner review; the source navigation treats this as a primary destination and the renderer owns a distinct operational workflow.
- Do not consolidate solely because another page shares a query or table. Shared WMS resources are expected; independent user goals and lifecycle boundaries remain separate.
- Canonical home: `pick_task_queue` unless a later owner decision explicitly changes the navigation contract.

# 19. Acceptance Criteria

- A permitted user opens the page and sees a non-error, page-specific surface in the active warehouse scope.
- Query results and mutation responses are company/warehouse isolated on the server.
- The primary workflow is executable with required validation and explicit state transitions; canonical handoffs show their request/result boundary.
- The cited focused contract/domain/browser tests pass, and a direct browser lifecycle proves the highest-risk transition identified above.

# 20. Test Evidence

- STATIC/CONTRACT: `modules/build09-pick-task-queue-workspace.js`, `platform/api/build09.mjs`, `platform/wms/index.mjs`.
- BUILD-09 test sources:
- `tests/build-09/pick-task-queue-denial-browser.test.mjs`
- `tests/build-09/pick-task-warehouse-isolation.test.mjs`
- `tests/build-09/operational-32-page-matrix-chromium.test.mjs`
- The 231-page navigation audit is route/visible-surface evidence only; it is not substituted for action, persistence, or isolation proof.

# 21. Known Limitations

- Catalog baseline: `aa730dd23462aab3e90b70ad2db1bf6cc945ca99`; engineering reference researched: `25c24df753962bbf3c13301eed71624bc0ee39b6`.
- This is documentation-only reconciliation. It does not modify engineering source, tests, migrations, or product documentation.
- Fixture availability and current server runtime state are not inferred from source wiring; they must be proven by the cited tests or a future direct browser run.

# 22. Source Evidence

- `modules/build09-pick-task-queue-workspace.js`
- `platform/api/build09.mjs`
- `platform/wms/index.mjs`
- `services/permissionService.js`
- `picking.listPickTasks` → `assignPickTask`

# 23. Change History

- 2026-08-14 — Wave 2 continuation: deepened from engineering reference `25c24df753962bbf3c13301eed71624bc0ee39b6`; preserved catalog baseline `aa730dd23462aab3e90b70ad2db1bf6cc945ca99`.

## CAPABILITIES OWNED

- Pick Task Queue page-specific presentation, validation, and lifecycle orchestration at the cited module boundary.

## CAPABILITIES CONSUMED

- Build-09 scoped resources, action executor, domain persistence, canonical Inventory/Quality authority where applicable, and warehouse/company permission enforcement.
