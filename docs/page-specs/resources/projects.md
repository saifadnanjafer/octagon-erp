---
page_id: "projects"
title_en: "Projects"
title_ar: "المشاريع"
domain: "resources"
navigation_group: "resources_supply"
kind: "PAGE"
canonical_status: "PRIMARY"
canonical_home: "projects"
parent_page: null
aliases: []
roles: ["workshop.user"]
permission: "workshop.user"
entitlement: "none/global (not a commercial/SaaS-gated page)"
renderer_type: "page-specific"
renderer_sources: ["modules/canonical-projects.js"]
view_sources: ["views/projects.html"]
api_sources: ["GET /api/v1/projects/*; POST /api/v1/action/projects:*"]
domain_sources: ["platform/projects/index.mjs","platform/projects/projects.mjs","platform/projects/budget.mjs","platform/projects/billing.mjs","platform/projects/effort.mjs","platform/projects/costing.mjs"]
tables_or_entities: ["projects","project_phases","project_milestones","project_tasks","project_cost_codes","project_budgets","project_commitments","project_change_orders","project_risks","project_issues","project_effort","project_billing_requests","finance_documents"]
test_sources: ["tests/checkpoint-d-e/projects_lifecycle.test.mjs","tests/checkpoint-d-e/projects_lifecycle.test.mjs"]
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

- Page ID: `projects`; English: Projects; domain: `resources`; navigation group: `resources_supply`.
- Route: `switchPage('projects')`; page-specific renderer: `modules/canonical-projects.js`; view: `views/projects.html`.
- Canonical status: PRIMARY; this is a primary catalog destination, not an embedded tab or compatibility alias.

# 2. Business Purpose

A project manager opens Projects to manage projects, phases, milestones, tasks, budgets, commitments, risks, issues, effort, billing, and profitability through canonical project authority.

# 3. Primary Users

- Declared client gate: "workshop.user".
- Business roles: owner/operator/reviewer/approver/manager split is partly evidenced by the cited domain boundary but requires direct role-isolation proof.

# 4. Primary User Goal

USER OPENS THIS PAGE TO: A project manager opens Projects to manage projects, phases, milestones, tasks, budgets, commitments, risks, issues, effort, billing, and profitability through canonical project authority.

# 5. AS-IS Runtime Surface

