---
page_id: "content_approvals"
title_en: "Content Approvals"
title_ar: "اعتمادات المحتوى"
domain: "commercial"
navigation_group: "commercial_marketing"
kind: "PAGE"
canonical_status: "PRIMARY"
canonical_home: "content_approvals"
parent_page: null
aliases: []
roles: ["system.admin","workshop.manager"]
permission: "system.admin, workshop.manager"
entitlement: "UNMAPPED — commercial/SaaS page, no literal saas_plan_entitlements \"page:*\" row found"
renderer_type: "page-specific-or-generic-shell"
renderer_sources: ["app.js"]
view_sources: ["views/approvals.html"]
api_sources: ["POST /api/v1/action/workflow:* candidate; local canvas compatibility path"]
domain_sources: ["platform/workflow/index.mjs","app.js workflow canvas helpers"]
tables_or_entities: ["workflow_definitions","workflow_versions","workflow_instances","workflow_steps","workflow_timers","workflow_audit_log","localStorage workflow_viewport_v1","approval_requests","approval_steps","approval_events"]
test_sources: ["tests/phase02/workflow-approvals.test.mjs"]
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

- Page ID: `content_approvals`; English: Content Approvals; domain: `commercial`; navigation group: `commercial_marketing`.
- Route: `switchPage('content_approvals')`; view: `views/approvals.html`; renderer evidence: `app.js`.
- Canonical status: PRIMARY; this page is a primary navigation destination, not an embedded tab.

# 2. Business Purpose

A content owner opens Content Approvals to submit and review content decisions with a durable approval record rather than an informal local status.

# 3. Primary Users

- Declared client gate: system.admin, workshop.manager.
- Operational roles: owner/operator/reviewer/approver/manager split is NOT VERIFIED from page-specific evidence.

# 4. Primary User Goal

USER OPENS THIS PAGE TO: A content owner opens Content Approvals to submit and review content decisions with a durable approval record rather than an informal local status.

# 5. AS-IS Runtime Surface

- View: `views/approvals.html`; renderer: `app.js generic/legacy surface`.
- API/query boundary: POST /api/v1/action/workflow:* candidate; local canvas compatibility path.
- AS-IS classification: **THIN**; usability: **THIN**.
- Primary actions:
- Submit/approve/reject content -> approval action target NOT VERIFIED — permission: server authorization required; persistence: Durable WorkflowRegistry/WorkflowRuntime should own definitions and instances; the legacy canvas is a compatibility adapter only.
- Navigation activation is not persistence, isolation, lifecycle, or release proof.

# 6. Data Sources

- UI to API/query: `POST /api/v1/action/workflow:* candidate; local canvas compatibility path`.
- Domain authority: `platform/workflow/index.mjs; app.js workflow canvas helpers`.
- Tables/entities where evidence permits: `workflow_definitions`, `workflow_versions`, `workflow_instances`, `workflow_steps`, `workflow_timers`, `workflow_audit_log`, `localStorage workflow_viewport_v1`, `approval_requests`, `approval_steps`, `approval_events`.
- Scope requirements: company, branch, period, currency, actor, and role scope must be server-derived where applicable; local-only rows are not canonical posted facts.

# 7. Actions

- Submit/approve/reject content -> approval action target NOT VERIFIED — permission: server authorization required; persistence: Durable WorkflowRegistry/WorkflowRuntime should own definitions and instances; the legacy canvas is a compatibility adapter only.

# 8. Inputs

- Business inputs vary by page: company/group/period, account mapping, amount/date/source document, bank or facility reference, reconciliation decision, workflow definition, tax period, or device/session context.
- Raw IDs must not bypass tenant, company, period, actor, maker-checker, lifecycle, or entitlement validation.
- For local or NOT_VERIFIED surfaces, inputs must be treated as provisional until a canonical API/domain persistence proof exists.

# 9. Outputs

A content owner opens Content Approvals to submit and review content decisions with a durable approval record rather than an informal local status. Expected output: scoped records, decision state, durable source reference, report, alert, or device/session state as appropriate. Exact persisted result is NOT VERIFIED for the page-specific surface.

# 10. Workflow Position

- Upstream: registered actions; permissions; workflow canvas definition.
- Downstream: approved target actions; outbox/external effects; audit.
- Cross-page edge status: PARTIAL/NOT_VERIFIED; no unproven handoff is treated as complete.

# 11. States

