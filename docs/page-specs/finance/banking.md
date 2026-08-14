---
page_id: "banking"
title_en: "Banking"
title_ar: "البنوك والخزينة"
domain: "finance"
navigation_group: "finance_accounts"
kind: "PAGE"
canonical_status: "PRIMARY"
canonical_home: "banking"
parent_page: null
aliases: []
roles: ["finance.user"]
permission: "finance.user"
entitlement: "none/global (not a commercial/SaaS-gated page)"
renderer_type: "page-specific-or-generic-shell"
renderer_sources: ["app.js"]
view_sources: ["views/banking.html"]
api_sources: ["GET /api/v1/finance/*; POST /api/v1/action/finance:*"]
domain_sources: ["platform/finance/engine.mjs","platform/finance/index.mjs","platform/api/finance.mjs"]
tables_or_entities: ["finance_documents","finance_document_lines","finance_journal_entries","finance_journal_lines","finance_periods","finance_locks","finance_payments","finance_bank_accounts","finance_bank_transactions","finance_reconciliations"]
test_sources: ["tests/phase03/finance-http-api.test.mjs","tests/phase03/finance-closure-audit.test.mjs"]
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

- Page ID: `banking`; English: Banking; domain: `finance`; navigation group: `finance_accounts`.
- Route: `switchPage('banking')`; view: `views/banking.html`; renderer evidence: `app.js`.
- Canonical status: PRIMARY; this page is a primary navigation destination, not an embedded tab.

# 2. Business Purpose

A finance user opens Banking to review bank accounts, imported or entered bank activity, and reconciliation context without creating a second cash authority.

# 3. Primary Users

- Declared client gate: finance.user.
- Operational roles: owner/operator/reviewer/approver/manager split is NOT VERIFIED from page-specific evidence.

# 4. Primary User Goal

USER OPENS THIS PAGE TO: A finance user opens Banking to review bank accounts, imported or entered bank activity, and reconciliation context without creating a second cash authority.

# 5. AS-IS Runtime Surface

