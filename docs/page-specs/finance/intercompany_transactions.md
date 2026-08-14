---
page_id: "intercompany_transactions"
title_en: "Intercompany Transactions"
title_ar: "· المعاملات المتبادلة"
domain: "finance"
navigation_group: "finance_intercompany"
kind: "TRANSACTION"
canonical_status: "PRIMARY"
canonical_home: "intercompany_transactions"
parent_page: null
aliases: []
roles: ["finance.manager"]
permission: "finance.manager"
entitlement: "none/global (not a commercial/SaaS-gated page)"
renderer_type: "page-specific-or-generic-shell"
renderer_sources: ["app.js"]
view_sources: ["views/intercompany_transactions.html"]
api_sources: ["GET /api/v1/finance/*; intercompany page-specific route NOT VERIFIED"]
domain_sources: ["platform/intercompany/operations.mjs","platform/finance/planning-treasury-intercompany.mjs"]
tables_or_entities: ["intercompany_transactions","intercompany_mismatches","intercompany_reconciliations","finance_documents","finance_lineage_links"]
test_sources: ["tests/build-08/intercompany-operations-domain.test.mjs","tests/build-08/consolidation-domain.test.mjs"]
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

- Page ID: `intercompany_transactions`; English: Intercompany Transactions; domain: `finance`; navigation group: `finance_intercompany`.
- Route: `switchPage('intercompany_transactions')`; view: `views/intercompany_transactions.html`; renderer evidence: `app.js`.
- Canonical status: PRIMARY; this page is a primary navigation destination, not an embedded tab.

# 2. Business Purpose

An intercompany accountant opens Transactions to create or review cross-company charges, reciprocal entries, and source references.

# 3. Primary Users

- Declared client gate: finance.manager.
- Operational roles: owner/operator/reviewer/approver/manager split is NOT VERIFIED from page-specific evidence.

# 4. Primary User Goal

USER OPENS THIS PAGE TO: An intercompany accountant opens Transactions to create or review cross-company charges, reciprocal entries, and source references.

# 5. AS-IS Runtime Surface

