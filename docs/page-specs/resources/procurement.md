---
page_id: "procurement"
title_en: "Procurement"
title_ar: "المشتريات"
domain: "resources"
navigation_group: "resources_supply"
kind: "PAGE"
canonical_status: "PRIMARY"
canonical_home: "procurement"
parent_page: null
aliases: []
roles: ["workshop.manager","finance.user"]
permission: "workshop.manager, finance.user"
entitlement: "none/global (not a commercial/SaaS-gated page)"
renderer_type: "page-specific"
renderer_sources: ["modules/canonical-procurement.js"]
view_sources: ["views/procurement.html"]
api_sources: ["GET /api/v1/procurement/*; POST /api/v1/action/procurement:*"]
domain_sources: ["platform/procurement/index.mjs","platform/procurement/governance.mjs","platform/procurement/lifecycle.mjs","platform/procurement/orders.mjs","platform/procurement/matching.mjs"]
tables_or_entities: ["purchase_requests","purchase_request_lines","purchase_requisitions","purchase_orders","purchase_order_lines","purchase_fulfilment_demands","stock_pickings","purchase_receipt_events","purchase_quality_checks","purchase_bill_requests","purchase_returns","finance_documents"]
test_sources: ["tests/checkpoint-c/canonical_procurement_ui.test.mjs","tests/checkpoint-c/procurement_lifecycle.test.mjs","tests/phase04/canonical_procurement.test.mjs"]
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

- Page ID: `procurement`; English: Procurement; domain: `resources`; navigation group: `resources_supply`.
- Route: `switchPage('procurement')`; page-specific renderer: `modules/canonical-procurement.js`; view: `views/procurement.html`.
- Canonical status: PRIMARY; this is a primary catalog destination, not an embedded tab or compatibility alias.

# 2. Business Purpose

A procurement user opens Procurement to create and govern requests/requisitions, source suppliers, place orders, receive goods, match bills, and record returns.

# 3. Primary Users

- Declared client gate: "workshop.manager, finance.user".
- Business roles: owner/operator/reviewer/approver/manager split is partly evidenced by the cited domain boundary but requires direct role-isolation proof.

# 4. Primary User Goal

USER OPENS THIS PAGE TO: A procurement user opens Procurement to create and govern requests/requisitions, source suppliers, place orders, receive goods, match bills, and record returns.

# 5. AS-IS Runtime Surface