- View: `views/banking.html`; renderer: `app.js generic/legacy surface`.
- API/query boundary: GET /api/v1/finance/*; POST /api/v1/action/finance:*.
- AS-IS classification: **THIN**; usability: **THIN**.
- Primary actions:
- View/import/reconcile -> exact page action/API NOT VERIFIED — permission: server authorization required; persistence: Finance engine is the canonical accounting authority and sole GL writer.
- Navigation activation is not persistence, isolation, lifecycle, or release proof.

# 6. Data Sources

- UI to API/query: `GET /api/v1/finance/*; POST /api/v1/action/finance:*`.
- Domain authority: `platform/finance/engine.mjs; platform/finance/index.mjs; platform/api/finance.mjs`.
- Tables/entities where evidence permits: `finance_documents`, `finance_document_lines`, `finance_journal_entries`, `finance_journal_lines`, `finance_periods`, `finance_locks`, `finance_payments`, `finance_bank_accounts`, `finance_bank_transactions`, `finance_reconciliations`.
- Scope requirements: company, branch, period, currency, actor, and role scope must be server-derived where applicable; local-only rows are not canonical posted facts.

# 7. Actions

- View/import/reconcile -> exact page action/API NOT VERIFIED — permission: server authorization required; persistence: Finance engine is the canonical accounting authority and sole GL writer.

# 8. Inputs

- Business inputs vary by page: company/group/period, account mapping, amount/date/source document, bank or facility reference, reconciliation decision, workflow definition, tax period, or device/session context.
- Raw IDs must not bypass tenant, company, period, actor, maker-checker, lifecycle, or entitlement validation.
- For local or NOT_VERIFIED surfaces, inputs must be treated as provisional until a canonical API/domain persistence proof exists.

# 9. Outputs

A finance user opens Banking to review bank accounts, imported or entered bank activity, and reconciliation context without creating a second cash authority. Expected output: scoped records, decision state, durable source reference, report, alert, or device/session state as appropriate. Exact persisted result is NOT VERIFIED for the page-specific surface.

# 10. Workflow Position

- Upstream: posted source facts; company/branch/period scope.
- Downstream: AR/AP; treasury; reports; tax/compliance.
- Cross-page edge status: PARTIAL/NOT_VERIFIED; no unproven handoff is treated as complete.

# 11. States

- LOADING, READY, EMPTY, DENIED, VALIDATION_ERROR, SERVER_ERROR, POSTED, REVERSED.
- LOADING, EMPTY, DENIED, VALIDATION_ERROR, SERVER_ERROR, and SUCCESS/HANDOFF must remain distinct where supported.
- Lifecycle authority: Finance engine is the canonical accounting authority and sole GL writer.

# 12. Permissions & Scope

- Client gate: finance.user.
- Server authorization and scope: action/resource permission plus company/branch/period/actor/entitlement rules as applicable; direct page isolation is NOT VERIFIED.
- Approval roles must remain separate from requestor roles; local UI controls are not authorization proof.

# 13. Arabic / English

- English: Banking; Arabic: البنوك والخزينة.
- Every primary action, state, error, and report period needs a visible bilingual label; mojibake or missing state text is a usability defect.

# 14. Responsive Requirements

- Desktop: preserve period/company scope, record identity, status, decision, totals, and primary action.
- Mobile/kiosk: where applicable, prove the smallest safe action, offline/entitlement state, retry, and audit result; direct responsive proof is NOT VERIFIED unless cited in tests.

# 15. AS-IS Functional Assessment

**THIN / THIN** — The destination and domain candidate exist, but page-specific functional wiring or persistence is incomplete.

# 16. Target Business Contract

A finance user opens Banking to review bank accounts, imported or entered bank activity, and reconciliation context without creating a second cash authority. The target contract is a scoped, page-specific workflow that loads authoritative data, exposes lifecycle-valid actions, persists through **Finance engine is the canonical accounting authority and sole GL writer.**, produces a durable result/reference, and makes missing, denied, stale, validation, and server-error states explicit.

# 17. Identified Gaps

- **banking-W4-01** (P1, CREDIBILITY_GAP) — The navigation destination exists, but page-specific API/action wiring is not established by the selected evidence. **Required next step:** Recover the renderer-to-domain contract and attach a direct lifecycle with company, period, and role isolation.

# 18. Consolidation Analysis

- Recommended disposition: **STRENGTHEN**.
- Keep separate only when the user goal and lifecycle authority are distinct. Shared Finance tables or adjacent page titles do not prove duplication.
- Current authority decision: Finance engine is the canonical accounting authority and sole GL writer.

# 19. Acceptance Criteria

- A permitted user opens the page and sees a non-error surface with explicit scope and freshness.
- Each primary action validates required inputs, authorization, lifecycle, idempotency, and maker-checker rules, then displays the durable resulting state.
- A direct browser/API/domain test proves the highest-risk transition and persistence; navigation-only proof is insufficient.
- For this page: A finance user opens Banking to review bank accounts, imported or entered bank activity, and reconciliation context without creating a second cash authority.

# 20. Test Evidence

- Evidence class: STATIC/DOMAIN/CONTRACT references listed below; direct page lifecycle is bounded.
- `tests/phase03/finance-http-api.test.mjs`
- `tests/phase03/finance-closure-audit.test.mjs`
- Source files verified at engineering reference:
- `views/banking.html`
- `platform/finance/engine.mjs`
- `platform/finance/index.mjs`
- `platform/api/finance.mjs`
- `tests/phase03/finance-http-api.test.mjs`
- `tests/phase03/finance-closure-audit.test.mjs`

# 21. Known Limitations

- Catalog starting SHA: `10152af1772bf9efba43cc42bb4226b73b63abca`; engineering reference: `25c24df753962bbf3c13301eed71624bc0ee39b6`.
- Wave 4 is documentation-only; no engineering source, product test, migration, runtime data, or navigation file was changed.
- A domain test does not automatically prove that this navigation page is wired to that domain.

# 22. Source Evidence

- `views/banking.html`
- `platform/finance/engine.mjs`
- `platform/finance/index.mjs`
- `platform/api/finance.mjs`
- `tests/phase03/finance-http-api.test.mjs`
- `tests/phase03/finance-closure-audit.test.mjs`

# 23. Change History

- 2026-08-14 — Wave 4 deep review from engineering reference `25c24df753962bbf3c13301eed71624bc0ee39b6`; Waves 2-3 were preserved and not redone.

## CAPABILITIES OWNED

- Finance engine is the canonical accounting authority and sole GL writer.

## CAPABILITIES CONSUMED

- posted source facts; company/branch/period scope; AR/AP; treasury; reports; tax/compliance
