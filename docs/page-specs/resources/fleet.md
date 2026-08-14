---
page_id: "fleet"
title_en: "Fleet"
title_ar: "المركبات"
domain: "resources"
navigation_group: "resources_assets"
kind: PAGE
canonical_status: PRIMARY
canonical_home: "fleet"
parent_page: null
aliases: []
roles: ["workshop.user"]
permission: "workshop.user"
entitlement: "none/global (not a commercial/SaaS-gated page)"
renderer_type: "javascript"
renderer_sources: ["views/fleet.html","modules/build10-workspaces.js"]
view_sources: ["views/fleet.html"]
api_sources: ["/api/v1/iot/${pageKey}","/api/v1/iot/fleet/${pageKey}","/api/v1/iot/offline/${pageKey}","/api/v1/iot/kiosk/${pageKey}","/api/v1/iot/boards/${pageKey}","/api/v1/action/${pageKey}"]
domain_sources: ["services/permissionService.js","modules/build10-workspaces.js"]
tables_or_entities: []
test_sources: ["docs/navigation/NAVIGATION_FORENSIC_REPORT.json","docs/autopilot/evidence/NAVIGATION-RECOVERY-1-click-audit-all.json","tests/build-10/browser-harness.mjs","tests/build-10/build10-workspaces-contract.test.mjs","tests/build-10/cross-domain-scenarios.test.mjs","tests/build-10/fleet-telematics-geofences.test.mjs","tests/build-10/iot-offline-kiosk-export-contract.test.mjs","tests/build-10/iot-registry-domain.test.mjs","tests/build-10/kiosk-operational-boards.test.mjs","tests/build-10/operational-browser-chromium.test.mjs"]
catalog_baseline_sha: "25c24df753962bbf3c13301eed71624bc0ee39b6"
last_verified_sha: "25c24df753962bbf3c13301eed71624bc0ee39b6"
evidence_confidence: "HIGH"
implementation_status: "IMPLEMENTED_AT_BASELINE"
functional_status: "CONNECTED"
usability_status: "STRONG"
review_status: "BASELINE_REVIEWED"
---

# 1. Identity

- Page ID: `fleet`
- English: Fleet
- Arabic: المركبات
- Domain: `resources`; navigation group: `resources_assets`
- Route: switchPage('fleet') / views/fleet.html
- Page type: PAGE

# 2. Business Purpose

Fleet Management — workshop/logistics (risk: medium, phase: phase6h)

# 3. Primary Users

- Declared roles: workshop.user
- Viewer/operator/reviewer/manager/administrator split: NOT VERIFIED beyond the declared permission gate.

# 4. Primary User Goal

User opens this page to work with the Fleet workspace. The exact business completion goal is supported by the review inventory purpose statement above.

# 5. AS-IS Runtime Surface

The registered view is views/fleet.html. Static source counts at baseline: 6 headings, 5 button tags, 1 input/select/textarea controls, 1 tables, 0 forms, and 6 literal /api/v1 calls. Dynamic content not visible in static source is NOT VERIFIED.

- Renderer evidence: views/fleet.html
- Visible action inventory: (no <button> labels found in static view file)
- Empty state: not verified — no empty-state markup found in static view file (may be rendered dynamically by JS)
- Denied state: toast "عذراً، ليس لديك صلاحية للوصول إلى هذا القسم" + redirect to calculator/login (app.js switchPage generic denial handling)
- Generic-shell risk: NO from the inspected page-specific source.

# 6. Data Sources

- UI → renderer: views/fleet.html
- Renderer → API/query: /api/v1/iot/${pageKey}, /api/v1/iot/fleet/${pageKey}, /api/v1/iot/offline/${pageKey}, /api/v1/iot/kiosk/${pageKey}, /api/v1/iot/boards/${pageKey}, /api/v1/action/${pageKey}
- Domain service → table/entity: NOT VERIFIED; no table is asserted without direct source evidence.
- Required fixture: warehouse

# 7. Actions

