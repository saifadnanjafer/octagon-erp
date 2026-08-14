---
page_id: "contracts"
title_en: "Contracts"
title_ar: "العقود والشؤون القانونية"
domain: "resources"
navigation_group: "resources_supply"
kind: "PAGE"
canonical_status: "PRIMARY"
canonical_home: "contracts"
parent_page: null
aliases: []
roles: ["workshop.manager","finance.manager"]
permission: "workshop.manager, finance.manager"
entitlement: "none/global (not a commercial/SaaS-gated page)"
renderer_type: "page-specific"
renderer_sources: ["Contracts renderer (source path NOT VERIFIED)"]
view_sources: ["views/contracts.html"]
api_sources: ["NOT VERIFIED in page-specific evidence"]
domain_sources: ["Contracts authority NOT VERIFIED","platform/sales/contracts.mjs is a competing candidate"]
tables_or_entities: ["contracts (candidate)","sale_contracts (candidate)"]
test_sources: []
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

- Page ID: `contracts`; English: Contracts; domain: `resources`; navigation group: `resources_supply`.
- Route: `switchPage('contracts')`; page-specific renderer: `Contracts renderer (source path NOT VERIFIED)`; view: `views/contracts.html`.
- Canonical status: PRIMARY; this is a primary catalog destination, not an embedded tab or compatibility alias.

# 2. Business Purpose

A resource or service administrator opens Contracts to understand the organization’s contract records and obligations, including whether this is the same authority as Sales Contracts.

# 3. Primary Users

- Declared client gate: "workshop.manager, finance.manager".
- Business roles: owner/operator/reviewer/approver/manager split is NOT VERIFIED from the page-specific evidence.

# 4. Primary User Goal

USER OPENS THIS PAGE TO: A resource or service administrator opens Contracts to understand the organization’s contract records and obligations, including whether this is the same authority as Sales Contracts.

# 5. AS-IS Runtime Surface

- Renderer/view: `Contracts renderer (source path NOT VERIFIED)` and `views/contracts.html`.
- Query/action boundary: NOT VERIFIED in page-specific evidence.
- Current classification: **THIN**; usability: **THIN**.
- Visible primary actions:
- List/create/update -> API/domain/persistence NOT VERIFIED
- The page-specific evidence is separated from navigation proof. A visible route does not prove persistence, permission isolation, or completed workflow.

# 6. Data Sources

- UI to API/query: `NOT VERIFIED in page-specific evidence`.
- Domain authority: `Contracts authority NOT VERIFIED; platform/sales/contracts.mjs is a competing candidate`.
- Persisted entities/tables where source evidence permits: `contracts (candidate)`, `sale_contracts (candidate)`.
- Company/branch/warehouse/actor scope: server-derived scope is required where the cited API/domain supports it; page-specific isolation proof remains a separate acceptance item.

# 7. Actions

- List/create/update -> API/domain/persistence NOT VERIFIED — permission: declared page gate plus server action authorization; persistence: UNKNOWN; do not allow parallel writes.

# 8. Inputs

- Required business inputs: record IDs, governed party/product/project/warehouse selectors, lifecycle decisions, quantities/reasons, and source references according to the action.
- Raw IDs must not bypass company, branch, warehouse, actor, maker-checker, or lifecycle validation.
- For connected actions, the server must derive scope and validate stale state before persistence.

# 9. Outputs

Contract records and obligations NOT VERIFIED.

# 10. Workflow Position

- Upstream: customer/vendor/service context NOT VERIFIED.
- Downstream: sales_contracts; procurement; projects; finance.
- Workflow classification: PARTIAL/UNVERIFIED; the page must not be presented as a completed canonical handoff.

# 11. States

- NOT_VERIFIED.
- LOADING, EMPTY, DENIED, VALIDATION_ERROR, SERVER_ERROR, and SUCCESS/HANDOFF must remain visibly distinct wherever the renderer supports the corresponding state.
- State persistence and transition authority: UNKNOWN; do not allow parallel writes.

