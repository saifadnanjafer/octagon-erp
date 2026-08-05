# BUILD-09R-2 — high-value operational page pack (2026-08-05)

Seven purpose-built workspace groups replacing the generic table+dialog shell on the highest-value
BUILD-09 operational pages, plus a shared workspace kernel, the defect fixes found along the
way, and 17 new real-Chromium tests.

**Branch:** `codex/octagon-feature-page-expansion-marathon`
**Start:** `ba2202af09ee310082cea04492ba013726a692c1`
**End:** see STATE.json `last_reconciled`

## Dispatch note — the prompt's premise was stale

The dispatching prompt named `d74c3bfc` as the starting SHA and described BUILD-10's frontend as
an unbuilt 138-line stub with 3 red workspace-contract tests and 3 red Chromium lifecycle tests.
The remote was already 6 commits ahead of that, and those commits had built it. This session
verified rather than assumed: `npm.cmd run test:build-10` reported **37/37 including all three
Chromium lifecycle tests**, `modules/build10-workspaces.js` is 330 lines over a real
`modules/build10/*` tree, and the 38 page ids are genuinely present in `index.html` navigation.

BUILD-10 was therefore already COMPLETE and was left alone. Per the dispatching prompt's own
priority ladder (§31), the remaining unfinished work was Phase G — the BUILD-09R-2 high-value
page pack — and that is what this session delivered. BUILD-11 was not started.

## What shipped

`modules/build09r-shared.js` — shared workspace kernel. Bilingual/RTL rendering, a guarded
single-flight action caller that classifies 403 / maker-checker as an honest denied panel rather
than an unhandled rejection, governed-lookup wiring, and the KPI / progress / stepper / field
primitives, so all seven groups read as one product instead of seven separately-grown pages.

| Group | Pages | Defining behaviour |
|---|---|---|
| A | `wave_planning`, `wave_execution` | Real pick-task pool with in-place selection (a repaint would wipe the grouping-rule form); wave maker-checker refusal surfaced, not hidden |
| B | `cycle_count_plans`, `count_session`, `variance_review` | Blind counts stay blind; variance proposes a REQUEST_ONLY canonical adjustment and moves no stock |
| C | `lot_serial_traceability`, `recall_analysis` | Backward and forward chains as distinct panels; every recall output labelled a proposal |
| D | `shopfloor_terminal`, `workcenter_queue` | Terminal refuses to claim a transition canonical Manufacturing has not made |
| E | `quality_hold_queue`, `rework_workspace`, `scrap_approval` | Approval is a second person; Quality never moves stock |
| F | `downtime_board`, `operational_performance` | A rate with no evidence renders "not available", never 0% |
| G | `dock_schedule`, `dock_checkin`, `staging_board`, `crossdock_workspace` | One physical flow: a per-dock timeline, a gatehouse with a live detention clock, lane capacity meters, and cross-dock matching that requests rather than moves |

**20 of 32** BUILD-09 pages are now purpose-built (18 this session + the 2 mobile workspaces from
the prior session). The remaining 12 are pinned by name in
`tests/build-09/build09r2-bespoke-contract.test.mjs` as the honest backlog.

### Group G note — the dock group is deliberately one group

Dock Schedule, Dock Check-In, Staging Board and Cross-Dock are four pages describing one physical
sequence: a vehicle is booked against a dock, arrives and is checked in, is assigned and serviced,
its stock lands in a capacity-bounded staging lane, and part of it may cross-dock straight onto an
outbound appointment instead of being put away. Building them together let the four share one
appointment model and one set of status semantics rather than four drifting interpretations.

Two things were corrected while building, both worth recording:

- **The timeline was positioning blocks by UTC while every other timestamp on the page rendered in
  local time.** A 09:00 local booking sat at the 06:00 mark with a tooltip reading 09:00. The day
  bucket and the track offset are now both local, matching the `<input type="date">` the operator
  picks the day with. Caught by asserting the block's actual geometry rather than its presence.
- **Client-side dock-collision highlighting was removed as dead code.** `platform/wms/docks.mjs`
  refuses a colliding window at both `createDockAppointment` and `assignDock`, so two appointments
  cannot occupy one dock; re-deriving that in the browser would be a second, weaker authority that
  could disagree with the server. The refusal is surfaced as the server's own denial instead.

## Defects found and fixed

1. **`listCountSessions` leaked the blind-count snapshot** (`platform/wms/cycle-counting.mjs`).
   `startCountSession` correctly hid `theoreticalQuantity` for a blind count, but the list read
   surface returned it unconditionally — a counter could list the sessions and read the exact
   quantity a blind count exists to withhold. Now withheld while assigned/counting/recount and
   revealed from submission onwards, when variance review genuinely needs it. Found only because
   the UI assertion was strengthened to check the rendered DOM rather than trust the
   start-session response. Covered by a new domain regression test.

2. **The `lots` / `serials` governed pickers were dead** (`modules/octagon-governed-lookups.js`).
   Both were declared as WMS resources, resolving to `/api/v1/wms/lots`, which does not exist —
   the real route is `/api/v1/inventory/lots`. The picker 404d and rendered permanently empty,
   which is why nothing had ever selected a lot through the UI. Now namespaced correctly,
   labelled by `lot_number` / `serial_number` (the raw rows carry no name/code, so the generic
   fallback rendered bare UUIDs), and filtered client-side since those endpoints have no
   server-side search.

3. **A `clickablePoint` test flake** — a `guarded()` repaint can detach an element between
   `waitForSelector` and `click`. Fixed with `clickStable()` in the harness, which retries on a
   fresh handle rather than downgrading to an `evaluate()` click, so the tests still prove the
   control is genuinely clickable.

## Test-integrity notes

Two assertions were passing for the wrong reason and were corrected, which is worth recording
because both would have shipped a false green:

- The harness renders `lang="ar"`, so `Intl` emits Arabic-Indic digits. `assert.doesNotMatch(text, /20/)`
  on a "this quantity must be hidden" check could never fail. `latinDigits()` now folds digits
  before every numeric assertion — and once it did, it immediately exposed defect (1) above.
- A loose `/4/` wait over a whole panel also matched the string `42Nm` in the operator
  instructions, hiding a failed output submit. Numeric assertions now target dedicated counters.

## Verification at the closing commit

```
npm.cmd run test:build-08     17/17
npm.cmd run test:build-09     55/55   (35 baseline preserved + 20 new)
npm.cmd run test:build-10     37/37   (unchanged; BUILD-10 left alone)
npm.cmd run test:permissions  39/39
npm.cmd run test:migration     5/5
```

17 new real-Chromium flows driven through visible controls only (no `page.evaluate(fetch(...))`
counted as UI proof), plus 3 static contract tests and 1 domain regression.

Migrations 081–085 untouched. No operational workshop data, payroll, attendance or timesheet
path was read or written. BUILD-11 not started.

## Remaining BUILD-09R-2 backlog

12 pages still on the generic shell, pinned in the contract test: `warehouse_topology`,
`zone_bin_management`, `putaway_rules`, `putaway_task_queue`, `replenishment_rules`,
`replenishment_proposals`, `receiving_discrepancies`, `pick_task_queue`, `expiration_queue`,
`production_material_requests`, `production_issue_return`, `production_receipt`.

BUILD-09R therefore stays **IN_PROGRESS**. The numeric target for this session was met, but the
chapter is not finished, and marking it COMPLETE on a count rather than on coverage would be
exactly the kind of false closure this evidence trail exists to prevent.
