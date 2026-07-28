# Checkpoint D/E — exact handoff

Written at the end of the D2 session so the next session resumes without
re-deriving anything.

## Where things stand

| Checkpoint | Scope | Status |
|---|---|---|
| **D1** | Projects and project costing | **COMPLETE** — commit `5f18230`, published |
| **D2** | Engineering, BOM, Routings, Work Centers, MRP | **COMPLETE** — commit `72faccd`, published |
| D3 | Manufacturing orders, work orders, shop floor, WIP, production costing | **NOT STARTED** |
| D4 | Quality, subcontract manufacturing | **NOT STARTED** |
| E1 | Assets | **NOT STARTED** |
| E2 | Maintenance | **NOT STARTED** |
| E3 | Fleet and telemetry adapters | **NOT STARTED** |

Branch: `build/octagon-projects-manufacturing-assets-maintenance-fleet`
Local == remote == `72faccda3f5700be6a80d0de8fb51422f71fcace`.

**Migration tip is 053.** Next migration is **054**. Do not edit 001–053.

## Start here next session

1. `git status` (expect clean apart from prior-phase browser artifacts, which
   are regression byproducts and must NOT be committed).
2. `node --test "tests/checkpoint-d-e/*.test.mjs"` — expect **50 pass / 0 fail**.
3. Build D3 on migration **054**.

## Everything D3 needs, already built and proven

- **Approved BOM/routing resolution**: `effectiveBomForProduct(db, companyId, productId)`
  and `effectiveRoutingForProduct(...)` in `platform/engineering/`. They return
  only `state='approved'` versions inside their effective dates.
- **Immutability hooks**: call `markBomConsumed(db, companyId, versionId)` and
  `markRoutingConsumed(...)` when a production order consumes a version. They
  stamp `consumed_at`, after which the version can never be edited or
  rejected. Already unit-tested.
- **Standard cost rates**: ONE authority — `project_cost_rates`. Work-centre
  machine rates are already mirrored there with `rate_scope='work_center'`,
  `rate_key=<work_center_id>`. Read labour/machine cost through
  `platform/projects/effort.mjs :: resolveHourlyCost`. **Never read payroll.**
- **Effort facts**: `projects:effort:record` already accepts
  `production_order_id`, `work_order_id`, and `maintenance_order_id` anchors
  and prices from configured rates. D3 should reuse it, not create a new
  labour table.
- **Approved MRP proposals waiting to be executed**: `mrp_proposals` rows in
  state `approved` carry `bom_version_id`, `routing_version_id`, quantity and
  target warehouse. Columns `executed_authority` and `executed_ref` exist and
  are deliberately unset — D3 fills them when it turns a `manufacture`
  proposal into a production order.
- **Finance interfaces (Phase 03, already registered)**:
  `finance_source_fact_schemas` contains `manufacturing_wip_posting`,
  `project_cost_posting`, `stock_issue_posting`, `landed_cost_posting`,
  `asset_depreciation_posting`. Post through
  `postSourceFact(db, ctx, {...})`. **Finance is the only GL writer.**
- **Inventory actions to reuse (never re-implement)**: `stock:move:post`,
  `stock:reservation:reserve|consume|release|reverse`, `stock:receipt:*`,
  `stock:transfer:*`, `stock:delivery:*`, `stock:return:*`,
  `stock:lot:create`, `stock:serial:create`. No direct quant writes.
- **Work items**: `work_items` already has `work_order_ref`, `qc_ref`,
  `maintenance_ref`, `project_ref`. Create via `createWorkItemLifecycle`.
  **Never create a second task table.**
- **Work centres** carry `wip_location_id` and `absorption_account_id` — the
  two things WIP accounting needs.

## Traps that already cost time — do not repeat

1. **`getQuantBalance()` is not an availability figure.** It sums every
   location, and the ledger is double-entry across locations, so a supplier
   receipt nets to zero. For planning/availability use an internal-locations
   only query (`platform/engineering/mrp.mjs :: internalBalance` is the
   reference implementation).
2. **Register the module in `platform_modules` before registering actions** —
   `platform_actions.module_id` has an FK to it. `kind` must be one of
   `core|standard|optional|pack`.
3. **Do not over-declare `input_schema.required`** in a migration. The
   executor enforces it *before* the handler runs, so optional-anchor fields
   must stay out of `required`.
4. **The view-template race.** Any page that is a core `pageMap` entry gets
   `views/<page>.html` hydrated into its host asynchronously. Gate module
   activation on `ensurePageTemplateLoaded(page)` — see
   `modules/canonical-engineering.js`. `tests/checkpoint-d-e/shell_dispatcher.test.mjs`
   enforces this for every canonical module; add new ones to its
   `CANONICAL_MODULES` list.
5. **`app.js` has exactly one `switchPage`.** The D1 report's duplicate claim
   was wrong — see `dispatcher-audit.md`. The only duplicate top-level
   function is `renderAttendanceCalendar` (frozen area, untouched).
6. **Bump the `?v=` cache token** on `app.js` and any changed module in
   `index.html`, or the browser serves a stale copy and your change appears
   not to work.
7. **Page hosts that already exist** for the remaining domains:
   `pageWorkOrders`, `pageQcCenter`, `pageAssets`, `pageEquipment`,
   `pageMachines`, `pageFleet`.

## Verification recipe

```bash
PORT=8093 node scripts/preview-authenticated-server.mjs   # disposable copy
```
Then log in as one of the scoped fixture roles
(`test.manufacturing`, `test.project`, `test.sysadmin`, `test.viewer`, …),
password `OctagonTest!2026#Disposable`. The launcher stages a throwaway
database and refuses to open the operational one.

When adding a fixture role, update the exact roster assertion in
`tests/phase04-finalization/test_auth_fixture.test.mjs` (currently 10).

## Still outstanding across the whole assignment

- Checkpoints D3, D4, E1, E2, E3; migrations 054–060.
- The Checkpoint D/E Puppeteer acceptance runner, screenshots and traces.
  **No screenshot artefacts exist for D1 or D2.** Both were verified live in
  real Chromium over authenticated HTTP with DOM inspection, but nothing was
  captured to disk.
- Dedicated concurrency, failure-injection and rollback suites.
- PostgreSQL execution — blocked: no isolated PostgreSQL runtime here.
- Production backup/restore — not executed, by policy.
- Pre-existing failure `tests/phase02/browser-live-evidence.test.mjs`
  (fails at source commit `6adcd0d` too: 10/12 there, 11/12 here).
- The owner-approved opening-inventory accounting date remains unresolved and
  was not invented.