# 12. Permissions & Scope

- Client navigation gate: workshop.manager, finance.manager.
- Server authorization: action/resource permission plus company/branch/warehouse/actor scope as enforced by the cited API/domain; exact matrix is NOT VERIFIED.
- A visible button is not authorization proof. Approver/requester separation is required for governed actions.

# 13. Arabic / English

- English label: Contracts; Arabic label source: العقود والشؤون القانونية.
- Every primary action and lifecycle state needs a paired visible Arabic/English label; mojibake or untranslated state text is a usability defect.

# 14. Responsive Requirements

- Desktop: preserve scope, record identity, state, primary action, errors, and handoff reference without hiding the business decision.
- Mobile: if used by workshop, warehouse, field, or supplier staff, prove the smallest complete action with controls and validation visible; direct mobile behavior is NOT VERIFIED.

# 15. AS-IS Functional Assessment

**THIN / THIN** — Navigation/page inventory only plus canonical sales contract action registry; no recovered page API.. This is a source-evidence classification, not a release acceptance claim.

# 16. Target Business Contract

A resource or service administrator opens Contracts to understand the organization’s contract records and obligations, including whether this is the same authority as Sales Contracts. The target contract is a governed page-specific workflow that loads scoped data, exposes lifecycle-valid actions, persists through **UNKNOWN; do not allow parallel writes.**, returns a durable reference, and distinguishes loading, empty, denied, validation, server-error, and success states. The target is not complete until the gaps and acceptance criteria below have evidence.

# 17. Identified Gaps

- **contracts-W3-01** (P0, AUTHORITY_CONFLICT) — Contracts and Sales Contracts are separate primary navigation destinations while canonical ownership and persistence are not resolved. **Required next step:** Owner must choose one canonical contract home and classify the other as a view, child workflow, or retired alias.

# 18. Consolidation Analysis

- Recommended disposition: **OWNER_DECISION_REQUIRED**.
- Keep this page separate only when its user goal and lifecycle authority are distinct. Shared tables, tabs, or labels alone are not proof of duplication.
- Canonical authority decision: UNKNOWN; do not allow parallel writes.

# 19. Acceptance Criteria

- A permitted user opens the page and sees a non-error page-specific surface in the active scope.
- Each primary action validates required inputs, actor/tenant scope, lifecycle state, and maker-checker rules; its response shows the resulting state and durable reference.
- A direct browser/API/domain test proves the highest-risk transition and confirms persistence; navigation-only evidence is insufficient.
- Cross-page handoffs identified above are either proven in a lifecycle test or explicitly rendered as manual/not verified.
- For this page specifically: A resource or service administrator opens Contracts to understand the organization’s contract records and obligations, including whether this is the same authority as Sales Contracts.

# 20. Test Evidence

- Evidence class: **Navigation/page inventory only plus canonical sales contract action registry; no recovered page API.**
- Cited source/tests:

- Navigation audit, if cited by the existing catalog, proves route activation/visible surface only; it does not prove domain mutation, isolation, or persistence.

# 21. Known Limitations

- Catalog baseline: `3c047bb0d04985cd88a536d4dbb16b74d2d6405a`; engineering reference: `25c24df753962bbf3c13301eed71624bc0ee39b6`.
- Wave 3 is documentation-only. No engineering source, tests, migrations, runtime data, navigation, or product implementation was changed.
- Source evidence is current to the recorded engineering reference; uncommitted engineering changes are outside this spec.

# 22. Source Evidence

- `views/contracts.html`

# 23. Change History

- 2026-08-14 — Wave 3 deep review from engineering reference `25c24df753962bbf3c13301eed71624bc0ee39b6`; Wave 2 pages and catalog history were preserved.

## CAPABILITIES OWNED

- UNKNOWN; do not allow parallel writes.

## CAPABILITIES CONSUMED

- customer/vendor/service context NOT VERIFIED; sales_contracts; procurement; projects; finance
