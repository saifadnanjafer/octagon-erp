---
page_id: "sales_price_lists"
title_en: "Sales Price Lists"
title_ar: "قوائم الأسعار"
domain: "commercial"
navigation_group: "commercial_sales"
kind: "LIST"
canonical_status: "PRIMARY"
canonical_home: "sales_price_lists"
parent_page: null
aliases: []
roles: ["workshop.user","finance.user"]
permission: "workshop.user, finance.user"
entitlement: "none/global (not a commercial/SaaS-gated page)"
renderer_type: "page-specific"
renderer_sources: ["modules/sales-price-lists.js"]
view_sources: ["views/sales_price_lists.html"]
api_sources: ["GET /api/v1/commercial/price-lists; POST /api/v1/action/price_list:*"]
domain_sources: ["platform/commercial/pricing.mjs","platform/sales/orders.mjs"]
tables_or_entities: ["product_price_lists","product_price_list_items","product_variants","sale_order_lines"]
test_sources: ["tests/phase04/canonical_sales.test.mjs","tests/phase04-finalization/canonical_sales.test.mjs"]
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

- Page ID: `sales_price_lists`; English: Sales Price Lists; domain: `commercial`; navigation group: `commercial_sales`.
- Route: `switchPage('sales_price_lists')`; page-specific renderer: `modules/sales-price-lists.js`; view: `views/sales_price_lists.html`.
- Canonical status: PRIMARY; this is a primary catalog destination, not an embedded tab or compatibility alias.

# 2. Business Purpose

A sales administrator opens Price Lists to maintain governed product pricing and provide the price context consumed by quotations and orders.

# 3. Primary Users

- Declared client gate: "workshop.user, finance.user".
- Business roles: owner/operator/reviewer/approver/manager split is partly evidenced by the cited domain boundary but requires direct role-isolation proof.

# 4. Primary User Goal

USER OPENS THIS PAGE TO: A sales administrator opens Price Lists to maintain governed product pricing and provide the price context consumed by quotations and orders.

# 5. AS-IS Runtime Surface

- Renderer/view: `modules/sales-price-lists.js` and `views/sales_price_lists.html`.
- Query/action boundary: GET /api/v1/commercial/price-lists; POST /api/v1/action/price_list:*.
- Current classification: **CONNECTED**; usability: **USABLE**.
- Visible primary actions:
- Create/update/activate price list -> price list action boundary
- Select price list -> quotation/order pricing query
- The page-specific evidence is separated from navigation proof. A visible route does not prove persistence, permission isolation, or completed workflow.

# 6. Data Sources

- UI to API/query: `GET /api/v1/commercial/price-lists; POST /api/v1/action/price_list:*`.
- Domain authority: `platform/commercial/pricing.mjs; platform/sales/orders.mjs`.
- Persisted entities/tables where source evidence permits: `product_price_lists`, `product_price_list_items`, `product_variants`, `sale_order_lines`.
- Company/branch/warehouse/actor scope: server-derived scope is required where the cited API/domain supports it; page-specific isolation proof remains a separate acceptance item.

# 7. Actions

- Create/update/activate price list -> price list action boundary — permission: declared page gate plus server action authorization; persistence: Commercial pricing domain owns price-list records; Sales consumes resolved prices.
- Select price list -> quotation/order pricing query — permission: declared page gate plus server action authorization; persistence: Commercial pricing domain owns price-list records; Sales consumes resolved prices.

# 8. Inputs

- Required business inputs: record IDs, governed party/product/project/warehouse selectors, lifecycle decisions, quantities/reasons, and source references according to the action.
- Raw IDs must not bypass company, branch, warehouse, actor, maker-checker, or lifecycle validation.
- For connected actions, the server must derive scope and validate stale state before persistence.

# 9. Outputs

Effective price list/item values used by commercial transactions.

# 10. Workflow Position

- Upstream: products/UOMs; company/currency.
- Downstream: sales quotations/orders; customer portal.
- Workflow classification: CONNECTED for the cited page-to-domain edge; cross-page completion edges marked in gaps are not assumed.

# 11. States

- DRAFT, ACTIVE, ARCHIVED, DENIED, VALIDATION_ERROR, SERVER_ERROR.
- LOADING, EMPTY, DENIED, VALIDATION_ERROR, SERVER_ERROR, and SUCCESS/HANDOFF must remain visibly distinct wherever the renderer supports the corresponding state.
- State persistence and transition authority: Commercial pricing domain owns price-list records; Sales consumes resolved prices.

