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
