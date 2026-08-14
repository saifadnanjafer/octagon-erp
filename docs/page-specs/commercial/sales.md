---
page_id: "sales"
title_en: "Sales"
title_ar: "المبيعات والعملاء"
domain: "commercial"
navigation_group: "commercial_sales"
kind: "PAGE"
canonical_status: "PRIMARY"
canonical_home: "sales"
parent_page: null
aliases: []
roles: ["workshop.user","finance.user"]
permission: "workshop.user, finance.user"
entitlement: "none/global (not a commercial/SaaS-gated page)"
renderer_type: "page-specific"
renderer_sources: ["modules/canonical-sales.js"]
view_sources: ["views/sales.html"]
api_sources: ["GET /api/v1/commercial/sales/*; POST /api/v1/action/{crm,sales}:*"]
domain_sources: ["platform/sales/index.mjs","platform/sales/lifecycle.mjs","platform/sales/orders.mjs"]
tables_or_entities: ["crm_leads","crm_opportunities","crm_opportunity_activities","sale_orders","sale_order_lines","sale_fulfilment_demands","stock_pickings","commercial_fiscal_requests","finance_documents"]
test_sources: ["tests/checkpoint-c/canonical_sales_ui.test.mjs","tests/checkpoint-c/sales_lifecycle.test.mjs","tests/phase04/canonical_sales.test.mjs","tests/phase04-finalization/canonical_sales.test.mjs"]
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

- Page ID: `sales`; English: Sales; domain: `commercial`; navigation group: `commercial_sales`.
- Route: `switchPage('sales')`; page-specific renderer: `modules/canonical-sales.js`; view: `views/sales.html`.
- Canonical status: PRIMARY; this is a primary catalog destination, not an embedded tab or compatibility alias.

# 2. Business Purpose

A sales user opens Sales to manage leads/opportunities through quotation, approval, acceptance, order confirmation, reservation, delivery, return, and invoice-request handoffs.

# 3. Primary Users

- Declared client gate: "workshop.user, finance.user".
- Business roles: owner/operator/reviewer/approver/manager split is partly evidenced by the cited domain boundary but requires direct role-isolation proof.

# 4. Primary User Goal

USER OPENS THIS PAGE TO: A sales user opens Sales to manage leads/opportunities through quotation, approval, acceptance, order confirmation, reservation, delivery, return, and invoice-request handoffs.

# 5. AS-IS Runtime Surface

