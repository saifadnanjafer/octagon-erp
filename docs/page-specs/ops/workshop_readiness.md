---
page_id: "workshop_readiness"
title_en: "Workshop Readiness"
title_ar: "جاهزية الورشة"
domain: "ops"
navigation_group: "ops_control"
kind: "PAGE"
canonical_status: "PRIMARY"
canonical_home: "workshop_readiness"
parent_page: null
aliases: []
roles: ["workshop.manager","system.admin"]
permission: "workshop.manager, system.admin"
entitlement: "none/global (not a commercial/SaaS-gated page)"
renderer_type: "page-specific"
renderer_sources: ["modules/workshop-readiness.js"]
view_sources: ["views/workshop_readiness.html"]
api_sources: ["GET /api/v1/workshop/readiness"]
domain_sources: ["platform/workshop/readiness.mjs","platform/workshop/readiness-catalog.mjs"]
tables_or_entities: ["platform_companies","platform_branches","platform_identities","platform_roles","uoms","product_templates","stock_locations","work_centers","bom_versions","quality_plans","sales_orders","wms_pick_tasks_v2","assets","fleet_vehicles","iot_devices","schema_migrations","platform_audit_events"]
test_sources: ["tests/workshop/readiness-contract.test.mjs","tests/workshop/readiness-domain.test.mjs","tests/navigation/workshop-pack-setup-to-readiness.test.mjs"]
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

- Page ID: `workshop_readiness`; English: Workshop Readiness; domain: `ops`; navigation group: `ops_control`.
- Route: `switchPage('workshop_readiness')`; page-specific renderer: `modules/workshop-readiness.js`; view: `views/workshop_readiness.html`.
- Canonical status: PRIMARY; this is a primary catalog destination, not an embedded tab or compatibility alias.

# 2. Business Purpose

A workshop manager opens Readiness to determine whether required organization, user, product, warehouse, production, quality, delivery, fleet, device, and governance prerequisites are ready before operational use.

# 3. Primary Users

- Declared client gate: "workshop.manager, system.admin".
- Business roles: owner/operator/reviewer/approver/manager split is partly evidenced by the cited domain boundary but requires direct role-isolation proof.

# 4. Primary User Goal

USER OPENS THIS PAGE TO: A workshop manager opens Readiness to determine whether required organization, user, product, warehouse, production, quality, delivery, fleet, device, and governance prerequisites are ready before operational use.

# 5. AS-IS Runtime Surface

- Renderer/view: `modules/workshop-readiness.js` and `views/workshop_readiness.html`.
- Query/action boundary: GET /api/v1/workshop/readiness.
- Current classification: **CONNECTED**; usability: **USABLE**.
- Visible primary actions:
- Refresh/filter -> readiness query
- Open setup target -> switchPage(target)
- The page-specific evidence is separated from navigation proof. A visible route does not prove persistence, permission isolation, or completed workflow.

# 6. Data Sources

- UI to API/query: `GET /api/v1/workshop/readiness`.
- Domain authority: `platform/workshop/readiness.mjs; platform/workshop/readiness-catalog.mjs`.
- Persisted entities/tables where source evidence permits: `platform_companies`, `platform_branches`, `platform_identities`, `platform_roles`, `uoms`, `product_templates`, `stock_locations`, `work_centers`, `bom_versions`, `quality_plans`, `sales_orders`, `wms_pick_tasks_v2`, `assets`, `fleet_vehicles`, `iot_devices`, `schema_migrations`, `platform_audit_events`.
- Company/branch/warehouse/actor scope: server-derived scope is required where the cited API/domain supports it; page-specific isolation proof remains a separate acceptance item.

# 7. Actions

- Refresh/filter -> readiness query — permission: declared page gate plus server action authorization; persistence: Read-only readiness evaluator; it must consume current canonical authorities and never mutate setup.
- Open setup target -> switchPage(target) — permission: declared page gate plus server action authorization; persistence: Read-only readiness evaluator; it must consume current canonical authorities and never mutate setup.

# 8. Inputs

- Required business inputs: record IDs, governed party/product/project/warehouse selectors, lifecycle decisions, quantities/reasons, and source references according to the action.
- Raw IDs must not bypass company, branch, warehouse, actor, maker-checker, or lifecycle validation.
- For connected actions, the server must derive scope and validate stale state before persistence.

# 9. Outputs

Categorized readiness checks, formula, action plan, guidance, and setup navigation.

# 10. Workflow Position

- Upstream: company context; readiness authority checks.
- Downstream: workshop_pack_setup; finance; procurement; sales; warehouse workspaces.
- Workflow classification: CONNECTED for the cited page-to-domain edge; cross-page completion edges marked in gaps are not assumed.

# 11. States

- READY, WARNING, MISSING, BLOCKED, OPTIONAL, PERMISSION_DENIED, NOT_SUPPORTED.
- LOADING, EMPTY, DENIED, VALIDATION_ERROR, SERVER_ERROR, and SUCCESS/HANDOFF must remain visibly distinct wherever the renderer supports the corresponding state.
- State persistence and transition authority: Read-only readiness evaluator; it must consume current canonical authorities and never mutate setup.

