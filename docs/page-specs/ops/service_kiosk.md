---
page_id: "service_kiosk"
title_en: "Service Kiosk"
title_ar: "كشك الخدمة"
domain: "ops"
navigation_group: "ops_kiosks"
kind: "KIOSK"
canonical_status: "PRIMARY"
canonical_home: "service_kiosk"
parent_page: null
aliases: []
roles: ["any authenticated user"]
permission: "none (public/open)"
entitlement: "none/global (not a commercial/SaaS-gated page)"
renderer_type: "page-specific-or-generic-shell"
renderer_sources: ["app.js"]
view_sources: ["views/kiosk.html"]
api_sources: ["GET /api/v1/service/* and kiosk resources; exact page route NOT VERIFIED"]
domain_sources: ["platform/kiosk/index.mjs","platform/kiosk/kiosk-registry.mjs","platform/kiosk/operational-boards.mjs","platform/service/index.mjs"]
tables_or_entities: ["kiosk_device_registries","offline_clients","service_entitlements","service_signatures","operational_board_events"]
test_sources: ["tests/build-07/service-browser-chromium.test.mjs","tests/build-07/service-entitlement-signature-lifecycle.test.mjs","tests/build-10/kiosk-operational-boards.test.mjs","tests/build-10/iot-offline-kiosk-export-contract.test.mjs"]
catalog_baseline_sha: "10152af1772bf9efba43cc42bb4226b73b63abca"
last_verified_sha: "25c24df753962bbf3c13301eed71624bc0ee39b6"
engineering_reference_sha: "25c24df753962bbf3c13301eed71624bc0ee39b6"
deep_review_wave: 4
evidence_confidence: "HIGH"
implementation_status: "IMPLEMENTED_OR_PRESENT_AT_ENGINEERING_REFERENCE"
functional_status: "CONNECTED"
usability_status: "STRONG"
review_status: "REQUIRES_PRODUCT_RECOVERY"
---

# 1. Identity

- Page ID: `service_kiosk`; English: Service Kiosk; domain: `ops`; navigation group: `ops_kiosks`.
- Route: `switchPage('service_kiosk')`; view: `views/kiosk.html`; renderer evidence: `app.js`.
- Canonical status: PRIMARY; this page is a primary navigation destination, not an embedded tab.

# 2. Business Purpose

A service operator opens Service Kiosk to use a governed device/session for service work while enforcing entitlement, offline, and audit boundaries.

# 3. Primary Users

- Declared client gate: none (public/open).
- Operational roles: owner/operator/reviewer/approver/manager split is partly evidenced by domain tests but still requires direct role-isolation proof.

# 4. Primary User Goal

USER OPENS THIS PAGE TO: A service operator opens Service Kiosk to use a governed device/session for service work while enforcing entitlement, offline, and audit boundaries.

# 5. AS-IS Runtime Surface

