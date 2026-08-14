---
page_id: "finance_installments"
title_en: "Finance Installments"
title_ar: "خطط التقسيط"
domain: "finance"
navigation_group: "finance_accounts"
kind: "PAGE"
canonical_status: "PRIMARY"
canonical_home: "finance_installments"
parent_page: null
aliases: []
roles: ["finance.manager","finance.user"]
permission: "finance.manager, finance.user"
entitlement: "none/global (not a commercial/SaaS-gated page)"
renderer_type: "page-specific"
renderer_sources: ["modules/finance-installments.js"]
view_sources: ["views/finance_installments.html"]
api_sources: ["No /api/v1 call; omni.finance.installmentPlans and saveData/local state"]
domain_sources: ["local browser finance object","Finance AR is canonical candidate"]
tables_or_entities: ["omni.finance.installmentPlans","local installment lines","finance_documents candidate"]
test_sources: ["tests/navigation/run-click-audit.mjs"]
catalog_baseline_sha: "3c047bb0d04985cd88a536d4dbb16b74d2d6405a"
last_verified_sha: "25c24df753962bbf3c13301eed71624bc0ee39b6"
engineering_reference_sha: "25c24df753962bbf3c13301eed71624bc0ee39b6"
deep_review_wave: 3
evidence_confidence: "MEDIUM"
implementation_status: "IMPLEMENTED_AT_ENGINEERING_REFERENCE"
functional_status: "SIMULATED_BY_DESIGN"
usability_status: "THIN"
review_status: "REQUIRES_PRODUCT_RECOVERY"
---

# 1. Identity

- Page ID: `finance_installments`; English: Finance Installments; domain: `finance`; navigation group: `finance_accounts`.
- Route: `switchPage('finance_installments')`; page-specific renderer: `modules/finance-installments.js`; view: `views/finance_installments.html`.
- Canonical status: PRIMARY; this is a primary catalog destination, not an embedded tab or compatibility alias.

# 2. Business Purpose

A finance user opens Installment Plans to create and monitor a customer payment schedule, register payments, and reconcile the schedule to a canonical receivable rather than a browser-local balance.

# 3. Primary Users

- Declared client gate: "finance.manager, finance.user".
- Business roles: owner/operator/reviewer/approver/manager split is NOT VERIFIED from the page-specific evidence.

# 4. Primary User Goal

USER OPENS THIS PAGE TO: A finance user opens Installment Plans to create and monitor a customer payment schedule, register payments, and reconcile the schedule to a canonical receivable rather than a browser-local balance.

# 5. AS-IS Runtime Surface

- Renderer/view: `modules/finance-installments.js` and `views/finance_installments.html`.
- Query/action boundary: No /api/v1 call; omni.finance.installmentPlans and saveData/local state.
- Current classification: **SIMULATED_BY_DESIGN**; usability: **THIN**.
- Visible primary actions:
- Create plan/pay/complete/delete -> local object mutation; no Finance action ID
- The page-specific evidence is separated from navigation proof. A visible route does not prove persistence, permission isolation, or completed workflow.

# 6. Data Sources

- UI to API/query: `No /api/v1 call; omni.finance.installmentPlans and saveData/local state`.
- Domain authority: `local browser finance object; Finance AR is canonical candidate`.
- Persisted entities/tables where source evidence permits: `omni.finance.installmentPlans`, `local installment lines`, `finance_documents candidate`.
- Company/branch/warehouse/actor scope: server-derived scope is required where the cited API/domain supports it; page-specific isolation proof remains a separate acceptance item.

# 7. Actions

- Create plan/pay/complete/delete -> local object mutation; no Finance action ID — permission: declared page gate plus server action authorization; persistence: Current local authority is not acceptable for financial posting; Finance AR must own result.

# 8. Inputs

- Required business inputs: record IDs, governed party/product/project/warehouse selectors, lifecycle decisions, quantities/reasons, and source references according to the action.
- Raw IDs must not bypass company, branch, warehouse, actor, maker-checker, or lifecycle validation.
- For the current local surface, inputs are browser-local and must not be treated as posted business facts.

# 9. Outputs

Browser-local plan/line status and KPI strip.

# 10. Workflow Position

- Upstream: local customer list and manually entered total.
- Downstream: local late view; canonical AR/payment allocation NOT VERIFIED.
- Workflow classification: PARTIAL/UNVERIFIED; the page must not be presented as a completed canonical handoff.

# 11. States