- DRAFT, ACTIVE, WAITING, RUNNING, COMPLETED, FAILED, CANCELLED, RETIRED, DENIED, VALIDATION_ERROR.
- LOADING, EMPTY, DENIED, VALIDATION_ERROR, SERVER_ERROR, and SUCCESS/HANDOFF must remain distinct where supported.
- Lifecycle authority: Durable WorkflowRegistry/WorkflowRuntime should own definitions and instances; the legacy canvas is a compatibility adapter only.

# 12. Permissions & Scope

- Client gate: system.admin, workshop.manager.
- Server authorization and scope: action/resource permission plus company/branch/period/actor/entitlement rules as applicable; direct page isolation is NOT VERIFIED.
- Approval roles must remain separate from requestor roles; local UI controls are not authorization proof.

# 13. Arabic / English

- English: Content Approvals; Arabic: اعتمادات المحتوى.
- Every primary action, state, error, and report period needs a visible bilingual label; mojibake or missing state text is a usability defect.

# 14. Responsive Requirements

- Desktop: preserve period/company scope, record identity, status, decision, totals, and primary action.
- Mobile/kiosk: where applicable, prove the smallest safe action, offline/entitlement state, retry, and audit result; direct responsive proof is NOT VERIFIED unless cited in tests.

# 15. AS-IS Functional Assessment

**THIN / THIN** — The destination and domain candidate exist, but page-specific functional wiring or persistence is incomplete.

# 16. Target Business Contract

A content owner opens Content Approvals to submit and review content decisions with a durable approval record rather than an informal local status. The target contract is a scoped, page-specific workflow that loads authoritative data, exposes lifecycle-valid actions, persists through **Durable WorkflowRegistry/WorkflowRuntime should own definitions and instances; the legacy canvas is a compatibility adapter only.**, produces a durable result/reference, and makes missing, denied, stale, validation, and server-error states explicit.

# 17. Identified Gaps

- **content_approvals-W4-01** (P0, AUTHORITY_CONFLICT) — The page exposes a local canvas and localStorage compatibility surface beside a durable workflow registry/runtime with versioning and leases. **Required next step:** Make the canvas an explicit adapter and prove definition/version/instance persistence through the durable runtime.
- **content_approvals-W4-02** (P1, WORKFLOW_DISCONNECT) — Workflow execution can reference registered actions, but page-level publication-to-run evidence and frozen-entity enforcement are not proven together. **Required next step:** Attach validation, activation, run, retry, timeout, and frozen-zone browser/API evidence.

# 18. Consolidation Analysis

- Recommended disposition: **OWNER_DECISION_REQUIRED**.
- Keep separate only when the user goal and lifecycle authority are distinct. Shared Finance tables or adjacent page titles do not prove duplication.
- Current authority decision: Durable WorkflowRegistry/WorkflowRuntime should own definitions and instances; the legacy canvas is a compatibility adapter only.

# 19. Acceptance Criteria

- A permitted user opens the page and sees a non-error surface with explicit scope and freshness.
- Each primary action validates required inputs, authorization, lifecycle, idempotency, and maker-checker rules, then displays the durable resulting state.
- A direct browser/API/domain test proves the highest-risk transition and persistence; navigation-only proof is insufficient.
- For this page: A content owner opens Content Approvals to submit and review content decisions with a durable approval record rather than an informal local status.

# 20. Test Evidence

- Evidence class: STATIC/DOMAIN/CONTRACT references listed below; direct page lifecycle is bounded.
- `tests/phase02/workflow-approvals.test.mjs`
- Source files verified at engineering reference:
- `views/approvals.html`
- `platform/workflow/index.mjs`
- `tests/phase02/workflow-approvals.test.mjs`

# 21. Known Limitations

- Catalog starting SHA: `10152af1772bf9efba43cc42bb4226b73b63abca`; engineering reference: `25c24df753962bbf3c13301eed71624bc0ee39b6`.
- Wave 4 is documentation-only; no engineering source, product test, migration, runtime data, or navigation file was changed.
- A domain test does not automatically prove that this navigation page is wired to that domain.

# 22. Source Evidence

- `views/approvals.html`
- `platform/workflow/index.mjs`
- `tests/phase02/workflow-approvals.test.mjs`

# 23. Change History

- 2026-08-14 — Wave 4 deep review from engineering reference `25c24df753962bbf3c13301eed71624bc0ee39b6`; Waves 2-3 were preserved and not redone.

## CAPABILITIES OWNED

- Durable WorkflowRegistry/WorkflowRuntime should own definitions and instances; the legacy canvas is a compatibility adapter only.

## CAPABILITIES CONSUMED

- registered actions; permissions; workflow canvas definition; approved target actions; outbox/external effects; audit
