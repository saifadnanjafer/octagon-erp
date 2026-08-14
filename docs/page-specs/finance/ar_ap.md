---
page_id: "ar_ap"
title_en: "Ar Ap"
title_ar: "الذمم المدينة والدائنة"
domain: "finance"
navigation_group: "finance_accounts"
kind: "PAGE"
canonical_status: "PRIMARY"
canonical_home: "ar_ap"
parent_page: null
aliases: []
roles: ["finance.user"]
permission: "finance.user"
entitlement: "none/global (not a commercial/SaaS-gated page)"
renderer_type: "page-specific"
renderer_sources: ["AR/AP renderer (source path NOT VERIFIED)"]
view_sources: ["views/ar_ap.html"]
api_sources: ["GET /api/v1/finance/ar|ap/*; POST /api/v1/action/finance_ar|finance_ap:*"]
domain_sources: ["platform/finance/engine.mjs","platform/finance/index.mjs"]
tables_or_entities: ["finance_documents","finance_document_lines","finance_payments","finance_payment_allocations","parties"]
test_sources: ["tests/phase04/canonical_finance.test.mjs","tests/phase04-finalization/canonical_finance.test.mjs"]
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

- Page ID: `ar_ap`; English: Ar Ap; domain: `finance`; navigation group: `finance_accounts`.
- Route: `switchPage('ar_ap')`; page-specific renderer: `AR/AP renderer (source path NOT VERIFIED)`; view: `views/ar_ap.html`.
- Canonical status: PRIMARY; this is a primary catalog destination, not an embedded tab or compatibility alias.

# 2. Business Purpose

A finance user opens AR/AP to review customer and supplier open items, aging, holds, releases, and payment allocation without editing source transactions outside Finance.

# 3. Primary Users

- Declared client gate: "finance.user".
- Business roles: owner/operator/reviewer/approver/manager split is partly evidenced by the cited domain boundary but requires direct role-isolation proof.

# 4. Primary User Goal

USER OPENS THIS PAGE TO: A finance user opens AR/AP to review customer and supplier open items, aging, holds, releases, and payment allocation without editing source transactions outside Finance.

# 5. AS-IS Runtime Surface

