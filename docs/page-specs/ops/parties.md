---
page_id: "parties"
title_en: "Customers &amp; Suppliers"
title_ar: "العملاء والموردون"
domain: "ops"
navigation_group: "ops_inventory"
kind: LIST
canonical_status: PRIMARY
canonical_home: "parties"
parent_page: null
aliases: []
roles: ["workshop.user","workshop.manager","system.admin"]
permission: "workshop.user, workshop.manager, system.admin"
entitlement: "none/global (not a commercial/SaaS-gated page)"
renderer_type: "view"
renderer_sources: ["views/customers_and_suppliers.html"]
view_sources: ["views/customers_and_suppliers.html"]
api_sources: []
domain_sources: ["services/permissionService.js"]
tables_or_entities: []
test_sources: ["docs/navigation/NAVIGATION_FORENSIC_REPORT.json","docs/autopilot/evidence/NAVIGATION-RECOVERY-1-click-audit-all.json","tests/build-05/platform-services-lifecycle.test.mjs","tests/build-06/commercial-operations-lifecycle.test.mjs","tests/build-07/mdg-dq-lifecycle.test.mjs","tests/checkpoint-f/atomicity_and_idempotency.test.mjs","tests/checkpoint-f/cross_domain_record_integrity.test.mjs","tests/checkpoint-g/disposable_backup_restore.test.mjs","tests/checkpoint-g/multi_process_concurrency.test.mjs","tests/checkpoint-h/http_legacy_writer_refusal.test.mjs"]
catalog_baseline_sha: "25c24df753962bbf3c13301eed71624bc0ee39b6"
last_verified_sha: "25c24df753962bbf3c13301eed71624bc0ee39b6"
evidence_confidence: "HIGH"
implementation_status: "IMPLEMENTED_AT_BASELINE"
functional_status: "CONNECTED"
usability_status: "USABLE"
review_status: "REQUIRES_PRODUCT_RECOVERY"
---

# 1. Identity

- Page ID: `parties`
- English: Customers &amp; Suppliers
- Arabic: العملاء والموردون
- Domain: `ops`; navigation group: `ops_inventory`
- Route: switchPage('parties') / views/customers_and_suppliers.html
- Page type: LIST

# 2. Business Purpose

(no PAGE_METADATA entry — inferred label only: Customers & Suppliers)

# 3. Primary Users

- Declared roles: workshop.user, workshop.manager, system.admin
- Viewer/operator/reviewer/manager/administrator split: NOT VERIFIED beyond the declared permission gate.

# 4. Primary User Goal

User opens this page to work with the Customers &amp; Suppliers workspace. The exact business completion goal is supported by the review inventory purpose statement above.

# 5. AS-IS Runtime Surface

The registered view is views/customers_and_suppliers.html. Static source counts at baseline: 2 headings, 5 button tags, 16 input/select/textarea controls, 1 tables, 1 forms, and 0 literal /api/v1 calls. Dynamic content not visible in static source is NOT VERIFIED.

- Renderer evidence: views/customers_and_suppliers.html
- Visible action inventory: &times;
- Empty state: not verified — no empty-state markup found in static view file (may be rendered dynamically by JS)
- Denied state: toast "عذراً، ليس لديك صلاحية للوصول إلى هذا القسم" + redirect to calculator/login (app.js switchPage generic denial handling)
- Generic-shell risk: NO from the inspected page-specific source.

# 6. Data Sources

- UI → renderer: views/customers_and_suppliers.html
- Renderer → API/query: NOT VERIFIED
- Domain service → table/entity: NOT VERIFIED; no table is asserted without direct source evidence.
- Required fixture: none/global

# 7. Actions

- UI label: &times; action ID/API/domain handler/persistence: NOT VERIFIED by the baseline inventory.
- UI label: إضافة عميل / مورد; handler/action ID: NOT VERIFIED; permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.
- UI label: تحديث; handler/action ID: NOT VERIFIED; permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.
- UI label: &times;; handler/action ID: closeCsPartyModal(); permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.
- UI label: إلغاء; handler/action ID: closeCsPartyModal(); permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.
- UI label: حفظ الطرف التجاري; handler/action ID: NOT VERIFIED; permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.

# 8. Inputs

- Static controls: &times;
- Governed selectors versus raw IDs: NOT VERIFIED from the page inventory; inspect the page-specific renderer before implementation.

# 9. Outputs

The intended output is the page’s named Customers &amp; Suppliers record, decision, view, or operational state. Exact persisted object: NOT VERIFIED.

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

