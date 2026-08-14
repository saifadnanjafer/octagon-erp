---
page_id: "import_center"
title_en: "Data Import"
title_ar: "استيراد البيانات"
domain: "admin"
navigation_group: "admin_org"
kind: PAGE
canonical_status: PRIMARY
canonical_home: "import_center"
parent_page: null
aliases: []
roles: ["default client policy"]
permission: "default-client-gate"
entitlement: "none/global (not in PAGE_INVENTORY.json)"
renderer_type: "javascript"
renderer_sources: ["modules/import-wizard.js"]
view_sources: []
api_sources: []
domain_sources: ["modules/import-wizard.js","services/permissionService.js"]
tables_or_entities: []
test_sources: ["docs/navigation/NAVIGATION_FORENSIC_REPORT.json","docs/autopilot/evidence/NAVIGATION-RECOVERY-1-click-audit-all.json"]
catalog_baseline_sha: "25c24df753962bbf3c13301eed71624bc0ee39b6"
last_verified_sha: "25c24df753962bbf3c13301eed71624bc0ee39b6"
evidence_confidence: "HIGH"
implementation_status: "IMPLEMENTED_AT_BASELINE"
functional_status: "CONNECTED"
usability_status: "USABLE"
review_status: "REQUIRES_PRODUCT_RECOVERY"
---

# 1. Identity

- Page ID: `import_center`
- English: Data Import
- Arabic: استيراد البيانات
- Domain: `admin`; navigation group: `admin_org`
- Route: switchPage('import_center')
- Page type: PAGE

# 2. Business Purpose

NOT VERIFIED — the baseline inventory has no purpose statement for Data Import.

# 3. Primary Users

- Declared roles: default client policy
- Viewer/operator/reviewer/manager/administrator split: NOT VERIFIED beyond the declared permission gate.

# 4. Primary User Goal

User opens this page to work with the Data Import workspace. The exact business completion goal is NOT VERIFIED from baseline evidence.

# 5. AS-IS Runtime Surface

