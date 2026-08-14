---
page_id: "sales_contracts"
title_en: "Sales Contracts"
title_ar: "العقود والموافقات"
domain: "commercial"
navigation_group: "commercial_relationships"
kind: "PAGE"
canonical_status: "PRIMARY"
canonical_home: "sales_contracts"
parent_page: null
aliases: []
roles: ["workshop.manager","finance.manager"]
permission: "workshop.manager, finance.manager"
entitlement: "none/global (not a commercial/SaaS-gated page)"
renderer_type: "page-specific"
renderer_sources: ["modules/sales-contracts.js"]
view_sources: ["views/sales_contracts.html"]
api_sources: ["No /api/v1 call in module; browser/local storage save()"]
domain_sources: ["platform/sales/contracts.mjs (canonical source exists but is not consumed by this renderer)"]
tables_or_entities: ["localStorage sales contracts object","sale_contracts (canonical domain candidate)"]
test_sources: ["tests/navigation/run-click-audit.mjs"]
catalog_baseline_sha: "3c047bb0d04985cd88a536d4dbb16b74d2d6405a"
last_verified_sha: "25c24df753962bbf3c13301eed71624bc0ee39b6"
engineering_reference_sha: "25c24df753962bbf3c13301eed71624bc0ee39b6"
deep_review_wave: 3
evidence_confidence: "MEDIUM"
implementation_status: "IMPLEMENTED_AT_ENGINEERING_REFERENCE"
functional_status: "SIMULATED_BY_DESIGN"
usability_status: "THIN"
review_status: "REQUIRES_PRODUCT_RECOVERY"
---

# 1. Identity

- Page ID: `sales_contracts`; English: Sales Contracts; domain: `commercial`; navigation group: `commercial_relationships`.
- Route: `switchPage('sales_contracts')`; page-specific renderer: `modules/sales-contracts.js`; view: `views/sales_contracts.html`.
- Canonical status: PRIMARY; this is a primary catalog destination, not an embedded tab or compatibility alias.

# 2. Business Purpose

A user opens Sales Contracts expecting a governed contract lifecycle tied to customer, commercial terms, service obligations, and downstream billing.

# 3. Primary Users

- Declared client gate: "workshop.manager, finance.manager".
- Business roles: owner/operator/reviewer/approver/manager split is NOT VERIFIED from the page-specific evidence.

# 4. Primary User Goal

USER OPENS THIS PAGE TO: A user opens Sales Contracts expecting a governed contract lifecycle tied to customer, commercial terms, service obligations, and downstream billing.

# 5. AS-IS Runtime Surface

- Renderer/view: `modules/sales-contracts.js` and `views/sales_contracts.html`.
- Query/action boundary: No /api/v1 call in module; browser/local storage save().
- Current classification: **SIMULATED_BY_DESIGN**; usability: **THIN**.
- Visible primary actions:
- Create/edit/approve/activate/complete/cancel -> local object lifecycle
- switchPage(sales_contracts) -> route only
- The page-specific evidence is separated from navigation proof. A visible route does not prove persistence, permission isolation, or completed workflow.

# 6. Data Sources

- UI to API/query: `No /api/v1 call in module; browser/local storage save()`.
- Domain authority: `platform/sales/contracts.mjs (canonical source exists but is not consumed by this renderer)`.
- Persisted entities/tables where source evidence permits: `localStorage sales contracts object`, `sale_contracts (canonical domain candidate)`.
- Company/branch/warehouse/actor scope: server-derived scope is required where the cited API/domain supports it; page-specific isolation proof remains a separate acceptance item.

# 7. Actions

- Create/edit/approve/activate/complete/cancel -> local object lifecycle — permission: declared page gate plus server action authorization; persistence: Canonical contract domain is the intended authority; current page is not connected.
- switchPage(sales_contracts) -> route only — permission: declared page gate plus server action authorization; persistence: Canonical contract domain is the intended authority; current page is not connected.

# 8. Inputs

- Required business inputs: record IDs, governed party/product/project/warehouse selectors, lifecycle decisions, quantities/reasons, and source references according to the action.
- Raw IDs must not bypass company, branch, warehouse, actor, maker-checker, or lifecycle validation.
- For the current local surface, inputs are browser-local and must not be treated as posted business facts.

# 9. Outputs

Browser-local contract object; canonical persistence NOT VERIFIED.

# 10. Workflow Position

- Upstream: customer/quotation context NOT VERIFIED.
- Downstream: billing/service obligations NOT VERIFIED.
- Workflow classification: PARTIAL/UNVERIFIED; the page must not be presented as a completed canonical handoff.

# 11. States

