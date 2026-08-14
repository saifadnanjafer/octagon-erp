---
page_id: "warranty"
title_en: "Warranty"
title_ar: "الضمان والمرتجعات"
domain: "commercial"
navigation_group: "commercial_relationships"
kind: "PAGE"
canonical_status: "PRIMARY"
canonical_home: "warranty"
parent_page: null
aliases: []
roles: ["workshop.user"]
permission: "workshop.user"
entitlement: "none/global (not a commercial/SaaS-gated page)"
renderer_type: "page-specific"
renderer_sources: ["Warranty renderer (source path NOT VERIFIED)"]
view_sources: ["views/warranty.html"]
api_sources: ["GET /api/v1/commercial/warranty; POST /api/v1/action/sales:warranty:*"]
domain_sources: ["platform/sales/warranty.mjs"]
tables_or_entities: ["sales_warranties","sales_warranty_events","sale_orders","parties"]
test_sources: ["tests/checkpoint-c/sales_lifecycle.test.mjs","tests/phase04/canonical_sales.test.mjs"]
catalog_baseline_sha: "3c047bb0d04985cd88a536d4dbb16b74d2d6405a"
last_verified_sha: "25c24df753962bbf3c13301eed71624bc0ee39b6"
engineering_reference_sha: "25c24df753962bbf3c13301eed71624bc0ee39b6"
deep_review_wave: 3
evidence_confidence: "HIGH"
implementation_status: "IMPLEMENTED_AT_ENGINEERING_REFERENCE"
functional_status: "CONNECTED"
usability_status: "THIN"
review_status: "REQUIRES_PRODUCT_RECOVERY"
---

# 1. Identity

- Page ID: `warranty`; English: Warranty; domain: `commercial`; navigation group: `commercial_relationships`.
- Route: `switchPage('warranty')`; page-specific renderer: `Warranty renderer (source path NOT VERIFIED)`; view: `views/warranty.html`.
- Canonical status: PRIMARY; this is a primary catalog destination, not an embedded tab or compatibility alias.

# 2. Business Purpose

A service or sales user opens Warranty to register, submit, approve, and close customer warranty coverage or claim state linked to a sale or service record.

# 3. Primary Users

- Declared client gate: "workshop.user".
- Business roles: owner/operator/reviewer/approver/manager split is partly evidenced by the cited domain boundary but requires direct role-isolation proof.

# 4. Primary User Goal

USER OPENS THIS PAGE TO: A service or sales user opens Warranty to register, submit, approve, and close customer warranty coverage or claim state linked to a sale or service record.

# 5. AS-IS Runtime Surface

- Renderer/view: `Warranty renderer (source path NOT VERIFIED)` and `views/warranty.html`.
- Query/action boundary: GET /api/v1/commercial/warranty; POST /api/v1/action/sales:warranty:*.
- Current classification: **CONNECTED**; usability: **THIN**.
- Visible primary actions:
- Create/submit/approve/close -> sales:warranty:create/submit/approve/close
- The page-specific evidence is separated from navigation proof. A visible route does not prove persistence, permission isolation, or completed workflow.

# 6. Data Sources

- UI to API/query: `GET /api/v1/commercial/warranty; POST /api/v1/action/sales:warranty:*`.
- Domain authority: `platform/sales/warranty.mjs`.
- Persisted entities/tables where source evidence permits: `sales_warranties`, `sales_warranty_events`, `sale_orders`, `parties`.
- Company/branch/warehouse/actor scope: server-derived scope is required where the cited API/domain supports it; page-specific isolation proof remains a separate acceptance item.

# 7. Actions

- Create/submit/approve/close -> sales:warranty:create/submit/approve/close — permission: declared page gate plus server action authorization; persistence: Sales warranty domain owns warranty state; service/RMA/Finance own effects.

# 8. Inputs

- Required business inputs: record IDs, governed party/product/project/warehouse selectors, lifecycle decisions, quantities/reasons, and source references according to the action.
- Raw IDs must not bypass company, branch, warehouse, actor, maker-checker, or lifecycle validation.
- For connected actions, the server must derive scope and validate stale state before persistence.

# 9. Outputs

Warranty record, decision/event history, downstream claim reference.

# 10. Workflow Position

- Upstream: party; sale order/product/serial evidence.
- Downstream: field service/RMA; finance credit or service charge.
- Workflow classification: CONNECTED for the cited page-to-domain edge; cross-page completion edges marked in gaps are not assumed.

# 11. States

