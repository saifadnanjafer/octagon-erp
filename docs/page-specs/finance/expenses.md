---
page_id: "expenses"
title_en: "Expenses"
title_ar: "المصروفات"
domain: "finance"
navigation_group: "finance_accounts"
kind: "PAGE"
canonical_status: "PRIMARY"
canonical_home: "expenses"
parent_page: null
aliases: []
roles: ["finance.user"]
permission: "finance.user"
entitlement: "none/global (not a commercial/SaaS-gated page)"
renderer_type: "page-specific-or-generic-shell"
renderer_sources: ["app.js"]
view_sources: ["views/expenses.html"]
api_sources: ["No page-specific /api/v1 route verified; local finance state and FinanceService candidates"]
domain_sources: ["platform/finance/engine.mjs","app.js legacy finance helpers"]
tables_or_entities: ["finance.transactions local object","account_moves canonical candidate","finance_documents canonical candidate","finance.transactions local object","expense_claims candidate","finance_documents"]
test_sources: ["tests/phase03/finance-browser-evidence.test.mjs","tests/phase03/finance-final-cutover.test.mjs"]
catalog_baseline_sha: "10152af1772bf9efba43cc42bb4226b73b63abca"
last_verified_sha: "25c24df753962bbf3c13301eed71624bc0ee39b6"
engineering_reference_sha: "25c24df753962bbf3c13301eed71624bc0ee39b6"
deep_review_wave: 4
evidence_confidence: "MEDIUM"
implementation_status: "IMPLEMENTED_OR_PRESENT_AT_ENGINEERING_REFERENCE"
functional_status: "PARTIALLY_CONNECTED"
usability_status: "THIN"
review_status: "REQUIRES_PRODUCT_RECOVERY"
---

# 1. Identity

- Page ID: `expenses`; English: Expenses; domain: `finance`; navigation group: `finance_accounts`.
- Route: `switchPage('expenses')`; view: `views/expenses.html`; renderer evidence: `app.js`.
- Canonical status: PRIMARY; this page is a primary navigation destination, not an embedded tab.

# 2. Business Purpose

An employee or manager opens Expenses to submit, review, approve, and account for an expense claim through the canonical Finance source-fact boundary.

# 3. Primary Users

- Declared client gate: finance.user.
- Operational roles: owner/operator/reviewer/approver/manager split is NOT VERIFIED from page-specific evidence.

# 4. Primary User Goal

USER OPENS THIS PAGE TO: An employee or manager opens Expenses to submit, review, approve, and account for an expense claim through the canonical Finance source-fact boundary.

# 5. AS-IS Runtime Surface

- View: `views/expenses.html`; renderer: `app.js generic/legacy surface`.
- API/query boundary: No page-specific /api/v1 route verified; local finance state and FinanceService candidates.
- AS-IS classification: **PARTIALLY_CONNECTED**; usability: **THIN**.
- Primary actions:
- Create/edit/approve expense -> local or Finance action NOT VERIFIED — permission: server authorization required; persistence: Finance engine should own posted facts; current legacy page surface is not a safe independent writer.
- Navigation activation is not persistence, isolation, lifecycle, or release proof.

# 6. Data Sources

- UI to API/query: `No page-specific /api/v1 route verified; local finance state and FinanceService candidates`.
- Domain authority: `platform/finance/engine.mjs; app.js legacy finance helpers`.
- Tables/entities where evidence permits: `finance.transactions local object`, `account_moves canonical candidate`, `finance_documents canonical candidate`, `finance.transactions local object`, `expense_claims candidate`, `finance_documents`.
- Scope requirements: company, branch, period, currency, actor, and role scope must be server-derived where applicable; local-only rows are not canonical posted facts.

# 7. Actions

- Create/edit/approve expense -> local or Finance action NOT VERIFIED — permission: server authorization required; persistence: Finance engine should own posted facts; current legacy page surface is not a safe independent writer.

# 8. Inputs

- Business inputs vary by page: company/group/period, account mapping, amount/date/source document, bank or facility reference, reconciliation decision, workflow definition, tax period, or device/session context.
- Raw IDs must not bypass tenant, company, period, actor, maker-checker, lifecycle, or entitlement validation.
- For local or NOT_VERIFIED surfaces, inputs must be treated as provisional until a canonical API/domain persistence proof exists.

# 9. Outputs

An employee or manager opens Expenses to submit, review, approve, and account for an expense claim through the canonical Finance source-fact boundary. Expected output: scoped records, decision state, durable source reference, report, alert, or device/session state as appropriate. Exact persisted result is partly evidenced by the cited domain.

# 10. Workflow Position

