# Checkpoint D/E — test suite register

Every suite run separately. Counts are as reported by `node --test`; no
aggregate is double-counted.

## New suite

| Suite | Command | Exit | Pass | Fail | Skip | Proves |
|---|---|---|---|---|---|---|
| Projects lifecycle | `node --test tests/checkpoint-d-e/projects_lifecycle.test.mjs` | 0 | **23** | 0 | 0 | Project register, status state machine, templates, canonical Work Item delegation, budget/commitment governance, change orders, frozen-zone denial, milestone + T&M + fixed-price billing rules, derived costing and profitability, reports, scope spoofing denial, idempotency |

## Existing regressions (re-run on this branch)

| Suite | Command | Exit | Pass | Fail |
|---|---|---|---|---|
| Checkpoint C | `node --test "tests/checkpoint-c/*.test.mjs"` | 0 | **100** | 0 |
| Phase 04 | `node --test "tests/phase04/*.test.mjs"` | 0 | **47** | 0 |
| Phase 04 finalization | `node --test "tests/phase04-finalization/*.test.mjs"` | 0 | **100** | 0 |
| Phase 03 | `node --test "tests/phase03/*.test.mjs"` | 0 | **12** | 0 |
| Migration | `node --test "tests/migration/*.test.mjs"` | 0 | **1** | 0 |
| Unit | `node --test "tests/unit/*.test.mjs"` | 0 | **9** | 0 |
| Phase 02 | `node --test "tests/phase02/*.test.mjs"` | 1 | 10 | **1** |

### Two existing tests were corrected, not weakened

1. **`tests/checkpoint-c/migration_051.test.mjs`** asserted that 051 was the
   *last* executed migration. That is version-bound: appending 052 breaks it by
   design. Changed to assert 051 **is applied** by a fresh install — which is
   the proof the test exists for (051 runs and leaves a readable entity
   registry). All other assertions in that test are unchanged.

2. **`tests/phase04-finalization/test_auth_fixture.test.mjs`** asserted an
   exact roster of 8 disposable roles. Checkpoint D adds a scoped
   `project_manager` role (required for authenticated role proof). The roster
   assertion was updated to the new exact list of 9 — it remains an exact
   assertion, so adding a role stays a deliberate reviewed change. A **new**
   test was added asserting the project manager holds Projects permissions and
   does **not** hold `control:admin`, `pos:session:write`, or
   `sales:order:write`. The manifest count assertion now derives from
   `TEST_ROLES.length` instead of a hardcoded 8.

No assertion was removed or loosened in substance.

## Pre-existing failure (not caused by this work)

`tests/phase02/browser-live-evidence.test.mjs` fails.

Verified against a temporary worktree checked out at the source commit
`6adcd0df19788867c336d5020fe0d15cb7a123bb`:

| | Baseline `6adcd0d` | This branch |
|---|---|---|
| Result | **10/12 passed → FAIL** | 11/12 passed → FAIL |

The failure predates this checkpoint and is one check *better* on this branch.
It is recorded, not masked and not silently inherited.

## Empty test directories at the source commit

These exist but contain **no test files**, at the source commit and now:
`tests/rollback`, `tests/concurrency`, `tests/security`, `tests/contract`,
`tests/integration`, `tests/provenance`. Their "0 pass / 0 fail" result is an
absence of tests, not a pass.

## Not yet run / not yet written

Honest status for the remaining Checkpoint D/E scope:

- Manufacturing, Quality, Assets, Maintenance, Fleet, and Subcontract suites —
  **not written** (those checkpoints are not implemented).
- Dedicated Checkpoint D/E concurrency, failure-injection, and rollback suites —
  **not written**.
- Authenticated Chromium acceptance runner for Checkpoint D/E —
  **not written**. Projects was verified through real authenticated HTTP and
  live DOM inspection in a real Chromium instance, but no screenshot artefacts
  were captured for this checkpoint.
- PostgreSQL execution — **not executed**; no isolated PostgreSQL runtime is
  available in this environment. The 052 schema is written to be
  PostgreSQL-compatible but this is unproven.
- Production backup/restore — **not executed**, by policy.
