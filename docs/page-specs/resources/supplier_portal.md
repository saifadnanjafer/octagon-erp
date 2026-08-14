---
page_id: "supplier_portal"
title_en: "Supplier Portal"
title_ar: "بوابة الموردين"
domain: "resources"
navigation_group: "resources_supply"
kind: "PAGE"
canonical_status: "PRIMARY"
canonical_home: "supplier_portal"
parent_page: null
aliases: []
roles: ["workshop.manager","finance.user"]
permission: "workshop.manager, finance.user"
entitlement: "none/global (not a commercial/SaaS-gated page)"
renderer_type: "page-specific"
renderer_sources: ["Supplier portal renderer (source path NOT VERIFIED)"]
view_sources: ["views/supplier_portal.html"]
api_sources: ["NOT VERIFIED in page-specific evidence"]
domain_sources: ["platform/procurement authority is the canonical candidate"]
tables_or_entities: ["portal_users","portal_access_grants","purchase_orders","supplier_quotations","purchase_receipt_events"]
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

- Page ID: `supplier_portal`; English: Supplier Portal; domain: `resources`; navigation group: `resources_supply`.
- Route: `switchPage('supplier_portal')`; page-specific renderer: `Supplier portal renderer (source path NOT VERIFIED)`; view: `views/supplier_portal.html`.
- Canonical status: PRIMARY; this is a primary catalog destination, not an embedded tab or compatibility alias.

# 2. Business Purpose

A supplier user opens the portal to view permitted sourcing/order/receipt requests and submit supplier-side responses without becoming the purchasing or AP authority.

# 3. Primary Users

- Declared client gate: "workshop.manager, finance.user".
- Business roles: owner/operator/reviewer/approver/manager split is NOT VERIFIED from the page-specific evidence.

# 4. Primary User Goal

USER OPENS THIS PAGE TO: A supplier user opens the portal to view permitted sourcing/order/receipt requests and submit supplier-side responses without becoming the purchasing or AP authority.

# 5. AS-IS Runtime Surface

- Renderer/view: `Supplier portal renderer (source path NOT VERIFIED)` and `views/supplier_portal.html`.
- Query/action boundary: NOT VERIFIED in page-specific evidence.
- Current classification: **THIN**; usability: **THIN**.
- Visible primary actions:
- View/respond -> API/domain/persistence NOT VERIFIED
- The page-specific evidence is separated from navigation proof. A visible route does not prove persistence, permission isolation, or completed workflow.

# 6. Data Sources

- UI to API/query: `NOT VERIFIED in page-specific evidence`.
- Domain authority: `platform/procurement authority is the canonical candidate`.
- Persisted entities/tables where source evidence permits: `portal_users`, `portal_access_grants`, `purchase_orders`, `supplier_quotations`, `purchase_receipt_events`.
- Company/branch/warehouse/actor scope: server-derived scope is required where the cited API/domain supports it; page-specific isolation proof remains a separate acceptance item.

# 7. Actions

- View/respond -> API/domain/persistence NOT VERIFIED — permission: declared page gate plus server action authorization; persistence: Procurement remains authoritative; portal is a constrained participant.

# 8. Inputs

- Required business inputs: record IDs, governed party/product/project/warehouse selectors, lifecycle decisions, quantities/reasons, and source references according to the action.
- Raw IDs must not bypass company, branch, warehouse, actor, maker-checker, or lifecycle validation.
- For connected actions, the server must derive scope and validate stale state before persistence.

# 9. Outputs

Supplier response/status NOT VERIFIED.

# 10. Workflow Position

- Upstream: supplier party/portal grant; RFQ or purchase order.
- Downstream: procurement award/order/receipt; AP.
- Workflow classification: PARTIAL/UNVERIFIED; the page must not be presented as a completed canonical handoff.

# 11. States

- NOT_VERIFIED.
- LOADING, EMPTY, DENIED, VALIDATION_ERROR, SERVER_ERROR, and SUCCESS/HANDOFF must remain visibly distinct wherever the renderer supports the corresponding state.
- State persistence and transition authority: Procurement remains authoritative; portal is a constrained participant.

