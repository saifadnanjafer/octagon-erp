---
page_id: "service_queue_board"
title_en: "Service Queue Board"
title_ar: "لوحة طابور الخدمة"
domain: "ops"
navigation_group: "ops_boards"
kind: "QUEUE"
canonical_status: "PRIMARY"
canonical_home: "service_queue_board"
parent_page: null
aliases: []
roles: ["any authenticated user"]
permission: "none (public/open)"
entitlement: "none/global (not a commercial/SaaS-gated page)"
renderer_type: "page-specific"
renderer_sources: ["Service queue renderer (source path NOT VERIFIED)"]
view_sources: ["Service queue view (source path NOT VERIFIED)"]
api_sources: ["GET /api/v1/service/queue; POST /api/v1/action/service:*"]
domain_sources: ["Service queue authority (source path NOT VERIFIED)"]
tables_or_entities: ["service_jobs","service_queue_events","work_items"]
test_sources: ["tests/phase03/service_queue.test.mjs","tests/navigation/run-click-audit.mjs"]
catalog_baseline_sha: "3c047bb0d04985cd88a536d4dbb16b74d2d6405a"
last_verified_sha: "25c24df753962bbf3c13301eed71624bc0ee39b6"
engineering_reference_sha: "25c24df753962bbf3c13301eed71624bc0ee39b6"
deep_review_wave: 3
evidence_confidence: "HIGH"
implementation_status: "IMPLEMENTED_AT_ENGINEERING_REFERENCE"
functional_status: "CONNECTED"
usability_status: "STRONG"
review_status: "REQUIRES_PRODUCT_RECOVERY"
---

# 1. Identity

- Page ID: `service_queue_board`; English: Service Queue Board; domain: `ops`; navigation group: `ops_boards`.
- Route: `switchPage('service_queue_board')`; page-specific renderer: `Service queue renderer (source path NOT VERIFIED)`; view: `Service queue view (source path NOT VERIFIED)`.
- Canonical status: PRIMARY; this is a primary catalog destination, not an embedded tab or compatibility alias.

# 2. Business Purpose

A service manager opens the queue board to prioritize and route service work using visible status, ownership, and exception signals.

# 3. Primary Users

- Declared client gate: "none (public/open)".
- Business roles: owner/operator/reviewer/approver/manager split is partly evidenced by the cited domain boundary but requires direct role-isolation proof.

# 4. Primary User Goal

USER OPENS THIS PAGE TO: A service manager opens the queue board to prioritize and route service work using visible status, ownership, and exception signals.

# 5. AS-IS Runtime Surface

- Renderer/view: `Service queue renderer (source path NOT VERIFIED)` and `Service queue view (source path NOT VERIFIED)`.
- Query/action boundary: GET /api/v1/service/queue; POST /api/v1/action/service:*.
- Current classification: **CONNECTED**; usability: **STRONG**.
- Visible primary actions:
- Refresh/filter -> service queue query
- Assign/status action -> service action executor
- The page-specific evidence is separated from navigation proof. A visible route does not prove persistence, permission isolation, or completed workflow.

# 6. Data Sources

- UI to API/query: `GET /api/v1/service/queue; POST /api/v1/action/service:*`.
- Domain authority: `Service queue authority (source path NOT VERIFIED)`.
- Persisted entities/tables where source evidence permits: `service_jobs`, `service_queue_events`, `work_items`.
- Company/branch/warehouse/actor scope: server-derived scope is required where the cited API/domain supports it; page-specific isolation proof remains a separate acceptance item.

# 7. Actions

- Refresh/filter -> service queue query — permission: declared page gate plus server action authorization; persistence: Queue owns routing state; service/workshop/finance domains own downstream effects.
- Assign/status action -> service action executor — permission: declared page gate plus server action authorization; persistence: Queue owns routing state; service/workshop/finance domains own downstream effects.

# 8. Inputs

- Required business inputs: record IDs, governed party/product/project/warehouse selectors, lifecycle decisions, quantities/reasons, and source references according to the action.
- Raw IDs must not bypass company, branch, warehouse, actor, maker-checker, or lifecycle validation.
- For connected actions, the server must derive scope and validate stale state before persistence.

# 9. Outputs

Prioritized queue, assignment/status updates, and exception reason.

# 10. Workflow Position

- Upstream: service intake, customer, workshop job.
- Downstream: task_manager; field_service; finance.
- Workflow classification: CONNECTED for the cited page-to-domain edge; cross-page completion edges marked in gaps are not assumed.

