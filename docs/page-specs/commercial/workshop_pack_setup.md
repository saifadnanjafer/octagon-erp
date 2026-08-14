---
page_id: "workshop_pack_setup"
title_en: "Workshop Pack Setup"
title_ar: "إعداد حزمة الورشة"
domain: "commercial"
navigation_group: "commercial_verticals"
kind: "SETUP"
canonical_status: "PRIMARY"
canonical_home: "workshop_pack_setup"
parent_page: null
aliases: []
roles: ["system.admin","workshop.manager"]
permission: "system.admin, workshop.manager"
entitlement: "UNMAPPED — commercial/SaaS page, no literal saas_plan_entitlements \"page:*\" row found"
renderer_type: "page-specific"
renderer_sources: ["modules/build12-workspaces.js"]
view_sources: ["views/op_packs.html"]
api_sources: ["POST /api/v1/action/packs:validate|packs:approve|packs:stage|packs:enable"]
domain_sources: ["Build-12 pack lifecycle authority (exact domain source path NOT VERIFIED)"]
tables_or_entities: ["platform_pack_installations","platform_pack_approval_events","platform_audit_events"]
test_sources: ["tests/build-12/build12-browser.test.mjs","tests/build-12/build12-acceptance-contract.test.mjs","tests/navigation/workshop-pack-setup-to-readiness.test.mjs"]
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

- Page ID: `workshop_pack_setup`; English: Workshop Pack Setup; domain: `commercial`; navigation group: `commercial_verticals`.
- Route: `switchPage('workshop_pack_setup')`; page-specific renderer: `modules/build12-workspaces.js`; view: `views/op_packs.html`.
- Canonical status: PRIMARY; this is a primary catalog destination, not an embedded tab or compatibility alias.

# 2. Business Purpose

An authorized administrator opens Workshop Pack Setup to inspect and safely validate, approve, stage, or enable the workshop extension without treating the page as an operational transaction workspace.

# 3. Primary Users

- Declared client gate: "system.admin, workshop.manager".
- Business roles: owner/operator/reviewer/approver/manager split is partly evidenced by the cited domain boundary but requires direct role-isolation proof.

# 4. Primary User Goal

USER OPENS THIS PAGE TO: An authorized administrator opens Workshop Pack Setup to inspect and safely validate, approve, stage, or enable the workshop extension without treating the page as an operational transaction workspace.

# 5. AS-IS Runtime Surface

- Renderer/view: `modules/build12-workspaces.js` and `views/op_packs.html`.
- Query/action boundary: POST /api/v1/action/packs:validate|packs:approve|packs:stage|packs:enable.
- Current classification: **CONNECTED**; usability: **USABLE**.
- Visible primary actions:
- Validate pack -> packs:validate
- Approve pack -> packs:approve
- Stage pack -> packs:stage
- Enable pack -> packs:enable
- The page-specific evidence is separated from navigation proof. A visible route does not prove persistence, permission isolation, or completed workflow.

# 6. Data Sources

- UI to API/query: `POST /api/v1/action/packs:validate|packs:approve|packs:stage|packs:enable`.
- Domain authority: `Build-12 pack lifecycle authority (exact domain source path NOT VERIFIED)`.
- Persisted entities/tables where source evidence permits: `platform_pack_installations`, `platform_pack_approval_events`, `platform_audit_events`.
- Company/branch/warehouse/actor scope: server-derived scope is required where the cited API/domain supports it; page-specific isolation proof remains a separate acceptance item.

# 7. Actions

- Validate pack -> packs:validate — permission: declared page gate plus server action authorization; persistence: Pack lifecycle owns installation state; readiness consumes the result.
- Approve pack -> packs:approve — permission: declared page gate plus server action authorization; persistence: Pack lifecycle owns installation state; readiness consumes the result.
- Stage pack -> packs:stage — permission: declared page gate plus server action authorization; persistence: Pack lifecycle owns installation state; readiness consumes the result.
- Enable pack -> packs:enable — permission: declared page gate plus server action authorization; persistence: Pack lifecycle owns installation state; readiness consumes the result.

# 8. Inputs

- Required business inputs: record IDs, governed party/product/project/warehouse selectors, lifecycle decisions, quantities/reasons, and source references according to the action.
- Raw IDs must not bypass company, branch, warehouse, actor, maker-checker, or lifecycle validation.
- For connected actions, the server must derive scope and validate stale state before persistence.

# 9. Outputs

Pack lifecycle state and safe extension notice; no workshop job or stock result.

# 10. Workflow Position

- Upstream: pack registry and approval context.
- Downstream: workshop_readiness; workshop_command_center.
- Workflow classification: CONNECTED for the cited page-to-domain edge; cross-page completion edges marked in gaps are not assumed.

# 11. States