- View: `views/kiosk.html`; renderer: `app.js generic/legacy surface`.
- API/query boundary: GET /api/v1/service/* and kiosk resources; exact page route NOT VERIFIED.
- AS-IS classification: **CONNECTED**; usability: **STRONG**.
- Primary actions:
- Register/activate/offline-sync -> kiosk/service action boundary; exact page route NOT VERIFIED — permission: server authorization required; persistence: Kiosk registry and service entitlement/signature domains own device/session/access facts; operational boards consume them.
- Navigation activation is not persistence, isolation, lifecycle, or release proof.

# 6. Data Sources

- UI to API/query: `GET /api/v1/service/* and kiosk resources; exact page route NOT VERIFIED`.
- Domain authority: `platform/kiosk/index.mjs; platform/kiosk/kiosk-registry.mjs; platform/kiosk/operational-boards.mjs; platform/service/index.mjs`.
- Tables/entities where evidence permits: `kiosk_device_registries`, `offline_clients`, `service_entitlements`, `service_signatures`, `operational_board_events`.
- Scope requirements: company, branch, period, currency, actor, and role scope must be server-derived where applicable; local-only rows are not canonical posted facts.

# 7. Actions

- Register/activate/offline-sync -> kiosk/service action boundary; exact page route NOT VERIFIED — permission: server authorization required; persistence: Kiosk registry and service entitlement/signature domains own device/session/access facts; operational boards consume them.

# 8. Inputs

- Business inputs vary by page: company/group/period, account mapping, amount/date/source document, bank or facility reference, reconciliation decision, workflow definition, tax period, or device/session context.
- Raw IDs must not bypass tenant, company, period, actor, maker-checker, lifecycle, or entitlement validation.
- For local or NOT_VERIFIED surfaces, inputs must be treated as provisional until a canonical API/domain persistence proof exists.

# 9. Outputs

A service operator opens Service Kiosk to use a governed device/session for service work while enforcing entitlement, offline, and audit boundaries. Expected output: scoped records, decision state, durable source reference, report, alert, or device/session state as appropriate. Exact persisted result is partly evidenced by the cited domain.

# 10. Workflow Position

- Upstream: device registration; identity/entitlement; offline sync state.
- Downstream: shop-floor/warehouse/service actions; audit; offline export.
- Cross-page edge status: CONNECTED domain evidence with page-level gaps documented below.

# 11. States

- UNREGISTERED, REGISTERED, ONLINE, OFFLINE, READY, BLOCKED, EXPIRED, DENIED, NOT_VERIFIED.
- LOADING, EMPTY, DENIED, VALIDATION_ERROR, SERVER_ERROR, and SUCCESS/HANDOFF must remain distinct where supported.
- Lifecycle authority: Kiosk registry and service entitlement/signature domains own device/session/access facts; operational boards consume them.

# 12. Permissions & Scope

- Client gate: none (public/open).
- Server authorization and scope: action/resource permission plus company/branch/period/actor/entitlement rules as applicable; direct page isolation is partly evidenced.
- Approval roles must remain separate from requestor roles; local UI controls are not authorization proof.

# 13. Arabic / English

- English: Service Kiosk; Arabic: كشك الخدمة.
- Every primary action, state, error, and report period needs a visible bilingual label; mojibake or missing state text is a usability defect.

# 14. Responsive Requirements

- Desktop: preserve period/company scope, record identity, status, decision, totals, and primary action.
- Mobile/kiosk: where applicable, prove the smallest safe action, offline/entitlement state, retry, and audit result; direct responsive proof is NOT VERIFIED unless cited in tests.

# 15. AS-IS Functional Assessment

**CONNECTED / STRONG** — The page has a meaningful renderer/domain boundary, but remaining gaps prevent release closure.

# 16. Target Business Contract

A service operator opens Service Kiosk to use a governed device/session for service work while enforcing entitlement, offline, and audit boundaries. The target contract is a scoped, page-specific workflow that loads authoritative data, exposes lifecycle-valid actions, persists through **Kiosk registry and service entitlement/signature domains own device/session/access facts; operational boards consume them.**, produces a durable result/reference, and makes missing, denied, stale, validation, and server-error states explicit.

# 17. Identified Gaps

- **service_kiosk-W4-01** (P1, WORKFLOW_DISCONNECT) — Kiosk domain/tests prove operational lifecycle components, but the selected page-level service route and downstream work completion are not attributed as one flow. **Required next step:** Prove register/entitle/offline/restore and one service action handoff.

# 18. Consolidation Analysis

- Recommended disposition: **KEEP_PRIMARY**.
- Keep separate only when the user goal and lifecycle authority are distinct. Shared Finance tables or adjacent page titles do not prove duplication.
- Current authority decision: Kiosk registry and service entitlement/signature domains own device/session/access facts; operational boards consume them.

# 19. Acceptance Criteria

- A permitted user opens the page and sees a non-error surface with explicit scope and freshness.
- Each primary action validates required inputs, authorization, lifecycle, idempotency, and maker-checker rules, then displays the durable resulting state.
- A direct browser/API/domain test proves the highest-risk transition and persistence; navigation-only proof is insufficient.
- For this page: A service operator opens Service Kiosk to use a governed device/session for service work while enforcing entitlement, offline, and audit boundaries.

# 20. Test Evidence

- Evidence class: STATIC/DOMAIN/CONTRACT references listed below; direct page lifecycle is bounded.
- `tests/build-07/service-browser-chromium.test.mjs`
- `tests/build-07/service-entitlement-signature-lifecycle.test.mjs`
- `tests/build-10/kiosk-operational-boards.test.mjs`
- `tests/build-10/iot-offline-kiosk-export-contract.test.mjs`
- Source files verified at engineering reference:
- `views/kiosk.html`
- `platform/kiosk/index.mjs`
- `platform/kiosk/kiosk-registry.mjs`
- `platform/kiosk/operational-boards.mjs`
- `platform/service/index.mjs`
- `tests/build-07/service-browser-chromium.test.mjs`
- `tests/build-07/service-entitlement-signature-lifecycle.test.mjs`
- `tests/build-10/kiosk-operational-boards.test.mjs`
- `tests/build-10/iot-offline-kiosk-export-contract.test.mjs`

# 21. Known Limitations

- Catalog starting SHA: `10152af1772bf9efba43cc42bb4226b73b63abca`; engineering reference: `25c24df753962bbf3c13301eed71624bc0ee39b6`.
- Wave 4 is documentation-only; no engineering source, product test, migration, runtime data, or navigation file was changed.
- A domain test does not automatically prove that this navigation page is wired to that domain.

# 22. Source Evidence

- `views/kiosk.html`
- `platform/kiosk/index.mjs`
- `platform/kiosk/kiosk-registry.mjs`
- `platform/kiosk/operational-boards.mjs`
- `platform/service/index.mjs`
- `tests/build-07/service-browser-chromium.test.mjs`
- `tests/build-07/service-entitlement-signature-lifecycle.test.mjs`
- `tests/build-10/kiosk-operational-boards.test.mjs`
- `tests/build-10/iot-offline-kiosk-export-contract.test.mjs`

# 23. Change History

- 2026-08-14 — Wave 4 deep review from engineering reference `25c24df753962bbf3c13301eed71624bc0ee39b6`; Waves 2-3 were preserved and not redone.

## CAPABILITIES OWNED

- Kiosk registry and service entitlement/signature domains own device/session/access facts; operational boards consume them.

## CAPABILITIES CONSUMED

- device registration; identity/entitlement; offline sync state; shop-floor/warehouse/service actions; audit; offline export
