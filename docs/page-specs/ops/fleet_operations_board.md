---
page_id: "fleet_operations_board"
title_en: "Fleet Operations Board"
title_ar: "لوحة عمليات الأسطول"
domain: "ops"
navigation_group: "ops_boards"
kind: "BOARD"
canonical_status: "PRIMARY"
canonical_home: "fleet_operations_board"
parent_page: null
aliases: []
roles: ["any authenticated user"]
permission: "none (public/open)"
entitlement: "none/global (not a commercial/SaaS-gated page)"
renderer_type: "page-specific"
renderer_sources: ["Fleet operations renderer (source path NOT VERIFIED)"]
view_sources: ["Fleet operations view (source path NOT VERIFIED)"]
api_sources: ["GET /api/v1/fleet/*; exact page wiring NOT VERIFIED"]
domain_sources: ["Fleet domain candidate","platform/workshop/readiness.mjs"]
tables_or_entities: ["fleet_vehicles","assets","maintenance_work_orders","fleet_assignments"]
test_sources: ["tests/workshop/readiness-domain.test.mjs"]
catalog_baseline_sha: "3c047bb0d04985cd88a536d4dbb16b74d2d6405a"
last_verified_sha: "25c24df753962bbf3c13301eed71624bc0ee39b6"
engineering_reference_sha: "25c24df753962bbf3c13301eed71624bc0ee39b6"
deep_review_wave: 3
evidence_confidence: "MEDIUM"
implementation_status: "IMPLEMENTED_AT_ENGINEERING_REFERENCE"
functional_status: "THIN"
usability_status: "THIN"
review_status: "REQUIRES_PRODUCT_RECOVERY"
---

# 1. Identity

- Page ID: `fleet_operations_board`; English: Fleet Operations Board; domain: `ops`; navigation group: `ops_boards`.
- Route: `switchPage('fleet_operations_board')`; page-specific renderer: `Fleet operations renderer (source path NOT VERIFIED)`; view: `Fleet operations view (source path NOT VERIFIED)`.
- Canonical status: PRIMARY; this is a primary catalog destination, not an embedded tab or compatibility alias.

# 2. Business Purpose

A fleet or operations manager opens the board to monitor vehicle/asset readiness, assignments, and exceptions that affect delivery or field execution.

# 3. Primary Users

- Declared client gate: "none (public/open)".
- Business roles: owner/operator/reviewer/approver/manager split is NOT VERIFIED from the page-specific evidence.

# 4. Primary User Goal

USER OPENS THIS PAGE TO: A fleet or operations manager opens the board to monitor vehicle/asset readiness, assignments, and exceptions that affect delivery or field execution.

# 5. AS-IS Runtime Surface

