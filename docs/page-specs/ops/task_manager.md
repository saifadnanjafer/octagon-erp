---
page_id: "task_manager"
title_en: "Task Manager"
title_ar: "إدارة المهام"
domain: "ops"
navigation_group: "ops_control"
kind: "PAGE"
canonical_status: "PRIMARY"
canonical_home: "task_manager"
parent_page: null
aliases: []
roles: ["workshop.user"]
permission: "workshop.user"
entitlement: "none/global (not a commercial/SaaS-gated page)"
renderer_type: "page-specific"
renderer_sources: ["modules/canonical-work-management.js"]
view_sources: ["views/task_manager.html"]
api_sources: ["GET /api/v1/work-items; POST /api/v1/action/work_item:*"]
domain_sources: ["Canonical Work Item authority (exact domain source path NOT VERIFIED)"]
tables_or_entities: ["work_items","work_item_assignments","work_item_comments","platform_audit_events"]
test_sources: ["tests/workshop/my-work-domain.test.mjs","tests/checkpoint-d-e/projects_lifecycle.test.mjs","tests/navigation/workshop-pack-setup-to-readiness.test.mjs"]
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

- Page ID: `task_manager`; English: Task Manager; domain: `ops`; navigation group: `ops_control`.
- Route: `switchPage('task_manager')`; page-specific renderer: `modules/canonical-work-management.js`; view: `views/task_manager.html`.
- Canonical status: PRIMARY; this is a primary catalog destination, not an embedded tab or compatibility alias.

# 2. Business Purpose

An operator opens Task Manager to create, assign, prioritize, and advance a canonical work item, including a governed procurement or project reference when applicable.

# 3. Primary Users

- Declared client gate: "workshop.user".
- Business roles: owner/operator/reviewer/approver/manager split is partly evidenced by the cited domain boundary but requires direct role-isolation proof.

# 4. Primary User Goal

USER OPENS THIS PAGE TO: An operator opens Task Manager to create, assign, prioritize, and advance a canonical work item, including a governed procurement or project reference when applicable.

# 5. AS-IS Runtime Surface

- Renderer/view: `modules/canonical-work-management.js` and `views/task_manager.html`.
- Query/action boundary: GET /api/v1/work-items; POST /api/v1/action/work_item:*.
- Current classification: **CONNECTED**; usability: **USABLE**.
- Visible primary actions:
- Create/update/assign/status -> canonical work item action executor
- Open linked procurement/project -> governed switchPage target
- The page-specific evidence is separated from navigation proof. A visible route does not prove persistence, permission isolation, or completed workflow.

# 6. Data Sources

- UI to API/query: `GET /api/v1/work-items; POST /api/v1/action/work_item:*`.
- Domain authority: `Canonical Work Item authority (exact domain source path NOT VERIFIED)`.
- Persisted entities/tables where source evidence permits: `work_items`, `work_item_assignments`, `work_item_comments`, `platform_audit_events`.
- Company/branch/warehouse/actor scope: server-derived scope is required where the cited API/domain supports it; page-specific isolation proof remains a separate acceptance item.

# 7. Actions

- Create/update/assign/status -> canonical work item action executor — permission: declared page gate plus server action authorization; persistence: Canonical Work Items own task lifecycle; project page delegates task creation to this authority.
- Open linked procurement/project -> governed switchPage target — permission: declared page gate plus server action authorization; persistence: Canonical Work Items own task lifecycle; project page delegates task creation to this authority.

# 8. Inputs

- Required business inputs: record IDs, governed party/product/project/warehouse selectors, lifecycle decisions, quantities/reasons, and source references according to the action.
- Raw IDs must not bypass company, branch, warehouse, actor, maker-checker, or lifecycle validation.
- For connected actions, the server must derive scope and validate stale state before persistence.

# 9. Outputs

Persisted work item, assignee/status timeline, and link references.

# 10. Workflow Position

- Upstream: workshop/my-work; project task request.
- Downstream: my_work; projects; procurement; shopfloor_terminal.
- Workflow classification: CONNECTED for the cited page-to-domain edge; cross-page completion edges marked in gaps are not assumed.

# 11. States

- DRAFT, TODO, ASSIGNED, IN_PROGRESS, BLOCKED, DONE, CANCELLED, DENIED, VALIDATION_ERROR.
- LOADING, EMPTY, DENIED, VALIDATION_ERROR, SERVER_ERROR, and SUCCESS/HANDOFF must remain visibly distinct wherever the renderer supports the corresponding state.
- State persistence and transition authority: Canonical Work Items own task lifecycle; project page delegates task creation to this authority.

