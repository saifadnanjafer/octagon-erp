---
page_id: "field_service"
title_en: "Field Service"
title_ar: "الخدمة الميدانية"
domain: "commercial"
navigation_group: "commercial_verticals"
kind: "PAGE"
canonical_status: "PRIMARY"
canonical_home: "field_service"
parent_page: null
aliases: []
roles: ["workshop.user"]
permission: "workshop.user"
entitlement: "none/global (not a commercial/SaaS-gated page)"
renderer_type: "page-specific"
renderer_sources: ["modules/field-service.js"]
view_sources: ["views/field_service.html"]
api_sources: ["No canonical field-service API shown; local omni.fieldService state and finance bridge"]
domain_sources: ["local omni.fieldService","platform/finance engine is a downstream candidate"]
tables_or_entities: ["omni.fieldService.visits","omni finance transaction bridge","parties/customers (read candidate)"]
test_sources: ["tests/phase03/field_service.test.mjs","tests/navigation/run-click-audit.mjs"]
catalog_baseline_sha: "3c047bb0d04985cd88a536d4dbb16b74d2d6405a"
last_verified_sha: "25c24df753962bbf3c13301eed71624bc0ee39b6"
engineering_reference_sha: "25c24df753962bbf3c13301eed71624bc0ee39b6"
deep_review_wave: 3
evidence_confidence: "MEDIUM"
implementation_status: "IMPLEMENTED_AT_ENGINEERING_REFERENCE"
functional_status: "PARTIALLY_CONNECTED"
usability_status: "THIN"
review_status: "REQUIRES_PRODUCT_RECOVERY"
---

# 1. Identity

- Page ID: `field_service`; English: Field Service; domain: `commercial`; navigation group: `commercial_verticals`.
- Route: `switchPage('field_service')`; page-specific renderer: `modules/field-service.js`; view: `views/field_service.html`.
- Canonical status: PRIMARY; this is a primary catalog destination, not an embedded tab or compatibility alias.

# 2. Business Purpose

A field-service coordinator opens Field Service to schedule and close customer visits, capture technician work and charge context, and hand off any financial result through a canonical authority.

# 3. Primary Users

- Declared client gate: "workshop.user".
- Business roles: owner/operator/reviewer/approver/manager split is NOT VERIFIED from the page-specific evidence.

# 4. Primary User Goal

USER OPENS THIS PAGE TO: A field-service coordinator opens Field Service to schedule and close customer visits, capture technician work and charge context, and hand off any financial result through a canonical authority.

# 5. AS-IS Runtime Surface

- Renderer/view: `modules/field-service.js` and `views/field_service.html`.
- Query/action boundary: No canonical field-service API shown; local omni.fieldService state and finance bridge.
- Current classification: **PARTIALLY_CONNECTED**; usability: **THIN**.
- Visible primary actions:
- Create/update/complete visit -> local visits action
- Record charge -> addFinanceTransaction bridge
- Audit/history -> local audit helper
- The page-specific evidence is separated from navigation proof. A visible route does not prove persistence, permission isolation, or completed workflow.

# 6. Data Sources

- UI to API/query: `No canonical field-service API shown; local omni.fieldService state and finance bridge`.
- Domain authority: `local omni.fieldService; platform/finance engine is a downstream candidate`.
- Persisted entities/tables where source evidence permits: `omni.fieldService.visits`, `omni finance transaction bridge`, `parties/customers (read candidate)`.
- Company/branch/warehouse/actor scope: server-derived scope is required where the cited API/domain supports it; page-specific isolation proof remains a separate acceptance item.

# 7. Actions

- Create/update/complete visit -> local visits action — permission: declared page gate plus server action authorization; persistence: Current authority is local/unclear; Finance must remain the only GL writer.
- Record charge -> addFinanceTransaction bridge — permission: declared page gate plus server action authorization; persistence: Current authority is local/unclear; Finance must remain the only GL writer.
- Audit/history -> local audit helper — permission: declared page gate plus server action authorization; persistence: Current authority is local/unclear; Finance must remain the only GL writer.

# 8. Inputs

- Required business inputs: record IDs, governed party/product/project/warehouse selectors, lifecycle decisions, quantities/reasons, and source references according to the action.
- Raw IDs must not bypass company, branch, warehouse, actor, maker-checker, or lifecycle validation.
- For connected actions, the server must derive scope and validate stale state before persistence.

# 9. Outputs

Local field visit and possible finance transaction; canonical invoice/GL result NOT VERIFIED.

# 10. Workflow Position

- Upstream: customer/site/technician; service queue.
- Downstream: finance; warranty/RMA; work orders.
- Workflow classification: PARTIAL/UNVERIFIED; the page must not be presented as a completed canonical handoff.

# 11. States

