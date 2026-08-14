---
page_id: "people_development_overview"
title_en: "People Development"
title_ar: "نظرة عامة على تطوير الأفراد"
domain: "resources"
navigation_group: "resources_people"
kind: DASHBOARD
canonical_status: PRIMARY
canonical_home: "people_development_overview"
parent_page: null
aliases: []
roles: ["system.admin","workshop.manager"]
permission: "system.admin, workshop.manager"
entitlement: "UNMAPPED — commercial/SaaS page, no literal saas_plan_entitlements \"page:*\" row found"
renderer_type: "javascript"
renderer_sources: ["app.js switchPage","modules/build12-workspaces.js"]
view_sources: []
api_sources: ["/api/v1/build12/${resource}","/api/v1/action/${id}"]
domain_sources: ["services/permissionService.js","modules/build12-workspaces.js"]
tables_or_entities: []
test_sources: ["docs/navigation/NAVIGATION_FORENSIC_REPORT.json","docs/autopilot/evidence/NAVIGATION-RECOVERY-1-click-audit-all.json","tests/build-12/build12-acceptance-contract.test.mjs"]
catalog_baseline_sha: "25c24df753962bbf3c13301eed71624bc0ee39b6"
last_verified_sha: "25c24df753962bbf3c13301eed71624bc0ee39b6"
evidence_confidence: "HIGH"
implementation_status: "IMPLEMENTED_AT_BASELINE"
functional_status: "CONNECTED"
usability_status: "STRONG"
review_status: "REQUIRES_PRODUCT_RECOVERY"
---

# 1. Identity

- Page ID: `people_development_overview`
- English: People Development
- Arabic: نظرة عامة على تطوير الأفراد
- Domain: `resources`; navigation group: `resources_people`
- Route: switchPage('people_development_overview') / views/people_development_overview.html
- Page type: DASHBOARD

# 2. Business Purpose

People development — build12/people (risk: medium, phase: build12)

# 3. Primary Users

- Declared roles: system.admin, workshop.manager
- Viewer/operator/reviewer/manager/administrator split: NOT VERIFIED beyond the declared permission gate.

# 4. Primary User Goal

User opens this page to work with the People Development workspace. The exact business completion goal is supported by the review inventory purpose statement above.

# 5. AS-IS Runtime Surface

The registered view is views/people_development_overview.html. Static source counts at baseline: 2 headings, 3 button tags, 2 input/select/textarea controls, 1 tables, 1 forms, and 2 literal /api/v1 calls. Dynamic content not visible in static source is NOT VERIFIED.

- Renderer evidence: app.js switchPage
- Visible action inventory: (rendered by JS module — not statically inspectable)
- Empty state: not verified (no view file to inspect — JS-rendered page)
- Denied state: toast "عذراً، ليس لديك صلاحية للوصول إلى هذا القسم" + redirect to calculator/login (app.js switchPage generic denial handling)
- Generic-shell risk: NO from the inspected page-specific source.

# 6. Data Sources

- UI → renderer: app.js switchPage
- Renderer → API/query: /api/v1/build12/${resource}, /api/v1/action/${id}
- Domain service → table/entity: NOT VERIFIED; no table is asserted without direct source evidence.
- Required fixture: people-development

# 7. Actions

- UI label: (rendered by JS module — not statically inspectable); action ID/API/domain handler/persistence: NOT VERIFIED by the baseline inventory.
- UI label: ${esc(buttonText)}; handler/action ID: NOT VERIFIED; permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.
- UI label: ${escapeHtml(t('Refresh', 'تحديث'))}; handler/action ID: NOT VERIFIED; permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.
- UI label: ${esc(label)}; handler/action ID: NOT VERIFIED; permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.

# 8. Inputs

- Static controls: (rendered by JS module — not statically inspectable)
- Governed selectors versus raw IDs: NOT VERIFIED from the page inventory; inspect the page-specific renderer before implementation.

# 9. Outputs

The intended output is the page’s named People Development record, decision, view, or operational state. Exact persisted object: NOT VERIFIED.

# 10. Workflow Position

- Upstream: NOT VERIFIED from explicit workflow metadata.
- Downstream: NOT VERIFIED from page-specific source.

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

- Client page gate: system.admin, workshop.manager
- Entitlement: UNMAPPED — commercial/SaaS page, no literal saas_plan_entitlements "page:*" row found
- Tenant/company/branch/warehouse/employee scope: NOT VERIFIED in page-specific evidence.
- Client visibility and server authorization must be treated separately; the navigation click audit proves neither server mutation authorization nor data isolation.

