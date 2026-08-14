---
page_id: "account_mapping"
title_en: "Account Mapping"
title_ar: "· ربط الحسابات"
domain: "finance"
navigation_group: "finance_consolidation"
kind: "PAGE"
canonical_status: "PRIMARY"
canonical_home: "account_mapping"
parent_page: null
aliases: []
roles: ["finance.manager"]
permission: "finance.manager"
entitlement: "none/global (not a commercial/SaaS-gated page)"
renderer_type: "page-specific-or-generic-shell"
renderer_sources: ["app.js"]
view_sources: ["views/account_mapping.html"]
api_sources: ["GET /api/v1/finance/*; consolidation page-specific route NOT VERIFIED"]
domain_sources: ["platform/consolidation/index.mjs","platform/finance/engine.mjs"]
tables_or_entities: ["finance_consolidation_groups","finance_consolidation_runs","finance_elimination_entries","finance_lineage_links","finance_documents","finance_account_mappings","finance_accounts"]
test_sources: ["tests/build-08/consolidation-domain.test.mjs","tests/build-08/group-finance-browser-chromium.test.mjs","tests/page-consolidation/consolidation-contract.test.mjs"]
catalog_baseline_sha: "10152af1772bf9efba43cc42bb4226b73b63abca"
last_verified_sha: "25c24df753962bbf3c13301eed71624bc0ee39b6"
engineering_reference_sha: "25c24df753962bbf3c13301eed71624bc0ee39b6"
deep_review_wave: 4
evidence_confidence: "MEDIUM"
implementation_status: "IMPLEMENTED_OR_PRESENT_AT_ENGINEERING_REFERENCE"
functional_status: "THIN"
usability_status: "THIN"
review_status: "REQUIRES_PRODUCT_RECOVERY"
---

# 1. Identity

- Page ID: `account_mapping`; English: Account Mapping; domain: `finance`; navigation group: `finance_consolidation`.
- Route: `switchPage('account_mapping')`; view: `views/account_mapping.html`; renderer evidence: `app.js`.
- Canonical status: PRIMARY; this page is a primary navigation destination, not an embedded tab.

# 2. Business Purpose

A finance administrator opens Account Mapping to define or review how source-company accounts map into group reporting accounts before consolidation.

# 3. Primary Users

- Declared client gate: finance.manager.
- Operational roles: owner/operator/reviewer/approver/manager split is NOT VERIFIED from page-specific evidence.

# 4. Primary User Goal

USER OPENS THIS PAGE TO: A finance administrator opens Account Mapping to define or review how source-company accounts map into group reporting accounts before consolidation.

# 5. AS-IS Runtime Surface