- Renderer/view: `modules/canonical-sales.js` and `views/sales.html`.
- Query/action boundary: GET /api/v1/commercial/sales/*; POST /api/v1/action/{crm,sales}:*.
- Current classification: **CONNECTED**; usability: **USABLE**.
- Visible primary actions:
- CRM convert/activity/close -> crm:*
- Quotation submit/approve/revise/accept -> sales:quotation:*
- Order confirm/reserve/delivery/return/cancel -> sales:order:* and sales:delivery:*
- Invoice request -> sales:invoice_request:create
- The page-specific evidence is separated from navigation proof. A visible route does not prove persistence, permission isolation, or completed workflow.

# 6. Data Sources

- UI to API/query: `GET /api/v1/commercial/sales/*; POST /api/v1/action/{crm,sales}:*`.
- Domain authority: `platform/sales/index.mjs; platform/sales/lifecycle.mjs; platform/sales/orders.mjs`.
- Persisted entities/tables where source evidence permits: `crm_leads`, `crm_opportunities`, `crm_opportunity_activities`, `sale_orders`, `sale_order_lines`, `sale_fulfilment_demands`, `stock_pickings`, `commercial_fiscal_requests`, `finance_documents`.
- Company/branch/warehouse/actor scope: server-derived scope is required where the cited API/domain supports it; page-specific isolation proof remains a separate acceptance item.

# 7. Actions

- CRM convert/activity/close -> crm:* — permission: declared page gate plus server action authorization; persistence: Sales owns commercial lifecycle; Inventory/WMS owns movement; Finance owns invoice/GL posting.
- Quotation submit/approve/revise/accept -> sales:quotation:* — permission: declared page gate plus server action authorization; persistence: Sales owns commercial lifecycle; Inventory/WMS owns movement; Finance owns invoice/GL posting.
- Order confirm/reserve/delivery/return/cancel -> sales:order:* and sales:delivery:* — permission: declared page gate plus server action authorization; persistence: Sales owns commercial lifecycle; Inventory/WMS owns movement; Finance owns invoice/GL posting.
- Invoice request -> sales:invoice_request:create — permission: declared page gate plus server action authorization; persistence: Sales owns commercial lifecycle; Inventory/WMS owns movement; Finance owns invoice/GL posting.

# 8. Inputs

- Required business inputs: record IDs, governed party/product/project/warehouse selectors, lifecycle decisions, quantities/reasons, and source references according to the action.
- Raw IDs must not bypass company, branch, warehouse, actor, maker-checker, or lifecycle validation.
- For connected actions, the server must derive scope and validate stale state before persistence.

# 9. Outputs

Canonical sales order, fulfilment demand/picking, return, and finance invoice request references.

# 10. Workflow Position

- Upstream: parties; products; price lists; warehouse.
- Downstream: logistics/delivery; finance/ar_ap; warranty/rma; customer_portal.
- Workflow classification: CONNECTED for the cited page-to-domain edge; cross-page completion edges marked in gaps are not assumed.

# 11. States

- LEAD, OPPORTUNITY, QUOTATION_DRAFT, SENT, APPROVED, ACCEPTED, SALE, RESERVED, DELIVERED, RETURNED, CANCELLED, DENIED, VALIDATION_ERROR, SERVER_ERROR.
- LOADING, EMPTY, DENIED, VALIDATION_ERROR, SERVER_ERROR, and SUCCESS/HANDOFF must remain visibly distinct wherever the renderer supports the corresponding state.
- State persistence and transition authority: Sales owns commercial lifecycle; Inventory/WMS owns movement; Finance owns invoice/GL posting.

# 12. Permissions & Scope

- Client navigation gate: workshop.user, finance.user.
- Server authorization: action/resource permission plus company/branch/warehouse/actor scope as enforced by the cited API/domain; exact matrix is partly evidenced, not fully proven here.
- A visible button is not authorization proof. Approver/requester separation is required for governed actions.

# 13. Arabic / English

- English label: Sales; Arabic label source: المبيعات والعملاء.
- Every primary action and lifecycle state needs a paired visible Arabic/English label; mojibake or untranslated state text is a usability defect.

# 14. Responsive Requirements

- Desktop: preserve scope, record identity, state, primary action, errors, and handoff reference without hiding the business decision.
- Mobile: if used by workshop, warehouse, field, or supplier staff, prove the smallest complete action with controls and validation visible; direct mobile behavior is NOT VERIFIED.

# 15. AS-IS Functional Assessment

**CONNECTED / USABLE** — Canonical UI, sales lifecycle/order domain and checkpoint/phase04 tests.. This is a source-evidence classification, not a release acceptance claim.

# 16. Target Business Contract

A sales user opens Sales to manage leads/opportunities through quotation, approval, acceptance, order confirmation, reservation, delivery, return, and invoice-request handoffs. The target contract is a governed page-specific workflow that loads scoped data, exposes lifecycle-valid actions, persists through **Sales owns commercial lifecycle; Inventory/WMS owns movement; Finance owns invoice/GL posting.**, returns a durable reference, and distinguishes loading, empty, denied, validation, server-error, and success states. The target is not complete until the gaps and acceptance criteria below have evidence.

# 17. Identified Gaps

- **sales-W3-01** (P1, WORKFLOW_DISCONNECT) — The canonical sales flow links delivery and finance, but direct linkage from an accepted sale to workshop job/service execution is not verified. **Required next step:** Define and test the commercial-to-workshop handoff or explicitly mark it external/manual.

# 18. Consolidation Analysis

- Recommended disposition: **KEEP_PRIMARY**.
- Keep this page separate only when its user goal and lifecycle authority are distinct. Shared tables, tabs, or labels alone are not proof of duplication.
- Canonical authority decision: Sales owns commercial lifecycle; Inventory/WMS owns movement; Finance owns invoice/GL posting.

# 19. Acceptance Criteria

- A permitted user opens the page and sees a non-error page-specific surface in the active scope.
- Each primary action validates required inputs, actor/tenant scope, lifecycle state, and maker-checker rules; its response shows the resulting state and durable reference.
- A direct browser/API/domain test proves the highest-risk transition and confirms persistence; navigation-only evidence is insufficient.
- Cross-page handoffs identified above are either proven in a lifecycle test or explicitly rendered as manual/not verified.
- For this page specifically: A sales user opens Sales to manage leads/opportunities through quotation, approval, acceptance, order confirmation, reservation, delivery, return, and invoice-request handoffs.

# 20. Test Evidence

- Evidence class: **Canonical UI, sales lifecycle/order domain and checkpoint/phase04 tests.**
- Cited source/tests:
- `tests/checkpoint-c/canonical_sales_ui.test.mjs`
- `tests/checkpoint-c/sales_lifecycle.test.mjs`
- `tests/phase04/canonical_sales.test.mjs`
- `tests/phase04-finalization/canonical_sales.test.mjs`
- Navigation audit, if cited by the existing catalog, proves route activation/visible surface only; it does not prove domain mutation, isolation, or persistence.

# 21. Known Limitations

- Catalog baseline: `3c047bb0d04985cd88a536d4dbb16b74d2d6405a`; engineering reference: `25c24df753962bbf3c13301eed71624bc0ee39b6`.
- Wave 3 is documentation-only. No engineering source, tests, migrations, runtime data, navigation, or product implementation was changed.
- Source evidence is current to the recorded engineering reference; uncommitted engineering changes are outside this spec.

# 22. Source Evidence

- `modules/canonical-sales.js`
- `views/sales.html`
- `platform/sales/index.mjs`
- `platform/sales/lifecycle.mjs`
- `platform/sales/orders.mjs`
- `tests/checkpoint-c/canonical_sales_ui.test.mjs`
- `tests/checkpoint-c/sales_lifecycle.test.mjs`
- `tests/phase04/canonical_sales.test.mjs`
- `tests/phase04-finalization/canonical_sales.test.mjs`

# 23. Change History

- 2026-08-14 — Wave 3 deep review from engineering reference `25c24df753962bbf3c13301eed71624bc0ee39b6`; Wave 2 pages and catalog history were preserved.

## CAPABILITIES OWNED

- Sales owns commercial lifecycle; Inventory/WMS owns movement; Finance owns invoice/GL posting.

## CAPABILITIES CONSUMED

- parties; products; price lists; warehouse; logistics/delivery; finance/ar_ap; warranty/rma; customer_portal