- Upstream: local finance object; manual entry or imported source.
- Downstream: cashbox; income/expense reporting; Finance candidate.
- Cross-page edge status: PARTIAL/NOT_VERIFIED; no unproven handoff is treated as complete.

# 11. States

- LOCAL_DRAFT, LOCAL_SAVED, POSTED_NOT_VERIFIED, DENIED_NOT_VERIFIED.
- LOADING, EMPTY, DENIED, VALIDATION_ERROR, SERVER_ERROR, and SUCCESS/HANDOFF must remain distinct where supported.
- Lifecycle authority: Finance engine should own posted facts; current legacy page surface is not a safe independent writer.

# 12. Permissions & Scope

- Client gate: finance.user.
- Server authorization and scope: action/resource permission plus company/branch/period/actor/entitlement rules as applicable; direct page isolation is NOT VERIFIED.
- Approval roles must remain separate from requestor roles; local UI controls are not authorization proof.

# 13. Arabic / English

- English: Expenses; Arabic: المصروفات.
- Every primary action, state, error, and report period needs a visible bilingual label; mojibake or missing state text is a usability defect.

# 14. Responsive Requirements

- Desktop: preserve period/company scope, record identity, status, decision, totals, and primary action.
- Mobile/kiosk: where applicable, prove the smallest safe action, offline/entitlement state, retry, and audit result; direct responsive proof is NOT VERIFIED unless cited in tests.

# 15. AS-IS Functional Assessment

**PARTIALLY_CONNECTED / THIN** — The page has a meaningful renderer/domain boundary, but remaining gaps prevent release closure.

# 16. Target Business Contract

An employee or manager opens Expenses to submit, review, approve, and account for an expense claim through the canonical Finance source-fact boundary. The target contract is a scoped, page-specific workflow that loads authoritative data, exposes lifecycle-valid actions, persists through **Finance engine should own posted facts; current legacy page surface is not a safe independent writer.**, produces a durable result/reference, and makes missing, denied, stale, validation, and server-error states explicit.

# 17. Identified Gaps

- **expenses-W4-01** (P0, AUTHORITY_CONFLICT) — The legacy page can use local finance helpers while Finance engine owns documents, journals, and hash-chain posting. **Required next step:** Freeze or migrate the writer through an idempotent Finance source-fact contract.
- **expenses-W4-02** (P1, ISOLATION_GAP) — Company, branch, period, actor, and audit scope are not proven for the local page surface. **Required next step:** Add scoped browser/API evidence before allowing operational use.

# 18. Consolidation Analysis

- Recommended disposition: **RETIRE_OR_MIGRATE**.
- Keep separate only when the user goal and lifecycle authority are distinct. Shared Finance tables or adjacent page titles do not prove duplication.
- Current authority decision: Finance engine should own posted facts; current legacy page surface is not a safe independent writer.

# 19. Acceptance Criteria

- A permitted user opens the page and sees a non-error surface with explicit scope and freshness.
- Each primary action validates required inputs, authorization, lifecycle, idempotency, and maker-checker rules, then displays the durable resulting state.
- A direct browser/API/domain test proves the highest-risk transition and persistence; navigation-only proof is insufficient.
- For this page: An employee or manager opens Expenses to submit, review, approve, and account for an expense claim through the canonical Finance source-fact boundary.

# 20. Test Evidence

- Evidence class: STATIC/DOMAIN/CONTRACT references listed below; direct page lifecycle is bounded.
- `tests/phase03/finance-browser-evidence.test.mjs`
- `tests/phase03/finance-final-cutover.test.mjs`
- Source files verified at engineering reference:
- `views/expenses.html`
- `platform/finance/engine.mjs`
- `tests/phase03/finance-browser-evidence.test.mjs`
- `tests/phase03/finance-final-cutover.test.mjs`

# 21. Known Limitations

- Catalog starting SHA: `10152af1772bf9efba43cc42bb4226b73b63abca`; engineering reference: `25c24df753962bbf3c13301eed71624bc0ee39b6`.
- Wave 4 is documentation-only; no engineering source, product test, migration, runtime data, or navigation file was changed.
- A domain test does not automatically prove that this navigation page is wired to that domain.

# 22. Source Evidence

- `views/expenses.html`
- `platform/finance/engine.mjs`
- `tests/phase03/finance-browser-evidence.test.mjs`
- `tests/phase03/finance-final-cutover.test.mjs`

# 23. Change History

- 2026-08-14 — Wave 4 deep review from engineering reference `25c24df753962bbf3c13301eed71624bc0ee39b6`; Waves 2-3 were preserved and not redone.

## CAPABILITIES OWNED

- Finance engine should own posted facts; current legacy page surface is not a safe independent writer.

## CAPABILITIES CONSUMED

- local finance object; manual entry or imported source; cashbox; income/expense reporting; Finance candidate