# 12. Permissions & Scope

- Client navigation gate: workshop.manager, system.admin.
- Server authorization: action/resource permission plus company/branch/warehouse/actor scope as enforced by the cited API/domain; exact matrix is partly evidenced, not fully proven here.
- A visible button is not authorization proof. Approver/requester separation is required for governed actions.

# 13. Arabic / English

- English label: Workshop Readiness; Arabic label source: جاهزية الورشة.
- Every primary action and lifecycle state needs a paired visible Arabic/English label; mojibake or untranslated state text is a usability defect.

# 14. Responsive Requirements

- Desktop: preserve scope, record identity, state, primary action, errors, and handoff reference without hiding the business decision.
- Mobile: if used by workshop, warehouse, field, or supplier staff, prove the smallest complete action with controls and validation visible; direct mobile behavior is NOT VERIFIED.

# 15. AS-IS Functional Assessment

**CONNECTED / USABLE** — Workshop readiness contract/domain tests and route test; table-name conflict is source evidence.. This is a source-evidence classification, not a release acceptance claim.

# 16. Target Business Contract

A workshop manager opens Readiness to determine whether required organization, user, product, warehouse, production, quality, delivery, fleet, device, and governance prerequisites are ready before operational use. The target contract is a governed page-specific workflow that loads scoped data, exposes lifecycle-valid actions, persists through **Read-only readiness evaluator; it must consume current canonical authorities and never mutate setup.**, returns a durable reference, and distinguishes loading, empty, denied, validation, server-error, and success states. The target is not complete until the gaps and acceptance criteria below have evidence.

# 17. Identified Gaps

- **workshop_readiness-W3-01** (P1, AUTHORITY_CONFLICT) — The readiness catalog checks delivery against sales_orders while canonical Sales order persistence uses sale_orders. **Required next step:** Align the check to the canonical table or document a deliberate compatibility view and add a regression test.
- **workshop_readiness-W3-02** (P1, WORKFLOW_DISCONNECT) — Setup navigation is proven, but remediation completion from a readiness finding is not proven as a closed loop. **Required next step:** Add a browser contract that changes one prerequisite and re-runs readiness.

# 18. Consolidation Analysis

- Recommended disposition: **KEEP_PRIMARY**.
- Keep this page separate only when its user goal and lifecycle authority are distinct. Shared tables, tabs, or labels alone are not proof of duplication.
- Canonical authority decision: Read-only readiness evaluator; it must consume current canonical authorities and never mutate setup.

# 19. Acceptance Criteria

- A permitted user opens the page and sees a non-error page-specific surface in the active scope.
- Each primary action validates required inputs, actor/tenant scope, lifecycle state, and maker-checker rules; its response shows the resulting state and durable reference.
- A direct browser/API/domain test proves the highest-risk transition and confirms persistence; navigation-only evidence is insufficient.
- Cross-page handoffs identified above are either proven in a lifecycle test or explicitly rendered as manual/not verified.
- For this page specifically: A workshop manager opens Readiness to determine whether required organization, user, product, warehouse, production, quality, delivery, fleet, device, and governance prerequisites are ready before operational use.

# 20. Test Evidence

- Evidence class: **Workshop readiness contract/domain tests and route test; table-name conflict is source evidence.**
- Cited source/tests:
- `tests/workshop/readiness-contract.test.mjs`
- `tests/workshop/readiness-domain.test.mjs`
- `tests/navigation/workshop-pack-setup-to-readiness.test.mjs`
- Navigation audit, if cited by the existing catalog, proves route activation/visible surface only; it does not prove domain mutation, isolation, or persistence.

# 21. Known Limitations

- Catalog baseline: `3c047bb0d04985cd88a536d4dbb16b74d2d6405a`; engineering reference: `25c24df753962bbf3c13301eed71624bc0ee39b6`.
- Wave 3 is documentation-only. No engineering source, tests, migrations, runtime data, navigation, or product implementation was changed.
- Source evidence is current to the recorded engineering reference; uncommitted engineering changes are outside this spec.

# 22. Source Evidence

- `modules/workshop-readiness.js`
- `views/workshop_readiness.html`
- `platform/workshop/readiness.mjs`
- `platform/workshop/readiness-catalog.mjs`
- `tests/workshop/readiness-contract.test.mjs`
- `tests/workshop/readiness-domain.test.mjs`
- `tests/navigation/workshop-pack-setup-to-readiness.test.mjs`

# 23. Change History

- 2026-08-14 — Wave 3 deep review from engineering reference `25c24df753962bbf3c13301eed71624bc0ee39b6`; Wave 2 pages and catalog history were preserved.

## CAPABILITIES OWNED

- Read-only readiness evaluator; it must consume current canonical authorities and never mutate setup.

## CAPABILITIES CONSUMED

- company context; readiness authority checks; workshop_pack_setup; finance; procurement; sales; warehouse workspaces
