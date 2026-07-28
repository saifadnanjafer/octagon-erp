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
