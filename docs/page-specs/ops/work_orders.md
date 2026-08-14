---
page_id: "work_orders"
title_en: "Work Orders"
title_ar: "أوامر العمل"
domain: "ops"
navigation_group: "ops_production"
kind: "TRANSACTION"
canonical_status: "PRIMARY"
canonical_home: "work_orders"
parent_page: null
aliases: []
roles: ["workshop.user"]
permission: "workshop.user"
entitlement: "none/global (not a commercial/SaaS-gated page)"
renderer_type: "page-specific"
renderer_sources: ["modules/workshop-frontline.js"]
view_sources: ["views/work_orders.html"]
api_sources: ["NOT VERIFIED in page module; legacy/local work-order surface"]
domain_sources: ["Legacy workshop job handlers (exact source path NOT VERIFIED)"]
tables_or_entities: ["work_orders","work_order_lines","mfg_shopfloor_sessions"]
test_sources: ["tests/workshop/browser-flows.test.mjs"]
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

- Page ID: `work_orders`; English: Work Orders; domain: `ops`; navigation group: `ops_production`.
- Route: `switchPage('work_orders')`; page-specific renderer: `modules/workshop-frontline.js`; view: `views/work_orders.html`.
- Canonical status: PRIMARY; this is a primary catalog destination, not an embedded tab or compatibility alias.

# 2. Business Purpose

A workshop supervisor opens Work Orders to inspect and advance in-house workshop jobs, with clear separation from field visits and canonical generic work items.

# 3. Primary Users

- Declared client gate: "workshop.user".
- Business roles: owner/operator/reviewer/approver/manager split is NOT VERIFIED from the page-specific evidence.

# 4. Primary User Goal

USER OPENS THIS PAGE TO: A workshop supervisor opens Work Orders to inspect and advance in-house workshop jobs, with clear separation from field visits and canonical generic work items.

# 5. AS-IS Runtime Surface

- Renderer/view: `modules/workshop-frontline.js` and `views/work_orders.html`.
- Query/action boundary: NOT VERIFIED in page module; legacy/local work-order surface.
- Current classification: **THIN**; usability: **THIN**.
- Visible primary actions:
- Open/update/complete work order -> handler and persistence NOT VERIFIED from page source
- The page-specific evidence is separated from navigation proof. A visible route does not prove persistence, permission isolation, or completed workflow.

# 6. Data Sources

- UI to API/query: `NOT VERIFIED in page module; legacy/local work-order surface`.
- Domain authority: `Legacy workshop job handlers (exact source path NOT VERIFIED)`.
- Persisted entities/tables where source evidence permits: `work_orders`, `work_order_lines`, `mfg_shopfloor_sessions`.
- Company/branch/warehouse/actor scope: server-derived scope is required where the cited API/domain supports it; page-specific isolation proof remains a separate acceptance item.

# 7. Actions

- Open/update/complete work order -> handler and persistence NOT VERIFIED from page source — permission: declared page gate plus server action authorization; persistence: UNKNOWN; do not treat this page as authoritative until source and persistence are recovered.

# 8. Inputs

- Required business inputs: record IDs, governed party/product/project/warehouse selectors, lifecycle decisions, quantities/reasons, and source references according to the action.
- Raw IDs must not bypass company, branch, warehouse, actor, maker-checker, or lifecycle validation.
- For connected actions, the server must derive scope and validate stale state before persistence.

# 9. Outputs

Workshop job status and work instructions, persistence NOT VERIFIED.

# 10. Workflow Position

- Upstream: customer/sales or workshop intake.
- Downstream: shop-floor, quality, delivery, finance.
- Workflow classification: PARTIAL/UNVERIFIED; the page must not be presented as a completed canonical handoff.

# 11. States

- NOT_VERIFIED; page-level loading/empty/error contract requires recovery.
- LOADING, EMPTY, DENIED, VALIDATION_ERROR, SERVER_ERROR, and SUCCESS/HANDOFF must remain visibly distinct wherever the renderer supports the corresponding state.
- State persistence and transition authority: UNKNOWN; do not treat this page as authoritative until source and persistence are recovered.

# 12. Permissions & Scope