# 12. Permissions & Scope

- Client navigation gate: workshop.user.
- Server authorization: action/resource permission plus company/branch/warehouse/actor scope as enforced by the cited API/domain; exact matrix is partly evidenced, not fully proven here.
- A visible button is not authorization proof. Approver/requester separation is required for governed actions.

# 13. Arabic / English

- English label: Task Manager; Arabic label source: إدارة المهام.
- Every primary action and lifecycle state needs a paired visible Arabic/English label; mojibake or untranslated state text is a usability defect.

# 14. Responsive Requirements

- Desktop: preserve scope, record identity, state, primary action, errors, and handoff reference without hiding the business decision.
- Mobile: if used by workshop, warehouse, field, or supplier staff, prove the smallest complete action with controls and validation visible; direct mobile behavior is NOT VERIFIED.

# 15. AS-IS Functional Assessment

**CONNECTED / USABLE** — Canonical work-management module and project lifecycle source; direct task browser lifecycle NOT VERIFIED.. This is a source-evidence classification, not a release acceptance claim.

# 16. Target Business Contract

An operator opens Task Manager to create, assign, prioritize, and advance a canonical work item, including a governed procurement or project reference when applicable. The target contract is a governed page-specific workflow that loads scoped data, exposes lifecycle-valid actions, persists through **Canonical Work Items own task lifecycle; project page delegates task creation to this authority.**, returns a durable reference, and distinguishes loading, empty, denied, validation, server-error, and success states. The target is not complete until the gaps and acceptance criteria below have evidence.

# 17. Identified Gaps

- **task_manager-W3-01** (P1, AUTHORITY_OVERLAP) — Legacy project-management and work-order surfaces also expose task/job-like records; only canonical project tasks are explicitly delegated to Work Items. **Required next step:** Name one canonical work-item authority and mark legacy task/job records as adapters or retired.

# 18. Consolidation Analysis

- Recommended disposition: **KEEP_PRIMARY**.
- Keep this page separate only when its user goal and lifecycle authority are distinct. Shared tables, tabs, or labels alone are not proof of duplication.
- Canonical authority decision: Canonical Work Items own task lifecycle; project page delegates task creation to this authority.

# 19. Acceptance Criteria

- A permitted user opens the page and sees a non-error page-specific surface in the active scope.
- Each primary action validates required inputs, actor/tenant scope, lifecycle state, and maker-checker rules; its response shows the resulting state and durable reference.
- A direct browser/API/domain test proves the highest-risk transition and confirms persistence; navigation-only evidence is insufficient.
- Cross-page handoffs identified above are either proven in a lifecycle test or explicitly rendered as manual/not verified.
- For this page specifically: An operator opens Task Manager to create, assign, prioritize, and advance a canonical work item, including a governed procurement or project reference when applicable.

# 20. Test Evidence

- Evidence class: **Canonical work-management module and project lifecycle source; direct task browser lifecycle NOT VERIFIED.**
- Cited source/tests:
- `tests/workshop/my-work-domain.test.mjs`
- `tests/checkpoint-d-e/projects_lifecycle.test.mjs`
- `tests/navigation/workshop-pack-setup-to-readiness.test.mjs`
- Navigation audit, if cited by the existing catalog, proves route activation/visible surface only; it does not prove domain mutation, isolation, or persistence.

# 21. Known Limitations

- Catalog baseline: `3c047bb0d04985cd88a536d4dbb16b74d2d6405a`; engineering reference: `25c24df753962bbf3c13301eed71624bc0ee39b6`.
- Wave 3 is documentation-only. No engineering source, tests, migrations, runtime data, navigation, or product implementation was changed.
- Source evidence is current to the recorded engineering reference; uncommitted engineering changes are outside this spec.

# 22. Source Evidence

- `modules/canonical-work-management.js`
- `views/task_manager.html`
- `tests/workshop/my-work-domain.test.mjs`
- `tests/checkpoint-d-e/projects_lifecycle.test.mjs`
- `tests/navigation/workshop-pack-setup-to-readiness.test.mjs`

# 23. Change History

- 2026-08-14 — Wave 3 deep review from engineering reference `25c24df753962bbf3c13301eed71624bc0ee39b6`; Wave 2 pages and catalog history were preserved.

## CAPABILITIES OWNED

- Canonical Work Items own task lifecycle; project page delegates task creation to this authority.

## CAPABILITIES CONSUMED

- workshop/my-work; project task request; my_work; projects; procurement; shopfloor_terminal
