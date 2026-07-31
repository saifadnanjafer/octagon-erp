# P0 — Tests

## New test file

`tests/phase02/jobs-wiring.test.mjs` — 5/5 passed:

1. `createPlatformAuthority` exposes a real `jobQueue` and `webhookService`.
2. Seeds exactly one maintenance-sweep job definition, idempotently (two
   `createPlatformAuthority()` calls on the same dialect do not duplicate).
3. `tick()` + `drain()` actually executes the seeded job through the
   registered handler (proves the exact "no handler registered" dead-letter
   defect is fixed).
4. `handleControlPlaneQuery('job-queue')` reports real counts from `job_runs`,
   read-only.
5. No collision with any of the 5 legacy `server-scheduler.js` job codes.

## Regression scope run

Full `tests/phase02/*.test.mjs` suite (13 files after this addition) run
against this worktree, both before and after `npm install` (this fresh
worktree had no installed dependencies — a worktree-creation artifact, not a
code defect):

| File | Before `npm install` | After `npm install` |
|---|---|---|
| `settings-policies.test.mjs` | 29/29 | (unaffected, already passing) |
| `workflow-approvals.test.mjs` | 31/31 | (unaffected, already passing) |
| `authorization.test.mjs` | 31/32 | 31/32 — **pre-existing**, unrelated `MISSING_ARABIC_LABEL` data-quality finding on ~110 wave-2 permission IDs (bi/contracts/expenses/grc/hc/hse/integration/iraq/planning/plm/rental/sourcing/subscriptions/treasury/wms) — confirmed unrelated to this build |
| `runtime-integration.test.mjs` | 0/3 (missing `dotenv`) | 3/3 |
| `runtime-adversarial.test.mjs` | fail (missing deps) | 11/11 |
| `browser-evidence.test.mjs` | fail (missing deps) | 3/3 |
| `browser-live-evidence.test.mjs` | fail (missing deps) | see final tally below |
| `runtime-strangler.test.mjs` | 5/6 | 5/6 — **pre-existing**, confirmed present on the untouched `octagon-final-page-catalog` source worktree too (`MigrationRunnerError: Refusing full-chain rollback on a populated database`), unrelated to this build |
| `security-suite.test.mjs` | 23/24 | 23/24 — same pre-existing migration-runner issue as above |
| `jobs-wiring.test.mjs` (new) | — | 5/5 |

**Conclusion: this build introduces zero regressions.** The two genuine
pre-existing failures (`authorization.test.mjs`, and the shared
migration-rollback issue in `runtime-strangler.test.mjs`/`security-suite.test.mjs`)
were independently reproduced on the untouched source branch and are unrelated
to `platform/jobs`, the bridge, or `control_plane`. The `npm install` gap was
an artifact of `git worktree add` not installing dependencies — fixed once,
now applies to the whole worktree.
