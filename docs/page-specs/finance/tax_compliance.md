---
page_id: "tax_compliance"
title_en: "Tax Compliance"
title_ar: "الضرائب والفوترة"
domain: "finance"
navigation_group: "finance_accounts"
kind: "PAGE"
canonical_status: "PRIMARY"
canonical_home: "tax_compliance"
parent_page: null
aliases: []
roles: ["finance.manager","system.admin"]
permission: "finance.manager, system.admin"
entitlement: "none/global (not a commercial/SaaS-gated page)"
renderer_type: "page-specific-or-generic-shell"
renderer_sources: ["modules/tax-compliance.js"]
view_sources: ["views/tax_compliance.html"]
api_sources: ["GET /api/v1/finance/*; POST /api/v1/action/finance:*"]
domain_sources: ["platform/finance/engine.mjs","platform/finance/index.mjs","modules/tax-compliance.js"]
tables_or_entities: ["finance_documents","finance_document_lines","finance_tax_rates","finance_tax_reports","finance_periods"]
test_sources: ["tests/phase03/finance-http-api.test.mjs","tests/phase03/finance-ui-parity.test.mjs"]
catalog_baseline_sha: "10152af1772bf9efba43cc42bb4226b73b63abca"
last_verified_sha: "25c24df753962bbf3c13301eed71624bc0ee39b6"
engineering_reference_sha: "25c24df753962bbf3c13301eed71624bc0ee39b6"
deep_review_wave: 4
evidence_confidence: "MEDIUM"
implementation_status: "IMPLEMENTED_OR_PRESENT_AT_ENGINEERING_REFERENCE"
functional_status: "PARTIALLY_CONNECTED"
usability_status: "USABLE"
review_status: "REQUIRES_PRODUCT_RECOVERY"
---

# 1. Identity

- Page ID: `tax_compliance`; English: Tax Compliance; domain: `finance`; navigation group: `finance_accounts`.
- Route: `switchPage('tax_compliance')`; view: `views/tax_compliance.html`; renderer evidence: `modules/tax-compliance.js`.
- Canonical status: PRIMARY; this page is a primary navigation destination, not an embedded tab.

# 2. Business Purpose

A tax user opens Tax Compliance to review tax configuration, calculate/report obligations, submit a filing package, and preserve source-document lineage.

# 3. Primary Users

- Declared client gate: finance.manager, system.admin.
- Operational roles: owner/operator/reviewer/approver/manager split is NOT VERIFIED from page-specific evidence.

# 4. Primary User Goal

USER OPENS THIS PAGE TO: A tax user opens Tax Compliance to review tax configuration, calculate/report obligations, submit a filing package, and preserve source-document lineage.

# 5. AS-IS Runtime Surface

