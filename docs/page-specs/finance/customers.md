---
page_id: "customers"
title_en: "Customers"
title_ar: "أرصدة العملاء"
domain: "finance"
navigation_group: "finance_accounts"
kind: "LIST"
canonical_status: "PRIMARY"
canonical_home: "customers"
parent_page: null
aliases: []
roles: ["finance.user"]
permission: "finance.user"
entitlement: "none/global (not a commercial/SaaS-gated page)"
renderer_type: "page-specific"
renderer_sources: ["modules/canonical-sales.js"]
view_sources: ["views/customers_and_suppliers.html"]
api_sources: ["GET /api/v1/commercial/parties?role=customer; GET /api/v1/finance/*"]
domain_sources: ["platform/commercial/parties.mjs","platform/finance/engine.mjs"]
tables_or_entities: ["parties","party_roles","finance_documents","finance_journal_entries"]
test_sources: ["tests/phase04-finalization/customers_and_suppliers.test.mjs","tests/phase04-finalization/canonical_sales.test.mjs"]
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

- Page ID: `customers`; English: Customers; domain: `finance`; navigation group: `finance_accounts`.
- Route: `switchPage('customers')`; page-specific renderer: `modules/canonical-sales.js`; view: `views/customers_and_suppliers.html`.
- Canonical status: PRIMARY; this is a primary catalog destination, not an embedded tab or compatibility alias.

# 2. Business Purpose

A finance user opens Customers to inspect customer balances and customer-facing financial context without creating a second customer identity authority.

# 3. Primary Users

- Declared client gate: "finance.user".
- Business roles: owner/operator/reviewer/approver/manager split is partly evidenced by the cited domain boundary but requires direct role-isolation proof.

# 4. Primary User Goal

USER OPENS THIS PAGE TO: A finance user opens Customers to inspect customer balances and customer-facing financial context without creating a second customer identity authority.

# 5. AS-IS Runtime Surface

