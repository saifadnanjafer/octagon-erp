---
page_id: "report"
title_en: "Report"
title_ar: "التقرير النهائي"
domain: "core"
navigation_group: "core_records"
kind: ANALYTICS
canonical_status: PRIMARY
canonical_home: "report"
parent_page: null
aliases: []
roles: ["finance.user"]
permission: "finance.user"
entitlement: "none/global (not a commercial/SaaS-gated page)"
renderer_type: "view"
renderer_sources: ["views/report.html"]
view_sources: ["views/report.html"]
api_sources: []
domain_sources: ["services/permissionService.js"]
tables_or_entities: []
test_sources: ["docs/navigation/NAVIGATION_FORENSIC_REPORT.json","docs/autopilot/evidence/NAVIGATION-RECOVERY-1-click-audit-all.json","tests/build-05/platform-services-browser.test.mjs","tests/build-05/platform-services-lifecycle.test.mjs","tests/build-05/platform-services-runtime.test.mjs","tests/build-08/build08-page-contract.test.mjs","tests/build-08/consolidation-domain.test.mjs","tests/build-08/group-finance-browser-chromium.test.mjs","tests/build-08/treasury-liquidity-domain.test.mjs","tests/build-09/downtime-workspaces-browser.test.mjs"]
catalog_baseline_sha: "25c24df753962bbf3c13301eed71624bc0ee39b6"
last_verified_sha: "25c24df753962bbf3c13301eed71624bc0ee39b6"
evidence_confidence: "HIGH"
implementation_status: "IMPLEMENTED_AT_BASELINE"
functional_status: "CONNECTED"
usability_status: "USABLE"
review_status: "REQUIRES_PRODUCT_RECOVERY"
---

# 1. Identity

- Page ID: `report`
- English: Report
- Arabic: التقرير النهائي
- Domain: `core`; navigation group: `core_records`
- Route: switchPage('report') / views/report.html
- Page type: ANALYTICS

# 2. Business Purpose

Payroll report — finance/payroll (risk: high, phase: core)

# 3. Primary Users

- Declared roles: finance.user
- Viewer/operator/reviewer/manager/administrator split: NOT VERIFIED beyond the declared permission gate.

# 4. Primary User Goal

User opens this page to work with the Report workspace. The exact business completion goal is supported by the review inventory purpose statement above.

# 5. AS-IS Runtime Surface

The registered view is views/report.html. Static source counts at baseline: 2 headings, 3 button tags, 1 input/select/textarea controls, 1 tables, 0 forms, and 0 literal /api/v1 calls. Dynamic content not visible in static source is NOT VERIFIED.

- Renderer evidence: views/report.html
- Visible action inventory: (no <button> labels found in static view file)
- Empty state: has empty-state markup/copy in view file
- Denied state: toast "عذراً، ليس لديك صلاحية للوصول إلى هذا القسم" + redirect to calculator/login (app.js switchPage generic denial handling)
- Generic-shell risk: NO from the inspected page-specific source.

# 6. Data Sources

- UI → renderer: views/report.html
- Renderer → API/query: NOT VERIFIED
- Domain service → table/entity: NOT VERIFIED; no table is asserted without direct source evidence.
- Required fixture: none/global

# 7. Actions

- UI label: إعداد ملخص ذكي للتقرير; handler/action ID: prepareSmartReportSummary(); permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.
- UI label: طباعة; handler/action ID: window.print(); permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.
- UI label: تصدير التقرير; handler/action ID: exportPayrollPdf(); permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.

# 8. Inputs

- Static controls: (no <button> labels found in static view file)
- Governed selectors versus raw IDs: NOT VERIFIED from the page inventory; inspect the page-specific renderer before implementation.

# 9. Outputs

The intended output is the page’s named Report record, decision, view, or operational state. Exact persisted object: NOT VERIFIED.

# 10. Workflow Position

- Upstream: NOT VERIFIED from explicit workflow metadata.
- Downstream: NOT VERIFIED from page-specific source.

# 11. States

- LOADING: NOT VERIFIED
- READY: route activation passed visible Chromium audit.
- EMPTY: has empty-state markup/copy in view file
- DENIED: toast "عذراً، ليس لديك صلاحية للوصول إلى هذا القسم" + redirect to calculator/login (app.js switchPage generic denial handling)
- VALIDATION_ERROR: NOT VERIFIED
- SERVER_ERROR: NOT VERIFIED
- SUCCESS: NOT VERIFIED
- Domain lifecycle states: NOT VERIFIED.