- View: `views/tax_compliance.html`; renderer: `modules/tax-compliance.js`.
- API/query boundary: GET /api/v1/finance/*; POST /api/v1/action/finance:*.
- AS-IS classification: **PARTIALLY_CONNECTED**; usability: **USABLE**.
- Primary actions:
- Calculate/review/submit/amend -> finance tax action boundary — permission: server authorization required; persistence: Finance tax computation and posting own tax facts; the tax page presents compliance workflow and reports.
- Navigation activation is not persistence, isolation, lifecycle, or release proof.

# 6. Data Sources

- UI to API/query: `GET /api/v1/finance/*; POST /api/v1/action/finance:*`.
- Domain authority: `platform/finance/engine.mjs; platform/finance/index.mjs; modules/tax-compliance.js`.
- Tables/entities where evidence permits: `finance_documents`, `finance_document_lines`, `finance_tax_rates`, `finance_tax_reports`, `finance_periods`.
- Scope requirements: company, branch, period, currency, actor, and role scope must be server-derived where applicable; local-only rows are not canonical posted facts.

# 7. Actions

- Calculate/review/submit/amend -> finance tax action boundary — permission: server authorization required; persistence: Finance tax computation and posting own tax facts; the tax page presents compliance workflow and reports.

# 8. Inputs

- Business inputs vary by page: company/group/period, account mapping, amount/date/source document, bank or facility reference, reconciliation decision, workflow definition, tax period, or device/session context.
- Raw IDs must not bypass tenant, company, period, actor, maker-checker, lifecycle, or entitlement validation.
- For local or NOT_VERIFIED surfaces, inputs must be treated as provisional until a canonical API/domain persistence proof exists.

# 9. Outputs

A tax user opens Tax Compliance to review tax configuration, calculate/report obligations, submit a filing package, and preserve source-document lineage. Expected output: scoped records, decision state, durable source reference, report, alert, or device/session state as appropriate. Exact persisted result is partly evidenced by the cited domain.

# 10. Workflow Position

- Upstream: posted invoices/bills; tax configuration; period state.
- Downstream: tax reports; filings/export; Finance reversals/corrections.
- Cross-page edge status: PARTIAL/NOT_VERIFIED; no unproven handoff is treated as complete.

# 11. States

- DRAFT, CALCULATED, REVIEW, SUBMITTED, ACCEPTED, REJECTED, AMENDED, DENIED.
- LOADING, EMPTY, DENIED, VALIDATION_ERROR, SERVER_ERROR, and SUCCESS/HANDOFF must remain distinct where supported.
- Lifecycle authority: Finance tax computation and posting own tax facts; the tax page presents compliance workflow and reports.

# 12. Permissions & Scope

- Client gate: finance.manager, system.admin.
- Server authorization and scope: action/resource permission plus company/branch/period/actor/entitlement rules as applicable; direct page isolation is NOT VERIFIED.
- Approval roles must remain separate from requestor roles; local UI controls are not authorization proof.

# 13. Arabic / English

- English: Tax Compliance; Arabic: الضرائب والفوترة.
- Every primary action, state, error, and report period needs a visible bilingual label; mojibake or missing state text is a usability defect.

# 14. Responsive Requirements

- Desktop: preserve period/company scope, record identity, status, decision, totals, and primary action.
- Mobile/kiosk: where applicable, prove the smallest safe action, offline/entitlement state, retry, and audit result; direct responsive proof is NOT VERIFIED unless cited in tests.

# 15. AS-IS Functional Assessment

**PARTIALLY_CONNECTED / USABLE** — The page has a meaningful renderer/domain boundary, but remaining gaps prevent release closure.

# 16. Target Business Contract

A tax user opens Tax Compliance to review tax configuration, calculate/report obligations, submit a filing package, and preserve source-document lineage. The target contract is a scoped, page-specific workflow that loads authoritative data, exposes lifecycle-valid actions, persists through **Finance tax computation and posting own tax facts; the tax page presents compliance workflow and reports.**, produces a durable result/reference, and makes missing, denied, stale, validation, and server-error states explicit.

# 17. Identified Gaps

- **tax_compliance-W4-01** (P1, CREDIBILITY_GAP) — The tax renderer and Finance authority are present, but direct tax-period/report submission persistence is not fully attributed. **Required next step:** Prove tax calculation, review, submit, amend, and source-document lineage.

# 18. Consolidation Analysis

- Recommended disposition: **KEEP_PRIMARY**.
- Keep separate only when the user goal and lifecycle authority are distinct. Shared Finance tables or adjacent page titles do not prove duplication.
- Current authority decision: Finance tax computation and posting own tax facts; the tax page presents compliance workflow and reports.

# 19. Acceptance Criteria

- A permitted user opens the page and sees a non-error surface with explicit scope and freshness.
- Each primary action validates required inputs, authorization, lifecycle, idempotency, and maker-checker rules, then displays the durable resulting state.
- A direct browser/API/domain test proves the highest-risk transition and persistence; navigation-only proof is insufficient.
- For this page: A tax user opens Tax Compliance to review tax configuration, calculate/report obligations, submit a filing package, and preserve source-document lineage.

# 20. Test Evidence

- Evidence class: STATIC/DOMAIN/CONTRACT references listed below; direct page lifecycle is bounded.
- `tests/phase03/finance-http-api.test.mjs`
- `tests/phase03/finance-ui-parity.test.mjs`
- Source files verified at engineering reference:
- `modules/tax-compliance.js`
- `views/tax_compliance.html`
- `platform/finance/engine.mjs`
- `platform/finance/index.mjs`
- `tests/phase03/finance-http-api.test.mjs`
- `tests/phase03/finance-ui-parity.test.mjs`

# 21. Known Limitations

- Catalog starting SHA: `10152af1772bf9efba43cc42bb4226b73b63abca`; engineering reference: `25c24df753962bbf3c13301eed71624bc0ee39b6`.
- Wave 4 is documentation-only; no engineering source, product test, migration, runtime data, or navigation file was changed.
- A domain test does not automatically prove that this navigation page is wired to that domain.

# 22. Source Evidence

- `modules/tax-compliance.js`
- `views/tax_compliance.html`
- `platform/finance/engine.mjs`
- `platform/finance/index.mjs`
- `tests/phase03/finance-http-api.test.mjs`
- `tests/phase03/finance-ui-parity.test.mjs`

# 23. Change History

- 2026-08-14 — Wave 4 deep review from engineering reference `25c24df753962bbf3c13301eed71624bc0ee39b6`; Waves 2-3 were preserved and not redone.

## CAPABILITIES OWNED

- Finance tax computation and posting own tax facts; the tax page presents compliance workflow and reports.

## CAPABILITIES CONSUMED

- posted invoices/bills; tax configuration; period state; tax reports; filings/export; Finance reversals/corrections
