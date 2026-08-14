---
page_id: "products"
title_en: "Products &amp; Materials"
title_ar: "المنتجات والمواد"
domain: "ops"
navigation_group: "ops_inventory"
kind: PAGE
canonical_status: PRIMARY
canonical_home: "products"
parent_page: null
aliases: []
roles: ["workshop.user","workshop.manager","system.admin"]
permission: "workshop.user, workshop.manager, system.admin"
entitlement: "none/global (not a commercial/SaaS-gated page)"
renderer_type: "javascript"
renderer_sources: ["views/products_and_materials.html","modules/build09-action-forms.js"]
view_sources: ["views/products_and_materials.html"]
api_sources: ["/api/v1/action/${actionId}","/api/v1/wms/receiving-sessions?warehouse_id=${encodeURIComponent"]
domain_sources: ["services/permissionService.js","modules/build09-action-forms.js","modules/build09-count-workspace.js","modules/build09-dock-workspace.js","modules/build09-mobile-receiving.js","modules/build09-production-material-workspaces.js","modules/build09-putaway-workspace.js"]
tables_or_entities: []
test_sources: ["docs/navigation/NAVIGATION_FORENSIC_REPORT.json","docs/autopilot/evidence/NAVIGATION-RECOVERY-1-click-audit-all.json","tests/build-01/rma-foundation.test.mjs","tests/build-09/browser-harness.mjs","tests/build-09/dock-workspaces-browser.test.mjs","tests/build-09/mobile-receiving-picking-browser.test.mjs","tests/build-09/operational-production-quality-chromium.test.mjs","tests/build-09/production-material-workspaces-browser.test.mjs","tests/build-09/production-material-workspaces-contract.test.mjs","tests/build-09/putaway-workspaces-browser.test.mjs"]
catalog_baseline_sha: "25c24df753962bbf3c13301eed71624bc0ee39b6"
last_verified_sha: "25c24df753962bbf3c13301eed71624bc0ee39b6"
evidence_confidence: "HIGH"
implementation_status: "IMPLEMENTED_AT_BASELINE"
functional_status: "CONNECTED"
usability_status: "STRONG"
review_status: "BASELINE_REVIEWED"
---

# 1. Identity

- Page ID: `products`
- English: Products &amp; Materials
- Arabic: المنتجات والمواد
- Domain: `ops`; navigation group: `ops_inventory`
- Route: switchPage('products') / views/products_and_materials.html
- Page type: PAGE

# 2. Business Purpose

(no PAGE_METADATA entry — inferred label only: Products & Materials)

# 3. Primary Users

- Declared roles: workshop.user, workshop.manager, system.admin
- Viewer/operator/reviewer/manager/administrator split: NOT VERIFIED beyond the declared permission gate.

# 4. Primary User Goal

User opens this page to work with the Products &amp; Materials workspace. The exact business completion goal is supported by the review inventory purpose statement above.

# 5. AS-IS Runtime Surface

The registered view is views/products_and_materials.html. Static source counts at baseline: 44 headings, 62 button tags, 52 input/select/textarea controls, 1 tables, 25 forms, and 2 literal /api/v1 calls. Dynamic content not visible in static source is NOT VERIFIED.

- Renderer evidence: views/products_and_materials.html
- Visible action inventory: &times;
- Empty state: not verified — no empty-state markup found in static view file (may be rendered dynamically by JS)
- Denied state: toast "عذراً، ليس لديك صلاحية للوصول إلى هذا القسم" + redirect to calculator/login (app.js switchPage generic denial handling)
- Generic-shell risk: NO from the inspected page-specific source.

# 6. Data Sources