# 12. Permissions & Scope

- Client page gate: finance.user
- Entitlement: none/global (not a commercial/SaaS-gated page)
- Tenant/company/branch/warehouse/employee scope: NOT VERIFIED in page-specific evidence.
- Client visibility and server authorization must be treated separately; the navigation click audit proves neither server mutation authorization nor data isolation.

# 13. Arabic / English

- Arabic label: التقرير النهائي
- English label: Report
- Baseline language metadata: ar, en
- Missing labels: NOT VERIFIED beyond static inventory evidence.

# 14. Responsive Requirements

- Desktop/laptop: the visible navigation audit covered route activation, not layout quality.
- Mobile: not verified — no mobile-specific markers found (desktop-oriented by default); operational mobile behavior requires a separate browser contract.

# 15. AS-IS Functional Assessment

**USABLE** — The baseline contains a registered view/renderer, but no literal API evidence was found in the inspected source. This score is evidence-based and does not claim domain completion.

# 16. Target Business Contract

The Report workspace should give its governed users a page-specific way to complete the named business task: load scoped records, accept governed inputs where needed, execute authorized actions, persist the resulting state through the domain authority, and expose explicit loading/empty/denied/validation/server-error/success states. Exact fields and lifecycle transitions remain **NOT VERIFIED** where the baseline source does not define them.

# 17. Identified Gaps

- **PAGE-report-GAP-003** (P1, API) — No literal backend API path was verified in the inspected page-specific source; server capability remains NOT VERIFIED.

# 18. Consolidation Analysis

- Remain a primary workspace: **YES pending owner review**, because it is classified as a primary navigation page in the baseline forensic report.
- Tab/master-detail child/dialog/action/alias/internal-view alternative: NOT VERIFIED; do not consolidate from page title alone.
- Canonical candidate: `report` unless a later owner decision records another home.

# 19. Acceptance Criteria

- A user with the declared permission can open `report` through the visible navigation and see a non-error page-specific surface.
- The page exposes only actions whose permission, API/domain handler, required inputs, persisted result, and next state are documented and server-authorized.
- The page distinguishes LOADING, READY, EMPTY, DENIED, VALIDATION_ERROR, SERVER_ERROR, and SUCCESS in a real browser.
- A scoped browser test proves the named Report workflow; the current 231/231 click audit is route activation evidence only.

# 20. Test Evidence

- **REAL_BROWSER_VISIBLE_UI:** docs/autopilot/evidence/NAVIGATION-RECOVERY-1-click-audit-all.json — authenticated Chromium visible click audit; 231/231 primary navigation items passed, including this page.
- **STATIC:** docs/review/PAGE_INVENTORY.json and docs/navigation/NAVIGATION_FORENSIC_REPORT.json.
- **API / DOMAIN:** tests/build-05/platform-services-browser.test.mjs, tests/build-05/platform-services-lifecycle.test.mjs, tests/build-05/platform-services-runtime.test.mjs, tests/build-08/build08-page-contract.test.mjs, tests/build-08/consolidation-domain.test.mjs, tests/build-08/group-finance-browser-chromium.test.mjs, tests/build-08/treasury-liquidity-domain.test.mjs, tests/build-09/downtime-workspaces-browser.test.mjs
- **REAL_BROWSER_DIRECT:** NOT VERIFIED; no direct action lifecycle proof is attributed here.

# 21. Known Limitations

- This catalog is a forensic specification at baseline 25c24df753962bbf3c13301eed71624bc0ee39b6; it does not describe uncommitted engineering changes.
- Navigation activation is not functional, permission-isolation, lifecycle, or persistence proof.
- Table/entity ownership is intentionally left NOT VERIFIED unless exact source evidence is available.


# 22. Source Evidence

- `views/report.html`
- `index.html`
- `services/permissionService.js`
- `docs/review/PAGE_INVENTORY.json`
- `docs/navigation/NAVIGATION_FORENSIC_REPORT.json`

# 23. Change History

- 2026-08-14 — catalog created from baseline 25c24df753962bbf3c13301eed71624bc0ee39b6.
- Future reconciliation must append the Product Recovery SHA and preserve the AS-IS/TARGET separation.

## CAPABILITIES OWNED

- Report workspace presentation and its explicitly verified page-specific actions: prepareSmartReportSummary(), window.print(), exportPayrollPdf().

## CAPABILITIES CONSUMED

- Navigation activation, declared page permission gate, and any API paths listed in the front matter. Exact domain capabilities: NOT VERIFIED where no backend path was found.