- Client navigation gate: workshop.user.
- Server authorization: action/resource permission plus company/branch/warehouse/actor scope as enforced by the cited API/domain; exact matrix is NOT VERIFIED.
- A visible button is not authorization proof. Approver/requester separation is required for governed actions.

# 13. Arabic / English

- English label: Work Orders; Arabic label source: أوامر العمل.
- Every primary action and lifecycle state needs a paired visible Arabic/English label; mojibake or untranslated state text is a usability defect.

# 14. Responsive Requirements

- Desktop: preserve scope, record identity, state, primary action, errors, and handoff reference without hiding the business decision.
- Mobile: if used by workshop, warehouse, field, or supplier staff, prove the smallest complete action with controls and validation visible; direct mobile behavior is NOT VERIFIED.

# 15. AS-IS Functional Assessment

**THIN / THIN** — Static/navigation evidence only; NOT_VERIFIED for API, domain, persistence, and direct browser action.. This is a source-evidence classification, not a release acceptance claim.

# 16. Target Business Contract

A workshop supervisor opens Work Orders to inspect and advance in-house workshop jobs, with clear separation from field visits and canonical generic work items. The target contract is a governed page-specific workflow that loads scoped data, exposes lifecycle-valid actions, persists through **UNKNOWN; do not treat this page as authoritative until source and persistence are recovered.**, returns a durable reference, and distinguishes loading, empty, denied, validation, server-error, and success states. The target is not complete until the gaps and acceptance criteria below have evidence.

# 17. Identified Gaps

- **work_orders-W3-01** (P1, CREDIBILITY_GAP) — The page is cataloged as a primary transaction, but the inspected page evidence does not establish its API/domain owner or lifecycle persistence. **Required next step:** Recover the renderer/domain contract and attach a direct create-to-complete lifecycle.
- **work_orders-W3-02** (P1, AUTHORITY_OVERLAP) — Work Orders, Work Items, and field-service visits use overlapping job language. **Required next step:** Publish a business glossary and explicit ownership boundary.

# 18. Consolidation Analysis

- Recommended disposition: **STRENGTHEN**.
- Keep this page separate only when its user goal and lifecycle authority are distinct. Shared tables, tabs, or labels alone are not proof of duplication.
- Canonical authority decision: UNKNOWN; do not treat this page as authoritative until source and persistence are recovered.

# 19. Acceptance Criteria

- A permitted user opens the page and sees a non-error page-specific surface in the active scope.
- Each primary action validates required inputs, actor/tenant scope, lifecycle state, and maker-checker rules; its response shows the resulting state and durable reference.
- A direct browser/API/domain test proves the highest-risk transition and confirms persistence; navigation-only evidence is insufficient.
- Cross-page handoffs identified above are either proven in a lifecycle test or explicitly rendered as manual/not verified.
- For this page specifically: A workshop supervisor opens Work Orders to inspect and advance in-house workshop jobs, with clear separation from field visits and canonical generic work items.

# 20. Test Evidence

- Evidence class: **Static/navigation evidence only; NOT_VERIFIED for API, domain, persistence, and direct browser action.**
- Cited source/tests:
- `tests/workshop/browser-flows.test.mjs`
- Navigation audit, if cited by the existing catalog, proves route activation/visible surface only; it does not prove domain mutation, isolation, or persistence.

# 21. Known Limitations

- Catalog baseline: `3c047bb0d04985cd88a536d4dbb16b74d2d6405a`; engineering reference: `25c24df753962bbf3c13301eed71624bc0ee39b6`.
- Wave 3 is documentation-only. No engineering source, tests, migrations, runtime data, navigation, or product implementation was changed.
- Source evidence is current to the recorded engineering reference; uncommitted engineering changes are outside this spec.

# 22. Source Evidence

- `modules/workshop-frontline.js`
- `views/work_orders.html`
- `tests/workshop/browser-flows.test.mjs`

# 23. Change History

- 2026-08-14 — Wave 3 deep review from engineering reference `25c24df753962bbf3c13301eed71624bc0ee39b6`; Wave 2 pages and catalog history were preserved.

## CAPABILITIES OWNED

- UNKNOWN; do not treat this page as authoritative until source and persistence are recovered.

## CAPABILITIES CONSUMED

- customer/sales or workshop intake; shop-floor, quality, delivery, finance
