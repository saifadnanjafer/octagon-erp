# Checkpoint H — test suite register

Every suite run **separately**. Counts exactly as reported by `node --test`.
No aggregation across suites; no nested test counted twice.

| Suite | Command | Exit | Pass | Fail | Skip | Proves |
|---|---|---|---|---|---|---|
| **Checkpoint H** | `node --test "tests/checkpoint-h/*.test.mjs"` | 0 | **62** | 0 | 0 | Real-HTTP legacy writer refusal (40 refusals), frozen-zone negative control, Release Health endpoint + 27 signals |
| Checkpoint G | `npm run test:checkpoint-g` | 0 | 85 | 0 | 0 | Cutover controller, multi-process concurrency, isolation, backup/restore, failure injection, PostgreSQL adapter |
| Checkpoint F | `npm run test:checkpoint-f` | 0 | 27 | 0 | 0 | Authority coverage, atomicity, idempotency, cross-domain FK integrity |
| Checkpoint D/E | `npm run test:checkpoint-d-e` | 0 | 56 | 0 | 0 | Projects, engineering, manufacturing, quality, assets, maintenance, fleet, dispatcher |
| Checkpoint C | `npm run test:checkpoint-c` | 0 | 100 | 0 | 0 | Control plane, licensing, module gating |
| Phase 04 | `npm run test:phase04` | 0 | 47 | 0 | 0 | Canonical domains + the one mid-flight finance-port rollback |
| Phase 04 finalization | `npm run test:phase04-finalization` | 0 | 100 | 0 | 0 | Auth fixtures, role manifests |
| Phase 03 | `node --test "tests/phase03/*.test.mjs"` | 0 | 12 | 0 | 0 | Finance canonical cutover incl. browser evidence |
| Phase 02 (serial) | `npm run test:phase02` | 0 | 11 | 0 | 0 | Shell, identity, permissions, RTL/LTR, responsive, session revocation, direct-API denial |
| Migration runner | `npm run test:migration` | 0 | 1 | 0 | 0 | Fresh, rerun, dependency order, cycle detection, down-rollback, concurrent lock, PG fail-closed |
| Unit | `npm run test:unit` | 0 | 9 | 0 | 0 | Helpers |

**Repository total: 510 tests, 510 pass, 0 fail.**

| Script suite | Command | Exit | Result |
|---|---|---|---|
| Permission regression | `npm run test:permissions` | 0 | **35/35** |
| Precommit | automatic on every commit | 0 | pass |

## Checkpoint H breakdown (62)

| File | Tests | Proves |
|---|---|---|
| `http_legacy_writer_refusal.test.mjs` | 50 | Cutover active on the fixture; owner authenticated; 40 HTTP refusals with exact per-domain codes; `/api/db` 409 naming the collection; bare full-sync bounced; unauthenticated blocked; frozen-zone NOT refused; no record/audit-success/outbox residue; Release Health reachable + session-gated |
| `release_health.test.mjs` | 12 | All 27 signals present and uniquely named; valid status vocabulary; PostgreSQL runtime never healthy and never inheriting green; opening-inventory blocked; production approval blocked; un-activated cutover warns; post-cutover signals flip to healthy; git metadata real or unknown; audit health from the live registry; test fixture surfaced; unreadable source reports unknown; rollup blocked when any signal is blocked |

## Not run / not existing

| Suite | Status |
|---|---|
| Phase 01 | No `tests/phase01` directory exists |
| Release-candidate Chromium lifecycle | **Runner not built** |
| Mid-lifecycle failure injection (beyond stock) | **Not written** |
| Concurrency scenarios 2-18 | **Not written** |
| PostgreSQL runtime | **Not executed — environment unavailable** |
| `tests/rollback`, `concurrency`, `security`, `contract`, `integration`, `provenance`, `browser` | Still zero files; coverage lives under `tests/checkpoint-f/g/h` |

## Integrity

No assertion was removed, loosened or weakened in Checkpoint H. No test was
modified to hide a failure. Two of my own module defects and one wrong schema
assumption were caught by these tests and fixed in the code or the expectation,
as recorded in FINAL_RELEASE_CANDIDATE_DECISION.md.
