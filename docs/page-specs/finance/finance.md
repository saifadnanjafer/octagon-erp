---
page_id: "finance"
title_en: "Finance"
title_ar: "الداشبورد المالي"
domain: "finance"
navigation_group: "finance_accounts"
kind: "PAGE"
canonical_status: "PRIMARY"
canonical_home: "finance"
parent_page: null
aliases: []
roles: ["finance.user"]
permission: "finance.user"
entitlement: "none/global (not a commercial/SaaS-gated page)"
renderer_type: "page-specific"
renderer_sources: ["Finance renderer (source path NOT VERIFIED)"]
view_sources: ["views/finance.html"]
api_sources: ["GET /api/v1/finance/*; POST /api/v1/action/finance:*"]
domain_sources: ["platform/finance/index.mjs","platform/finance/engine.mjs"]
tables_or_entities: ["finance_documents","finance_document_lines","finance_journal_entries","finance_journal_lines","finance_periods","finance_locks","finance_payments","finance_reconciliations","finance_source_facts"]
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

- Page ID: `finance`; English: Finance; domain: `finance`; navigation group: `finance_accounts`.
- Route: `switchPage('finance')`; page-specific renderer: `Finance renderer (source path NOT VERIFIED)`; view: `views/finance.html`.
- Canonical status: PRIMARY; this is a primary catalog destination, not an embedded tab or compatibility alias.

# 2. Business Purpose

A finance user opens Finance to manage documents, journals, periods, payments, reconciliation, budgets, source facts, and reports with Finance as the sole accounting authority.

# 3. Primary Users

- Declared client gate: "finance.user".
- Business roles: owner/operator/reviewer/approver/manager split is partly evidenced by the cited domain boundary but requires direct role-isolation proof.

# 4. Primary User Goal

USER OPENS THIS PAGE TO: A finance user opens Finance to manage documents, journals, periods, payments, reconciliation, budgets, source facts, and reports with Finance as the sole accounting authority.

# 5. AS-IS Runtime Surface

