---
page_id: "service_kiosk"
title_en: "Service Kiosk"
title_ar: "كشك الخدمة"
domain: "ops"
navigation_group: "ops_kiosks"
kind: KIOSK
canonical_status: PRIMARY
canonical_home: "service_kiosk"
parent_page: null
aliases: []
roles: ["any authenticated user"]
permission: "none (public/open)"
entitlement: "none/global (not a commercial/SaaS-gated page)"
renderer_type: "javascript"
renderer_sources: ["modules/build10/renderers/kiosks.js"]
view_sources: []
api_sources: ["/api/v1/iot/${pageKey}","/api/v1/iot/fleet/${pageKey}","/api/v1/iot/offline/${pageKey}","/api/v1/iot/kiosk/${pageKey}","/api/v1/iot/boards/${pageKey}","/api/v1/action/${pageKey}"]
domain_sources: ["modules/build10/renderers/kiosks.js","services/permissionService.js","modules/build10-workspaces.js"]
tables_or_entities: []
test_sources: ["docs/navigation/NAVIGATION_FORENSIC_REPORT.json","docs/autopilot/evidence/NAVIGATION-RECOVERY-1-click-audit-all.json","tests/build-10/build10-workspaces-contract.test.mjs"]
catalog_baseline_sha: "25c24df753962bbf3c13301eed71624bc0ee39b6"
last_verified_sha: "25c24df753962bbf3c13301eed71624bc0ee39b6"
evidence_confidence: "HIGH"
implementation_status: "IMPLEMENTED_AT_BASELINE"
functional_status: "CONNECTED"
usability_status: "STRONG"
review_status: "BASELINE_REVIEWED"
---

# 1. Identity

- Page ID: `service_kiosk`
- English: Service Kiosk
- Arabic: كشك الخدمة
- Domain: `ops`; navigation group: `ops_kiosks`
- Route: switchPage('service_kiosk') / views/service_kiosk.html
- Page type: KIOSK

# 2. Business Purpose

Service kiosk — kiosk/service (risk: low, phase: build10)

# 3. Primary Users

- Declared roles: any authenticated user
- Viewer/operator/reviewer/manager/administrator split: NOT VERIFIED beyond the declared permission gate.

# 4. Primary User Goal

User opens this page to work with the Service Kiosk workspace. The exact business completion goal is supported by the review inventory purpose statement above.

# 5. AS-IS Runtime Surface

The registered view is views/service_kiosk.html. Static source counts at baseline: 8 headings, 9 button tags, 1 input/select/textarea controls, 1 tables, 0 forms, and 6 literal /api/v1 calls. Dynamic content not visible in static source is NOT VERIFIED.

- Renderer evidence: modules/build10/renderers/kiosks.js
- Visible action inventory: (rendered by JS module — not statically inspectable)
- Empty state: not verified (no view file to inspect — JS-rendered page)
- Denied state: none — public/open page, no permission gate (PAGE_PERMISSIONS entry is empty array)
- Generic-shell risk: NO from the inspected page-specific source.

# 6. Data Sources

- UI → renderer: modules/build10/renderers/kiosks.js
- Renderer → API/query: /api/v1/iot/${pageKey}, /api/v1/iot/fleet/${pageKey}, /api/v1/iot/offline/${pageKey}, /api/v1/iot/kiosk/${pageKey}, /api/v1/iot/boards/${pageKey}, /api/v1/action/${pageKey}
- Domain service → table/entity: NOT VERIFIED; no table is asserted without direct source evidence.
- Required fixture: none/global

# 7. Actions

