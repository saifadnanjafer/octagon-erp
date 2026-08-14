---
page_id: "approvals"
title_en: "Approvals"
title_ar: "الموافقات"
domain: "resources"
navigation_group: "resources_supply"
kind: "PAGE"
canonical_status: "PRIMARY"
canonical_home: "approvals"
parent_page: null
aliases: []
roles: ["workshop.manager","finance.manager"]
permission: "workshop.manager, finance.manager"
entitlement: "none/global (not a commercial/SaaS-gated page)"
renderer_type: "page-specific"
renderer_sources: ["Approvals renderer (source path NOT VERIFIED)"]
view_sources: ["views/approvals.html"]
api_sources: ["GET /api/v1/approvals; POST /api/v1/action/approval:*"]
domain_sources: ["Governance approval authority (source path NOT VERIFIED)"]
tables_or_entities: ["approval_requests","approval_steps","approval_events","platform_audit_events"]
test_sources: ["tests/checkpoint-c/canonical_procurement_ui.test.mjs","tests/phase04/canonical_procurement.test.mjs"]
catalog_baseline_sha: "3c047bb0d04985cd88a536d4dbb16b74d2d6405a"
last_verified_sha: "25c24df753962bbf3c13301eed71624bc0ee39b6"
engineering_reference_sha: "25c24df753962bbf3c13301eed71624bc0ee39b6"
deep_review_wave: 3
evidence_confidence: "HIGH"
implementation_status: "IMPLEMENTED_AT_ENGINEERING_REFERENCE"
functional_status: "CONNECTED"
usability_status: "STRONG"
review_status: "REQUIRES_PRODUCT_RECOVERY"
---

# 1. Identity

- Page ID: `approvals`; English: Approvals; domain: `resources`; navigation group: `resources_supply`.
- Route: `switchPage('approvals')`; page-specific renderer: `Approvals renderer (source path NOT VERIFIED)`; view: `views/approvals.html`.
- Canonical status: PRIMARY; this is a primary catalog destination, not an embedded tab or compatibility alias.

# 2. Business Purpose

An approver opens Approvals to review governed requests and apply maker-checker decisions with an auditable result that downstream domains consume.

# 3. Primary Users

- Declared client gate: "workshop.manager, finance.manager".
- Business roles: owner/operator/reviewer/approver/manager split is partly evidenced by the cited domain boundary but requires direct role-isolation proof.

# 4. Primary User Goal

USER OPENS THIS PAGE TO: An approver opens Approvals to review governed requests and apply maker-checker decisions with an auditable result that downstream domains consume.

# 5. AS-IS Runtime Surface

- Renderer/view: `Approvals renderer (source path NOT VERIFIED)` and `views/approvals.html`.
- Query/action boundary: GET /api/v1/approvals; POST /api/v1/action/approval:*.
- Current classification: **CONNECTED**; usability: **STRONG**.
- Visible primary actions:
- Submit/approve/reject -> approval action boundary; exact IDs require source verification
- The page-specific evidence is separated from navigation proof. A visible route does not prove persistence, permission isolation, or completed workflow.

# 6. Data Sources

- UI to API/query: `GET /api/v1/approvals; POST /api/v1/action/approval:*`.
- Domain authority: `Governance approval authority (source path NOT VERIFIED)`.
- Persisted entities/tables where source evidence permits: `approval_requests`, `approval_steps`, `approval_events`, `platform_audit_events`.
- Company/branch/warehouse/actor scope: server-derived scope is required where the cited API/domain supports it; page-specific isolation proof remains a separate acceptance item.

# 7. Actions

- Submit/approve/reject -> approval action boundary; exact IDs require source verification — permission: declared page gate plus server action authorization; persistence: Governance approval events are authoritative for decision; target domain owns the business record.

# 8. Inputs

- Required business inputs: record IDs, governed party/product/project/warehouse selectors, lifecycle decisions, quantities/reasons, and source references according to the action.
- Raw IDs must not bypass company, branch, warehouse, actor, maker-checker, or lifecycle validation.
- For connected actions, the server must derive scope and validate stale state before persistence.

# 9. Outputs

Approval decision/event and target record transition reference.

# 10. Workflow Position

- Upstream: sales/procurement/project/finance request.
- Downstream: quotation/order/requisition/budget/finance state.
- Workflow classification: CONNECTED for the cited page-to-domain edge; cross-page completion edges marked in gaps are not assumed.

# 11. States