- Renderer/view: `Finance renderer (source path NOT VERIFIED)` and `views/finance.html`.
- Query/action boundary: GET /api/v1/finance/*; POST /api/v1/action/finance:*.
- Current classification: **CONNECTED**; usability: **USABLE**.
- Visible primary actions:
- Create/submit/approve/post/reverse/amend/cancel/write_off -> finance:document:*
- Periods/payments/reconciliation/budgets/source facts -> finance:* action families
- The page-specific evidence is separated from navigation proof. A visible route does not prove persistence, permission isolation, or completed workflow.

# 6. Data Sources

- UI to API/query: `GET /api/v1/finance/*; POST /api/v1/action/finance:*`.
- Domain authority: `platform/finance/index.mjs; platform/finance/engine.mjs`.
- Persisted entities/tables where source evidence permits: `finance_documents`, `finance_document_lines`, `finance_journal_entries`, `finance_journal_lines`, `finance_periods`, `finance_locks`, `finance_payments`, `finance_reconciliations`, `finance_source_facts`.
- Company/branch/warehouse/actor scope: server-derived scope is required where the cited API/domain supports it; page-specific isolation proof remains a separate acceptance item.

# 7. Actions

- Create/submit/approve/post/reverse/amend/cancel/write_off -> finance:document:* — permission: declared page gate plus server action authorization; persistence: Finance engine is the sole GL writer and canonical AR/AP authority.
- Periods/payments/reconciliation/budgets/source facts -> finance:* action families — permission: declared page gate plus server action authorization; persistence: Finance engine is the sole GL writer and canonical AR/AP authority.

# 8. Inputs

- Required business inputs: record IDs, governed party/product/project/warehouse selectors, lifecycle decisions, quantities/reasons, and source references according to the action.
- Raw IDs must not bypass company, branch, warehouse, actor, maker-checker, or lifecycle validation.
- For connected actions, the server must derive scope and validate stale state before persistence.

# 9. Outputs

Finance document/journal/hash-chain and source-fact references.

# 10. Workflow Position

- Upstream: sales invoice requests; procurement bills; project billing; payments.
- Downstream: AR/AP reports; customer/supplier balances; tax/compliance; management reporting.
- Workflow classification: CONNECTED for the cited page-to-domain edge; cross-page completion edges marked in gaps are not assumed.

# 11. States

- DRAFT, SUBMITTED, APPROVED, POSTED, REVERSED, CANCELLED, WRITTEN_OFF, OPEN, SOFT_CLOSED, HARD_CLOSED, DENIED.
- LOADING, EMPTY, DENIED, VALIDATION_ERROR, SERVER_ERROR, and SUCCESS/HANDOFF must remain visibly distinct wherever the renderer supports the corresponding state.
- State persistence and transition authority: Finance engine is the sole GL writer and canonical AR/AP authority.

# 12. Permissions & Scope

- Client navigation gate: finance.user.
- Server authorization: action/resource permission plus company/branch/warehouse/actor scope as enforced by the cited API/domain; exact matrix is partly evidenced, not fully proven here.
- A visible button is not authorization proof. Approver/requester separation is required for governed actions.

# 13. Arabic / English

- English label: Finance; Arabic label source: الداشبورد المالي.
- Every primary action and lifecycle state needs a paired visible Arabic/English label; mojibake or untranslated state text is a usability defect.

# 14. Responsive Requirements

- Desktop: preserve scope, record identity, state, primary action, errors, and handoff reference without hiding the business decision.
- Mobile: if used by workshop, warehouse, field, or supplier staff, prove the smallest complete action with controls and validation visible; direct mobile behavior is NOT VERIFIED.

# 15. AS-IS Functional Assessment

**CONNECTED / USABLE** — Finance API/index/engine and canonical finance test sources.. This is a source-evidence classification, not a release acceptance claim.

# 16. Target Business Contract

A finance user opens Finance to manage documents, journals, periods, payments, reconciliation, budgets, source facts, and reports with Finance as the sole accounting authority. The target contract is a governed page-specific workflow that loads scoped data, exposes lifecycle-valid actions, persists through **Finance engine is the sole GL writer and canonical AR/AP authority.**, returns a durable reference, and distinguishes loading, empty, denied, validation, server-error, and success states. The target is not complete until the gaps and acceptance criteria below have evidence.

# 17. Identified Gaps

- **finance-W3-01** (P1, WORKFLOW_DISCONNECT) — Several legacy pages still claim finance-like writes; their migration to source facts is not complete. **Required next step:** Inventory and block non-Finance GL writes, then prove source-document idempotency.

# 18. Consolidation Analysis

- Recommended disposition: **KEEP_PRIMARY**.
- Keep this page separate only when its user goal and lifecycle authority are distinct. Shared tables, tabs, or labels alone are not proof of duplication.
- Canonical authority decision: Finance engine is the sole GL writer and canonical AR/AP authority.

# 19. Acceptance Criteria

- A permitted user opens the page and sees a non-error page-specific surface in the active scope.
- Each primary action validates required inputs, actor/tenant scope, lifecycle state, and maker-checker rules; its response shows the resulting state and durable reference.
- A direct browser/API/domain test proves the highest-risk transition and confirms persistence; navigation-only evidence is insufficient.
- Cross-page handoffs identified above are either proven in a lifecycle test or explicitly rendered as manual/not verified.
- For this page specifically: A finance user opens Finance to manage documents, journals, periods, payments, reconciliation, budgets, source facts, and reports with Finance as the sole accounting authority.

# 20. Test Evidence

- Evidence class: **Finance API/index/engine and canonical finance test sources.**
- Cited source/tests:
- `tests/phase04/canonical_finance.test.mjs`
- `tests/phase04-finalization/canonical_finance.test.mjs`
- Navigation audit, if cited by the existing catalog, proves route activation/visible surface only; it does not prove domain mutation, isolation, or persistence.

# 21. Known Limitations

- Catalog baseline: `3c047bb0d04985cd88a536d4dbb16b74d2d6405a`; engineering reference: `25c24df753962bbf3c13301eed71624bc0ee39b6`.
- Wave 3 is documentation-only. No engineering source, tests, migrations, runtime data, navigation, or product implementation was changed.
- Source evidence is current to the recorded engineering reference; uncommitted engineering changes are outside this spec.

# 22. Source Evidence

- `views/finance.html`
- `platform/finance/index.mjs`
- `platform/finance/engine.mjs`
- `tests/phase04/canonical_finance.test.mjs`
- `tests/phase04-finalization/canonical_finance.test.mjs`

# 23. Change History

- 2026-08-14 — Wave 3 deep review from engineering reference `25c24df753962bbf3c13301eed71624bc0ee39b6`; Wave 2 pages and catalog history were preserved.

## CAPABILITIES OWNED

- Finance engine is the sole GL writer and canonical AR/AP authority.

## CAPABILITIES CONSUMED

- sales invoice requests; procurement bills; project billing; payments; AR/AP reports; customer/supplier balances; tax/compliance; management reporting
