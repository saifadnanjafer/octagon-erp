# Visible Expansion Test-Suite Register

## Checkpoint C1

| Suite | Coverage | Result |
|---|---|---:|
| `migration_046.test.mjs` | fresh/sequential/rerun/down-up/failure atomicity | 4/4 |
| `sales_lifecycle.test.mjs` | lifecycle, activities, policy, revision, partial delivery/backorder, cancellation, reservation, commission, metadata, idempotency, rollback, concurrency, tax, reads | 14/14 |
| `canonical_sales_ui.test.mjs` | mount, 11 tabs, routes, visible lifecycle controls, no legacy fallback, states, responsive CSS, false-save error prevention | 9/9 |
| `test_auth_fixture.test.mjs` | safety guards, identities, grants, isolation, idempotency | 20/20 |
| `checkpoint-c-browser-acceptance.mjs` | authenticated real-Chromium C1 flow and screenshots | 20/20 |
| `tests/phase04-finalization/*.test.mjs` | inherited canonical client/master-data/Inventory regression | 99/99 |
| `scripts/permission-regression.mjs` | 102/102 sidebar pages mapped plus role/action policy | 35/35 |
| `scripts/precommit.js` | blocked-path and repository safety gate | PASS |

Counts are not double-counted across rows.

## Checkpoint C2

| Suite | Exact command | Result | Duration | What it proves |
|---|---|---:|---:|---|
| All Checkpoint C | `$files = Get-ChildItem tests/checkpoint-c -Filter '*.test.mjs'; node --test $files` | 44/44 | 10.631s | C1+C2 migrations, lifecycle, atomicity, scope, concurrency, and visible contracts coexist |
| Procurement migration/lifecycle/UI subset | `node --test tests/checkpoint-c/canonical_procurement_ui.test.mjs tests/checkpoint-c/migration_047.test.mjs tests/checkpoint-c/procurement_lifecycle.test.mjs` | 17/17 | 5.131s | C2-specific deterministic proof |
| Phase 04 finalization | `$files = Get-ChildItem tests/phase04-finalization -Filter '*.test.mjs'; node --test $files` | 99/99 | 8.213s | inherited canonical client, auth fixture, master data, WMS, valuation, and rollback regression |
| Permission regression | `node scripts/permission-regression.mjs` | 35/35 | <1s | page map and role/action policy remain intact |
| Authenticated Chromium | `BASE_URL=http://127.0.0.1:8097 node scripts/checkpoint-c-browser-acceptance.mjs` | 42/42 combined; 22/22 C2 | 128.9s | real original-shell admin/role/viewer workflows and responsive UI |
| Precommit | `node scripts/precommit.js` | PASS | <1s | repository and blocked-path safety |

No aggregate and component counts are added together. There were no skipped
tests. Raw Chromium artifacts remain gitignored; reviewed PNGs are registered
separately.

## Checkpoint C3

| Suite | Exact command | Result | Duration | What it proves |
|---|---|---:|---:|---|
| POS migration/lifecycle/UI plus inherited POS contract | `node --test tests/checkpoint-c/canonical_pos_ui.test.mjs tests/checkpoint-c/migration_048.test.mjs tests/checkpoint-c/pos_atomic_lifecycle.test.mjs tests/phase04/canonical_pos.test.mjs` | 14/14 | 6.296s | C3 migration, atomic sale/refund/reconciliation, visible contract, and inherited governed POS behavior |
| All Checkpoint C | `$files = Get-ChildItem tests/checkpoint-c -Filter '*.test.mjs'; node --test $files` | 57/57 | 9.824s | C1+C2+C3 migrations, lifecycle, atomicity, rollback, idempotency, concurrency, and visible contracts coexist |
| Phase 04 finalization | `$files = Get-ChildItem tests/phase04-finalization -Filter '*.test.mjs'; node --test $files` | 99/99 | 11.795s | inherited canonical client, auth fixture, master data, WMS, valuation, and rollback regression |
| Permission regression | `node scripts/permission-regression.mjs` | 35/35 | 0.879s | page map and role/action policy remain intact |
| Authenticated Chromium | `BASE_URL=http://127.0.0.1:8097 node scripts/checkpoint-c-browser-acceptance.mjs` | 58/58 combined; 16/16 C3 | recorded in trace | real original-shell terminal/session/sale/receipt/refund/reconciliation workflows, role denial, and responsive UI |
| Precommit | `node scripts/precommit.js` | PASS | 1.117s | repository and blocked-path safety |

The aggregate initially exposed that the older C2 migration test assumed 047
would remain the newest file. Its fixture now explicitly stages the migration
set through 047, preserving the intended sequential-upgrade contract after 048
was added. The corrected aggregate is 57/57 with no skipped tests.

## Checkpoint C4