- UI label: ${isRtl ? 'عرض' : 'View'}; handler/action ID: ${pageKey}:view; permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.
- UI label: ${isRtl ? 'تعديل' : 'Edit'}; handler/action ID: ${pageKey}:edit; permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.
- UI label: ${isRtl ? '+ إضافة جديد' : '+ New Record'}; handler/action ID: ${pageKey}:create; permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.
- UI label: ${isRtl ? 'تصدير CSV' : 'Export CSV'}; handler/action ID: OctagonBuild10.exportCsv(; permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.
- UI label: View; handler/action ID: ${pageKey}:view; permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.

# 8. Inputs

- Static controls: (no <button> labels found in static view file)
- Governed selectors versus raw IDs: NOT VERIFIED from the page inventory; inspect the page-specific renderer before implementation.

# 9. Outputs

The intended output is the page’s named Fleet record, decision, view, or operational state. Exact persisted object: NOT VERIFIED.

# 10. Workflow Position

- Upstream: NOT VERIFIED from explicit workflow metadata.
- Downstream: NOT VERIFIED from page-specific source.

# 11. States

- LOADING: module source contains async loading paths; exact copy/state transitions require browser proof.
- READY: route activation passed visible Chromium audit.
- EMPTY: not verified — no empty-state markup found in static view file (may be rendered dynamically by JS)
- DENIED: toast "عذراً، ليس لديك صلاحية للوصول إلى هذا القسم" + redirect to calculator/login (app.js switchPage generic denial handling)
- VALIDATION_ERROR: NOT VERIFIED
- SERVER_ERROR: NOT VERIFIED
- SUCCESS: NOT VERIFIED
- Domain lifecycle states: NOT VERIFIED.

# 12. Permissions & Scope

- Client page gate: workshop.user
- Entitlement: none/global (not a commercial/SaaS-gated page)
- Tenant/company/branch/warehouse/employee scope: NOT VERIFIED in page-specific evidence.
- Client visibility and server authorization must be treated separately; the navigation click audit proves neither server mutation authorization nor data isolation.

# 13. Arabic / English

- Arabic label: المركبات
- English label: Fleet
- Baseline language metadata: ar, en
- Missing labels: NOT VERIFIED beyond static inventory evidence.

# 14. Responsive Requirements

- Desktop/laptop: the visible navigation audit covered route activation, not layout quality.
- Mobile: not verified — no mobile-specific markers found (desktop-oriented by default); operational mobile behavior requires a separate browser contract.

# 15. AS-IS Functional Assessment

**STRONG** — The baseline contains a page-specific JavaScript renderer and API evidence. This score is evidence-based and does not claim domain completion.

# 16. Target Business Contract

The Fleet workspace should give its governed users a page-specific way to complete the named business task: load scoped records, accept governed inputs where needed, execute authorized actions, persist the resulting state through the domain authority, and expose explicit loading/empty/denied/validation/server-error/success states. Exact fields and lifecycle transitions remain **NOT VERIFIED** where the baseline source does not define them.

# 17. Identified Gaps

- No P0/P1 gap was derived from the inspected baseline sources. This is not a claim that the workspace is complete.

# 18. Consolidation Analysis

- Remain a primary workspace: **YES pending owner review**, because it is classified as a primary navigation page in the baseline forensic report.
- Tab/master-detail child/dialog/action/alias/internal-view alternative: NOT VERIFIED; do not consolidate from page title alone.
- Canonical candidate: `fleet` unless a later owner decision records another home.

# 19. Acceptance Criteria

- A user with the declared permission can open `fleet` through the visible navigation and see a non-error page-specific surface.
- The page exposes only actions whose permission, API/domain handler, required inputs, persisted result, and next state are documented and server-authorized.
- The page distinguishes LOADING, READY, EMPTY, DENIED, VALIDATION_ERROR, SERVER_ERROR, and SUCCESS in a real browser.
- A scoped browser test proves the named Fleet workflow; the current 231/231 click audit is route activation evidence only.

# 20. Test Evidence

- **REAL_BROWSER_VISIBLE_UI:** docs/autopilot/evidence/NAVIGATION-RECOVERY-1-click-audit-all.json — authenticated Chromium visible click audit; 231/231 primary navigation items passed, including this page.
- **STATIC:** docs/review/PAGE_INVENTORY.json and docs/navigation/NAVIGATION_FORENSIC_REPORT.json.
- **API / DOMAIN:** tests/build-10/browser-harness.mjs, tests/build-10/build10-workspaces-contract.test.mjs, tests/build-10/cross-domain-scenarios.test.mjs, tests/build-10/fleet-telematics-geofences.test.mjs, tests/build-10/iot-offline-kiosk-export-contract.test.mjs, tests/build-10/iot-registry-domain.test.mjs, tests/build-10/kiosk-operational-boards.test.mjs, tests/build-10/operational-browser-chromium.test.mjs
- **REAL_BROWSER_DIRECT:** NOT VERIFIED; no direct action lifecycle proof is attributed here.

# 21. Known Limitations

- This catalog is a forensic specification at baseline 25c24df753962bbf3c13301eed71624bc0ee39b6; it does not describe uncommitted engineering changes.
- Navigation activation is not functional, permission-isolation, lifecycle, or persistence proof.
- Table/entity ownership is intentionally left NOT VERIFIED unless exact source evidence is available.


# 22. Source Evidence

- `views/fleet.html`
- `index.html`
- `services/permissionService.js`
- `modules/build10-workspaces.js`
- `docs/review/PAGE_INVENTORY.json`
- `docs/navigation/NAVIGATION_FORENSIC_REPORT.json`

# 23. Change History

- 2026-08-14 — catalog created from baseline 25c24df753962bbf3c13301eed71624bc0ee39b6.
- Future reconciliation must append the Product Recovery SHA and preserve the AS-IS/TARGET separation.

## CAPABILITIES OWNED

- Fleet workspace presentation and its explicitly verified page-specific actions: ${pageKey}:view, ${pageKey}:edit, ${pageKey}:create, OctagonBuild10.exportCsv(, ${pageKey}:view.

## CAPABILITIES CONSUMED

- Navigation activation, declared page permission gate, and any API paths listed in the front matter. Exact domain capabilities: NOT VERIFIED where no backend path was found.