- Client page gate: workshop.user, workshop.manager, system.admin
- Entitlement: none/global (not a commercial/SaaS-gated page)
- Tenant/company/branch/warehouse/employee scope: NOT VERIFIED in page-specific evidence.
- Client visibility and server authorization must be treated separately; the navigation click audit proves neither server mutation authorization nor data isolation.

# 13. Arabic / English

- Arabic label: العملاء والموردون
- English label: Customers &amp; Suppliers
- Baseline language metadata: ar, en
- Missing labels: NOT VERIFIED beyond static inventory evidence.

# 14. Responsive Requirements

- Desktop/laptop: the visible navigation audit covered route activation, not layout quality.
- Mobile: not verified — no mobile-specific markers found (desktop-oriented by default); operational mobile behavior requires a separate browser contract.

# 15. AS-IS Functional Assessment

**USABLE** — The baseline contains a registered view/renderer, but no literal API evidence was found in the inspected source. This score is evidence-based and does not claim domain completion.

# 16. Target Business Contract

The Customers &amp; Suppliers workspace should give its governed users a page-specific way to complete the named business task: load scoped records, accept governed inputs where needed, execute authorized actions, persist the resulting state through the domain authority, and expose explicit loading/empty/denied/validation/server-error/success states. Exact fields and lifecycle transitions remain **NOT VERIFIED** where the baseline source does not define them.

# 17. Identified Gaps

- **PAGE-parties-GAP-003** (P1, API) — No literal backend API path was verified in the inspected page-specific source; server capability remains NOT VERIFIED.

# 18. Consolidation Analysis

- Remain a primary workspace: **YES pending owner review**, because it is classified as a primary navigation page in the baseline forensic report.
- Tab/master-detail child/dialog/action/alias/internal-view alternative: NOT VERIFIED; do not consolidate from page title alone.
- Canonical candidate: `parties` unless a later owner decision records another home.

# 19. Acceptance Criteria

- A user with the declared permission can open `parties` through the visible navigation and see a non-error page-specific surface.
- The page exposes only actions whose permission, API/domain handler, required inputs, persisted result, and next state are documented and server-authorized.
- The page distinguishes LOADING, READY, EMPTY, DENIED, VALIDATION_ERROR, SERVER_ERROR, and SUCCESS in a real browser.
- A scoped browser test proves the named Customers &amp; Suppliers workflow; the current 231/231 click audit is route activation evidence only.

# 20. Test Evidence

- **REAL_BROWSER_VISIBLE_UI:** docs/autopilot/evidence/NAVIGATION-RECOVERY-1-click-audit-all.json — authenticated Chromium visible click audit; 231/231 primary navigation items passed, including this page.
- **STATIC:** docs/review/PAGE_INVENTORY.json and docs/navigation/NAVIGATION_FORENSIC_REPORT.json.
- **API / DOMAIN:** tests/build-05/platform-services-lifecycle.test.mjs, tests/build-06/commercial-operations-lifecycle.test.mjs, tests/build-07/mdg-dq-lifecycle.test.mjs, tests/checkpoint-f/atomicity_and_idempotency.test.mjs, tests/checkpoint-f/cross_domain_record_integrity.test.mjs, tests/checkpoint-g/disposable_backup_restore.test.mjs, tests/checkpoint-g/multi_process_concurrency.test.mjs, tests/checkpoint-h/http_legacy_writer_refusal.test.mjs
- **REAL_BROWSER_DIRECT:** NOT VERIFIED; no direct action lifecycle proof is attributed here.

# 21. Known Limitations

- This catalog is a forensic specification at baseline 25c24df753962bbf3c13301eed71624bc0ee39b6; it does not describe uncommitted engineering changes.
- Navigation activation is not functional, permission-isolation, lifecycle, or persistence proof.
- Table/entity ownership is intentionally left NOT VERIFIED unless exact source evidence is available.


# 22. Source Evidence

- `views/customers_and_suppliers.html`
- `index.html`
- `services/permissionService.js`
- `docs/review/PAGE_INVENTORY.json`
- `docs/navigation/NAVIGATION_FORENSIC_REPORT.json`

# 23. Change History

- 2026-08-14 — catalog created from baseline 25c24df753962bbf3c13301eed71624bc0ee39b6.
- Future reconciliation must append the Product Recovery SHA and preserve the AS-IS/TARGET separation.

## CAPABILITIES OWNED

- Customers &amp; Suppliers workspace presentation and its explicitly verified page-specific actions: NOT VERIFIED, NOT VERIFIED, closeCsPartyModal(), closeCsPartyModal(), NOT VERIFIED.

## CAPABILITIES CONSUMED

- Navigation activation, declared page permission gate, and any API paths listed in the front matter. Exact domain capabilities: NOT VERIFIED where no backend path was found.