# 12. Permissions & Scope

- Client navigation gate: workshop.manager, finance.user.
- Server authorization: action/resource permission plus company/branch/warehouse/actor scope as enforced by the cited API/domain; exact matrix is NOT VERIFIED.
- A visible button is not authorization proof. Approver/requester separation is required for governed actions.

# 13. Arabic / English

- English label: Supplier Portal; Arabic label source: بوابة الموردين.
- Every primary action and lifecycle state needs a paired visible Arabic/English label; mojibake or untranslated state text is a usability defect.

# 14. Responsive Requirements

- Desktop: preserve scope, record identity, state, primary action, errors, and handoff reference without hiding the business decision.
- Mobile: if used by workshop, warehouse, field, or supplier staff, prove the smallest complete action with controls and validation visible; direct mobile behavior is NOT VERIFIED.

# 15. AS-IS Functional Assessment

**THIN / THIN** — Page/view/navigation inventory; canonical procurement actions are known but not linked by this renderer.. This is a source-evidence classification, not a release acceptance claim.

# 16. Target Business Contract

A supplier user opens the portal to view permitted sourcing/order/receipt requests and submit supplier-side responses without becoming the purchasing or AP authority. The target contract is a governed page-specific workflow that loads scoped data, exposes lifecycle-valid actions, persists through **Procurement remains authoritative; portal is a constrained participant.**, returns a durable reference, and distinguishes loading, empty, denied, validation, server-error, and success states. The target is not complete until the gaps and acceptance criteria below have evidence.

# 17. Identified Gaps

- **supplier_portal-W3-01** (P1, CREDIBILITY_GAP) — Primary supplier portal navigation is not connected to the canonical procurement action boundary in the inspected evidence. **Required next step:** Recover portal API, supplier isolation, and submit-to-procurement lifecycle.

# 18. Consolidation Analysis

- Recommended disposition: **STRENGTHEN**.
- Keep this page separate only when its user goal and lifecycle authority are distinct. Shared tables, tabs, or labels alone are not proof of duplication.
- Canonical authority decision: Procurement remains authoritative; portal is a constrained participant.

# 19. Acceptance Criteria

- A permitted user opens the page and sees a non-error page-specific surface in the active scope.
- Each primary action validates required inputs, actor/tenant scope, lifecycle state, and maker-checker rules; its response shows the resulting state and durable reference.
- A direct browser/API/domain test proves the highest-risk transition and confirms persistence; navigation-only evidence is insufficient.
- Cross-page handoffs identified above are either proven in a lifecycle test or explicitly rendered as manual/not verified.
- For this page specifically: A supplier user opens the portal to view permitted sourcing/order/receipt requests and submit supplier-side responses without becoming the purchasing or AP authority.

# 20. Test Evidence

- Evidence class: **Page/view/navigation inventory; canonical procurement actions are known but not linked by this renderer.**
- Cited source/tests:

- Navigation audit, if cited by the existing catalog, proves route activation/visible surface only; it does not prove domain mutation, isolation, or persistence.

# 21. Known Limitations

- Catalog baseline: `3c047bb0d04985cd88a536d4dbb16b74d2d6405a`; engineering reference: `25c24df753962bbf3c13301eed71624bc0ee39b6`.
- Wave 3 is documentation-only. No engineering source, tests, migrations, runtime data, navigation, or product implementation was changed.
- Source evidence is current to the recorded engineering reference; uncommitted engineering changes are outside this spec.

# 22. Source Evidence

- `views/supplier_portal.html`

# 23. Change History

- 2026-08-14 — Wave 3 deep review from engineering reference `25c24df753962bbf3c13301eed71624bc0ee39b6`; Wave 2 pages and catalog history were preserved.

## CAPABILITIES OWNED

- Procurement remains authoritative; portal is a constrained participant.

## CAPABILITIES CONSUMED

- supplier party/portal grant; RFQ or purchase order; procurement award/order/receipt; AP