| Suite | Exact command | Result | Duration | What it proves |
|---|---|---:|---:|---|
| C4 migration/lifecycle/UI plus inherited Work Item contract | `node --test tests/checkpoint-c/canonical_work_management_ui.test.mjs tests/checkpoint-c/migration_049.test.mjs tests/checkpoint-c/work_item_lifecycle.test.mjs tests/phase04/canonical_work_items.test.mjs` | 17/17 | 8.648s | migration, nine views, identity-scoped My Tasks, relations, lifecycle, recurrence, SLA, rollback and concurrency |
| All Checkpoint C | `$files=Get-ChildItem tests/checkpoint-c -Filter '*.test.mjs'; node --test $files` | 73/73 | 12.417s | C1-C4 deterministic coexistence, atomicity, idempotency, company scope and visible contracts |
| Phase 04 finalization | `$files=Get-ChildItem tests/phase04-finalization -Filter '*.test.mjs'; node --test $files` | 99/99 | 12.733s | inherited canonical client, fixture, master-data, WMS, valuation and rollback regression |
| Permission regression | `node scripts/permission-regression.mjs` | 35/35 | <1s | 102 mapped pages and role/action policy |
| Authenticated Chromium | `BASE_URL=http://127.0.0.1:8097 node scripts/checkpoint-c-browser-acceptance.mjs` | 73/73 combined; 15/15 C4 | 251.8s | original-shell C1-C4 workflows, role enforcement, RTL/LTR and responsive UI |
| Precommit | `node scripts/precommit.js` | PASS | <1s | repository and blocked-path safety |

An incorrect attempted command, `node scripts/precommit-check.mjs`, failed
because that file does not exist. The repository's actual gate is
`scripts/precommit.js`; it passed. No test was weakened and no suite count is
double-counted.

A later screenshot replay reused an already-mutated staging copy and failed
only the POS cash expectation (72/73). The disposable copy was discarded; the
registered fresh-staging rerun passed 73/73. The failed run is not counted.

## Checkpoint C5

| Suite | Exact command | Result | Duration | What it proves |
|---|---|---:|---:|---|
| C5 Administration, migration, domain and inherited Control Plane | `node --test tests/checkpoint-c/canonical_administration_ui.test.mjs tests/checkpoint-c/migration_050.test.mjs tests/checkpoint-c/control_plane_administration.test.mjs tests/unit/control-plane.test.mjs` | 20/20 | 15.498s | 19 areas, scoped reads, no secrets, module/feature/job/license actions, access denial/recovery, dependencies, idempotency and rollback |
| All Checkpoint C | `$files=Get-ChildItem tests/checkpoint-c -Filter '*.test.mjs'; node --test $files` | 92/92 | 12.365s | C1-C5 deterministic coexistence and migration sequencing |
| Phase 04 finalization | `$files=Get-ChildItem tests/phase04-finalization -Filter '*.test.mjs'; node --test $files` | 99/99 | 12.267s | inherited canonical client, auth fixture, master data, WMS, valuation and rollback regression |
| Permission regression | `node scripts/permission-regression.mjs` | 35/35 | <1s | 102 mapped pages and role/action policy |
| Authenticated Chromium | `BASE_URL=http://127.0.0.1:8097 node scripts/checkpoint-c-browser-acceptance.mjs` | 90/90 combined; 17/17 C5 | 298.0s | module assignment, navigation, server denial/recovery, licensing, feature, health, roles, RTL/LTR and responsive UI |
| Precommit | `node scripts/precommit.js` | PASS | <1s | repository and blocked-path safety |

The first aggregate produced 91/92 because the older migration 049 test assumed
049 remained the repository tail. It now verifies migration 049 by ID, as the
048 test already does. The fresh rerun passed 92/92; no assertion about 049's
own schema, provenance, rollback, or sequencing was removed.

## Checkpoint C6 final register

| Suite | Exact command | Result | Duration |
|---|---|---:|---:|
| Phase 01 | exact migration-runner plus `tests/unit/*.test.mjs` list | 10/10 outer; 80 internal | 37.7s |
| Phase 02 non-browser | Phase 02 files excluding live browser | 10/10 outer; 200 internal | 137.0s |
| Phase 02 Chromium | `node --test tests/phase02/browser-live-evidence.test.mjs` | 12/12 | 205.7s |
| Phase 03 non-browser | Phase 03 files excluding Finance browser | 11/11 outer; 138 internal | 88.8s |
| Phase 03 Chromium | `node --test tests/phase03/finance-browser-evidence.test.mjs` | 9/9 | 149.1s |
| Phase 04 | `$files=Get-ChildItem tests/phase04 -Filter '*.test.mjs'; node --test $files` | 47/47 | 25.9s |
| Phase 04 finalization | `$files=Get-ChildItem tests/phase04-finalization -Filter '*.test.mjs'; node --test $files` | 99/99 | 9.2s |
| Checkpoint C | `$files=Get-ChildItem tests/checkpoint-c -Filter '*.test.mjs'; node --test $files` | 100/100 | 24.5s |
| Permission regression | `node scripts/permission-regression.mjs` | 35/35 | 1.1s |
| Checkpoint C Chromium | `$env:BASE_URL='http://127.0.0.1:8097'; node scripts/checkpoint-c-browser-acceptance.mjs` | 90/90 | 333.6s |
| Precommit | `node scripts/precommit.js` | PASS | 3.3s |

No skipped tests and no aggregate/component double counting. An incorrect
empty Phase 01 file list triggered broad discovery and unrelated legacy-script
failures; that run is rejected and not counted. The exact Phase 01 list was
rerun green.