# 12. Permissions & Scope

- Client navigation gate: workshop.user, finance.user.
- Server authorization: action/resource permission plus company/branch/warehouse/actor scope as enforced by the cited API/domain; exact matrix is partly evidenced, not fully proven here.
- A visible button is not authorization proof. Approver/requester separation is required for governed actions.

# 13. Arabic / English

- English label: Sales Price Lists; Arabic label source: قوائم الأسعار.
- Every primary action and lifecycle state needs a paired visible Arabic/English label; mojibake or untranslated state text is a usability defect.

# 14. Responsive Requirements

- Desktop: preserve scope, record identity, state, primary action, errors, and handoff reference without hiding the business decision.
- Mobile: if used by workshop, warehouse, field, or supplier staff, prove the smallest complete action with controls and validation visible; direct mobile behavior is NOT VERIFIED.

# 15. AS-IS Functional Assessment

**CONNECTED / USABLE** — Canonical sales module/API and phase04 tests; exact renderer action wiring should be confirmed.. This is a source-evidence classification, not a release acceptance claim.

# 16. Target Business Contract

A sales administrator opens Price Lists to maintain governed product pricing and provide the price context consumed by quotations and orders. The target contract is a governed page-specific workflow that loads scoped data, exposes lifecycle-valid actions, persists through **Commercial pricing domain owns price-list records; Sales consumes resolved prices.**, returns a durable reference, and distinguishes loading, empty, denied, validation, server-error, and success states. The target is not complete until the gaps and acceptance criteria below have evidence.

# 17. Identified Gaps

- **sales_price_lists-W3-01** (P1, CREDIBILITY_GAP) — Exact action IDs and precedence when multiple price lists apply are not fully attributed in page evidence. **Required next step:** Attach price resolution tests for customer, product, currency, and validity date.

# 18. Consolidation Analysis

- Recommended disposition: **KEEP_PRIMARY**.
- Keep this page separate only when its user goal and lifecycle authority are distinct. Shared tables, tabs, or labels alone are not proof of duplication.
- Canonical authority decision: Commercial pricing domain owns price-list records; Sales consumes resolved prices.

# 19. Acceptance Criteria

- A permitted user opens the page and sees a non-error page-specific surface in the active scope.
- Each primary action validates required inputs, actor/tenant scope, lifecycle state, and maker-checker rules; its response shows the resulting state and durable reference.
- A direct browser/API/domain test proves the highest-risk transition and confirms persistence; navigation-only evidence is insufficient.
- Cross-page handoffs identified above are either proven in a lifecycle test or explicitly rendered as manual/not verified.
- For this page specifically: A sales administrator opens Price Lists to maintain governed product pricing and provide the price context consumed by quotations and orders.

# 20. Test Evidence

- Evidence class: **Canonical sales module/API and phase04 tests; exact renderer action wiring should be confirmed.**
- Cited source/tests:
- `tests/phase04/canonical_sales.test.mjs`
- `tests/phase04-finalization/canonical_sales.test.mjs`
- Navigation audit, if cited by the existing catalog, proves route activation/visible surface only; it does not prove domain mutation, isolation, or persistence.

# 21. Known Limitations

- Catalog baseline: `3c047bb0d04985cd88a536d4dbb16b74d2d6405a`; engineering reference: `25c24df753962bbf3c13301eed71624bc0ee39b6`.
- Wave 3 is documentation-only. No engineering source, tests, migrations, runtime data, navigation, or product implementation was changed.
- Source evidence is current to the recorded engineering reference; uncommitted engineering changes are outside this spec.

# 22. Source Evidence

- `modules/sales-price-lists.js`
- `views/sales_price_lists.html`
- `platform/commercial/pricing.mjs`
- `platform/sales/orders.mjs`
- `tests/phase04/canonical_sales.test.mjs`
- `tests/phase04-finalization/canonical_sales.test.mjs`

# 23. Change History

- 2026-08-14 — Wave 3 deep review from engineering reference `25c24df753962bbf3c13301eed71624bc0ee39b6`; Wave 2 pages and catalog history were preserved.

## CAPABILITIES OWNED

- Commercial pricing domain owns price-list records; Sales consumes resolved prices.

## CAPABILITIES CONSUMED

- products/UOMs; company/currency; sales quotations/orders; customer portal
