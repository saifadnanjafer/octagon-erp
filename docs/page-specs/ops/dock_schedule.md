---
page_id: "dock_schedule"
title_en: "Dock Schedule"
title_ar: "جدول الأرصفة"
domain: "ops"
navigation_group: "ops_warehouse_traceability"
kind: PAGE
canonical_status: PRIMARY
canonical_home: "dock_schedule"
parent_page: null
aliases: []
roles: ["workshop.manager"]
permission: "workshop.manager"
entitlement: "none/global (not a commercial/SaaS-gated page)"
renderer_type: "javascript"
renderer_sources: ["modules/build09-dock-workspace.js"]
view_sources: []
api_sources: []
domain_sources: ["modules/build09-dock-workspace.js","services/permissionService.js"]
tables_or_entities: []
test_sources: ["docs/navigation/NAVIGATION_FORENSIC_REPORT.json","docs/autopilot/evidence/NAVIGATION-RECOVERY-1-click-audit-all.json","tests/build-09/build09-workspaces-contract.test.mjs","tests/build-09/build09r2-bespoke-contract.test.mjs","tests/build-09/dock-workspaces-browser.test.mjs","tests/build-09/operational-32-page-matrix-chromium.test.mjs"]
catalog_baseline_sha: "25c24df753962bbf3c13301eed71624bc0ee39b6"
last_verified_sha: "25c24df753962bbf3c13301eed71624bc0ee39b6"
evidence_confidence: "HIGH"
implementation_status: "IMPLEMENTED_AT_BASELINE"
functional_status: "CONNECTED"
usability_status: "USABLE"
review_status: "REQUIRES_PRODUCT_RECOVERY"
---

# 1. Identity

- Page ID: `dock_schedule`
- English: Dock Schedule
- Arabic: جدول الأرصفة
- Domain: `ops`; navigation group: `ops_warehouse_traceability`
- Route: switchPage('dock_schedule') / views/dock_schedule.html
- Page type: PAGE

# 2. Business Purpose

Dock schedule — workshop/logistics (risk: high, phase: build09)

# 3. Primary Users

- Declared roles: workshop.manager
- Viewer/operator/reviewer/manager/administrator split: NOT VERIFIED beyond the declared permission gate.

# 4. Primary User Goal

User opens this page to work with the Dock Schedule workspace. The exact business completion goal is supported by the review inventory purpose statement above.

# 5. AS-IS Runtime Surface

The registered view is views/dock_schedule.html. Static source counts at baseline: 13 headings, 15 button tags, 2 input/select/textarea controls, 0 tables, 6 forms, and 0 literal /api/v1 calls. Dynamic content not visible in static source is NOT VERIFIED.

- Renderer evidence: modules/build09-dock-workspace.js
- Visible action inventory: (rendered by JS module — not statically inspectable)
- Empty state: not verified (no view file to inspect — JS-rendered page)
- Denied state: toast "عذراً، ليس لديك صلاحية للوصول إلى هذا القسم" + redirect to calculator/login (app.js switchPage generic denial handling)
- Generic-shell risk: NO from the inspected page-specific source.

# 6. Data Sources

- UI → renderer: modules/build09-dock-workspace.js
- Renderer → API/query: NOT VERIFIED
- Domain service → table/entity: NOT VERIFIED; no table is asserted without direct source evidence.
- Required fixture: warehouse

# 7. Actions

