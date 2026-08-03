# BUILD-10 — Runtime/Fixture Repair + Frontend Closure

- Branch: `codex/octagon-feature-page-expansion-marathon`
- Executing model: **Claude Sonnet 5** (`claude-sonnet-5`)
- Status: **COMPLETE as of commit `c6fd9bd`.** See the "Frontend closure and final verification"
  section below for the completion evidence. The rest of this file is left as-written for the
  backend-repair checkpoint that came first in the same session lineage - it is accurate history,
  not the final state.

## Frontend closure and final verification (same day, continuation)

After the backend/fixture repair below, the BUILD-10 frontend workspace shell was built out for
real: `modules/build10-workspaces.js` (138 -> 330 lines) and `modules/build10-workspaces.css`
(-> 251 lines) plus 10 new `modules/build10/*.js` files (api, actions, forms, components,
registry, state, and per-domain renderers for boards/devices/fleet/kiosks/offline/telemetry).
All 38 BUILD-10 page ids are now wired into `index.html` navigation (`index.html` `data-page=`
count went 158 -> 196) with matching `services/permissionService.js` metadata. Two backend bugs
surfaced and were fixed along the way: `evaluateGeofenceEvent`/`recordLocationPoint` now resolve
a vehicle from `device_id` via `fleet_device_mappings` when no `vehicle_id` is given (browser
flows drive by device, not vehicle), and migrations 083-085 had briefly gained extra `ACTIONS`
rows for Chromium-test action-id aliases - corrected by reverting those already-accepted files
and moving the aliases into a new additive migration, `086_build10_actions_and_permissions_followup.mjs`
(`dependsOn: ['085_build10_kiosk_operational_boards']`), which is the correct way to extend an
already-accepted migration chain without mutating it.

Final verification, this session:
- `npm.cmd run test:build-10`: **37/37 passed** (all 3 Chromium lifecycle tests pass:
  telematics/trip/geofence, offline PWA batch/conflict/RTL, kiosk boards/permission-denial).
- `npm.cmd run test:build-08`: 17/17 passed.
- `npm.cmd run test:build-09`: 34/34 passed.
- `npm.cmd run test:permissions`: 39/39 passed (after bumping the sidebar-coverage baseline
  158 -> 196 in `scripts/permission-regression.mjs` - a legitimate count move from BUILD-10's 38
  new pages, same pattern as BUILD-09's 126 -> 158 move; both the total and 100%-mapped-coverage
  assertions moved together, confirming no unmapped page was introduced).
- `npm.cmd run test:migration`: 5/5 passed (migration 086 accepted correctly on top of 081-085).

BUILD-10's own completion gate (device lifecycle, fleet telematics lifecycle, offline lifecycle,
kiosk lifecycle, 38-page matrix, known failure repaired, canonical runtime context) is met.
BUILD-11 is the next eligible task.

---

## Original backend/fixture-repair checkpoint (first part of this session, before the above)

- Status at the time of writing: **IN_PROGRESS, not COMPLETE.** This session repaired the
  backend/domain-layer gaps BUILD-10 had accumulated since its own implementation session, and
  got the 6 real cross-domain scenarios green for the first time. It did **not yet** build the
  BUILD-10 frontend workspace shell, which was still a stub at this point - see "not done" below
  (since resolved; see the section above).

## Context

The dispatching mega-prompt for this session named one known BUILD-10 failure
(`fleetMapping.mapDeviceToVehicle is not a function`). Investigating it surfaced a much larger,
previously-undocumented reconciliation gap: `tests/build-10/cross-domain-scenarios.test.mjs` and
`tests/build-10/browser-harness.mjs` were written against function names, argument shapes, and
even return-field names that never matched what `platform/iot/*.mjs`, `platform/offline/*.mjs`,
and `platform/kiosk/*.mjs` actually implement. This was never one typo; it was systemic drift
across ~10 files that had apparently never been run to green.

## What this repairs (real, verified)

