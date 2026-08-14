---
page_id: "customer_portal"
title_en: "Customer Portal"
title_ar: "بوابة العميل"
domain: "commercial"
navigation_group: "commercial_relationships"
kind: "PAGE"
canonical_status: "PRIMARY"
canonical_home: "customer_portal"
parent_page: null
aliases: []
roles: ["any authenticated user"]
permission: "none (public/open)"
entitlement: "none/global (not a commercial/SaaS-gated page)"
renderer_type: "page-specific"
renderer_sources: ["Customer portal renderer (source path NOT VERIFIED)"]
view_sources: ["views/customer_portal.html"]
api_sources: ["GET /api/v1/commercial/portal/*; POST /api/v1/action/portal:*"]
domain_sources: ["Customer portal authority (source path NOT VERIFIED)","platform/sales/orders.mjs","platform/finance/engine.mjs"]
tables_or_entities: ["portal_users","portal_access_grants","sale_orders","stock_pickings","finance_documents","sales_contracts"]
test_sources: ["tests/phase04-finalization/canonical_sales.test.mjs"]
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

- Page ID: `customer_portal`; English: Customer Portal; domain: `commercial`; navigation group: `commercial_relationships`.
- Route: `switchPage('customer_portal')`; page-specific renderer: `Customer portal renderer (source path NOT VERIFIED)`; view: `views/customer_portal.html`.
- Canonical status: PRIMARY; this is a primary catalog destination, not an embedded tab or compatibility alias.

# 2. Business Purpose

A customer-facing user opens the portal to view permitted commercial documents, delivery status, balances, contracts, and service/warranty requests without exposing another company’s data.

# 3. Primary Users

- Declared client gate: "none (public/open)".
- Business roles: owner/operator/reviewer/approver/manager split is partly evidenced by the cited domain boundary but requires direct role-isolation proof.

# 4. Primary User Goal

USER OPENS THIS PAGE TO: A customer-facing user opens the portal to view permitted commercial documents, delivery status, balances, contracts, and service/warranty requests without exposing another company’s data.

# 5. AS-IS Runtime Surface