- DRAFT, SUBMITTED, APPROVED, CLOSED, DENIED, VALIDATION_ERROR.
- LOADING, EMPTY, DENIED, VALIDATION_ERROR, SERVER_ERROR, and SUCCESS/HANDOFF must remain visibly distinct wherever the renderer supports the corresponding state.
- State persistence and transition authority: Sales warranty domain owns warranty state; service/RMA/Finance own effects.

# 12. Permissions & Scope

- Client navigation gate: workshop.user.
- Server authorization: action/resource permission plus company/branch/warehouse/actor scope as enforced by the cited API/domain; exact matrix is partly evidenced, not fully proven here.
- A visible button is not authorization proof. Approver/requester separation is required for governed actions.

# 13. Arabic / English

- English label: Warranty; Arabic label source: الضمان والمرتجعات.
- Every primary action and lifecycle state needs a paired visible Arabic/English label; mojibake or untranslated state text is a usability defect.

# 14. Responsive Requirements

- Desktop: preserve scope, record identity, state, primary action, errors, and handoff reference without hiding the business decision.
- Mobile: if used by workshop, warehouse, field, or supplier staff, prove the smallest complete action with controls and validation visible; direct mobile behavior is NOT VERIFIED.

# 15. AS-IS Functional Assessment

**CONNECTED / THIN** — Sales warranty domain/action registry and canonical sales test references.. This is a source-evidence classification, not a release acceptance claim.

# 16. Target Business Contract

A service or sales user opens Warranty to register, submit, approve, and close customer warranty coverage or claim state linked to a sale or service record. The target contract is a governed page-specific workflow that loads scoped data, exposes lifecycle-valid actions, persists through **Sales warranty domain owns warranty state; service/RMA/Finance own effects.**, returns a durable reference, and distinguishes loading, empty, denied, validation, server-error, and success states. The target is not complete until the gaps and acceptance criteria below have evidence.

# 17. Identified Gaps

- **warranty-W3-01** (P1, WORKFLOW_DISCONNECT) — The warranty authority exists, but linkage to field service and finance charge/credit outcomes is not verified. **Required next step:** Define accepted claim to service/RMA and financial outcome edges.

# 18. Consolidation Analysis

- Recommended disposition: **STRENGTHEN**.
- Keep this page separate only when its user goal and lifecycle authority are distinct. Shared tables, tabs, or labels alone are not proof of duplication.
- Canonical authority decision: Sales warranty domain owns warranty state; service/RMA/Finance own effects.

# 19. Acceptance Criteria

- A permitted user opens the page and sees a non-error page-specific surface in the active scope.
- Each primary action validates required inputs, actor/tenant scope, lifecycle state, and maker-checker rules; its response shows the resulting state and durable reference.
- A direct browser/API/domain test proves the highest-risk transition and confirms persistence; navigation-only evidence is insufficient.
- Cross-page handoffs identified above are either proven in a lifecycle test or explicitly rendered as manual/not verified.
- For this page specifically: A service or sales user opens Warranty to register, submit, approve, and close customer warranty coverage or claim state linked to a sale or service record.

# 20. Test Evidence

- Evidence class: **Sales warranty domain/action registry and canonical sales test references.**
- Cited source/tests:
- `tests/checkpoint-c/sales_lifecycle.test.mjs`
- `tests/phase04/canonical_sales.test.mjs`
- Navigation audit, if cited by the existing catalog, proves route activation/visible surface only; it does not prove domain mutation, isolation, or persistence.

# 21. Known Limitations

- Catalog baseline: `3c047bb0d04985cd88a536d4dbb16b74d2d6405a`; engineering reference: `25c24df753962bbf3c13301eed71624bc0ee39b6`.
- Wave 3 is documentation-only. No engineering source, tests, migrations, runtime data, navigation, or product implementation was changed.
- Source evidence is current to the recorded engineering reference; uncommitted engineering changes are outside this spec.

# 22. Source Evidence

- `views/warranty.html`
- `platform/sales/warranty.mjs`
- `tests/checkpoint-c/sales_lifecycle.test.mjs`
- `tests/phase04/canonical_sales.test.mjs`

# 23. Change History

- 2026-08-14 — Wave 3 deep review from engineering reference `25c24df753962bbf3c13301eed71624bc0ee39b6`; Wave 2 pages and catalog history were preserved.

## CAPABILITIES OWNED

- Sales warranty domain owns warranty state; service/RMA/Finance own effects.

## CAPABILITIES CONSUMED

- party; sale order/product/serial evidence; field service/RMA; finance credit or service charge