- Renderer/view: `Fleet operations renderer (source path NOT VERIFIED)` and `Fleet operations view (source path NOT VERIFIED)`.
- Query/action boundary: GET /api/v1/fleet/*; exact page wiring NOT VERIFIED.
- Current classification: **THIN**; usability: **THIN**.
- Visible primary actions:
- Refresh/assign/status -> exact action boundary NOT VERIFIED
- The page-specific evidence is separated from navigation proof. A visible route does not prove persistence, permission isolation, or completed workflow.

# 6. Data Sources

- UI to API/query: `GET /api/v1/fleet/*; exact page wiring NOT VERIFIED`.
- Domain authority: `Fleet domain candidate; platform/workshop/readiness.mjs`.
- Persisted entities/tables where source evidence permits: `fleet_vehicles`, `assets`, `maintenance_work_orders`, `fleet_assignments`.
- Company/branch/warehouse/actor scope: server-derived scope is required where the cited API/domain supports it; page-specific isolation proof remains a separate acceptance item.

# 7. Actions

- Refresh/assign/status -> exact action boundary NOT VERIFIED — permission: declared page gate plus server action authorization; persistence: Fleet domain candidate; readiness consumes fleet checks but does not own fleet mutations.

# 8. Inputs

- Required business inputs: record IDs, governed party/product/project/warehouse selectors, lifecycle decisions, quantities/reasons, and source references according to the action.
- Raw IDs must not bypass company, branch, warehouse, actor, maker-checker, or lifecycle validation.
- For connected actions, the server must derive scope and validate stale state before persistence.

# 9. Outputs

Fleet board and exception/readiness signals.

# 10. Workflow Position

- Upstream: fleet/asset/maintenance state.
- Downstream: delivery; field_service; workshop readiness.
- Workflow classification: PARTIAL/UNVERIFIED; the page must not be presented as a completed canonical handoff.

# 11. States

- NOT_VERIFIED; readiness states may be consumed.
- LOADING, EMPTY, DENIED, VALIDATION_ERROR, SERVER_ERROR, and SUCCESS/HANDOFF must remain visibly distinct wherever the renderer supports the corresponding state.
- State persistence and transition authority: Fleet domain candidate; readiness consumes fleet checks but does not own fleet mutations.

# 12. Permissions & Scope

- Client navigation gate: none (public/open).
- Server authorization: action/resource permission plus company/branch/warehouse/actor scope as enforced by the cited API/domain; exact matrix is NOT VERIFIED.
- A visible button is not authorization proof. Approver/requester separation is required for governed actions.

# 13. Arabic / English

- English label: Fleet Operations Board; Arabic label source: لوحة عمليات الأسطول.
- Every primary action and lifecycle state needs a paired visible Arabic/English label; mojibake or untranslated state text is a usability defect.

# 14. Responsive Requirements

- Desktop: preserve scope, record identity, state, primary action, errors, and handoff reference without hiding the business decision.
- Mobile: if used by workshop, warehouse, field, or supplier staff, prove the smallest complete action with controls and validation visible; direct mobile behavior is NOT VERIFIED.

# 15. AS-IS Functional Assessment

**THIN / THIN** — Navigation and readiness source; page-specific lifecycle NOT_VERIFIED.. This is a source-evidence classification, not a release acceptance claim.

# 16. Target Business Contract

A fleet or operations manager opens the board to monitor vehicle/asset readiness, assignments, and exceptions that affect delivery or field execution. The target contract is a governed page-specific workflow that loads scoped data, exposes lifecycle-valid actions, persists through **Fleet domain candidate; readiness consumes fleet checks but does not own fleet mutations.**, returns a durable reference, and distinguishes loading, empty, denied, validation, server-error, and success states. The target is not complete until the gaps and acceptance criteria below have evidence.

# 17. Identified Gaps

- **fleet_operations_board-W3-01** (P2, CREDIBILITY_GAP) — The page is in delivery operations but its API/action persistence is not evidenced at the selected reference. **Required next step:** Recover direct renderer/domain contract and one assignment-to-delivery exception flow.

# 18. Consolidation Analysis

- Recommended disposition: **STRENGTHEN**.
- Keep this page separate only when its user goal and lifecycle authority are distinct. Shared tables, tabs, or labels alone are not proof of duplication.
- Canonical authority decision: Fleet domain candidate; readiness consumes fleet checks but does not own fleet mutations.

# 19. Acceptance Criteria

- A permitted user opens the page and sees a non-error page-specific surface in the active scope.
- Each primary action validates required inputs, actor/tenant scope, lifecycle state, and maker-checker rules; its response shows the resulting state and durable reference.
- A direct browser/API/domain test proves the highest-risk transition and confirms persistence; navigation-only evidence is insufficient.
- Cross-page handoffs identified above are either proven in a lifecycle test or explicitly rendered as manual/not verified.
- For this page specifically: A fleet or operations manager opens the board to monitor vehicle/asset readiness, assignments, and exceptions that affect delivery or field execution.

# 20. Test Evidence

- Evidence class: **Navigation and readiness source; page-specific lifecycle NOT_VERIFIED.**
- Cited source/tests:
- `tests/workshop/readiness-domain.test.mjs`
- Navigation audit, if cited by the existing catalog, proves route activation/visible surface only; it does not prove domain mutation, isolation, or persistence.

# 21. Known Limitations

- Catalog baseline: `3c047bb0d04985cd88a536d4dbb16b74d2d6405a`; engineering reference: `25c24df753962bbf3c13301eed71624bc0ee39b6`.
- Wave 3 is documentation-only. No engineering source, tests, migrations, runtime data, navigation, or product implementation was changed.
- Source evidence is current to the recorded engineering reference; uncommitted engineering changes are outside this spec.

# 22. Source Evidence

- `platform/workshop/readiness.mjs`
- `tests/workshop/readiness-domain.test.mjs`

# 23. Change History

- 2026-08-14 — Wave 3 deep review from engineering reference `25c24df753962bbf3c13301eed71624bc0ee39b6`; Wave 2 pages and catalog history were preserved.

## CAPABILITIES OWNED

- Fleet domain candidate; readiness consumes fleet checks but does not own fleet mutations.

## CAPABILITIES CONSUMED

- fleet/asset/maintenance state; delivery; field_service; workshop readiness
