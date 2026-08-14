---
page_id: "workshop_ledger"
title_en: "Workshop Ledger"
title_ar: "محاسبة ودوام الورشة"
domain: "finance"
navigation_group: "finance_accounts"
kind: "PAGE"
canonical_status: "PRIMARY"
canonical_home: "workshop_ledger"
parent_page: null
aliases: []
roles: ["workshop.manager","finance.user"]
permission: "workshop.manager, finance.user"
entitlement: "none/global (not a commercial/SaaS-gated page)"
renderer_type: "page-specific"
renderer_sources: ["modules/workshop-ledger.js"]
view_sources: ["views/workshop_ledger.html"]
api_sources: ["Fetch /workshop_migration_data.json plus local import/actions; no canonical Finance API shown"]
domain_sources: ["local workshop_migration_data and local finance transaction helpers"]
tables_or_entities: ["workshop_migration_data.json","local finance transactions","attendance/advances local collections"]
test_sources: ["tests/phase03/workshop_ledger.test.mjs","tests/navigation/run-click-audit.mjs"]
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

- Page ID: `workshop_ledger`; English: Workshop Ledger; domain: `finance`; navigation group: `finance_accounts`.
- Route: `switchPage('workshop_ledger')`; page-specific renderer: `modules/workshop-ledger.js`; view: `views/workshop_ledger.html`.
- Canonical status: PRIMARY; this is a primary catalog destination, not an embedded tab or compatibility alias.

# 2. Business Purpose

A workshop finance user opens Workshop Ledger expecting a trustworthy ledger, cashbox, advances, attendance, and payroll-related view tied to canonical Finance.

# 3. Primary Users

- Declared client gate: "workshop.manager, finance.user".
- Business roles: owner/operator/reviewer/approver/manager split is NOT VERIFIED from the page-specific evidence.

# 4. Primary User Goal

USER OPENS THIS PAGE TO: A workshop finance user opens Workshop Ledger expecting a trustworthy ledger, cashbox, advances, attendance, and payroll-related view tied to canonical Finance.

# 5. AS-IS Runtime Surface

- Renderer/view: `modules/workshop-ledger.js` and `views/workshop_ledger.html`.
- Query/action boundary: Fetch /workshop_migration_data.json plus local import/actions; no canonical Finance API shown.
- Current classification: **SIMULATED_BY_DESIGN**; usability: **THIN**.
- Visible primary actions:
- Run import/pay salary/audit -> local data mutation and local finance helper
- The page-specific evidence is separated from navigation proof. A visible route does not prove persistence, permission isolation, or completed workflow.

# 6. Data Sources

- UI to API/query: `Fetch /workshop_migration_data.json plus local import/actions; no canonical Finance API shown`.
- Domain authority: `local workshop_migration_data and local finance transaction helpers`.
- Persisted entities/tables where source evidence permits: `workshop_migration_data.json`, `local finance transactions`, `attendance/advances local collections`.
- Company/branch/warehouse/actor scope: server-derived scope is required where the cited API/domain supports it; page-specific isolation proof remains a separate acceptance item.

# 7. Actions

- Run import/pay salary/audit -> local data mutation and local finance helper — permission: declared page gate plus server action authorization; persistence: Current local authority conflicts with canonical Finance; page must not be treated as posted accounting.

# 8. Inputs

- Required business inputs: record IDs, governed party/product/project/warehouse selectors, lifecycle decisions, quantities/reasons, and source references according to the action.
- Raw IDs must not bypass company, branch, warehouse, actor, maker-checker, or lifecycle validation.
- For the current local surface, inputs are browser-local and must not be treated as posted business facts.

# 9. Outputs

Local ledger/import result; canonical journal/posting reference NOT VERIFIED.

# 10. Workflow Position

- Upstream: workshop migration JSON; attendance/advance local state.
- Downstream: cashbox/payroll/finance reports NOT VERIFIED.
- Workflow classification: PARTIAL/UNVERIFIED; the page must not be presented as a completed canonical handoff.

# 11. States

- IMPORTED, EDITABLE, PAID, AUDITED (local).
- LOADING, EMPTY, DENIED, VALIDATION_ERROR, SERVER_ERROR, and SUCCESS/HANDOFF must remain visibly distinct wherever the renderer supports the corresponding state.
- State persistence and transition authority: Current local authority conflicts with canonical Finance; page must not be treated as posted accounting.

# 12. Permissions & Scope