No dedicated views/*.html file is registered; the page is created by JavaScript or a shell. Static source counts at baseline: 5 headings, 5 button tags, 5 input/select/textarea controls, 1 tables, 0 forms, and 0 literal /api/v1 calls. Dynamic content not visible in static source is NOT VERIFIED.

- Renderer evidence: modules/import-wizard.js
- Visible action inventory: NOT VERIFIED — page absent from PAGE_INVENTORY.json
- Empty state: NOT VERIFIED
- Denied state: NOT VERIFIED
- Generic-shell risk: NO from the inspected page-specific source.

# 6. Data Sources

- UI → renderer: modules/import-wizard.js
- Renderer → API/query: NOT VERIFIED
- Domain service → table/entity: NOT VERIFIED; no table is asserted without direct source evidence.
- Required fixture: NOT VERIFIED

# 7. Actions

- UI label: ${esc(p.name)}; handler/action ID: ImportWizard.applyPreset(; permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.
- UI label: تحليل CSV; handler/action ID: ImportWizard.parse(); permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.
- UI label: حفظ الربط; handler/action ID: ImportWizard.savePreset(); permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.
- UI label: استيراد الصالح فقط; handler/action ID: ImportWizard.confirm(true); permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.
- UI label: استيراد كل الصفوف; handler/action ID: ImportWizard.confirm(false); permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.

# 8. Inputs

- Static controls: NOT VERIFIED — page absent from PAGE_INVENTORY.json
- Governed selectors versus raw IDs: NOT VERIFIED from the page inventory; inspect the page-specific renderer before implementation.

# 9. Outputs

The intended output is the page’s named Data Import record, decision, view, or operational state. Exact persisted object: NOT VERIFIED.

# 10. Workflow Position

- Upstream: NOT VERIFIED from explicit workflow metadata.
- Downstream: NOT VERIFIED from page-specific source.

# 11. States

- LOADING: module source contains async loading paths; exact copy/state transitions require browser proof.
- READY: route activation passed visible Chromium audit.
- EMPTY: NOT VERIFIED
- DENIED: NOT VERIFIED
- VALIDATION_ERROR: NOT VERIFIED
- SERVER_ERROR: NOT VERIFIED
- SUCCESS: NOT VERIFIED
- Domain lifecycle states: NOT VERIFIED.

# 12. Permissions & Scope

- Client page gate: default-client-gate
- Entitlement: none/global (not in PAGE_INVENTORY.json)
- Tenant/company/branch/warehouse/employee scope: NOT VERIFIED in page-specific evidence.
- Client visibility and server authorization must be treated separately; the navigation click audit proves neither server mutation authorization nor data isolation.

# 13. Arabic / English

- Arabic label: استيراد البيانات
- English label: Data Import
- Baseline language metadata: ar, en
- Missing labels: NOT VERIFIED beyond static inventory evidence.

# 14. Responsive Requirements

- Desktop/laptop: the visible navigation audit covered route activation, not layout quality.
- Mobile: NOT VERIFIED; operational mobile behavior requires a separate browser contract.

# 15. AS-IS Functional Assessment

**USABLE** — The baseline contains a page-specific JavaScript renderer, but no literal API evidence was found in the inspected source. This score is evidence-based and does not claim domain completion.

# 16. Target Business Contract

The Data Import workspace should give its governed users a page-specific way to complete the named business task: load scoped records, accept governed inputs where needed, execute authorized actions, persist the resulting state through the domain authority, and expose explicit loading/empty/denied/validation/server-error/success states. Exact fields and lifecycle transitions remain **NOT VERIFIED** where the baseline source does not define them.

# 17. Identified Gaps

- **PAGE-import_center-GAP-003** (P1, API) — No literal backend API path was verified in the inspected page-specific source; server capability remains NOT VERIFIED.

# 18. Consolidation Analysis

- Remain a primary workspace: **YES pending owner review**, because it is classified as a primary navigation page in the baseline forensic report.
- Tab/master-detail child/dialog/action/alias/internal-view alternative: NOT VERIFIED; do not consolidate from page title alone.
- Canonical candidate: `import_center` unless a later owner decision records another home.

# 19. Acceptance Criteria

- A user with the declared permission can open `import_center` through the visible navigation and see a non-error page-specific surface.
- The page exposes only actions whose permission, API/domain handler, required inputs, persisted result, and next state are documented and server-authorized.
- The page distinguishes LOADING, READY, EMPTY, DENIED, VALIDATION_ERROR, SERVER_ERROR, and SUCCESS in a real browser.
- A scoped browser test proves the named Data Import workflow; the current 231/231 click audit is route activation evidence only.

# 20. Test Evidence

- **REAL_BROWSER_VISIBLE_UI:** docs/autopilot/evidence/NAVIGATION-RECOVERY-1-click-audit-all.json — authenticated Chromium visible click audit; 231/231 primary navigation items passed, including this page.
- **STATIC:** docs/review/PAGE_INVENTORY.json and docs/navigation/NAVIGATION_FORENSIC_REPORT.json.
- **API / DOMAIN:** NOT VERIFIED by a page-id-specific test in tests/.
- **REAL_BROWSER_DIRECT:** NOT VERIFIED; no direct action lifecycle proof is attributed here.

# 21. Known Limitations

- This catalog is a forensic specification at baseline 25c24df753962bbf3c13301eed71624bc0ee39b6; it does not describe uncommitted engineering changes.
- Navigation activation is not functional, permission-isolation, lifecycle, or persistence proof.
- Table/entity ownership is intentionally left NOT VERIFIED unless exact source evidence is available.


# 22. Source Evidence

- `modules/import-wizard.js`
- `index.html`
- `services/permissionService.js`
- `docs/review/PAGE_INVENTORY.json`
- `docs/navigation/NAVIGATION_FORENSIC_REPORT.json`

# 23. Change History

- 2026-08-14 — catalog created from baseline 25c24df753962bbf3c13301eed71624bc0ee39b6.
- Future reconciliation must append the Product Recovery SHA and preserve the AS-IS/TARGET separation.

## CAPABILITIES OWNED

- Data Import workspace presentation and its explicitly verified page-specific actions: ImportWizard.applyPreset(, ImportWizard.parse(), ImportWizard.savePreset(), ImportWizard.confirm(true), ImportWizard.confirm(false).

## CAPABILITIES CONSUMED

- Navigation activation, declared page permission gate, and any API paths listed in the front matter. Exact domain capabilities: NOT VERIFIED where no backend path was found.