- View: `views/account_mapping.html`; renderer: `app.js generic/legacy surface`.
- API/query boundary: GET /api/v1/finance/*; consolidation page-specific route NOT VERIFIED.
- AS-IS classification: **THIN**; usability: **THIN**.
- Primary actions:
- Create/update mapping -> page action/API NOT VERIFIED — permission: server authorization required; persistence: Consolidation domain should own group, run, elimination, and lineage state; Finance owns source journals.
- Validate mapping -> consolidation readiness NOT VERIFIED — permission: server authorization required; persistence: Consolidation domain should own group, run, elimination, and lineage state; Finance owns source journals.
- Navigation activation is not persistence, isolation, lifecycle, or release proof.

# 6. Data Sources

- UI to API/query: `GET /api/v1/finance/*; consolidation page-specific route NOT VERIFIED`.
- Domain authority: `platform/consolidation/index.mjs; platform/finance/engine.mjs`.
- Tables/entities where evidence permits: `finance_consolidation_groups`, `finance_consolidation_runs`, `finance_elimination_entries`, `finance_lineage_links`, `finance_documents`, `finance_account_mappings`, `finance_accounts`.
- Scope requirements: company, branch, period, currency, actor, and role scope must be server-derived where applicable; local-only rows are not canonical posted facts.

# 7. Actions

- Create/update mapping -> page action/API NOT VERIFIED — permission: server authorization required; persistence: Consolidation domain should own group, run, elimination, and lineage state; Finance owns source journals.
- Validate mapping -> consolidation readiness NOT VERIFIED — permission: server authorization required; persistence: Consolidation domain should own group, run, elimination, and lineage state; Finance owns source journals.

# 8. Inputs

- Business inputs vary by page: company/group/period, account mapping, amount/date/source document, bank or facility reference, reconciliation decision, workflow definition, tax period, or device/session context.
- Raw IDs must not bypass tenant, company, period, actor, maker-checker, lifecycle, or entitlement validation.
- For local or NOT_VERIFIED surfaces, inputs must be treated as provisional until a canonical API/domain persistence proof exists.

# 9. Outputs

A finance administrator opens Account Mapping to define or review how source-company accounts map into group reporting accounts before consolidation. Expected output: scoped records, decision state, durable source reference, report, alert, or device/session state as appropriate. Exact persisted result is NOT VERIFIED for the page-specific surface.

# 10. Workflow Position

- Upstream: company/group hierarchy; posted company ledgers; account mapping.
- Downstream: consolidated reports; audit lineage; management decisions.
- Cross-page edge status: PARTIAL/NOT_VERIFIED; no unproven handoff is treated as complete.

# 11. States

- DRAFT, READY, RUNNING, COMPLETED, FAILED, REVERSED, DENIED, NOT_VERIFIED.
- LOADING, EMPTY, DENIED, VALIDATION_ERROR, SERVER_ERROR, and SUCCESS/HANDOFF must remain distinct where supported.
- Lifecycle authority: Consolidation domain should own group, run, elimination, and lineage state; Finance owns source journals.

# 12. Permissions & Scope

- Client gate: finance.manager.
- Server authorization and scope: action/resource permission plus company/branch/period/actor/entitlement rules as applicable; direct page isolation is NOT VERIFIED.
- Approval roles must remain separate from requestor roles; local UI controls are not authorization proof.

# 13. Arabic / English

- English: Account Mapping; Arabic: · ربط الحسابات.
- Every primary action, state, error, and report period needs a visible bilingual label; mojibake or missing state text is a usability defect.

# 14. Responsive Requirements

- Desktop: preserve period/company scope, record identity, status, decision, totals, and primary action.
- Mobile/kiosk: where applicable, prove the smallest safe action, offline/entitlement state, retry, and audit result; direct responsive proof is NOT VERIFIED unless cited in tests.

# 15. AS-IS Functional Assessment

**THIN / THIN** — The destination and domain candidate exist, but page-specific functional wiring or persistence is incomplete.

# 16. Target Business Contract

A finance administrator opens Account Mapping to define or review how source-company accounts map into group reporting accounts before consolidation. The target contract is a scoped, page-specific workflow that loads authoritative data, exposes lifecycle-valid actions, persists through **Consolidation domain should own group, run, elimination, and lineage state; Finance owns source journals.**, produces a durable result/reference, and makes missing, denied, stale, validation, and server-error states explicit.

# 17. Identified Gaps

- **account_mapping-W4-01** (P1, CREDIBILITY_GAP) — The consolidation domain and tests exist, but the individual primary pages do not show a verified renderer/action/API contract. **Required next step:** Map each page to one read or mutation boundary and prove run idempotency and source lineage.
- **account_mapping-W4-02** (P2, PURPOSE_UNCLEAR) — Groups, runs, reports, lineage, and eliminations are adjacent pages with incomplete user-goal separation. **Required next step:** Publish a bounded page hierarchy and keep one canonical write home per capability.

# 18. Consolidation Analysis

- Recommended disposition: **STRENGTHEN**.
- Keep separate only when the user goal and lifecycle authority are distinct. Shared Finance tables or adjacent page titles do not prove duplication.
- Current authority decision: Consolidation domain should own group, run, elimination, and lineage state; Finance owns source journals.

# 19. Acceptance Criteria

- A permitted user opens the page and sees a non-error surface with explicit scope and freshness.
- Each primary action validates required inputs, authorization, lifecycle, idempotency, and maker-checker rules, then displays the durable resulting state.
- A direct browser/API/domain test proves the highest-risk transition and persistence; navigation-only proof is insufficient.
- For this page: A finance administrator opens Account Mapping to define or review how source-company accounts map into group reporting accounts before consolidation.

# 20. Test Evidence

- Evidence class: STATIC/DOMAIN/CONTRACT references listed below; direct page lifecycle is bounded.
- `tests/build-08/consolidation-domain.test.mjs`
- `tests/build-08/group-finance-browser-chromium.test.mjs`
- `tests/page-consolidation/consolidation-contract.test.mjs`
- Source files verified at engineering reference:
- `views/account_mapping.html`
- `platform/consolidation/index.mjs`
- `platform/finance/engine.mjs`
- `tests/build-08/consolidation-domain.test.mjs`
- `tests/build-08/group-finance-browser-chromium.test.mjs`
- `tests/page-consolidation/consolidation-contract.test.mjs`

# 21. Known Limitations

- Catalog starting SHA: `10152af1772bf9efba43cc42bb4226b73b63abca`; engineering reference: `25c24df753962bbf3c13301eed71624bc0ee39b6`.
- Wave 4 is documentation-only; no engineering source, product test, migration, runtime data, or navigation file was changed.
- A domain test does not automatically prove that this navigation page is wired to that domain.

# 22. Source Evidence

- `views/account_mapping.html`
- `platform/consolidation/index.mjs`
- `platform/finance/engine.mjs`
- `tests/build-08/consolidation-domain.test.mjs`
- `tests/build-08/group-finance-browser-chromium.test.mjs`
- `tests/page-consolidation/consolidation-contract.test.mjs`

# 23. Change History

- 2026-08-14 — Wave 4 deep review from engineering reference `25c24df753962bbf3c13301eed71624bc0ee39b6`; Waves 2-3 were preserved and not redone.

## CAPABILITIES OWNED

- Consolidation domain should own group, run, elimination, and lineage state; Finance owns source journals.

## CAPABILITIES CONSUMED

- company/group hierarchy; posted company ledgers; account mapping; consolidated reports; audit lineage; management decisions