- View: `views/intercompany_transactions.html`; renderer: `app.js generic/legacy surface`.
- API/query boundary: GET /api/v1/finance/*; intercompany page-specific route NOT VERIFIED.
- AS-IS classification: **THIN**; usability: **THIN**.
- Primary actions:
- Create/send/accept transaction -> page action/API NOT VERIFIED — permission: server authorization required; persistence: Intercompany operations owns agreement, mismatch, and reconciliation workflow; Finance owns each company ledger posting.
- Navigation activation is not persistence, isolation, lifecycle, or release proof.

# 6. Data Sources

- UI to API/query: `GET /api/v1/finance/*; intercompany page-specific route NOT VERIFIED`.
- Domain authority: `platform/intercompany/operations.mjs; platform/finance/planning-treasury-intercompany.mjs`.
- Tables/entities where evidence permits: `intercompany_transactions`, `intercompany_mismatches`, `intercompany_reconciliations`, `finance_documents`, `finance_lineage_links`.
- Scope requirements: company, branch, period, currency, actor, and role scope must be server-derived where applicable; local-only rows are not canonical posted facts.

# 7. Actions

- Create/send/accept transaction -> page action/API NOT VERIFIED — permission: server authorization required; persistence: Intercompany operations owns agreement, mismatch, and reconciliation workflow; Finance owns each company ledger posting.

# 8. Inputs

- Business inputs vary by page: company/group/period, account mapping, amount/date/source document, bank or facility reference, reconciliation decision, workflow definition, tax period, or device/session context.
- Raw IDs must not bypass tenant, company, period, actor, maker-checker, lifecycle, or entitlement validation.
- For local or NOT_VERIFIED surfaces, inputs must be treated as provisional until a canonical API/domain persistence proof exists.

# 9. Outputs

An intercompany accountant opens Transactions to create or review cross-company charges, reciprocal entries, and source references. Expected output: scoped records, decision state, durable source reference, report, alert, or device/session state as appropriate. Exact persisted result is NOT VERIFIED for the page-specific surface.

# 10. Workflow Position

- Upstream: company pair/group configuration; source company entries.
- Downstream: consolidation runs; eliminations; finance corrections.
- Cross-page edge status: PARTIAL/NOT_VERIFIED; no unproven handoff is treated as complete.

# 11. States

- DRAFT, SENT, RECEIVED, MATCHED, MISMATCH, RECONCILED, REJECTED, NOT_VERIFIED.
- LOADING, EMPTY, DENIED, VALIDATION_ERROR, SERVER_ERROR, and SUCCESS/HANDOFF must remain distinct where supported.
- Lifecycle authority: Intercompany operations owns agreement, mismatch, and reconciliation workflow; Finance owns each company ledger posting.

# 12. Permissions & Scope

- Client gate: finance.manager.
- Server authorization and scope: action/resource permission plus company/branch/period/actor/entitlement rules as applicable; direct page isolation is NOT VERIFIED.
- Approval roles must remain separate from requestor roles; local UI controls are not authorization proof.

# 13. Arabic / English

- English: Intercompany Transactions; Arabic: · المعاملات المتبادلة.
- Every primary action, state, error, and report period needs a visible bilingual label; mojibake or missing state text is a usability defect.

# 14. Responsive Requirements

- Desktop: preserve period/company scope, record identity, status, decision, totals, and primary action.
- Mobile/kiosk: where applicable, prove the smallest safe action, offline/entitlement state, retry, and audit result; direct responsive proof is NOT VERIFIED unless cited in tests.

# 15. AS-IS Functional Assessment

**THIN / THIN** — The destination and domain candidate exist, but page-specific functional wiring or persistence is incomplete.

# 16. Target Business Contract

An intercompany accountant opens Transactions to create or review cross-company charges, reciprocal entries, and source references. The target contract is a scoped, page-specific workflow that loads authoritative data, exposes lifecycle-valid actions, persists through **Intercompany operations owns agreement, mismatch, and reconciliation workflow; Finance owns each company ledger posting.**, produces a durable result/reference, and makes missing, denied, stale, validation, and server-error states explicit.

# 17. Identified Gaps

- **intercompany_transactions-W4-01** (P1, WORKFLOW_DISCONNECT) — The intercompany domain and tests exist, but page-level transaction-to-mismatch-to-reconciliation evidence is not attributed. **Required next step:** Prove the complete pair-scoped lifecycle and its Finance posting/lineage references.
- **intercompany_transactions-W4-02** (P2, ISOLATION_GAP) — Company-pair access and cross-company authorization are not proven by navigation evidence. **Required next step:** Add role and company-pair isolation tests.

# 18. Consolidation Analysis

- Recommended disposition: **STRENGTHEN**.
- Keep separate only when the user goal and lifecycle authority are distinct. Shared Finance tables or adjacent page titles do not prove duplication.
- Current authority decision: Intercompany operations owns agreement, mismatch, and reconciliation workflow; Finance owns each company ledger posting.

# 19. Acceptance Criteria

- A permitted user opens the page and sees a non-error surface with explicit scope and freshness.
- Each primary action validates required inputs, authorization, lifecycle, idempotency, and maker-checker rules, then displays the durable resulting state.
- A direct browser/API/domain test proves the highest-risk transition and persistence; navigation-only proof is insufficient.
- For this page: An intercompany accountant opens Transactions to create or review cross-company charges, reciprocal entries, and source references.

# 20. Test Evidence

- Evidence class: STATIC/DOMAIN/CONTRACT references listed below; direct page lifecycle is bounded.
- `tests/build-08/intercompany-operations-domain.test.mjs`
- `tests/build-08/consolidation-domain.test.mjs`
- Source files verified at engineering reference:
- `views/intercompany_transactions.html`
- `platform/intercompany/operations.mjs`
- `platform/finance/planning-treasury-intercompany.mjs`
- `tests/build-08/intercompany-operations-domain.test.mjs`
- `tests/build-08/consolidation-domain.test.mjs`

# 21. Known Limitations

- Catalog starting SHA: `10152af1772bf9efba43cc42bb4226b73b63abca`; engineering reference: `25c24df753962bbf3c13301eed71624bc0ee39b6`.
- Wave 4 is documentation-only; no engineering source, product test, migration, runtime data, or navigation file was changed.
- A domain test does not automatically prove that this navigation page is wired to that domain.

# 22. Source Evidence

- `views/intercompany_transactions.html`
- `platform/intercompany/operations.mjs`
- `platform/finance/planning-treasury-intercompany.mjs`
- `tests/build-08/intercompany-operations-domain.test.mjs`
- `tests/build-08/consolidation-domain.test.mjs`

# 23. Change History

- 2026-08-14 — Wave 4 deep review from engineering reference `25c24df753962bbf3c13301eed71624bc0ee39b6`; Waves 2-3 were preserved and not redone.

## CAPABILITIES OWNED

- Intercompany operations owns agreement, mismatch, and reconciliation workflow; Finance owns each company ledger posting.

## CAPABILITIES CONSUMED

- company pair/group configuration; source company entries; consolidation runs; eliminations; finance corrections