- DRAFT, ACTIVE, COMPLETED, CANCELLED (local only).
- LOADING, EMPTY, DENIED, VALIDATION_ERROR, SERVER_ERROR, and SUCCESS/HANDOFF must remain visibly distinct wherever the renderer supports the corresponding state.
- State persistence and transition authority: Canonical contract domain is the intended authority; current page is not connected.

# 12. Permissions & Scope

- Client navigation gate: workshop.manager, finance.manager.
- Server authorization: action/resource permission plus company/branch/warehouse/actor scope as enforced by the cited API/domain; exact matrix is NOT VERIFIED.
- A visible button is not authorization proof. Approver/requester separation is required for governed actions.

# 13. Arabic / English

- English label: Sales Contracts; Arabic label source: العقود والموافقات.
- Every primary action and lifecycle state needs a paired visible Arabic/English label; mojibake or untranslated state text is a usability defect.

# 14. Responsive Requirements

- Desktop: preserve scope, record identity, state, primary action, errors, and handoff reference without hiding the business decision.
- Mobile: if used by workshop, warehouse, field, or supplier staff, prove the smallest complete action with controls and validation visible; direct mobile behavior is NOT VERIFIED.

# 15. AS-IS Functional Assessment

**SIMULATED_BY_DESIGN / THIN** — Direct module source shows localStorage and no API; canonical action registry provides the conflicting authority.. This is a source-evidence classification, not a release acceptance claim.

# 16. Target Business Contract

A user opens Sales Contracts expecting a governed contract lifecycle tied to customer, commercial terms, service obligations, and downstream billing. The target contract is a governed page-specific workflow that loads scoped data, exposes lifecycle-valid actions, persists through **Canonical contract domain is the intended authority; current page is not connected.**, returns a durable reference, and distinguishes loading, empty, denied, validation, server-error, and success states. The target is not complete until the gaps and acceptance criteria below have evidence.

# 17. Identified Gaps

- **sales_contracts-W3-01** (P0, AUTHORITY_CONFLICT) — A localStorage contract workspace is presented beside canonical sales contract actions: sales:contract:create/activate/suspend/terminate. **Required next step:** Disable or migrate the local renderer; bind the page to platform/sales/contracts.mjs and prove persistence/isolation.
- **sales_contracts-W3-02** (P1, WORKFLOW_DISCONNECT) — No verified link from contract to quotation, service delivery, warranty, or finance. **Required next step:** Define contract source, terms, obligation schedule, and billing handoff.

# 18. Consolidation Analysis

- Recommended disposition: **CONSOLIDATE_WITH_CANONICAL_SALES**.
- Keep this page separate only when its user goal and lifecycle authority are distinct. Shared tables, tabs, or labels alone are not proof of duplication.
- Canonical authority decision: Canonical contract domain is the intended authority; current page is not connected.

# 19. Acceptance Criteria

- A permitted user opens the page and sees a non-error page-specific surface in the active scope.
- Each primary action validates required inputs, actor/tenant scope, lifecycle state, and maker-checker rules; its response shows the resulting state and durable reference.
- A direct browser/API/domain test proves the highest-risk transition and confirms persistence; navigation-only evidence is insufficient.
- Cross-page handoffs identified above are either proven in a lifecycle test or explicitly rendered as manual/not verified.
- For this page specifically: A user opens Sales Contracts expecting a governed contract lifecycle tied to customer, commercial terms, service obligations, and downstream billing.

# 20. Test Evidence

- Evidence class: **Direct module source shows localStorage and no API; canonical action registry provides the conflicting authority.**
- Cited source/tests:
- `tests/navigation/run-click-audit.mjs`
- Navigation audit, if cited by the existing catalog, proves route activation/visible surface only; it does not prove domain mutation, isolation, or persistence.

# 21. Known Limitations

- Catalog baseline: `3c047bb0d04985cd88a536d4dbb16b74d2d6405a`; engineering reference: `25c24df753962bbf3c13301eed71624bc0ee39b6`.
- Wave 3 is documentation-only. No engineering source, tests, migrations, runtime data, navigation, or product implementation was changed.
- Source evidence is current to the recorded engineering reference; uncommitted engineering changes are outside this spec.

# 22. Source Evidence

- `modules/sales-contracts.js`
- `views/sales_contracts.html`
- `tests/navigation/run-click-audit.mjs`

# 23. Change History

- 2026-08-14 — Wave 3 deep review from engineering reference `25c24df753962bbf3c13301eed71624bc0ee39b6`; Wave 2 pages and catalog history were preserved.

## CAPABILITIES OWNED

- Canonical contract domain is the intended authority; current page is not connected.

## CAPABILITIES CONSUMED

- customer/quotation context NOT VERIFIED; billing/service obligations NOT VERIFIED