- UI label: (rendered by JS module — not statically inspectable); action ID/API/domain handler/persistence: NOT VERIFIED by the baseline inventory.
- UI label: ${esc(row.carrierName || row.vehicleReference || row.sourceDocumentId || row.id.slice(0, 8))}; handler/action ID: NOT VERIFIED; permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.
- UI label: ${esc(t('Schedule appointment', 'جدولة الموعد'))}; handler/action ID: NOT VERIFIED; permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.
- UI label: ${esc(row.vehicleReference || row.carrierName || row.id.slice(0, 8))} ${esc(row.appointmentType)} · ${esc(t('due', 'موعده'))} ${esc(when(row.expectedArrival))} · ${esc(row.dockId ? `${t('dock', 'رصيف')} ${row.dockId}` : t('no dock', 'بدون رصيف'))} ${detention != null ? ` ${esc(t('detention', 'احتجاز'))} ${esc(minutes(detention))} ` : ''} ${statusBadge(row.status)}; handler/action ID: NOT VERIFIED; permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.
- UI label: ${esc(t('Check in vehicle', 'تسجيل دخول المركبة'))}; handler/action ID: NOT VERIFIED; permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.
- UI label: ${esc(t('Assign dock', 'إسناد الرصيف'))}; handler/action ID: NOT VERIFIED; permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.
- UI label: ${esc(row.appointmentType === 'inbound' ? t('Start unloading', 'بدء التفريغ') : t('Start loading', 'بدء التحميل'))}; handler/action ID: NOT VERIFIED; permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.
- UI label: ${esc(t('Depart vehicle', 'مغادرة المركبة'))}; handler/action ID: NOT VERIFIED; permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.
- UI label: ${esc(t('Release', 'تحرير'))}; handler/action ID: NOT VERIFIED; permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.
- UI label: ${esc(t('Allocate to lane', 'تخصيص للممر'))}; handler/action ID: NOT VERIFIED; permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.
- UI label: ${esc(num(row.eligibilityScore, 0))} ${esc(row.productId)} ${esc(t('matched', 'مطابق'))} ${esc(num(row.matchedQuantity))} ${esc(t('of demand', 'من الطلب'))} ${esc(num(row.demandQuantity))} ${badge(row.status, MATCH_TONE[row.status] ?? '')}; handler/action ID: NOT VERIFIED; permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.
- UI label: ${esc(t('Acknowledge', 'إقرار'))}; handler/action ID: NOT VERIFIED; permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.
- UI label: ${esc(t('Approve match', 'اعتماد المطابقة'))}; handler/action ID: NOT VERIFIED; permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.

# 8. Inputs

- Static controls: (rendered by JS module — not statically inspectable)
- Governed selectors versus raw IDs: NOT VERIFIED from the page inventory; inspect the page-specific renderer before implementation.

# 9. Outputs

The intended output is the page’s named Dock Schedule record, decision, view, or operational state. Exact persisted object: NOT VERIFIED.

# 10. Workflow Position

- Upstream: NOT VERIFIED from explicit workflow metadata.
- Downstream: `crossdock_workspace`, `dock_checkin`, `staging_board`

# 11. States

- LOADING: module source contains async loading paths; exact copy/state transitions require browser proof.
- READY: route activation passed visible Chromium audit.
- EMPTY: not verified (no view file to inspect — JS-rendered page)
- DENIED: toast "عذراً، ليس لديك صلاحية للوصول إلى هذا القسم" + redirect to calculator/login (app.js switchPage generic denial handling)
- VALIDATION_ERROR: NOT VERIFIED
- SERVER_ERROR: NOT VERIFIED
- SUCCESS: NOT VERIFIED
- Domain lifecycle states: NOT VERIFIED.

# 12. Permissions & Scope

- Client page gate: workshop.manager
- Entitlement: none/global (not a commercial/SaaS-gated page)
- Tenant/company/branch/warehouse/employee scope: NOT VERIFIED in page-specific evidence.
- Client visibility and server authorization must be treated separately; the navigation click audit proves neither server mutation authorization nor data isolation.

# 13. Arabic / English

- Arabic label: جدول الأرصفة
- English label: Dock Schedule
- Baseline language metadata: ar, en
- Missing labels: NOT VERIFIED beyond static inventory evidence.

# 14. Responsive Requirements

- Desktop/laptop: the visible navigation audit covered route activation, not layout quality.
- Mobile: not verified — no mobile-specific markers found (desktop-oriented by default); operational mobile behavior requires a separate browser contract.