- Client navigation gate: workshop.manager, finance.user.
- Server authorization: action/resource permission plus company/branch/warehouse/actor scope as enforced by the cited API/domain; exact matrix is NOT VERIFIED.
- A visible button is not authorization proof. Approver/requester separation is required for governed actions.

# 13. Arabic / English

- English label: Workshop Ledger; Arabic label source: محاسبة ودوام الورشة.
- Every primary action and lifecycle state needs a paired visible Arabic/English label; mojibake or untranslated state text is a usability defect.

# 14. Responsive Requirements

- Desktop: preserve scope, record identity, state, primary action, errors, and handoff reference without hiding the business decision.
- Mobile: if used by workshop, warehouse, field, or supplier staff, prove the smallest complete action with controls and validation visible; direct mobile behavior is NOT VERIFIED.

# 15. AS-IS Functional Assessment

**SIMULATED_BY_DESIGN / THIN** — Module source explicitly reads migration JSON and uses local finance helpers; no canonical Finance API wiring shown.. This is a source-evidence classification, not a release acceptance claim.

# 16. Target Business Contract

A workshop finance user opens Workshop Ledger expecting a trustworthy ledger, cashbox, advances, attendance, and payroll-related view tied to canonical Finance. The target contract is a governed page-specific workflow that loads scoped data, exposes lifecycle-valid actions, persists through **Current local authority conflicts with canonical Finance; page must not be treated as posted accounting.**, returns a durable reference, and distinguishes loading, empty, denied, validation, server-error, and success states. The target is not complete until the gaps and acceptance criteria below have evidence.

# 17. Identified Gaps

- **workshop_ledger-W3-01** (P0, AUTHORITY_CONFLICT) — Workshop Ledger presents a unified financial table and local pay/import actions while Finance is the canonical GL authority. **Required next step:** Freeze new writes, define migration/source-fact mapping, and replace local posting with Finance actions.
- **workshop_ledger-W3-02** (P1, CREDIBILITY_GAP) — No tenant/company/period isolation or idempotent migration proof is attributed to the page. **Required next step:** Add migration rehearsal evidence and source-document idempotency.

# 18. Consolidation Analysis

- Recommended disposition: **RETIRE_OR_MIGRATE**.
- Keep this page separate only when its user goal and lifecycle authority are distinct. Shared tables, tabs, or labels alone are not proof of duplication.
- Canonical authority decision: Current local authority conflicts with canonical Finance; page must not be treated as posted accounting.

# 19. Acceptance Criteria

- A permitted user opens the page and sees a non-error page-specific surface in the active scope.
- Each primary action validates required inputs, actor/tenant scope, lifecycle state, and maker-checker rules; its response shows the resulting state and durable reference.
- A direct browser/API/domain test proves the highest-risk transition and confirms persistence; navigation-only evidence is insufficient.
- Cross-page handoffs identified above are either proven in a lifecycle test or explicitly rendered as manual/not verified.
- For this page specifically: A workshop finance user opens Workshop Ledger expecting a trustworthy ledger, cashbox, advances, attendance, and payroll-related view tied to canonical Finance.

# 20. Test Evidence

- Evidence class: **Module source explicitly reads migration JSON and uses local finance helpers; no canonical Finance API wiring shown.**
- Cited source/tests:
- `tests/phase03/workshop_ledger.test.mjs`
- `tests/navigation/run-click-audit.mjs`
- Navigation audit, if cited by the existing catalog, proves route activation/visible surface only; it does not prove domain mutation, isolation, or persistence.

# 21. Known Limitations

- Catalog baseline: `3c047bb0d04985cd88a536d4dbb16b74d2d6405a`; engineering reference: `25c24df753962bbf3c13301eed71624bc0ee39b6`.
- Wave 3 is documentation-only. No engineering source, tests, migrations, runtime data, navigation, or product implementation was changed.
- Source evidence is current to the recorded engineering reference; uncommitted engineering changes are outside this spec.

# 22. Source Evidence

- `modules/workshop-ledger.js`
- `views/workshop_ledger.html`
- `tests/phase03/workshop_ledger.test.mjs`
- `tests/navigation/run-click-audit.mjs`

# 23. Change History

- 2026-08-14 — Wave 3 deep review from engineering reference `25c24df753962bbf3c13301eed71624bc0ee39b6`; Wave 2 pages and catalog history were preserved.

## CAPABILITIES OWNED

- Current local authority conflicts with canonical Finance; page must not be treated as posted accounting.

## CAPABILITIES CONSUMED

- workshop migration JSON; attendance/advance local state; cashbox/payroll/finance reports NOT VERIFIED
