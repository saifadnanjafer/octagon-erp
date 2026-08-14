---
page_id: "timesheet"
title_en: "Timesheet"
title_ar: "التايم شيت الذكي"
domain: "core"
navigation_group: "core_daily"
kind: PAGE
canonical_status: PRIMARY
canonical_home: "timesheet"
parent_page: null
aliases: []
roles: ["workshop.user"]
permission: "workshop.user"
entitlement: "none/global (not a commercial/SaaS-gated page)"
renderer_type: "view"
renderer_sources: ["views/timesheet.html"]
view_sources: ["views/timesheet.html"]
api_sources: []
domain_sources: ["services/permissionService.js"]
tables_or_entities: []
test_sources: ["docs/navigation/NAVIGATION_FORENSIC_REPORT.json","docs/autopilot/evidence/NAVIGATION-RECOVERY-1-click-audit-all.json","tests/build-12/build12-domain.test.mjs","tests/checkpoint-f/canonical_authority_coverage.test.mjs","tests/checkpoint-g/canonical_cutover_controller.test.mjs","tests/checkpoint-h/http_legacy_writer_refusal.test.mjs","tests/page-consolidation/consolidation-contract.test.mjs","tests/phase02/browser-live-evidence.test.mjs","tests/phase02/security-suite.test.mjs","tests/phase02/settings-policies.test.mjs"]
catalog_baseline_sha: "25c24df753962bbf3c13301eed71624bc0ee39b6"
last_verified_sha: "25c24df753962bbf3c13301eed71624bc0ee39b6"
evidence_confidence: "HIGH"
implementation_status: "IMPLEMENTED_AT_BASELINE"
functional_status: "CONNECTED"
usability_status: "USABLE"
review_status: "REQUIRES_PRODUCT_RECOVERY"
---

# 1. Identity

- Page ID: `timesheet`
- English: Timesheet
- Arabic: التايم شيت الذكي
- Domain: `core`; navigation group: `core_daily`
- Route: switchPage('timesheet') / views/timesheet.html
- Page type: PAGE

# 2. Business Purpose

Timesheet — hr/payroll (risk: high, phase: phase6e)

# 3. Primary Users

- Declared roles: workshop.user
- Viewer/operator/reviewer/manager/administrator split: NOT VERIFIED beyond the declared permission gate.

# 4. Primary User Goal

User opens this page to work with the Timesheet workspace. The exact business completion goal is supported by the review inventory purpose statement above.

# 5. AS-IS Runtime Surface

The registered view is views/timesheet.html. Static source counts at baseline: 2 headings, 6 button tags, 3 input/select/textarea controls, 0 tables, 0 forms, and 0 literal /api/v1 calls. Dynamic content not visible in static source is NOT VERIFIED.

- Renderer evidence: views/timesheet.html
- Visible action inventory: (no <button> labels found in static view file)
- Empty state: not verified — no empty-state markup found in static view file (may be rendered dynamically by JS)
- Denied state: toast "عذراً، ليس لديك صلاحية للوصول إلى هذا القسم" + redirect to calculator/login (app.js switchPage generic denial handling)
- Generic-shell risk: NO from the inspected page-specific source.

# 6. Data Sources

- UI → renderer: views/timesheet.html
- Renderer → API/query: NOT VERIFIED
- Domain service → table/entity: NOT VERIFIED; no table is asserted without direct source evidence.
- Required fixture: none/global

# 7. Actions

- UI label: طباعة التايم شيت; handler/action ID: printTimesheetForSelectedMonth(); permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.
- UI label: 🪄 تعبئة الأيام المفقودة; handler/action ID: autoFillMissingDays(); permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.
- UI label: ⚙️ تطبيق القوانين (محلياً); handler/action ID: applyRulesNoAI(); permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.
- UI label: ➕ إضافة موظف; handler/action ID: addEmployee(); permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.
- UI label: إرسال الأمر; handler/action ID: processTimesheetWithAI(); permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.
- UI label: تطبيق قوانين الرواتب; handler/action ID: applyComplexRulesWithAI(); permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.

# 8. Inputs

- Static controls: (no <button> labels found in static view file)
- Governed selectors versus raw IDs: NOT VERIFIED from the page inventory; inspect the page-specific renderer before implementation.

# 9. Outputs

The intended output is the page’s named Timesheet record, decision, view, or operational state. Exact persisted object: NOT VERIFIED.

# 10. Workflow Position