- LOADING, READY, VALIDATION_ERROR, DENIED, STAGED, ENABLED, SERVER_ERROR.
- LOADING, EMPTY, DENIED, VALIDATION_ERROR, SERVER_ERROR, and SUCCESS/HANDOFF must remain visibly distinct wherever the renderer supports the corresponding state.
- State persistence and transition authority: Pack lifecycle owns installation state; readiness consumes the result.

# 12. Permissions & Scope

- Client navigation gate: system.admin, workshop.manager.
- Server authorization: action/resource permission plus company/branch/warehouse/actor scope as enforced by the cited API/domain; exact matrix is partly evidenced, not fully proven here.
- A visible button is not authorization proof. Approver/requester separation is required for governed actions.

# 13. Arabic / English

- English label: Workshop Pack Setup; Arabic label source: إعداد حزمة الورشة.
- Every primary action and lifecycle state needs a paired visible Arabic/English label; mojibake or untranslated state text is a usability defect.

# 14. Responsive Requirements

- Desktop: preserve scope, record identity, state, primary action, errors, and handoff reference without hiding the business decision.
- Mobile: if used by workshop, warehouse, field, or supplier staff, prove the smallest complete action with controls and validation visible; direct mobile behavior is NOT VERIFIED.

# 15. AS-IS Functional Assessment

**CONNECTED / USABLE** — Build-12 acceptance/browser and navigation test sources; route activation is not operational proof.. This is a source-evidence classification, not a release acceptance claim.

# 16. Target Business Contract

An authorized administrator opens Workshop Pack Setup to inspect and safely validate, approve, stage, or enable the workshop extension without treating the page as an operational transaction workspace. The target contract is a governed page-specific workflow that loads scoped data, exposes lifecycle-valid actions, persists through **Pack lifecycle owns installation state; readiness consumes the result.**, returns a durable reference, and distinguishes loading, empty, denied, validation, server-error, and success states. The target is not complete until the gaps and acceptance criteria below have evidence.

# 17. Identified Gaps

- **workshop_pack_setup-W3-01** (P2, CREDIBILITY_GAP) — The safe pack lifecycle is tested, but post-enable readiness impact is not asserted in the same browser run. **Required next step:** Add a bounded setup-to-readiness assertion for one enabled pack.

# 18. Consolidation Analysis

- Recommended disposition: **KEEP_PRIMARY**.
- Keep this page separate only when its user goal and lifecycle authority are distinct. Shared tables, tabs, or labels alone are not proof of duplication.
- Canonical authority decision: Pack lifecycle owns installation state; readiness consumes the result.

# 19. Acceptance Criteria

- A permitted user opens the page and sees a non-error page-specific surface in the active scope.
- Each primary action validates required inputs, actor/tenant scope, lifecycle state, and maker-checker rules; its response shows the resulting state and durable reference.
- A direct browser/API/domain test proves the highest-risk transition and confirms persistence; navigation-only evidence is insufficient.
- Cross-page handoffs identified above are either proven in a lifecycle test or explicitly rendered as manual/not verified.
- For this page specifically: An authorized administrator opens Workshop Pack Setup to inspect and safely validate, approve, stage, or enable the workshop extension without treating the page as an operational transaction workspace.

# 20. Test Evidence

- Evidence class: **Build-12 acceptance/browser and navigation test sources; route activation is not operational proof.**
- Cited source/tests:
- `tests/build-12/build12-browser.test.mjs`
- `tests/build-12/build12-acceptance-contract.test.mjs`
- `tests/navigation/workshop-pack-setup-to-readiness.test.mjs`
- Navigation audit, if cited by the existing catalog, proves route activation/visible surface only; it does not prove domain mutation, isolation, or persistence.

# 21. Known Limitations

- Catalog baseline: `3c047bb0d04985cd88a536d4dbb16b74d2d6405a`; engineering reference: `25c24df753962bbf3c13301eed71624bc0ee39b6`.
- Wave 3 is documentation-only. No engineering source, tests, migrations, runtime data, navigation, or product implementation was changed.
- Source evidence is current to the recorded engineering reference; uncommitted engineering changes are outside this spec.

# 22. Source Evidence

- `modules/build12-workspaces.js`
- `views/op_packs.html`
- `tests/build-12/build12-browser.test.mjs`
- `tests/build-12/build12-acceptance-contract.test.mjs`
- `tests/navigation/workshop-pack-setup-to-readiness.test.mjs`

# 23. Change History

- 2026-08-14 — Wave 3 deep review from engineering reference `25c24df753962bbf3c13301eed71624bc0ee39b6`; Wave 2 pages and catalog history were preserved.

## CAPABILITIES OWNED

- Pack lifecycle owns installation state; readiness consumes the result.

## CAPABILITIES CONSUMED

- pack registry and approval context; workshop_readiness; workshop_command_center