- **`platform/kernel/actions/domain-handler.mjs`**: the shared action-executor binder was calling
  every domain handler as `handler(dialect, scopedInput)` — 2 arguments only. Handlers written as
  `(db, input, ctx)` (all of BUILD-10 Slice 2/3, `platform/offline/*`, `platform/kiosk/*`) received
  `ctx === undefined` and crashed on `ctx.company_id` the moment they were invoked through the real
  action executor (HTTP/browser path) rather than called directly in a Node test with a hand-built
  ctx object. Fixed to pass the same trusted, scoped object as both `input` and `ctx` -
  backward-compatible for every existing 2-arg `(db, input)` handler (JS ignores the extra
  argument), and a real fix for every 3-arg handler across every domain that uses this binder
  (BUILD-01 through BUILD-14, not just BUILD-10). Verified via the full BUILD-08 regression
  (17/17, unaffected) plus BUILD-09/permissions regression (see below).
- **`platform/iot/index.mjs`**: Slice 3 fleet-telematics functions (`mapFleetDevice`,
  `calibrateOdometer`, `recordLocationPoint`, `startTrip`, `endTrip`, `createGeofence`,
  `evaluateGeofenceEvent`, `acknowledgeGeofenceEvent`, `recordSpeedEvent`,
  `acknowledgeSpeedEvent`, `recordFuelReading`, `investigateFuelAnomaly`,
  `evaluateMaintenanceTrigger`, `acknowledgeMaintenanceTrigger`) existed as real, tested domain
  logic (`tests/build-10/fleet-telematics-geofences.test.mjs` already covered them at the
  function-call level) but were never registered with `registerIotActions()` - meaning none of
  them were reachable through the action executor, the HTTP API, or the browser UI. Registered
  under new `iot:fleet_*`, `iot:location_point_record`, `iot:trip_*`, `iot:geofence_*`,
  `iot:speed_event_*`, `iot:fuel_*`, `iot:maintenance_trigger_*` action ids.