- UI → renderer: views/products_and_materials.html
- Renderer → API/query: /api/v1/action/${actionId}, /api/v1/wms/receiving-sessions?warehouse_id=${encodeURIComponent
- Domain service → table/entity: NOT VERIFIED; no table is asserted without direct source evidence.
- Required fixture: none/global

# 7. Actions

- UI label: &times; action ID/API/domain handler/persistence: NOT VERIFIED by the baseline inventory.
- UI label: إضافة منتج / مادة; handler/action ID: NOT VERIFIED; permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.
- UI label: تحديث; handler/action ID: NOT VERIFIED; permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.
- UI label: &times;; handler/action ID: closePmProductModal(); permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.
- UI label: إلغاء; handler/action ID: closePmProductModal(); permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.
- UI label: حفظ البيانات; handler/action ID: NOT VERIFIED; permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.
- UI label: ${esc(t('Start session', 'بدء جلسة'))}; handler/action ID: NOT VERIFIED; permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.
- UI label: ${esc(t('Create count plan', 'إنشاء خطة جرد'))}; handler/action ID: NOT VERIFIED; permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.
- UI label: ${esc(row.freezeReference || row.id)} ${esc(row.sessionType)} · ${esc(num((row.lines || []).length, 0))} ${esc(t('lines', 'سطر'))} · ${esc(when(row.createdAt))} ${badge(row.blindCount ? t('blind', 'أعمى') : t('directed', 'موجّه'), row.blindCount ? 'info' : 'muted')}${statusBadge(row.status)}; handler/action ID: NOT VERIFIED; permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.
- UI label: ${esc(done ? t('Update', 'تحديث') : t('Record', 'تسجيل'))}; handler/action ID: NOT VERIFIED; permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.
- UI label: ${esc(t('Submit count', 'تسليم الجرد'))}; handler/action ID: NOT VERIFIED; permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.
- UI label: ${esc(t('Back to sessions', 'العودة للجلسات'))}; handler/action ID: NOT VERIFIED; permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.
- UI label: ${esc(row.freezeReference || row.id)} ${esc(num(row.varianceCount, 0))} ${esc(t('variances', 'فرق'))} · ${esc(when(row.updatedAt))} ${statusBadge(row.status)}; handler/action ID: NOT VERIFIED; permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.

# 8. Inputs

- Static controls: &times;
- Governed selectors versus raw IDs: NOT VERIFIED from the page inventory; inspect the page-specific renderer before implementation.

# 9. Outputs

The intended output is the page’s named Products &amp; Materials record, decision, view, or operational state. Exact persisted object: NOT VERIFIED.

# 10. Workflow Position

- Upstream: NOT VERIFIED from explicit workflow metadata.
- Downstream: `count_session`, `crossdock_workspace`, `cycle_count_plans`, `dock_checkin`, `dock_schedule`, `lot_serial_traceability`, `mobile_receiving`, `production_issue_return`, `production_material_requests`, `production_receipt`, `putaway_rules`, `putaway_task_queue`, `replenishment_proposals`, `replenishment_rules`, `staging_board`, `variance_review`

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

- Client page gate: workshop.user, workshop.manager, system.admin
- Entitlement: none/global (not a commercial/SaaS-gated page)
- Tenant/company/branch/warehouse/employee scope: NOT VERIFIED in page-specific evidence.
- Client visibility and server authorization must be treated separately; the navigation click audit proves neither server mutation authorization nor data isolation.

# 13. Arabic / English

- Arabic label: المنتجات والمواد
- English label: Products &amp; Materials
- Baseline language metadata: ar, en
- Missing labels: NOT VERIFIED beyond static inventory evidence.

# 14. Responsive Requirements

- Desktop/laptop: the visible navigation audit covered route activation, not layout quality.
- Mobile: not verified — no mobile-specific markers found (desktop-oriented by default); operational mobile behavior requires a separate browser contract.

# 15. AS-IS Functional Assessment

**STRONG** — The baseline contains a page-specific JavaScript renderer and API evidence. This score is evidence-based and does not claim domain completion.

# 16. Target Business Contract

The Products &amp; Materials workspace should give its governed users a page-specific way to complete the named business task: load scoped records, accept governed inputs where needed, execute authorized actions, persist the resulting state through the domain authority, and expose explicit loading/empty/denied/validation/server-error/success states. Exact fields and lifecycle transitions remain **NOT VERIFIED** where the baseline source does not define them.

# 17. Identified Gaps

- No P0/P1 gap was derived from the inspected baseline sources. This is not a claim that the workspace is complete.

# 18. Consolidation Analysis

- Remain a primary workspace: **YES pending owner review**, because it is classified as a primary navigation page in the baseline forensic report.
- Tab/master-detail child/dialog/action/alias/internal-view alternative: NOT VERIFIED; do not consolidate from page title alone.
- Canonical candidate: `products` unless a later owner decision records another home.

# 19. Acceptance Criteria

- A user with the declared permission can open `products` through the visible navigation and see a non-error page-specific surface.
- The page exposes only actions whose permission, API/domain handler, required inputs, persisted result, and next state are documented and server-authorized.
- The page distinguishes LOADING, READY, EMPTY, DENIED, VALIDATION_ERROR, SERVER_ERROR, and SUCCESS in a real browser.
- A scoped browser test proves the named Products &amp; Materials workflow; the current 231/231 click audit is route activation evidence only.

# 20. Test Evidence

- **REAL_BROWSER_VISIBLE_UI:** docs/autopilot/evidence/NAVIGATION-RECOVERY-1-click-audit-all.json — authenticated Chromium visible click audit; 231/231 primary navigation items passed, including this page.
- **STATIC:** docs/review/PAGE_INVENTORY.json and docs/navigation/NAVIGATION_FORENSIC_REPORT.json.
- **API / DOMAIN:** tests/build-01/rma-foundation.test.mjs, tests/build-09/browser-harness.mjs, tests/build-09/dock-workspaces-browser.test.mjs, tests/build-09/mobile-receiving-picking-browser.test.mjs, tests/build-09/operational-production-quality-chromium.test.mjs, tests/build-09/production-material-workspaces-browser.test.mjs, tests/build-09/production-material-workspaces-contract.test.mjs, tests/build-09/putaway-workspaces-browser.test.mjs
- **REAL_BROWSER_DIRECT:** NOT VERIFIED; no direct action lifecycle proof is attributed here.

# 21. Known Limitations

- This catalog is a forensic specification at baseline 25c24df753962bbf3c13301eed71624bc0ee39b6; it does not describe uncommitted engineering changes.
- Navigation activation is not functional, permission-isolation, lifecycle, or persistence proof.
- Table/entity ownership is intentionally left NOT VERIFIED unless exact source evidence is available.


# 22. Source Evidence

- `views/products_and_materials.html`
- `index.html`
- `services/permissionService.js`
- `modules/build09-action-forms.js`
- `modules/build09-count-workspace.js`
- `modules/build09-dock-workspace.js`
- `modules/build09-mobile-receiving.js`
- `modules/build09-production-material-workspaces.js`
- `modules/build09-putaway-workspace.js`
- `docs/review/PAGE_INVENTORY.json`
- `docs/navigation/NAVIGATION_FORENSIC_REPORT.json`

# 23. Change History

- 2026-08-14 — catalog created from baseline 25c24df753962bbf3c13301eed71624bc0ee39b6.
- Future reconciliation must append the Product Recovery SHA and preserve the AS-IS/TARGET separation.

## CAPABILITIES OWNED

- Products &amp; Materials workspace presentation and its explicitly verified page-specific actions: NOT VERIFIED, NOT VERIFIED, closePmProductModal(), closePmProductModal(), NOT VERIFIED, NOT VERIFIED, NOT VERIFIED, NOT VERIFIED, NOT VERIFIED, NOT VERIFIED, NOT VERIFIED, NOT VERIFIED, NOT VERIFIED, NOT VERIFIED, NOT VERIFIED, NOT VERIFIED, NOT VERIFIED, NOT VERIFIED, NOT VERIFIED, NOT VERIFIED.

## CAPABILITIES CONSUMED

- Navigation activation, declared page permission gate, and any API paths listed in the front matter. Exact domain capabilities: NOT VERIFIED where no backend path was found.
