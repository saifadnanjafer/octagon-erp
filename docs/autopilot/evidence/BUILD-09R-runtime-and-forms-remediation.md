# BUILD-09R — BUILD-09 Usability Remediation Evidence

- Branch: `codex/octagon-feature-page-expansion-marathon`
- Starting SHA (this session): `85a18cf875489847acf1482bb6fb88fd617f6edf` (`test(build09r): preserve WMS permission compatibility contract`)
- SHA at time of writing: `649ad551a569b4ad1ac157fa36628d57fa9bb2d1`
- Executing model: **Claude Sonnet 5** (not Kimi 3 / "Sonnet 5 Extra" as some dispatch prompts for this task assumed — corrected rather than fabricated)
- Status: **IN_PROGRESS, not COMPLETE.** Substantial, verified progress on the real root causes; genuine gaps remain (below) and the numeric delivery floor requested for this task (2,500+ changed lines, 25-30 files, 6+ commits) is not yet fully met — 5 commits, ~810 changed lines (727 insertions + 79 deletions, `git diff --stat 85a18cf..649ad55`), 16 files. Reported honestly rather than padded to hit the number.

## What this remediates

BUILD-09 shipped 32 WMS/shop-floor/quality operational workspaces. Three prior `build09r` commits (`67642f9`, `39f3541`, `85a18cf`, already on this branch before this session) made a first, partial attempt at the fixes this task describes, but were themselves an incomplete prototype: a 33-line runtime-context stub, a 9-line action-form registry that gave all 46 actions it covered the same three fake fields (`reference`/`quantity`/`reason_code`), and one static source-pattern test file.

## Root cause found and fixed (this was the actual reason every page showed "select a warehouse")

`modules/octagon-runtime-context.js` exposed only `{ready, refresh, setWarehouse, subscribe, snapshot}` on `window.OctagonRuntimeContext`. Every BUILD-09 page (`modules/build09-workspaces.js`) read `companyId`/`warehouseId`/`availableWarehouses`/`permissions` as **direct properties** on that object — which never existed outside the module's private closure state. Every page always read `undefined` for the warehouse and showed the same generic "Select a warehouse before loading" error, regardless of real session/company/warehouse state. This is the literal defect the original BUILD-09R brief describes (mismatched bootstrap contract) — freshly reintroduced between two *new* files instead of old-vs-new code.

A second, compounding bug: `workspaceMarkup()` rendered the warehouse control as a plain `<input>`, while `renderPage()`'s population code (`.innerHTML = '<option>...'`) assumed it was a `<select>` — a silent no-op on an `<input>` either way.

Both fixed in commit `028c07f`. Verified via `tests/build-09/operational-32-page-matrix-chromium.test.mjs`, which walks all 32 pages in a real browser and asserts the warehouse `<select>` is actually populated on every one.

## Work done, by commit (all pushed; local SHA = remote SHA verified after each push)

1. **`028c07f` fix(build09r-runtime)** — the root-cause fix above; wired real permission resolution into the `/api/v1/runtime/context` endpoint (`permissions` was hardcoded to `[]`) via a new `PermissionEvaluator.listPermissions()` that reuses the existing `evaluate()` decision path (no parallel security logic); made client-side `canWrite()` per-action against the real `platform_actions.required_permission` values instead of one blanket toggle.
2. **`246c88b` fix(build09r-forms)** — an Explore-agent audit traced all 70 action ids referenced across the 32 pages to their real server handlers and found **every one** had wrong field names (form used READ-side camelCase; handlers read snake_case `input.*` directly) plus ~20 with missing required fields or fields the handler silently ignores. Rebuilt the full registry against verified contracts. Added honest, page-specific empty-state messages to all 32 pages (was one generic message for all of them) and optional status-style filters to 21 pages.
3. **`671a354` fix(build09r-lookups)** — building a real UI-driven Chromium test surfaced that `products`, `workOrders`, and `productionOrders` governed-lookup fields were routed to `/api/v1/wms/*`, which 404s for them (they live under `commercial`/`manufacturing` namespaces); fixed routing, added a real `operators` source (`/api/auth/options`, since no dedicated operators query resource exists anywhere in the API), and corrected `quality:checkpoint_open`'s `source_type` value domain.
4. **`51d8dba` test(build09r)** — a structural contract test that loads the real form registry and asserts every page-referenced action has a real form and a real permission mapping (this would have caught the original id-mismatch bug on the first run); the required 32-page real-browser matrix.
5. **`649ad55` feat(build09r-scope)** — extracted the shared company/branch/warehouse scope selector component (`modules/octagon-scope-selector.js`) with loading/no-access/no-warehouse/populated states, replacing per-page inline duplication; bumped `index.html`'s cache-busting `?v=` for every module actually changed this arc (none of the prior 4 commits had touched `index.html`, so a browser with any of these cached would have kept serving stale code).