- DRAFT, SUBMITTED, PENDING, APPROVED, REJECTED, CANCELLED, DENIED.
- LOADING, EMPTY, DENIED, VALIDATION_ERROR, SERVER_ERROR, and SUCCESS/HANDOFF must remain visibly distinct wherever the renderer supports the corresponding state.
- State persistence and transition authority: Governance approval events are authoritative for decision; target domain owns the business record.

# 12. Permissions & Scope

- Client navigation gate: workshop.manager, finance.manager.
- Server authorization: action/resource permission plus company/branch/warehouse/actor scope as enforced by the cited API/domain; exact matrix is partly evidenced, not fully proven here.
- A visible button is not authorization proof. Approver/requester separation is required for governed actions.

# 13. Arabic / English

- English label: Approvals; Arabic label source: الموافقات.
- Every primary action and lifecycle state needs a paired visible Arabic/English label; mojibake or untranslated state text is a usability defect.

# 14. Responsive Requirements

- Desktop: preserve scope, record identity, state, primary action, errors, and handoff reference without hiding the business decision.
- Mobile: if used by workshop, warehouse, field, or supplier staff, prove the smallest complete action with controls and validation visible; direct mobile behavior is partly evidenced.

# 15. AS-IS Functional Assessment

**CONNECTED / STRONG** — Approval navigation/source and procurement/sales approval consumers; exact page action wiring bounded.. This is a source-evidence classification, not a release acceptance claim.

# 16. Target Business Contract

An approver opens Approvals to review governed requests and apply maker-checker decisions with an auditable result that downstream domains consume. The target contract is a governed page-specific workflow that loads scoped data, exposes lifecycle-valid actions, persists through **Governance approval events are authoritative for decision; target domain owns the business record.**, returns a durable reference, and distinguishes loading, empty, denied, validation, server-error, and success states. The target is not complete until the gaps and acceptance criteria below have evidence.

# 17. Identified Gaps

- **approvals-W3-01** (P1, WORKFLOW_DISCONNECT) — Approval UI and domain are shared across workflows, but target-specific maker-checker and delegation rules are not mapped here. **Required next step:** Publish action-to-target matrix and prove separation of requester/approver.

# 18. Consolidation Analysis

- Recommended disposition: **KEEP_PRIMARY**.
- Keep this page separate only when its user goal and lifecycle authority are distinct. Shared tables, tabs, or labels alone are not proof of duplication.
- Canonical authority decision: Governance approval events are authoritative for decision; target domain owns the business record.

# 19. Acceptance Criteria

- A permitted user opens the page and sees a non-error page-specific surface in the active scope.
- Each primary action validates required inputs, actor/tenant scope, lifecycle state, and maker-checker rules; its response shows the resulting state and durable reference.
- A direct browser/API/domain test proves the highest-risk transition and confirms persistence; navigation-only evidence is insufficient.
- Cross-page handoffs identified above are either proven in a lifecycle test or explicitly rendered as manual/not verified.
- For this page specifically: An approver opens Approvals to review governed requests and apply maker-checker decisions with an auditable result that downstream domains consume.

# 20. Test Evidence

- Evidence class: **Approval navigation/source and procurement/sales approval consumers; exact page action wiring bounded.**
- Cited source/tests:
- `tests/checkpoint-c/canonical_procurement_ui.test.mjs`
- `tests/phase04/canonical_procurement.test.mjs`
- Navigation audit, if cited by the existing catalog, proves route activation/visible surface only; it does not prove domain mutation, isolation, or persistence.

# 21. Known Limitations

- Catalog baseline: `3c047bb0d04985cd88a536d4dbb16b74d2d6405a`; engineering reference: `25c24df753962bbf3c13301eed71624bc0ee39b6`.
- Wave 3 is documentation-only. No engineering source, tests, migrations, runtime data, navigation, or product implementation was changed.
- Source evidence is current to the recorded engineering reference; uncommitted engineering changes are outside this spec.

# 22. Source Evidence

- `views/approvals.html`
- `tests/checkpoint-c/canonical_procurement_ui.test.mjs`
- `tests/phase04/canonical_procurement.test.mjs`

# 23. Change History

- 2026-08-14 — Wave 3 deep review from engineering reference `25c24df753962bbf3c13301eed71624bc0ee39b6`; Wave 2 pages and catalog history were preserved.

## CAPABILITIES OWNED

- Governance approval events are authoritative for decision; target domain owns the business record.

## CAPABILITIES CONSUMED

- sales/procurement/project/finance request; quotation/order/requisition/budget/finance state