- UI label: (rendered by JS module — not statically inspectable); action ID/API/domain handler/persistence: NOT VERIFIED by the baseline inventory.
- UI label: ${isRtl ? 'تسجيل الحضور/الانصراف الذاتي' : 'Employee Self Check-in'}; handler/action ID: window.Build10Engine.openActionDialog(; permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.
- UI label: ${isRtl ? 'مسح باركود سريع' : 'Quick Barcode Scan'}; handler/action ID: window.Build10Engine.openActionDialog(; permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.
- UI label: ${isRtl ? 'تسجيل إنتاج جديد' : 'Record Operation Output'}; handler/action ID: window.Build10Engine.openActionDialog(; permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.
- UI label: ${isRtl ? 'استلام طلب خدمة جديد' : 'New Service Reception'}; handler/action ID: window.Build10Engine.openActionDialog(; permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.
- UI label: ${isRtl ? 'عرض' : 'View'}; handler/action ID: ${pageKey}:view; permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.
- UI label: ${isRtl ? 'تعديل' : 'Edit'}; handler/action ID: ${pageKey}:edit; permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.
- UI label: ${isRtl ? '+ إضافة جديد' : '+ New Record'}; handler/action ID: ${pageKey}:create; permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.
- UI label: ${isRtl ? 'تصدير CSV' : 'Export CSV'}; handler/action ID: OctagonBuild10.exportCsv(; permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.
- UI label: View; handler/action ID: ${pageKey}:view; permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.

# 8. Inputs

- Static controls: (rendered by JS module — not statically inspectable)
- Governed selectors versus raw IDs: NOT VERIFIED from the page inventory; inspect the page-specific renderer before implementation.

# 9. Outputs

The intended output is the page’s named Service Kiosk record, decision, view, or operational state. Exact persisted object: NOT VERIFIED.

# 10. Workflow Position

- Upstream: NOT VERIFIED from explicit workflow metadata.
- Downstream: NOT VERIFIED from page-specific source.

# 11. States

- LOADING: module source contains async loading paths; exact copy/state transitions require browser proof.
- READY: route activation passed visible Chromium audit.
- EMPTY: not verified (no view file to inspect — JS-rendered page)
- DENIED: none — public/open page, no permission gate (PAGE_PERMISSIONS entry is empty array)
- VALIDATION_ERROR: NOT VERIFIED
- SERVER_ERROR: NOT VERIFIED
- SUCCESS: NOT VERIFIED
- Domain lifecycle states: NOT VERIFIED.

# 12. Permissions & Scope

- Client page gate: none (public/open)
- Entitlement: none/global (not a commercial/SaaS-gated page)
- Tenant/company/branch/warehouse/employee scope: NOT VERIFIED in page-specific evidence.
- Client visibility and server authorization must be treated separately; the navigation click audit proves neither server mutation authorization nor data isolation.

# 13. Arabic / English

- Arabic label: كشك الخدمة
- English label: Service Kiosk
- Baseline language metadata: ar, en
- Missing labels: NOT VERIFIED beyond static inventory evidence.

# 14. Responsive Requirements

- Desktop/laptop: the visible navigation audit covered route activation, not layout quality.
- Mobile: mobile/kiosk-oriented page (id or nav group signals mobile use); operational mobile behavior requires a separate browser contract.

# 15. AS-IS Functional Assessment

**STRONG** — The baseline contains a page-specific JavaScript renderer and API evidence. This score is evidence-based and does not claim domain completion.

# 16. Target Business Contract

The Service Kiosk workspace should give its governed users a page-specific way to complete the named business task: load scoped records, accept governed inputs where needed, execute authorized actions, persist the resulting state through the domain authority, and expose explicit loading/empty/denied/validation/server-error/success states. Exact fields and lifecycle transitions remain **NOT VERIFIED** where the baseline source does not define them.

# 17. Identified Gaps

- No P0/P1 gap was derived from the inspected baseline sources. This is not a claim that the workspace is complete.

# 18. Consolidation Analysis

- Remain a primary workspace: **YES pending owner review**, because it is classified as a primary navigation page in the baseline forensic report.
- Tab/master-detail child/dialog/action/alias/internal-view alternative: NOT VERIFIED; do not consolidate from page title alone.
- Canonical candidate: `service_kiosk` unless a later owner decision records another home.

# 19. Acceptance Criteria

- A user with the declared permission can open `service_kiosk` through the visible navigation and see a non-error page-specific surface.
- The page exposes only actions whose permission, API/domain handler, required inputs, persisted result, and next state are documented and server-authorized.
- The page distinguishes LOADING, READY, EMPTY, DENIED, VALIDATION_ERROR, SERVER_ERROR, and SUCCESS in a real browser.
- A scoped browser test proves the named Service Kiosk workflow; the current 231/231 click audit is route activation evidence only.

# 20. Test Evidence

- **REAL_BROWSER_VISIBLE_UI:** docs/autopilot/evidence/NAVIGATION-RECOVERY-1-click-audit-all.json — authenticated Chromium visible click audit; 231/231 primary navigation items passed, including this page.
- **STATIC:** docs/review/PAGE_INVENTORY.json and docs/navigation/NAVIGATION_FORENSIC_REPORT.json.
- **API / DOMAIN:** tests/build-10/build10-workspaces-contract.test.mjs
- **REAL_BROWSER_DIRECT:** NOT VERIFIED; no direct action lifecycle proof is attributed here.

# 21. Known Limitations

- This catalog is a forensic specification at baseline 25c24df753962bbf3c13301eed71624bc0ee39b6; it does not describe uncommitted engineering changes.
- Navigation activation is not functional, permission-isolation, lifecycle, or persistence proof.
- Table/entity ownership is intentionally left NOT VERIFIED unless exact source evidence is available.


# 22. Source Evidence

- `modules/build10/renderers/kiosks.js`
- `index.html`
- `services/permissionService.js`
- `modules/build10-workspaces.js`
- `docs/review/PAGE_INVENTORY.json`
- `docs/navigation/NAVIGATION_FORENSIC_REPORT.json`

# 23. Change History

- 2026-08-14 — catalog created from baseline 25c24df753962bbf3c13301eed71624bc0ee39b6.
- Future reconciliation must append the Product Recovery SHA and preserve the AS-IS/TARGET separation.

## CAPABILITIES OWNED

- Service Kiosk workspace presentation and its explicitly verified page-specific actions: window.Build10Engine.openActionDialog(, window.Build10Engine.openActionDialog(, window.Build10Engine.openActionDialog(, window.Build10Engine.openActionDialog(, ${pageKey}:view, ${pageKey}:edit, ${pageKey}:create, OctagonBuild10.exportCsv(, ${pageKey}:view.

## CAPABILITIES CONSUMED

- Navigation activation, declared page permission gate, and any API paths listed in the front matter. Exact domain capabilities: NOT VERIFIED where no backend path was found.