## Executable evidence

`npm.cmd run test:build-09`: **32/32 passed**, serial, including **6 real Chromium browser tests** (was 2 before this session):
- Runtime context: single-warehouse auto-selection reaching the DOM, explicit-selection persistence, stale/invalid-preference recovery after reload.
- Topology: clicks the real "Create Zone" / "Create Location" dialogs, types into the governed zone lookup, selects a result, submits, verifies the DB row and that the location's `zone_id` matches the zone picked via the lookup.
- Production + quality: opens a shop-floor session and runs it through `operation_start` via the real dialog (governed work-order and session lookups), then opens a quality checkpoint (governed product lookup, corrected `source_type` domain).
- Inbound receiving/putaway and outbound wave/picking (pre-existing, were timing out at 30s before this session's runtime-context fix; now pass in 5-8s).
- **32-page matrix**: every BUILD-09 page activates, gets a populated warehouse scope, reaches a real terminal query phase (not stuck loading), and produces no console error.

`npm.cmd run test:build-08`: 17/17 unaffected. `npm.cmd run test:permissions`: 39/39 unaffected. `npm.cmd run test:build-10`: has one pre-existing failure (`tests/build-10/browser-harness.mjs`: `fleetMapping.mapDeviceToVehicle is not a function`) confirmed via `git stash` against the original commit to be unrelated to this work (zero file overlap) — not touched, per "do not begin BUILD-10."

## What is genuinely NOT done (do not mark this task COMPLETE without addressing these)

- **Numeric delivery floor** (2,500+ lines / 25-30 files / 6+ commits): not met. 5 commits, ~810 changed lines, 16 files. The work done is deep rather than broad — every line changed corresponds to a verified real defect, not padding — but the floor itself is unmet.
- **Real-click proof beyond the 5 flows**: all 70 action forms have verified-correct field names (via the handler-contract audit) and are exercised indirectly by the pre-existing domain test suite's `browserAction()` calls (which now succeed with the corrected field names), but only ~8 actions (`zone_create`, `location_create`, `session_open`, `operation_start`, `checkpoint_open`, plus the pre-existing inbound/outbound flows) have been driven through an actual dialog click-fill-submit in a real browser. The other ~60 forms' *rendering* is covered by the structural contract test, not a live click.
- **Company/branch isolation**: enforced server-side (every BUILD-09 read query checks `company_id`; `wms-governance-contract.test.mjs` already covers this) and exercised implicitly, but this session did not add a dedicated BUILD-09R-specific isolation test beyond what pre-existed.
- **Page-specific bespoke layouts**: all 32 pages now have honest per-page empty states and 21 have status filters, but they still share one generic table+dialog shell rather than fully bespoke per-page UI (e.g. a kiosk-style scanning flow for `mobile_receiving`/`mobile_picking` distinct from the generic table). Section 12's stricter reading ("not near-identical") is partially, not fully, satisfied.
- **`docs/autopilot/prompts/BUILD-09R-*.md`**: no formal prompt file was authored for this task (unlike BUILD-01 through BUILD-09, which each have one); this evidence file is the record instead.

## Recommendation for continuation

A follow-up session (`BUILD-09R-2` or similar) should: (1) drive 10-15 more of the highest-traffic forms (receiving, picking, wave, count) through real clicks the way the topology/production flows were; (2) consider whether 2 of the 32 pages (`mobile_receiving`, `mobile_picking`) warrant a genuinely distinct mobile-scanning layout instead of the shared table; (3) reconcile the BUILD-10 QUEUE.json gap noted in STATE.json (8 real commits landed but never marked) — a separate, pre-existing issue this session found but did not fix, being out of scope.

## Safety

Operational data, Telegram, frozen VNext, `main`, and payroll/attendance/timesheet were untouched. All changes are additive/corrective within `modules/build09-*.js`, `modules/octagon-*.js`, `platform/api/index.mjs`, `platform/authorization/evaluator/index.mjs` (one new backward-compatible method), `tests/build-09/*`, and `index.html` script tags. No migrations, no schema changes, no destructive git operations.