- Renderer/view: `modules/canonical-procurement.js` and `views/procurement.html`.
- Query/action boundary: GET /api/v1/procurement/*; POST /api/v1/action/procurement:*.
- Current classification: **CONNECTED**; usability: **USABLE**.
- Visible primary actions:
- Create/submit/approve request/requisition -> procurement:request:* / procurement:requisition:*
- Create RFQ/record/award supplier quote -> procurement:rfq:* / procurement:supplier_quotation:*
- Create/approve/confirm order -> procurement:order:*
- Receive/match/bill/return/score -> procurement:receipt:post, procurement:threewaymatch:perform, procurement:bill_request:create, procurement:return:create, procurement:score:record
- The page-specific evidence is separated from navigation proof. A visible route does not prove persistence, permission isolation, or completed workflow.

# 6. Data Sources

- UI to API/query: `GET /api/v1/procurement/*; POST /api/v1/action/procurement:*`.
- Domain authority: `platform/procurement/index.mjs; platform/procurement/governance.mjs; platform/procurement/lifecycle.mjs; platform/procurement/orders.mjs; platform/procurement/matching.mjs`.
- Persisted entities/tables where source evidence permits: `purchase_requests`, `purchase_request_lines`, `purchase_requisitions`, `purchase_orders`, `purchase_order_lines`, `purchase_fulfilment_demands`, `stock_pickings`, `purchase_receipt_events`, `purchase_quality_checks`, `purchase_bill_requests`, `purchase_returns`, `finance_documents`.
- Company/branch/warehouse/actor scope: server-derived scope is required where the cited API/domain supports it; page-specific isolation proof remains a separate acceptance item.

# 7. Actions

- Create/submit/approve request/requisition -> procurement:request:* / procurement:requisition:* — permission: declared page gate plus server action authorization; persistence: Procurement owns purchasing lifecycle; WMS/Inventory owns stock movement; Finance owns AP posting.
- Create RFQ/record/award supplier quote -> procurement:rfq:* / procurement:supplier_quotation:* — permission: declared page gate plus server action authorization; persistence: Procurement owns purchasing lifecycle; WMS/Inventory owns stock movement; Finance owns AP posting.
- Create/approve/confirm order -> procurement:order:* — permission: declared page gate plus server action authorization; persistence: Procurement owns purchasing lifecycle; WMS/Inventory owns stock movement; Finance owns AP posting.
- Receive/match/bill/return/score -> procurement:receipt:post, procurement:threewaymatch:perform, procurement:bill_request:create, procurement:return:create, procurement:score:record — permission: declared page gate plus server action authorization; persistence: Procurement owns purchasing lifecycle; WMS/Inventory owns stock movement; Finance owns AP posting.

# 8. Inputs

- Required business inputs: record IDs, governed party/product/project/warehouse selectors, lifecycle decisions, quantities/reasons, and source references according to the action.
- Raw IDs must not bypass company, branch, warehouse, actor, maker-checker, or lifecycle validation.
- For connected actions, the server must derive scope and validate stale state before persistence.

# 9. Outputs

Requisition/RFQ/order/receipt/match/bill/return records with stock and Finance references.

# 10. Workflow Position

- Upstream: parties supplier role; products; warehouse; approval.
- Downstream: warehouse receiving/quality; finance AP; material availability.
- Workflow classification: CONNECTED for the cited page-to-domain edge; cross-page completion edges marked in gaps are not assumed.

# 11. States

- DRAFT, SUBMITTED, APPROVED, RFQ, AWARDED, PURCHASE, RECEIVED, QUALITY_HOLD, MATCHED, BILLED, RETURNED, CLOSED, DENIED, VALIDATION_ERROR.
- LOADING, EMPTY, DENIED, VALIDATION_ERROR, SERVER_ERROR, and SUCCESS/HANDOFF must remain visibly distinct wherever the renderer supports the corresponding state.
- State persistence and transition authority: Procurement owns purchasing lifecycle; WMS/Inventory owns stock movement; Finance owns AP posting.

# 12. Permissions & Scope

- Client navigation gate: workshop.manager, finance.user.
- Server authorization: action/resource permission plus company/branch/warehouse/actor scope as enforced by the cited API/domain; exact matrix is partly evidenced, not fully proven here.
- A visible button is not authorization proof. Approver/requester separation is required for governed actions.

# 13. Arabic / English

- English label: Procurement; Arabic label source: المشتريات.
- Every primary action and lifecycle state needs a paired visible Arabic/English label; mojibake or untranslated state text is a usability defect.

# 14. Responsive Requirements

- Desktop: preserve scope, record identity, state, primary action, errors, and handoff reference without hiding the business decision.
- Mobile: if used by workshop, warehouse, field, or supplier staff, prove the smallest complete action with controls and validation visible; direct mobile behavior is NOT VERIFIED.

# 15. AS-IS Functional Assessment

**CONNECTED / USABLE** — Canonical procurement UI, action registry, lifecycle/order/matching sources, and checkpoint/phase04 tests.. This is a source-evidence classification, not a release acceptance claim.

# 16. Target Business Contract

A procurement user opens Procurement to create and govern requests/requisitions, source suppliers, place orders, receive goods, match bills, and record returns. The target contract is a governed page-specific workflow that loads scoped data, exposes lifecycle-valid actions, persists through **Procurement owns purchasing lifecycle; WMS/Inventory owns stock movement; Finance owns AP posting.**, returns a durable reference, and distinguishes loading, empty, denied, validation, server-error, and success states. The target is not complete until the gaps and acceptance criteria below have evidence.

# 17. Identified Gaps

- **procurement-W3-01** (P1, WORKFLOW_DISCONNECT) — Workshop material demand is visible in operational sources, but a direct canonical material-demand-to-purchase-request edge is not verified. **Required next step:** Define the source document/link and prove one shortage-to-request flow.

# 18. Consolidation Analysis

- Recommended disposition: **KEEP_PRIMARY**.
- Keep this page separate only when its user goal and lifecycle authority are distinct. Shared tables, tabs, or labels alone are not proof of duplication.
- Canonical authority decision: Procurement owns purchasing lifecycle; WMS/Inventory owns stock movement; Finance owns AP posting.

# 19. Acceptance Criteria

- A permitted user opens the page and sees a non-error page-specific surface in the active scope.
- Each primary action validates required inputs, actor/tenant scope, lifecycle state, and maker-checker rules; its response shows the resulting state and durable reference.
- A direct browser/API/domain test proves the highest-risk transition and confirms persistence; navigation-only evidence is insufficient.
- Cross-page handoffs identified above are either proven in a lifecycle test or explicitly rendered as manual/not verified.
- For this page specifically: A procurement user opens Procurement to create and govern requests/requisitions, source suppliers, place orders, receive goods, match bills, and record returns.

# 20. Test Evidence

- Evidence class: **Canonical procurement UI, action registry, lifecycle/order/matching sources, and checkpoint/phase04 tests.**
- Cited source/tests:
- `tests/checkpoint-c/canonical_procurement_ui.test.mjs`
- `tests/checkpoint-c/procurement_lifecycle.test.mjs`
- `tests/phase04/canonical_procurement.test.mjs`
- Navigation audit, if cited by the existing catalog, proves route activation/visible surface only; it does not prove domain mutation, isolation, or persistence.

# 21. Known Limitations

- Catalog baseline: `3c047bb0d04985cd88a536d4dbb16b74d2d6405a`; engineering reference: `25c24df753962bbf3c13301eed71624bc0ee39b6`.
- Wave 3 is documentation-only. No engineering source, tests, migrations, runtime data, navigation, or product implementation was changed.
- Source evidence is current to the recorded engineering reference; uncommitted engineering changes are outside this spec.

# 22. Source Evidence

- `modules/canonical-procurement.js`
- `views/procurement.html`
- `platform/procurement/index.mjs`
- `platform/procurement/governance.mjs`
- `platform/procurement/lifecycle.mjs`
- `platform/procurement/orders.mjs`
- `platform/procurement/matching.mjs`
- `tests/checkpoint-c/canonical_procurement_ui.test.mjs`
- `tests/checkpoint-c/procurement_lifecycle.test.mjs`
- `tests/phase04/canonical_procurement.test.mjs`

# 23. Change History

- 2026-08-14 — Wave 3 deep review from engineering reference `25c24df753962bbf3c13301eed71624bc0ee39b6`; Wave 2 pages and catalog history were preserved.

## CAPABILITIES OWNED

- Procurement owns purchasing lifecycle; WMS/Inventory owns stock movement; Finance owns AP posting.

## CAPABILITIES CONSUMED

- parties supplier role; products; warehouse; approval; warehouse receiving/quality; finance AP; material availability