- Renderer/view: `Customer portal renderer (source path NOT VERIFIED)` and `views/customer_portal.html`.
- Query/action boundary: GET /api/v1/commercial/portal/*; POST /api/v1/action/portal:*.
- Current classification: **CONNECTED**; usability: **USABLE**.
- Visible primary actions:
- View/download/request -> portal read/action boundary; exact mutation set requires server proof
- The page-specific evidence is separated from navigation proof. A visible route does not prove persistence, permission isolation, or completed workflow.

# 6. Data Sources

- UI to API/query: `GET /api/v1/commercial/portal/*; POST /api/v1/action/portal:*`.
- Domain authority: `Customer portal authority (source path NOT VERIFIED); platform/sales/orders.mjs; platform/finance/engine.mjs`.
- Persisted entities/tables where source evidence permits: `portal_users`, `portal_access_grants`, `sale_orders`, `stock_pickings`, `finance_documents`, `sales_contracts`.
- Company/branch/warehouse/actor scope: server-derived scope is required where the cited API/domain supports it; page-specific isolation proof remains a separate acceptance item.

# 7. Actions

- View/download/request -> portal read/action boundary; exact mutation set requires server proof — permission: declared page gate plus server action authorization; persistence: Portal grants control visibility; source sales/finance domains own records.

# 8. Inputs

- Required business inputs: record IDs, governed party/product/project/warehouse selectors, lifecycle decisions, quantities/reasons, and source references according to the action.
- Raw IDs must not bypass company, branch, warehouse, actor, maker-checker, or lifecycle validation.
- For connected actions, the server must derive scope and validate stale state before persistence.

# 9. Outputs

Scoped customer document/status view and permitted request reference.

# 10. Workflow Position

- Upstream: party/portal identity; sales and finance documents.
- Downstream: sales support; warranty; finance requests.
- Workflow classification: CONNECTED for the cited page-to-domain edge; cross-page completion edges marked in gaps are not assumed.

# 11. States

- LOADING, READY, EMPTY, DENIED, EXPIRED, SERVER_ERROR.
- LOADING, EMPTY, DENIED, VALIDATION_ERROR, SERVER_ERROR, and SUCCESS/HANDOFF must remain visibly distinct wherever the renderer supports the corresponding state.
- State persistence and transition authority: Portal grants control visibility; source sales/finance domains own records.

# 12. Permissions & Scope

- Client navigation gate: none (public/open).
- Server authorization: action/resource permission plus company/branch/warehouse/actor scope as enforced by the cited API/domain; exact matrix is partly evidenced, not fully proven here.
- A visible button is not authorization proof. Approver/requester separation is required for governed actions.

# 13. Arabic / English

- English label: Customer Portal; Arabic label source: بوابة العميل.
- Every primary action and lifecycle state needs a paired visible Arabic/English label; mojibake or untranslated state text is a usability defect.

# 14. Responsive Requirements

- Desktop: preserve scope, record identity, state, primary action, errors, and handoff reference without hiding the business decision.
- Mobile: if used by workshop, warehouse, field, or supplier staff, prove the smallest complete action with controls and validation visible; direct mobile behavior is NOT VERIFIED.

# 15. AS-IS Functional Assessment

**CONNECTED / USABLE** — Customer portal view plus sales/finance source boundaries; direct lifecycle/isolation evidence remains bounded.. This is a source-evidence classification, not a release acceptance claim.

# 16. Target Business Contract

A customer-facing user opens the portal to view permitted commercial documents, delivery status, balances, contracts, and service/warranty requests without exposing another company’s data. The target contract is a governed page-specific workflow that loads scoped data, exposes lifecycle-valid actions, persists through **Portal grants control visibility; source sales/finance domains own records.**, returns a durable reference, and distinguishes loading, empty, denied, validation, server-error, and success states. The target is not complete until the gaps and acceptance criteria below have evidence.

# 17. Identified Gaps

- **customer_portal-W3-01** (P1, ISOLATION_GAP) — Cross-company and delegated-portal isolation is not proven by navigation evidence. **Required next step:** Add browser/API assertions for direct object access, expired grants, and customer-to-party mapping.

# 18. Consolidation Analysis

- Recommended disposition: **KEEP_PRIMARY**.
- Keep this page separate only when its user goal and lifecycle authority are distinct. Shared tables, tabs, or labels alone are not proof of duplication.
- Canonical authority decision: Portal grants control visibility; source sales/finance domains own records.

# 19. Acceptance Criteria

- A permitted user opens the page and sees a non-error page-specific surface in the active scope.
- Each primary action validates required inputs, actor/tenant scope, lifecycle state, and maker-checker rules; its response shows the resulting state and durable reference.
- A direct browser/API/domain test proves the highest-risk transition and confirms persistence; navigation-only evidence is insufficient.
- Cross-page handoffs identified above are either proven in a lifecycle test or explicitly rendered as manual/not verified.
- For this page specifically: A customer-facing user opens the portal to view permitted commercial documents, delivery status, balances, contracts, and service/warranty requests without exposing another company’s data.

# 20. Test Evidence

- Evidence class: **Customer portal view plus sales/finance source boundaries; direct lifecycle/isolation evidence remains bounded.**
- Cited source/tests:
- `tests/phase04-finalization/canonical_sales.test.mjs`
- Navigation audit, if cited by the existing catalog, proves route activation/visible surface only; it does not prove domain mutation, isolation, or persistence.

# 21. Known Limitations

- Catalog baseline: `3c047bb0d04985cd88a536d4dbb16b74d2d6405a`; engineering reference: `25c24df753962bbf3c13301eed71624bc0ee39b6`.
- Wave 3 is documentation-only. No engineering source, tests, migrations, runtime data, navigation, or product implementation was changed.
- Source evidence is current to the recorded engineering reference; uncommitted engineering changes are outside this spec.

# 22. Source Evidence

- `views/customer_portal.html`
- `platform/sales/orders.mjs`
- `platform/finance/engine.mjs`
- `tests/phase04-finalization/canonical_sales.test.mjs`

# 23. Change History

- 2026-08-14 — Wave 3 deep review from engineering reference `25c24df753962bbf3c13301eed71624bc0ee39b6`; Wave 2 pages and catalog history were preserved.

## CAPABILITIES OWNED

- Portal grants control visibility; source sales/finance domains own records.

## CAPABILITIES CONSUMED

- party/portal identity; sales and finance documents; sales support; warranty; finance requests