- **`platform/iot/firmware-config.mjs`**: added `evaluateConfigDrift(db, input, ctx)` - genuinely
  did not exist. Compares a `iot_config_profiles.desired_config_json` against caller-supplied
  `current_parameters` and returns `{hasDrift, driftDetails}`. Not registered as an action (matches
  the existing pattern where pure evaluation/read functions like `listXxx` aren't action-bound).
- **`platform/kiosk/kiosk-registry.mjs`**: added `evaluateKioskActionPermission(db, input, ctx)` -
  genuinely did not exist. Checks a kiosk's stored `allowed_actions_json` and active status.
- **`platform/offline/sync-engine.mjs`**: `pushOfflineSync` looped over a command batch calling
  `queueOfflineCommand` with no try/catch, so one disallowed action (e.g. `finance:post_gl`) threw
  and aborted the *entire* batch instead of rejecting just that item - contradicting the
  batch-sync contract every other function in this file implements (accepted/conflict/rejected
  counts). Fixed to catch per-command errors, track `rejectedCount`, and return a new `results[]`
  array (`{localTempId, status, reason|serverMappedId|conflictId}` per item). Additive field; the
  existing `offline-sync-engine.test.mjs` batch test (no disallowed items in its batch) is
  unaffected.
- **`tests/build-10/cross-domain-scenarios.test.mjs`**: all 6 scenarios rewritten to call the real
  exported functions with their real argument shapes and real return fields (not renamed to a
  parallel/aliased API - the functions themselves were already correct; the test was wrong).
  `npm.cmd run test:build-10` scenario file: **6/6 passing** (was 0/6 - all 6 failed before this
  session, not just the 1 the dispatching prompt named).
- **`tests/build-10/browser-harness.mjs`**: `seedOperationalFacts` fixed to call
  `mapFleetDevice`/`registerOfflineClient`/`registerKiosk` with real field names and a valid
  `kiosk_type` (schema only allows `employee|warehouse|shopfloor|service`, not the `fleet` the
  fixture used). This stops the Chromium harness from crashing during seed - it no longer crashes,
  but the 3 Chromium tests still fail for an unrelated, larger reason (see below).
- **`tests/build-10/iot-offline-kiosk-export-contract.test.mjs`** (new): asserts the canonical
  exported function name for every `platform/iot`, `platform/offline`, `platform/kiosk` module,
  and that every registered action id binds to a real function. This is the contract test the
  dispatching prompt asked for, to stop this exact class of drift from recurring silently.

## What is genuinely NOT done

- **The BUILD-10 frontend workspace shell is a stub, not a governed UI.**
  `modules/build10-workspaces.js` (138 lines) renders one hardcoded sample row for all 38 pages,
  under a `window.Build10Engine` global. It has no real API calls, no scope awareness, no
  loading/empty/error/denied states, no board-specific layouts, no action dialogs, and
  `window.switchPage` in the Chromium test harness is a no-op - so any Chromium test that waits
  for a page to become `.page-active` times out (confirmed: all 3 browser tests now time out at
  ~33s instead of crashing at ~2s, which is worse wall-clock but proves the seed fix worked and
  isolates the real remaining gap to the frontend). `tests/build-10/build10-workspaces-contract.test.mjs`
  (3 tests) documents the actual contract this file needs to meet: real `/api/v1/iot/` +
  `/api/v1/action/` calls, `activeCompany`/`activeWarehouse` scope, `PermissionService.checkPage`,
  `octagon:language-changed` handling, CSV export, `.b10-board*` grid layouts for the 8 board/kiosk
  pages, RTL, a 760px responsive breakpoint, and per-page `data-phase=error` status states.
  None of the 38 BUILD-10 page ids appear anywhere in `index.html`'s navigation (`grep -c
  "fleet_device_mapping\|kiosk_device_registry" index.html` → `0`) despite an earlier commit in
  this branch's history (`8a9d9c8 feat(build10): wire 38 workspaces into shell UI, navigation,
  and permission service`) claiming to have done so - only `services/permissionService.js`'s
  page-metadata entries (38/38 present) actually landed from that commit.
- Building this out to the standard BUILD-09R-2 set for its 2 pages (bespoke layout, real API
  wiring, real-click Chromium proof) - scaled to 38 pages across device/fleet/offline/kiosk/board
  categories - is a genuinely large, separate frontend implementation task. This session did not
  attempt to force it by writing a shallow version that wouldn't meet the existing contract test's
  bar, since that contract test is already specific and already correct - it should stay red until
  the real implementation lands, not be weakened to pass.
- `test:build-10` non-Chromium file count: **31/34 passing** (3 failures are exactly the
  workspaces-contract file above). The 3 Chromium browser tests are unresolved (frontend gap, not
  re-tested to completion after the seed fix due to ~33s-per-test timeouts against a stub UI that
  will never satisfy them).

## Executable evidence

- `node --test tests/build-10/cross-domain-scenarios.test.mjs`: 6/6 passed (was 0/6).
- `node --test tests/build-10/iot-offline-kiosk-export-contract.test.mjs`: 2/2 passed (new).
- `node --test --test-concurrency=1` over all non-Chromium `tests/build-10/*.test.mjs`: 31/34
  passed (3 known workspaces-contract failures, documented above).
- `npm.cmd run test:build-08`: 17/17 passed, unaffected by the shared `domain-handler.mjs` change.
- BUILD-09 and permission regressions: run after this evidence file was written; see
  `STATE.json`/`QUEUE.json` for the recorded result.

## Recommendation for continuation

A follow-up session should build the real `modules/build10-workspaces.js` (and its CSS) against
the exact contract in `build10-workspaces-contract.test.mjs`, wire the 38 page ids into
`index.html` navigation, then re-run and fix the 3 Chromium lifecycle tests in
`operational-browser-chromium.test.mjs`. Only after that should BUILD-10 be marked COMPLETE.

## Safety

Operational data, Telegram, frozen VNext, `main`, and payroll/attendance/timesheet were untouched.
Changes are additive/corrective within `platform/iot/*`, `platform/offline/sync-engine.mjs`,
`platform/kiosk/kiosk-registry.mjs`, `platform/kernel/actions/domain-handler.mjs`,
`tests/build-10/*`. No migrations, no schema changes, no destructive git operations.