- PLANNED, ASSIGNED, IN_PROGRESS, COMPLETED, CANCELLED (local/partially connected).
- LOADING, EMPTY, DENIED, VALIDATION_ERROR, SERVER_ERROR, and SUCCESS/HANDOFF must remain visibly distinct wherever the renderer supports the corresponding state.
- State persistence and transition authority: Current authority is local/unclear; Finance must remain the only GL writer.

# 12. Permissions & Scope

- Client navigation gate: workshop.user.
- Server authorization: action/resource permission plus company/branch/warehouse/actor scope as enforced by the cited API/domain; exact matrix is NOT VERIFIED.
- A visible button is not authorization proof. Approver/requester separation is required for governed actions.

# 13. Arabic / English

- English label: Field Service; Arabic label source: الخدمة الميدانية.
- Every primary action and lifecycle state needs a paired visible Arabic/English label; mojibake or untranslated state text is a usability defect.

# 14. Responsive Requirements

- Desktop: preserve scope, record identity, state, primary action, errors, and handoff reference without hiding the business decision.
- Mobile: if used by workshop, warehouse, field, or supplier staff, prove the smallest complete action with controls and validation visible; direct mobile behavior is NOT VERIFIED.

# 15. AS-IS Functional Assessment

**PARTIALLY_CONNECTED / THIN** — Module comments and source show local omni state, AuditService, and addFinanceTransaction; no canonical API route shown.. This is a source-evidence classification, not a release acceptance claim.

# 16. Target Business Contract

A field-service coordinator opens Field Service to schedule and close customer visits, capture technician work and charge context, and hand off any financial result through a canonical authority. The target contract is a governed page-specific workflow that loads scoped data, exposes lifecycle-valid actions, persists through **Current authority is local/unclear; Finance must remain the only GL writer.**, returns a durable reference, and distinguishes loading, empty, denied, validation, server-error, and success states. The target is not complete until the gaps and acceptance criteria below have evidence.

# 17. Identified Gaps

- **field_service-W3-01** (P0, AUTHORITY_CONFLICT) — Field Service writes local visit state and calls a finance bridge while canonical Projects/Sales/Finance authorities exist. **Required next step:** Choose canonical field-service/service-job authority and route financial effects through Finance source facts.
- **field_service-W3-02** (P1, WORKFLOW_DISCONNECT) — No verified link from field visit to warranty, sales order, project task, or posted finance document. **Required next step:** Define service completion and billing source-document contract.

# 18. Consolidation Analysis

- Recommended disposition: **CONSOLIDATE_WITH_SERVICE_REVIEW**.
- Keep this page separate only when its user goal and lifecycle authority are distinct. Shared tables, tabs, or labels alone are not proof of duplication.
- Canonical authority decision: Current authority is local/unclear; Finance must remain the only GL writer.

# 19. Acceptance Criteria

- A permitted user opens the page and sees a non-error page-specific surface in the active scope.
- Each primary action validates required inputs, actor/tenant scope, lifecycle state, and maker-checker rules; its response shows the resulting state and durable reference.
- A direct browser/API/domain test proves the highest-risk transition and confirms persistence; navigation-only evidence is insufficient.
- Cross-page handoffs identified above are either proven in a lifecycle test or explicitly rendered as manual/not verified.
- For this page specifically: A field-service coordinator opens Field Service to schedule and close customer visits, capture technician work and charge context, and hand off any financial result through a canonical authority.

# 20. Test Evidence

- Evidence class: **Module comments and source show local omni state, AuditService, and addFinanceTransaction; no canonical API route shown.**
- Cited source/tests:
- `tests/phase03/field_service.test.mjs`
- `tests/navigation/run-click-audit.mjs`
- Navigation audit, if cited by the existing catalog, proves route activation/visible surface only; it does not prove domain mutation, isolation, or persistence.

# 21. Known Limitations

- Catalog baseline: `3c047bb0d04985cd88a536d4dbb16b74d2d6405a`; engineering reference: `25c24df753962bbf3c13301eed71624bc0ee39b6`.
- Wave 3 is documentation-only. No engineering source, tests, migrations, runtime data, navigation, or product implementation was changed.
- Source evidence is current to the recorded engineering reference; uncommitted engineering changes are outside this spec.

# 22. Source Evidence

- `modules/field-service.js`
- `views/field_service.html`
- `tests/phase03/field_service.test.mjs`
- `tests/navigation/run-click-audit.mjs`

# 23. Change History

- 2026-08-14 — Wave 3 deep review from engineering reference `25c24df753962bbf3c13301eed71624bc0ee39b6`; Wave 2 pages and catalog history were preserved.

## CAPABILITIES OWNED

- Current authority is local/unclear; Finance must remain the only GL writer.

## CAPABILITIES CONSUMED

- customer/site/technician; service queue; finance; warranty/RMA; work orders