# 11. States

- LOADING, READY, EMPTY, BLOCKED, DENIED, SERVER_ERROR.
- LOADING, EMPTY, DENIED, VALIDATION_ERROR, SERVER_ERROR, and SUCCESS/HANDOFF must remain visibly distinct wherever the renderer supports the corresponding state.
- State persistence and transition authority: Queue owns routing state; service/workshop/finance domains own downstream effects.

# 12. Permissions & Scope

- Client navigation gate: none (public/open).
- Server authorization: action/resource permission plus company/branch/warehouse/actor scope as enforced by the cited API/domain; exact matrix is partly evidenced, not fully proven here.
- A visible button is not authorization proof. Approver/requester separation is required for governed actions.

# 13. Arabic / English

- English label: Service Queue Board; Arabic label source: لوحة طابور الخدمة.
- Every primary action and lifecycle state needs a paired visible Arabic/English label; mojibake or untranslated state text is a usability defect.

# 14. Responsive Requirements

- Desktop: preserve scope, record identity, state, primary action, errors, and handoff reference without hiding the business decision.
- Mobile: if used by workshop, warehouse, field, or supplier staff, prove the smallest complete action with controls and validation visible; direct mobile behavior is partly evidenced.

# 15. AS-IS Functional Assessment

**CONNECTED / STRONG** — Page/module and focused service test references; downstream persistence not fully verified.. This is a source-evidence classification, not a release acceptance claim.

# 16. Target Business Contract

A service manager opens the queue board to prioritize and route service work using visible status, ownership, and exception signals. The target contract is a governed page-specific workflow that loads scoped data, exposes lifecycle-valid actions, persists through **Queue owns routing state; service/workshop/finance domains own downstream effects.**, returns a durable reference, and distinguishes loading, empty, denied, validation, server-error, and success states. The target is not complete until the gaps and acceptance criteria below have evidence.

# 17. Identified Gaps

- **service_queue_board-W3-01** (P1, WORKFLOW_DISCONNECT) — A queue handoff to canonical workshop, field-service, and finance completion is not proven as one lifecycle. **Required next step:** Add one direct browser flow for assignment through completion and financial handoff.

# 18. Consolidation Analysis

- Recommended disposition: **KEEP_PRIMARY**.
- Keep this page separate only when its user goal and lifecycle authority are distinct. Shared tables, tabs, or labels alone are not proof of duplication.
- Canonical authority decision: Queue owns routing state; service/workshop/finance domains own downstream effects.

# 19. Acceptance Criteria

- A permitted user opens the page and sees a non-error page-specific surface in the active scope.
- Each primary action validates required inputs, actor/tenant scope, lifecycle state, and maker-checker rules; its response shows the resulting state and durable reference.
- A direct browser/API/domain test proves the highest-risk transition and confirms persistence; navigation-only evidence is insufficient.
- Cross-page handoffs identified above are either proven in a lifecycle test or explicitly rendered as manual/not verified.
- For this page specifically: A service manager opens the queue board to prioritize and route service work using visible status, ownership, and exception signals.

# 20. Test Evidence

- Evidence class: **Page/module and focused service test references; downstream persistence not fully verified.**
- Cited source/tests:
- `tests/phase03/service_queue.test.mjs`
- `tests/navigation/run-click-audit.mjs`
- Navigation audit, if cited by the existing catalog, proves route activation/visible surface only; it does not prove domain mutation, isolation, or persistence.

# 21. Known Limitations

- Catalog baseline: `3c047bb0d04985cd88a536d4dbb16b74d2d6405a`; engineering reference: `25c24df753962bbf3c13301eed71624bc0ee39b6`.
- Wave 3 is documentation-only. No engineering source, tests, migrations, runtime data, navigation, or product implementation was changed.
- Source evidence is current to the recorded engineering reference; uncommitted engineering changes are outside this spec.

# 22. Source Evidence

- `tests/phase03/service_queue.test.mjs`
- `tests/navigation/run-click-audit.mjs`

# 23. Change History

- 2026-08-14 — Wave 3 deep review from engineering reference `25c24df753962bbf3c13301eed71624bc0ee39b6`; Wave 2 pages and catalog history were preserved.

## CAPABILITIES OWNED

- Queue owns routing state; service/workshop/finance domains own downstream effects.

## CAPABILITIES CONSUMED

- service intake, customer, workshop job; task_manager; field_service; finance
