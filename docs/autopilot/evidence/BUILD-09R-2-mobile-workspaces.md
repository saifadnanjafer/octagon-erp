# BUILD-09R-2 — Mobile Receiving / Mobile Picking Purpose-Built Workspaces

- Branch: `codex/octagon-feature-page-expansion-marathon`
- Starting SHA (this session): `241a735db060d3a8eb79ce9c4e366f9d07f16bb3`
- SHA at time of writing: `3cfb2af67453f684c443ba3e6b8af29067e05919`
- Executing model: **Claude Sonnet 5** (`claude-sonnet-5`)
- Status: **IN_PROGRESS, not COMPLETE.** This directly continues the recommendation at the
  end of `BUILD-09R-runtime-and-forms-remediation.md` ("consider whether 2 of the 32 pages
  warrant a genuinely distinct mobile-scanning layout"). Only 2 of the ~19 workspaces the
  BUILD-09R-2 brief describes are done; see "not done" below.

## What this delivers

`modules/build09-mobile-receiving.js` and `modules/build09-mobile-picking.js`: real
step-by-step scanning workspaces for the `mobile_receiving` and `mobile_picking` pages,
replacing the generic table+dialog shell those two pages previously shared with the other
30 BUILD-09 pages. Both are wired in via a new `registerPageOverride()` hook on
`window.OctagonBuild09` (`modules/build09-workspaces.js`) rather than forked into
`renderPage()`/`fetchRows()`, so the other 30 pages are unaffected and the generic shell
stays available if a future page needs it.

Receiving flow: start session -> confirm reference -> scan product (barcode + governed
product/location lookup, expected-vs-received quantity, lot/serial, discrepancy flag) ->
review -> request canonical posting (creates the canonical picking via `wms:picking:create`,
`wms:receiving_request_post`) -> acknowledge once Inventory has validated it -> complete.

Picking flow: task queue (self-assign) -> scan source location -> scan product -> confirm
quantity (short-pick reason required when under-picking) -> stage -> request canonical
posting (`wms:pick_request_post`) -> acknowledge with a `canonical_result_id` text field
(same precedent already used by `shopfloor:material_acknowledge` /
`quality:scrap_acknowledge` in `modules/build09-action-forms.js` - the caller is not
expected to have a raw-ID-free way to know a cross-authority move id it didn't create
itself) -> completed.

Neither introduces a new receipt, picking, or stock authority; both only call the existing
governed WMS/Inventory actions.

## Bugs found and fixed along the way (not just the two new pages)

Driving these two pages through **real clicks** for the first time (previous BUILD-09R work
proved ~8 forms via real clicks; the rest were proven structurally, not by clicking) surfaced
two latent, previously-undetected bugs in `modules/octagon-governed-lookups.js` that affect
every consumer of the shared lookup, including the pre-existing generic action-form dialog:

- `products` search resolved to the product **template** id, not the **variant** id every
  WMS/production/quality action actually expects (`getProducts` in
  `platform/commercial/products.mjs` aliases `v.id as variant_id` but then spreads `t.*`,
  which still contains the template's own `id`). Selecting a product via the governed lookup
  silently submitted the wrong id.
- `locations` search resolved to **no id at all** (`listLocations`'s `mapProfile` in
  `platform/wms/topology.mjs` only returns `locationId`, never `id`). Every location `<select>`
  populated by the governed lookup - in the two new pages and in the pre-existing generic
  dialog forms that also use `lookup(..., 'locations')` - was rendering `<option value="">`
  for every real option. This one predates this session and was never caught because no
  prior real-Chromium test drove a location lookup through an actual select.

Both fixed in `modules/octagon-governed-lookups.js` with an explicit, narrow
`ID_FIELD_BY_KIND` map for the two kinds actually verified; other `WMS_RESOURCES` kinds are
untouched and unaudited (flagged in a code comment, not silently assumed fixed).

## Executable evidence

New real-Chromium test (`tests/build-09/mobile-receiving-picking-browser.test.mjs`) drives
both workspaces through actual `page.type`/`page.select`/`page.click` and governed-lookup
search (not `page.evaluate(fetch(...))`), asserting the resulting DB rows, not just DOM
state. `operational-32-page-matrix-chromium.test.mjs` updated so its 32-page walk checks
these two pages' own body/status instead of the generic `[data-role="status"]` paragraph
they intentionally no longer touch.

- `npm.cmd run test:build-09` (serial): **34/34 passed** (was 32/32; +2 new tests), including
  8 real Chromium flows (was 6).
- `npm.cmd run test:build-08`: 17/17 unaffected.
- `npm.cmd run test:permissions`: 39/39 unaffected.

## What is genuinely NOT done (do not mark BUILD-09R or BUILD-09R-2 COMPLETE without these)

- **17 of the ~19 workspaces** the BUILD-09R-2 brief lists for deepening (Putaway Task Queue,
  Wave Planning/Execution, Cycle Count, Traceability, Recall, Shop-Floor Terminal,
  Work-Center Queue, Production Material Requests/Issue-Return/Receipt, Quality Hold Queue,
  Rework, Scrap Approval, Downtime Board, Operational Performance Dashboard) still share the
  generic table+dialog shell. Only `mobile_receiving` and `mobile_picking` got bespoke
  layouts this session.
- **Real-click action coverage**: this session adds real-click proof for the mobile
  receiving/picking actions specifically (session/task lifecycle, scan, review, stage,
  request-post). The ~30-action target in the BUILD-09R-2 brief spans many actions on the 17
  pages above that were not touched.
- **Dedicated BUILD-09R-2 scope-isolation tests** (company/branch/warehouse cross-tenant
  denial, stale-preference discard, role-based action denial beyond what
  `wms-governance-contract.test.mjs` already covers): not added this session.
- **BUILD-10 and BUILD-11**: not started. A single mega-prompt in this session asked for
  BUILD-09R-2 completion, BUILD-10 closure, and a substantial BUILD-11 SaaS/commercial
  platform core in one unsupervised run; that is a multi-day scope that cannot honestly be
  delivered to real quality in one sitting, and this session did not attempt to force it by
  padding line counts or fabricating completion. BUILD-10's known `fleetMapping
  .mapDeviceToVehicle` failure (noted in the prior evidence file) is unchanged.

## Recommendation for continuation

A follow-up session should pick the next-highest-traffic pages from the list above (Wave
Planning/Execution and Cycle Count are good next candidates given their existing
cross-domain test coverage) and repeat this session's pattern: bespoke layout, real-click
Chromium proof, and treat any governed-lookup id mismatch found along the way as a
same-session fix rather than deferred debt, since it silently breaks the pre-existing generic
dialogs too. Only after the workspace-deepening and real-click-coverage items above are
substantially addressed should BUILD-09R be marked COMPLETE and BUILD-10 begin.

## Safety

Operational data, Telegram, frozen VNext, `main`, and payroll/attendance/timesheet were
untouched. Changes are additive/corrective within `modules/build09-*.js`,
`modules/octagon-governed-lookups.js`, `tests/build-09/*`, and `index.html` script/style
tags. No migrations, no schema changes, no destructive git operations.