- Renderer/view: `AR/AP renderer (source path NOT VERIFIED)` and `views/ar_ap.html`.
- Query/action boundary: GET /api/v1/finance/ar|ap/*; POST /api/v1/action/finance_ar|finance_ap:*.
- Current classification: **CONNECTED**; usability: **USABLE**.
- Visible primary actions:
- Open items/aging -> finance_ar:open_items/aging and finance_ap:open_items/aging
- Hold/release -> finance_ap:hold/release_hold
- Payment allocation -> finance:payment:*
- The page-specific evidence is separated from navigation proof. A visible route does not prove persistence, permission isolation, or completed workflow.

# 6. Data Sources

- UI to API/query: `GET /api/v1/finance/ar|ap/*; POST /api/v1/action/finance_ar|finance_ap:*`.
- Domain authority: `platform/finance/engine.mjs; platform/finance/index.mjs`.
- Persisted entities/tables where source evidence permits: `finance_documents`, `finance_document_lines`, `finance_payments`, `finance_payment_allocations`, `parties`.
- Company/branch/warehouse/actor scope: server-derived scope is required where the cited API/domain supports it; page-specific isolation proof remains a separate acceptance item.

# 7. Actions

- Open items/aging -> finance_ar:open_items/aging and finance_ap:open_items/aging — permission: declared page gate plus server action authorization; persistence: Finance engine owns AR/AP open items, aging, holds, and allocations.
- Hold/release -> finance_ap:hold/release_hold — permission: declared page gate plus server action authorization; persistence: Finance engine owns AR/AP open items, aging, holds, and allocations.
- Payment allocation -> finance:payment:* — permission: declared page gate plus server action authorization; persistence: Finance engine owns AR/AP open items, aging, holds, and allocations.

# 8. Inputs

- Required business inputs: record IDs, governed party/product/project/warehouse selectors, lifecycle decisions, quantities/reasons, and source references according to the action.
- Raw IDs must not bypass company, branch, warehouse, actor, maker-checker, or lifecycle validation.
- For connected actions, the server must derive scope and validate stale state before persistence.

# 9. Outputs

Scoped balances/aging and allocation/hold state.

# 10. Workflow Position

- Upstream: posted sales invoices; posted supplier bills; payments.
- Downstream: collections; supplier payment; reconciliation; reports.
- Workflow classification: CONNECTED for the cited page-to-domain edge; cross-page completion edges marked in gaps are not assumed.

# 11. States

- OPEN, PARTIAL, PAID, OVERDUE, ON_HOLD, RELEASED, RECONCILED, DENIED.
- LOADING, EMPTY, DENIED, VALIDATION_ERROR, SERVER_ERROR, and SUCCESS/HANDOFF must remain visibly distinct wherever the renderer supports the corresponding state.
- State persistence and transition authority: Finance engine owns AR/AP open items, aging, holds, and allocations.

# 12. Permissions & Scope

- Client navigation gate: finance.user.
- Server authorization: action/resource permission plus company/branch/warehouse/actor scope as enforced by the cited API/domain; exact matrix is partly evidenced, not fully proven here.
- A visible button is not authorization proof. Approver/requester separation is required for governed actions.

# 13. Arabic / English

- English label: Ar Ap; Arabic label source: الذمم المدينة والدائنة.
- Every primary action and lifecycle state needs a paired visible Arabic/English label; mojibake or untranslated state text is a usability defect.

# 14. Responsive Requirements

- Desktop: preserve scope, record identity, state, primary action, errors, and handoff reference without hiding the business decision.
- Mobile: if used by workshop, warehouse, field, or supplier staff, prove the smallest complete action with controls and validation visible; direct mobile behavior is NOT VERIFIED.

# 15. AS-IS Functional Assessment

**CONNECTED / USABLE** — Finance engine/index action registry and finance test sources; page renderer direct proof bounded.. This is a source-evidence classification, not a release acceptance claim.

# 16. Target Business Contract

A finance user opens AR/AP to review customer and supplier open items, aging, holds, releases, and payment allocation without editing source transactions outside Finance. The target contract is a governed page-specific workflow that loads scoped data, exposes lifecycle-valid actions, persists through **Finance engine owns AR/AP open items, aging, holds, and allocations.**, returns a durable reference, and distinguishes loading, empty, denied, validation, server-error, and success states. The target is not complete until the gaps and acceptance criteria below have evidence.

# 17. Identified Gaps

- **ar_ap-W3-01** (P1, CREDIBILITY_GAP) — Exact page-specific permission and direct browser action evidence are not separated from Finance engine tests. **Required next step:** Attach AR/AP role-isolation and payment-allocation browser proof.

# 18. Consolidation Analysis

- Recommended disposition: **KEEP_PRIMARY**.
- Keep this page separate only when its user goal and lifecycle authority are distinct. Shared tables, tabs, or labels alone are not proof of duplication.
- Canonical authority decision: Finance engine owns AR/AP open items, aging, holds, and allocations.

# 19. Acceptance Criteria

- A permitted user opens the page and sees a non-error page-specific surface in the active scope.
- Each primary action validates required inputs, actor/tenant scope, lifecycle state, and maker-checker rules; its response shows the resulting state and durable reference.
- A direct browser/API/domain test proves the highest-risk transition and confirms persistence; navigation-only evidence is insufficient.
- Cross-page handoffs identified above are either proven in a lifecycle test or explicitly rendered as manual/not verified.
- For this page specifically: A finance user opens AR/AP to review customer and supplier open items, aging, holds, releases, and payment allocation without editing source transactions outside Finance.

# 20. Test Evidence

- Evidence class: **Finance engine/index action registry and finance test sources; page renderer direct proof bounded.**
- Cited source/tests:
- `tests/phase04/canonical_finance.test.mjs`
- `tests/phase04-finalization/canonical_finance.test.mjs`
- Navigation audit, if cited by the existing catalog, proves route activation/visible surface only; it does not prove domain mutation, isolation, or persistence.

# 21. Known Limitations

- Catalog baseline: `3c047bb0d04985cd88a536d4dbb16b74d2d6405a`; engineering reference: `25c24df753962bbf3c13301eed71624bc0ee39b6`.
- Wave 3 is documentation-only. No engineering source, tests, migrations, runtime data, navigation, or product implementation was changed.
- Source evidence is current to the recorded engineering reference; uncommitted engineering changes are outside this spec.

# 22. Source Evidence

- `views/ar_ap.html`
- `platform/finance/engine.mjs`
- `platform/finance/index.mjs`
- `tests/phase04/canonical_finance.test.mjs`
- `tests/phase04-finalization/canonical_finance.test.mjs`

# 23. Change History

- 2026-08-14 — Wave 3 deep review from engineering reference `25c24df753962bbf3c13301eed71624bc0ee39b6`; Wave 2 pages and catalog history were preserved.

## CAPABILITIES OWNED

- Finance engine owns AR/AP open items, aging, holds, and allocations.

## CAPABILITIES CONSUMED

- posted sales invoices; posted supplier bills; payments; collections; supplier payment; reconciliation; reports