- Renderer/view: `modules/canonical-sales.js` and `views/customers_and_suppliers.html`.
- Query/action boundary: GET /api/v1/commercial/parties?role=customer; GET /api/v1/finance/*.
- Current classification: **CONNECTED**; usability: **USABLE**.
- Visible primary actions:
- Filter customer -> parties query
- Open finance context -> finance/customer open-items query
- The page-specific evidence is separated from navigation proof. A visible route does not prove persistence, permission isolation, or completed workflow.

# 6. Data Sources

- UI to API/query: `GET /api/v1/commercial/parties?role=customer; GET /api/v1/finance/*`.
- Domain authority: `platform/commercial/parties.mjs; platform/finance/engine.mjs`.
- Persisted entities/tables where source evidence permits: `parties`, `party_roles`, `finance_documents`, `finance_journal_entries`.
- Company/branch/warehouse/actor scope: server-derived scope is required where the cited API/domain supports it; page-specific isolation proof remains a separate acceptance item.

# 7. Actions

- Filter customer -> parties query — permission: declared page gate plus server action authorization; persistence: Parties owns identity; Finance owns balances/open items.
- Open finance context -> finance/customer open-items query — permission: declared page gate plus server action authorization; persistence: Parties owns identity; Finance owns balances/open items.

# 8. Inputs

- Required business inputs: record IDs, governed party/product/project/warehouse selectors, lifecycle decisions, quantities/reasons, and source references according to the action.
- Raw IDs must not bypass company, branch, warehouse, actor, maker-checker, or lifecycle validation.
- For connected actions, the server must derive scope and validate stale state before persistence.

# 9. Outputs

Customer list and finance-linked open-item context.

# 10. Workflow Position

- Upstream: parties; posted finance documents.
- Downstream: sales; ar_ap; customer_portal.
- Workflow classification: CONNECTED for the cited page-to-domain edge; cross-page completion edges marked in gaps are not assumed.

# 11. States

- LOADING, READY, EMPTY, DENIED, SERVER_ERROR.
- LOADING, EMPTY, DENIED, VALIDATION_ERROR, SERVER_ERROR, and SUCCESS/HANDOFF must remain visibly distinct wherever the renderer supports the corresponding state.
- State persistence and transition authority: Parties owns identity; Finance owns balances/open items.

# 12. Permissions & Scope

- Client navigation gate: finance.user.
- Server authorization: action/resource permission plus company/branch/warehouse/actor scope as enforced by the cited API/domain; exact matrix is partly evidenced, not fully proven here.
- A visible button is not authorization proof. Approver/requester separation is required for governed actions.

# 13. Arabic / English

- English label: Customers; Arabic label source: أرصدة العملاء.
- Every primary action and lifecycle state needs a paired visible Arabic/English label; mojibake or untranslated state text is a usability defect.

# 14. Responsive Requirements

- Desktop: preserve scope, record identity, state, primary action, errors, and handoff reference without hiding the business decision.
- Mobile: if used by workshop, warehouse, field, or supplier staff, prove the smallest complete action with controls and validation visible; direct mobile behavior is NOT VERIFIED.

# 15. AS-IS Functional Assessment

**CONNECTED / USABLE** — Manifest page mapping plus canonical commercial/sales/finance sources; dedicated Customers renderer boundary needs confirmation.. This is a source-evidence classification, not a release acceptance claim.

# 16. Target Business Contract

A finance user opens Customers to inspect customer balances and customer-facing financial context without creating a second customer identity authority. The target contract is a governed page-specific workflow that loads scoped data, exposes lifecycle-valid actions, persists through **Parties owns identity; Finance owns balances/open items.**, returns a durable reference, and distinguishes loading, empty, denied, validation, server-error, and success states. The target is not complete until the gaps and acceptance criteria below have evidence.

# 17. Identified Gaps

- **customers-W3-01** (P2, CONSOLIDATION_CANDIDATE) — Customers and Parties expose overlapping identity surfaces; ownership is not clear from navigation names alone. **Required next step:** Owner decision: make Customers a finance-filtered view of Parties or document its distinct finance goal.

# 18. Consolidation Analysis

- Recommended disposition: **CONSOLIDATE_WITH_PARTIES_REVIEW**.
- Keep this page separate only when its user goal and lifecycle authority are distinct. Shared tables, tabs, or labels alone are not proof of duplication.
- Canonical authority decision: Parties owns identity; Finance owns balances/open items.

# 19. Acceptance Criteria

- A permitted user opens the page and sees a non-error page-specific surface in the active scope.
- Each primary action validates required inputs, actor/tenant scope, lifecycle state, and maker-checker rules; its response shows the resulting state and durable reference.
- A direct browser/API/domain test proves the highest-risk transition and confirms persistence; navigation-only evidence is insufficient.
- Cross-page handoffs identified above are either proven in a lifecycle test or explicitly rendered as manual/not verified.
- For this page specifically: A finance user opens Customers to inspect customer balances and customer-facing financial context without creating a second customer identity authority.

# 20. Test Evidence

- Evidence class: **Manifest page mapping plus canonical commercial/sales/finance sources; dedicated Customers renderer boundary needs confirmation.**
- Cited source/tests:
- `tests/phase04-finalization/customers_and_suppliers.test.mjs`
- `tests/phase04-finalization/canonical_sales.test.mjs`
- Navigation audit, if cited by the existing catalog, proves route activation/visible surface only; it does not prove domain mutation, isolation, or persistence.

# 21. Known Limitations

- Catalog baseline: `3c047bb0d04985cd88a536d4dbb16b74d2d6405a`; engineering reference: `25c24df753962bbf3c13301eed71624bc0ee39b6`.
- Wave 3 is documentation-only. No engineering source, tests, migrations, runtime data, navigation, or product implementation was changed.
- Source evidence is current to the recorded engineering reference; uncommitted engineering changes are outside this spec.

# 22. Source Evidence

- `modules/canonical-sales.js`
- `views/customers_and_suppliers.html`
- `platform/commercial/parties.mjs`
- `platform/finance/engine.mjs`
- `tests/phase04-finalization/customers_and_suppliers.test.mjs`
- `tests/phase04-finalization/canonical_sales.test.mjs`

# 23. Change History

- 2026-08-14 — Wave 3 deep review from engineering reference `25c24df753962bbf3c13301eed71624bc0ee39b6`; Wave 2 pages and catalog history were preserved.

## CAPABILITIES OWNED

- Parties owns identity; Finance owns balances/open items.

## CAPABILITIES CONSUMED

- parties; posted finance documents; sales; ar_ap; customer_portal