- Renderer/view: `modules/canonical-projects.js` and `views/projects.html`.
- Query/action boundary: GET /api/v1/projects/*; POST /api/v1/action/projects:*.
- Current classification: **CONNECTED**; usability: **USABLE**.
- Visible primary actions:
- Project/template/phase/milestone/task -> projects:*
- Budget/commitment/change/risk/issue/effort -> projects:*
- Billing request/approve -> projects:billing:* with Finance postSourceFact
- The page-specific evidence is separated from navigation proof. A visible route does not prove persistence, permission isolation, or completed workflow.

# 6. Data Sources

- UI to API/query: `GET /api/v1/projects/*; POST /api/v1/action/projects:*`.
- Domain authority: `platform/projects/index.mjs; platform/projects/projects.mjs; platform/projects/budget.mjs; platform/projects/billing.mjs; platform/projects/effort.mjs; platform/projects/costing.mjs`.
- Persisted entities/tables where source evidence permits: `projects`, `project_phases`, `project_milestones`, `project_tasks`, `project_cost_codes`, `project_budgets`, `project_commitments`, `project_change_orders`, `project_risks`, `project_issues`, `project_effort`, `project_billing_requests`, `finance_documents`.
- Company/branch/warehouse/actor scope: server-derived scope is required where the cited API/domain supports it; page-specific isolation proof remains a separate acceptance item.

# 7. Actions

- Project/template/phase/milestone/task -> projects:* — permission: declared page gate plus server action authorization; persistence: Projects owns project records; Work Items own tasks; Finance is the only GL writer.
- Budget/commitment/change/risk/issue/effort -> projects:* — permission: declared page gate plus server action authorization; persistence: Projects owns project records; Work Items own tasks; Finance is the only GL writer.
- Billing request/approve -> projects:billing:* with Finance postSourceFact — permission: declared page gate plus server action authorization; persistence: Projects owns project records; Work Items own tasks; Finance is the only GL writer.

# 8. Inputs

- Required business inputs: record IDs, governed party/product/project/warehouse selectors, lifecycle decisions, quantities/reasons, and source references according to the action.
- Raw IDs must not bypass company, branch, warehouse, actor, maker-checker, or lifecycle validation.
- For connected actions, the server must derive scope and validate stale state before persistence.

# 9. Outputs

Project lifecycle, canonical Work Item task, budget/commitment/change records, effort, and Finance billing reference.

# 10. Workflow Position

- Upstream: customer/contract/sales context; work items.
- Downstream: task_manager; procurement commitments; finance billing; delivery.
- Workflow classification: CONNECTED for the cited page-to-domain edge; cross-page completion edges marked in gaps are not assumed.

# 11. States

- DRAFT, ACTIVE, ON_HOLD, COMPLETED, ARCHIVED, APPROVED, REJECTED, AT_RISK, INVOICED, DENIED.
- LOADING, EMPTY, DENIED, VALIDATION_ERROR, SERVER_ERROR, and SUCCESS/HANDOFF must remain visibly distinct wherever the renderer supports the corresponding state.
- State persistence and transition authority: Projects owns project records; Work Items own tasks; Finance is the only GL writer.

# 12. Permissions & Scope

- Client navigation gate: workshop.user.
- Server authorization: action/resource permission plus company/branch/warehouse/actor scope as enforced by the cited API/domain; exact matrix is partly evidenced, not fully proven here.
- A visible button is not authorization proof. Approver/requester separation is required for governed actions.

# 13. Arabic / English

- English label: Projects; Arabic label source: المشاريع.
- Every primary action and lifecycle state needs a paired visible Arabic/English label; mojibake or untranslated state text is a usability defect.

# 14. Responsive Requirements

- Desktop: preserve scope, record identity, state, primary action, errors, and handoff reference without hiding the business decision.
- Mobile: if used by workshop, warehouse, field, or supplier staff, prove the smallest complete action with controls and validation visible; direct mobile behavior is NOT VERIFIED.

# 15. AS-IS Functional Assessment

**CONNECTED / USABLE** — Canonical project module/API/domain and lifecycle tests; duplicate legacy source is a known boundary.. This is a source-evidence classification, not a release acceptance claim.

# 16. Target Business Contract

A project manager opens Projects to manage projects, phases, milestones, tasks, budgets, commitments, risks, issues, effort, billing, and profitability through canonical project authority. The target contract is a governed page-specific workflow that loads scoped data, exposes lifecycle-valid actions, persists through **Projects owns project records; Work Items own tasks; Finance is the only GL writer.**, returns a durable reference, and distinguishes loading, empty, denied, validation, server-error, and success states. The target is not complete until the gaps and acceptance criteria below have evidence.

# 17. Identified Gaps

- **projects-W3-01** (P1, AUTHORITY_OVERLAP) — Legacy project-management fixtures/localStorage remain navigable beside canonical Projects. **Required next step:** Retire or explicitly mark legacy project surface and keep canonical Projects as sole project write authority.
- **projects-W3-02** (P1, WORKFLOW_DISCONNECT) — Project billing is Finance-linked, but customer contract/sales-origin and delivery completion edges are not proven end to end. **Required next step:** Add source-document and browser proof for project-to-billing handoff.

# 18. Consolidation Analysis

- Recommended disposition: **KEEP_PRIMARY**.
- Keep this page separate only when its user goal and lifecycle authority are distinct. Shared tables, tabs, or labels alone are not proof of duplication.
- Canonical authority decision: Projects owns project records; Work Items own tasks; Finance is the only GL writer.

# 19. Acceptance Criteria

- A permitted user opens the page and sees a non-error page-specific surface in the active scope.
- Each primary action validates required inputs, actor/tenant scope, lifecycle state, and maker-checker rules; its response shows the resulting state and durable reference.
- A direct browser/API/domain test proves the highest-risk transition and confirms persistence; navigation-only evidence is insufficient.
- Cross-page handoffs identified above are either proven in a lifecycle test or explicitly rendered as manual/not verified.
- For this page specifically: A project manager opens Projects to manage projects, phases, milestones, tasks, budgets, commitments, risks, issues, effort, billing, and profitability through canonical project authority.

# 20. Test Evidence

- Evidence class: **Canonical project module/API/domain and lifecycle tests; duplicate legacy source is a known boundary.**
- Cited source/tests:
- `tests/checkpoint-d-e/projects_lifecycle.test.mjs`
- `tests/checkpoint-d-e/projects_lifecycle.test.mjs`
- Navigation audit, if cited by the existing catalog, proves route activation/visible surface only; it does not prove domain mutation, isolation, or persistence.

# 21. Known Limitations

- Catalog baseline: `3c047bb0d04985cd88a536d4dbb16b74d2d6405a`; engineering reference: `25c24df753962bbf3c13301eed71624bc0ee39b6`.
- Wave 3 is documentation-only. No engineering source, tests, migrations, runtime data, navigation, or product implementation was changed.
- Source evidence is current to the recorded engineering reference; uncommitted engineering changes are outside this spec.

# 22. Source Evidence

- `modules/canonical-projects.js`
- `views/projects.html`
- `platform/projects/index.mjs`
- `platform/projects/projects.mjs`
- `platform/projects/budget.mjs`
- `platform/projects/billing.mjs`
- `platform/projects/effort.mjs`
- `platform/projects/costing.mjs`
- `tests/checkpoint-d-e/projects_lifecycle.test.mjs`

# 23. Change History

- 2026-08-14 — Wave 3 deep review from engineering reference `25c24df753962bbf3c13301eed71624bc0ee39b6`; Wave 2 pages and catalog history were preserved.

## CAPABILITIES OWNED

- Projects owns project records; Work Items own tasks; Finance is the only GL writer.

## CAPABILITIES CONSUMED

- customer/contract/sales context; work items; task_manager; procurement commitments; finance billing; delivery