- ACTIVE, COMPLETED, DEFAULTED, PENDING, PAID, LATE (local).
- LOADING, EMPTY, DENIED, VALIDATION_ERROR, SERVER_ERROR, and SUCCESS/HANDOFF must remain visibly distinct wherever the renderer supports the corresponding state.
- State persistence and transition authority: Current local authority is not acceptable for financial posting; Finance AR must own result.

# 12. Permissions & Scope

- Client navigation gate: finance.manager, finance.user.
- Server authorization: action/resource permission plus company/branch/warehouse/actor scope as enforced by the cited API/domain; exact matrix is NOT VERIFIED.
- A visible button is not authorization proof. Approver/requester separation is required for governed actions.

# 13. Arabic / English

- English label: Finance Installments; Arabic label source: خطط التقسيط.
- Every primary action and lifecycle state needs a paired visible Arabic/English label; mojibake or untranslated state text is a usability defect.

# 14. Responsive Requirements

- Desktop: preserve scope, record identity, state, primary action, errors, and handoff reference without hiding the business decision.
- Mobile: if used by workshop, warehouse, field, or supplier staff, prove the smallest complete action with controls and validation visible; direct mobile behavior is NOT VERIFIED.

# 15. AS-IS Functional Assessment

**SIMULATED_BY_DESIGN / THIN** — Full module source shows omni/local state, prompt-based payment, saveData, and no API call.. This is a source-evidence classification, not a release acceptance claim.

# 16. Target Business Contract

A finance user opens Installment Plans to create and monitor a customer payment schedule, register payments, and reconcile the schedule to a canonical receivable rather than a browser-local balance. The target contract is a governed page-specific workflow that loads scoped data, exposes lifecycle-valid actions, persists through **Current local authority is not acceptable for financial posting; Finance AR must own result.**, returns a durable reference, and distinguishes loading, empty, denied, validation, server-error, and success states. The target is not complete until the gaps and acceptance criteria below have evidence.

# 17. Identified Gaps

- **finance_installments-W3-01** (P0, AUTHORITY_CONFLICT) — Installment plans and payments are local while Finance owns AR documents, payments, and allocations. **Required next step:** Migrate schedules to a canonical Finance receivable/payment contract or retire this writer.
- **finance_installments-W3-02** (P1, WORKFLOW_DISCONNECT) — No source invoice, currency, company, period, idempotency, or payment allocation reference is present. **Required next step:** Define required source document and post/allocate lifecycle before reuse.

# 18. Consolidation Analysis

- Recommended disposition: **RETIRE_OR_MIGRATE**.
- Keep this page separate only when its user goal and lifecycle authority are distinct. Shared tables, tabs, or labels alone are not proof of duplication.
- Canonical authority decision: Current local authority is not acceptable for financial posting; Finance AR must own result.

# 19. Acceptance Criteria

- A permitted user opens the page and sees a non-error page-specific surface in the active scope.
- Each primary action validates required inputs, actor/tenant scope, lifecycle state, and maker-checker rules; its response shows the resulting state and durable reference.
- A direct browser/API/domain test proves the highest-risk transition and confirms persistence; navigation-only evidence is insufficient.
- Cross-page handoffs identified above are either proven in a lifecycle test or explicitly rendered as manual/not verified.
- For this page specifically: A finance user opens Installment Plans to create and monitor a customer payment schedule, register payments, and reconcile the schedule to a canonical receivable rather than a browser-local balance.

# 20. Test Evidence

- Evidence class: **Full module source shows omni/local state, prompt-based payment, saveData, and no API call.**
- Cited source/tests:
- `tests/navigation/run-click-audit.mjs`
- Navigation audit, if cited by the existing catalog, proves route activation/visible surface only; it does not prove domain mutation, isolation, or persistence.

# 21. Known Limitations

- Catalog baseline: `3c047bb0d04985cd88a536d4dbb16b74d2d6405a`; engineering reference: `25c24df753962bbf3c13301eed71624bc0ee39b6`.
- Wave 3 is documentation-only. No engineering source, tests, migrations, runtime data, navigation, or product implementation was changed.
- Source evidence is current to the recorded engineering reference; uncommitted engineering changes are outside this spec.

# 22. Source Evidence

- `modules/finance-installments.js`
- `views/finance_installments.html`
- `tests/navigation/run-click-audit.mjs`

# 23. Change History

- 2026-08-14 — Wave 3 deep review from engineering reference `25c24df753962bbf3c13301eed71624bc0ee39b6`; Wave 2 pages and catalog history were preserved.

## CAPABILITIES OWNED

- Current local authority is not acceptable for financial posting; Finance AR must own result.

## CAPABILITIES CONSUMED

- local customer list and manually entered total; local late view; canonical AR/payment allocation NOT VERIFIED