# 13. Arabic / English

- Arabic label: نظرة عامة على تطوير الأفراد
- English label: People Development
- Baseline language metadata: ar, en
- Missing labels: NOT VERIFIED beyond static inventory evidence.

# 14. Responsive Requirements

- Desktop/laptop: the visible navigation audit covered route activation, not layout quality.
- Mobile: not verified — no mobile-specific markers found (desktop-oriented by default); operational mobile behavior requires a separate browser contract.

# 15. AS-IS Functional Assessment

**STRONG** — The baseline contains a page-specific JavaScript renderer and API evidence. This score is evidence-based and does not claim domain completion.

# 16. Target Business Contract

The People Development workspace should give its governed users a page-specific way to complete the named business task: load scoped records, accept governed inputs where needed, execute authorized actions, persist the resulting state through the domain authority, and expose explicit loading/empty/denied/validation/server-error/success states. Exact fields and lifecycle transitions remain **NOT VERIFIED** where the baseline source does not define them.

# 17. Identified Gaps

- **PAGE-people_development_overview-GAP-004** (P1, PERMISSION) — The review inventory flags this commercial/SaaS page as lacking a matching entitlement mapping in the disposable review database.
- **PAGE-people_development_overview-GAP-005** (P2, TEST) — Documentation contradiction: NAVIGATION_FORENSIC_REPORT.json records app.js switchPage, while the module registry also contains this page. Reconcile renderer ownership after Product Recovery.

# 18. Consolidation Analysis

- Remain a primary workspace: **YES pending owner review**, because it is classified as a primary navigation page in the baseline forensic report.
- Tab/master-detail child/dialog/action/alias/internal-view alternative: NOT VERIFIED; do not consolidate from page title alone.
- Canonical candidate: `people_development_overview` unless a later owner decision records another home.

# 19. Acceptance Criteria

- A user with the declared permission can open `people_development_overview` through the visible navigation and see a non-error page-specific surface.
- The page exposes only actions whose permission, API/domain handler, required inputs, persisted result, and next state are documented and server-authorized.
- The page distinguishes LOADING, READY, EMPTY, DENIED, VALIDATION_ERROR, SERVER_ERROR, and SUCCESS in a real browser.
- A scoped browser test proves the named People Development workflow; the current 231/231 click audit is route activation evidence only.

# 20. Test Evidence

- **REAL_BROWSER_VISIBLE_UI:** docs/autopilot/evidence/NAVIGATION-RECOVERY-1-click-audit-all.json — authenticated Chromium visible click audit; 231/231 primary navigation items passed, including this page.
- **STATIC:** docs/review/PAGE_INVENTORY.json and docs/navigation/NAVIGATION_FORENSIC_REPORT.json.
- **API / DOMAIN:** tests/build-12/build12-acceptance-contract.test.mjs
- **REAL_BROWSER_DIRECT:** NOT VERIFIED; no direct action lifecycle proof is attributed here.

# 21. Known Limitations

- This catalog is a forensic specification at baseline 25c24df753962bbf3c13301eed71624bc0ee39b6; it does not describe uncommitted engineering changes.
- Navigation activation is not functional, permission-isolation, lifecycle, or persistence proof.
- Table/entity ownership is intentionally left NOT VERIFIED unless exact source evidence is available.
- The navigation forensic renderer classification conflicts with the page-specific module registry; reconcile after Product Recovery.


# 22. Source Evidence

- `app.js`
- `index.html`
- `services/permissionService.js`
- `modules/build12-workspaces.js`
- `docs/review/PAGE_INVENTORY.json`
- `docs/navigation/NAVIGATION_FORENSIC_REPORT.json`

# 23. Change History

- 2026-08-14 — catalog created from baseline 25c24df753962bbf3c13301eed71624bc0ee39b6.
- Future reconciliation must append the Product Recovery SHA and preserve the AS-IS/TARGET separation.

## CAPABILITIES OWNED

- People Development workspace presentation and its explicitly verified page-specific actions: NOT VERIFIED, NOT VERIFIED, NOT VERIFIED.

## CAPABILITIES CONSUMED

- Navigation activation, declared page permission gate, and any API paths listed in the front matter. Exact domain capabilities: NOT VERIFIED where no backend path was found.