# 15. AS-IS Functional Assessment

**USABLE** — The baseline contains a page-specific JavaScript renderer, but no literal API evidence was found in the inspected source. This score is evidence-based and does not claim domain completion.

# 16. Target Business Contract

The Dock Schedule workspace should give its governed users a page-specific way to complete the named business task: load scoped records, accept governed inputs where needed, execute authorized actions, persist the resulting state through the domain authority, and expose explicit loading/empty/denied/validation/server-error/success states. Exact fields and lifecycle transitions remain **NOT VERIFIED** where the baseline source does not define them.

# 17. Identified Gaps

- **PAGE-dock_schedule-GAP-003** (P1, API) — No literal backend API path was verified in the inspected page-specific source; server capability remains NOT VERIFIED.

# 18. Consolidation Analysis

- Remain a primary workspace: **YES pending owner review**, because it is classified as a primary navigation page in the baseline forensic report.
- Tab/master-detail child/dialog/action/alias/internal-view alternative: NOT VERIFIED; do not consolidate from page title alone.
- Canonical candidate: `dock_schedule` unless a later owner decision records another home.

# 19. Acceptance Criteria

- A user with the declared permission can open `dock_schedule` through the visible navigation and see a non-error page-specific surface.
- The page exposes only actions whose permission, API/domain handler, required inputs, persisted result, and next state are documented and server-authorized.
- The page distinguishes LOADING, READY, EMPTY, DENIED, VALIDATION_ERROR, SERVER_ERROR, and SUCCESS in a real browser.
- A scoped browser test proves the named Dock Schedule workflow; the current 231/231 click audit is route activation evidence only.

# 20. Test Evidence

- **REAL_BROWSER_VISIBLE_UI:** docs/autopilot/evidence/NAVIGATION-RECOVERY-1-click-audit-all.json — authenticated Chromium visible click audit; 231/231 primary navigation items passed, including this page.
- **STATIC:** docs/review/PAGE_INVENTORY.json and docs/navigation/NAVIGATION_FORENSIC_REPORT.json.
- **API / DOMAIN:** tests/build-09/build09-workspaces-contract.test.mjs, tests/build-09/build09r2-bespoke-contract.test.mjs, tests/build-09/dock-workspaces-browser.test.mjs, tests/build-09/operational-32-page-matrix-chromium.test.mjs
- **REAL_BROWSER_DIRECT:** NOT VERIFIED; no direct action lifecycle proof is attributed here.

# 21. Known Limitations

- This catalog is a forensic specification at baseline 25c24df753962bbf3c13301eed71624bc0ee39b6; it does not describe uncommitted engineering changes.
- Navigation activation is not functional, permission-isolation, lifecycle, or persistence proof.
- Table/entity ownership is intentionally left NOT VERIFIED unless exact source evidence is available.


# 22. Source Evidence

- `modules/build09-dock-workspace.js`
- `index.html`
- `services/permissionService.js`
- `docs/review/PAGE_INVENTORY.json`
- `docs/navigation/NAVIGATION_FORENSIC_REPORT.json`

# 23. Change History

- 2026-08-14 — catalog created from baseline 25c24df753962bbf3c13301eed71624bc0ee39b6.
- Future reconciliation must append the Product Recovery SHA and preserve the AS-IS/TARGET separation.

## CAPABILITIES OWNED

- Dock Schedule workspace presentation and its explicitly verified page-specific actions: NOT VERIFIED, NOT VERIFIED, NOT VERIFIED, NOT VERIFIED, NOT VERIFIED, NOT VERIFIED, NOT VERIFIED, NOT VERIFIED, NOT VERIFIED, NOT VERIFIED, NOT VERIFIED, NOT VERIFIED, NOT VERIFIED, NOT VERIFIED, NOT VERIFIED.

## CAPABILITIES CONSUMED

- Navigation activation, declared page permission gate, and any API paths listed in the front matter. Exact domain capabilities: NOT VERIFIED where no backend path was found.
