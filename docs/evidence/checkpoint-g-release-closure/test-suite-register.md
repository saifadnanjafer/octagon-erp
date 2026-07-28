# Checkpoint G — test suite register

Every suite run **separately**. Counts exactly as reported by `node --test`.
No aggregation across suites, no nested test counted twice.

## Repository suites

| Suite | Command | Exit | Pass | Fail | Skip | Duration | Proves |
|---|---|---|---|---|---|---|---|
| **Phase 02 (serial)** | `npm run test:phase02` | **0** | **11** | **0** | 0 | 816 s | Shell, identity, permissions, RTL/LTR, responsive, session revocation, direct-API denial — **now green in aggregate** |
| Phase 03 | `node --test "tests/phase03/*.test.mjs"` | 0 | 12 | 0 | 0 | 316 s | Finance canonical cutover |
| Phase 04 | `node --test "tests/phase04/*.test.mjs"` | 0 | 47 | 0 | 0 | 27 s | Phase 04 canonical domains + mid-flight finance-port rollback |
| Phase 04 finalization | `node --test "tests/phase04-finalization/*.test.mjs"` | 0 | 100 | 0 | 0 | 13 s | Auth fixtures, role manifests |
| Checkpoint C | `node --test "tests/checkpoint-c/*.test.mjs"` | 0 | 100 | 0 | 0 | 25 s | Control plane, licensing, module gating |
| Checkpoint D/E | `node --test "tests/checkpoint-d-e/*.test.mjs"` | 0 | 56 | 0 | 0 | 7 s | Projects, engineering, manufacturing, quality, assets, maintenance, fleet, dispatcher |
| Checkpoint F | `node --test "tests/checkpoint-f/*.test.mjs"` | 0 | 27 | 0 | 0 | 3 s | Authority coverage, atomicity, idempotency, cross-domain FK integrity |
| **Checkpoint G** | `npm run test:checkpoint-g` | 0 | **85** | 0 | 0 | ~20 s | Below |
| Migration runner | `node --test "tests/migration/*.test.mjs"` | 0 | 1 | 0 | 0 | 10 s | Fresh, rerun, dependency order, cycle detection, down-rollback, concurrent lock, PG fail-closed |
| Unit | `node --test "tests/unit/*.test.mjs"` | 0 | 9 | 0 | 0 | 38 s | Helpers |

**Repository total: 448 tests, 448 pass, 0 fail.**

For the first time in this arc, **every repository suite is green**.

## Checkpoint G breakdown (85)

| File | Tests | Proves |
|---|---|---|
| `canonical_cutover_controller.test.mjs` | 17 | Three safety guards, refusal auditing, dry run, 13-domain activation, server-consulted enforcement, frozen-zone exclusion, idempotent re-activation, persistence across reopen and migration rerun, rollback isolation, production fail-closed |
| `multi_process_concurrency.test.mjs` | 5 | Distinct OS pids, no oversubscription, cross-process idempotency, no duplicate warehouse, post-race integrity |
| `test_isolation.test.mjs` | 5 | OS port allocation bindable, never repeats, concurrent-safe; no test file guesses ports; no file disables fallback without `allocatePort()` |
| `disposable_backup_restore.test.mjs` | 10 | Backup hash stability, byte-identical restore, migrations applied, schema fingerprint, 19 table counts, source links, audit/outbox chains, cutover locks survive, Arabic intact, no session/secret leakage |
| `failure_injection_complete.test.mjs` | 26 | All 22 named workflows + audit + outbox + registry guard + post-run consistency |
| `postgres_adapter.test.mjs` | 22 | STRICT stripped across the real schema, AUTOINCREMENT, INSERT OR IGNORE, type mapping, `?`→`$n` with literal/comment safety, untranslatable refusal, transaction sequencing, error wrapping, fail-closed paths |

## Script suites

| Suite | Command | Exit | Result |
|---|---|---|---|
| Permission regression | `node scripts/permission-regression.mjs` | 0 | **35/35 pass** |
| Precommit | automatic on every commit | 0 | pass on all 5 commits |

## Suites NOT run or NOT existing

| Suite | Status |
|---|---|
| Phase 01 | No `tests/phase01` directory exists |
| Release-candidate Chromium lifecycle | **Runner not built** — see [browser-acceptance.md](browser-acceptance.md) |
| PostgreSQL runtime | **Not executed** — driver absent, no server |
| `tests/rollback`, `tests/concurrency`, `tests/security`, `tests/contract`, `tests/integration`, `tests/provenance`, `tests/browser` | Still contain **zero test files**. Checkpoint F and G supply equivalent coverage under `tests/checkpoint-f/` and `tests/checkpoint-g/`; these directories remain empty |

## Integrity

No assertion was removed, loosened or weakened.

One test was **updated**: `tests/migration/runner.test.mjs`
`testPostgresDialectStub` asserted the message
`"PostgreSQL dialect is not yet configured"` — a test pinning the very
limitation Checkpoint G removed. Renamed `testPostgresDialectFailsClosed` and
re-pointed at the contract that matters: opening without a connection string
must reject with `PG_NO_CONNECTION_STRING`, and `requireClient()` must throw
`PG_NOT_CONNECTED`. That is a stronger, machine-readable assertion than a
message regex. It was changed because the implementation improved, not to hide
a failure.

One test **failed and stayed failing until the product was fixed**: the
warehouse duplicate case in the concurrency suite. Migration 062 fixed the
defect; the assertion was never relaxed.