- Upstream: NOT VERIFIED from explicit workflow metadata.
- Downstream: NOT VERIFIED from page-specific source.

# 11. States

- LOADING: NOT VERIFIED
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

- Arabic label: التايم شيت الذكي
- English label: Timesheet
- Baseline language metadata: ar, en
- Missing labels: NOT VERIFIED beyond static inventory evidence.

# 14. Responsive Requirements

- Desktop/laptop: the visible navigation audit covered route activation, not layout quality.
- Mobile: not verified — no mobile-specific markers found (desktop-oriented by default); operational mobile behavior requires a separate browser contract.

# 15. AS-IS Functional Assessment

**USABLE** — The baseline contains a registered view/renderer, but no literal API evidence was found in the inspected source. This score is evidence-based and does not claim domain completion.

# 16. Target Business Contract

The Timesheet workspace should give its governed users a page-specific way to complete the named business task: load scoped records, accept governed inputs where needed, execute authorized actions, persist the resulting state through the domain authority, and expose explicit loading/empty/denied/validation/server-error/success states. Exact fields and lifecycle transitions remain **NOT VERIFIED** where the baseline source does not define them.

# 17. Identified Gaps

- **PAGE-timesheet-GAP-003** (P1, API) — No literal backend API path was verified in the inspected page-specific source; server capability remains NOT VERIFIED.

# 18. Consolidation Analysis

- Remain a primary workspace: **YES pending owner review**, because it is classified as a primary navigation page in the baseline forensic report.
- Tab/master-detail child/dialog/action/alias/internal-view alternative: NOT VERIFIED; do not consolidate from page title alone.
- Canonical candidate: `timesheet` unless a later owner decision records another home.

# 19. Acceptance Criteria

- A user with the declared permission can open `timesheet` through the visible navigation and see a non-error page-specific surface.
- The page exposes only actions whose permission, API/domain handler, required inputs, persisted result, and next state are documented and server-authorized.
- The page distinguishes LOADING, READY, EMPTY, DENIED, VALIDATION_ERROR, SERVER_ERROR, and SUCCESS in a real browser.
- A scoped browser test proves the named Timesheet workflow; the current 231/231 click audit is route activation evidence only.

# 20. Test Evidence

- **REAL_BROWSER_VISIBLE_UI:** docs/autopilot/evidence/NAVIGATION-RECOVERY-1-click-audit-all.json — authenticated Chromium visible click audit; 231/231 primary navigation items passed, including this page.
- **STATIC:** docs/review/PAGE_INVENTORY.json and docs/navigation/NAVIGATION_FORENSIC_REPORT.json.
- **API / DOMAIN:** tests/build-12/build12-domain.test.mjs, tests/checkpoint-f/canonical_authority_coverage.test.mjs, tests/checkpoint-g/canonical_cutover_controller.test.mjs, tests/checkpoint-h/http_legacy_writer_refusal.test.mjs, tests/page-consolidation/consolidation-contract.test.mjs, tests/phase02/browser-live-evidence.test.mjs, tests/phase02/security-suite.test.mjs, tests/phase02/settings-policies.test.mjs
- **REAL_BROWSER_DIRECT:** NOT VERIFIED; no direct action lifecycle proof is attributed here.

# 21. Known Limitations

- This catalog is a forensic specification at baseline 25c24df753962bbf3c13301eed71624bc0ee39b6; it does not describe uncommitted engineering changes.
- Navigation activation is not functional, permission-isolation, lifecycle, or persistence proof.
- Table/entity ownership is intentionally left NOT VERIFIED unless exact source evidence is available.


# 22. Source Evidence

- `views/timesheet.html`
- `index.html`
- `services/permissionService.js`
- `docs/review/PAGE_INVENTORY.json`
- `docs/navigation/NAVIGATION_FORENSIC_REPORT.json`

# 23. Change History

- 2026-08-14 — catalog created from baseline 25c24df753962bbf3c13301eed71624bc0ee39b6.
- Future reconciliation must append the Product Recovery SHA and preserve the AS-IS/TARGET separation.

## CAPABILITIES OWNED

- Timesheet workspace presentation and its explicitly verified page-specific actions: printTimesheetForSelectedMonth(), autoFillMissingDays(), applyRulesNoAI(), addEmployee(), processTimesheetWithAI(), applyComplexRulesWithAI().

## CAPABILITIES CONSUMED

- Navigation activation, declared page permission gate, and any API paths listed in the front matter. Exact domain capabilities: NOT VERIFIED where no backend path was found.
