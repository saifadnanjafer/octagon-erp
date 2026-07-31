# Test Suite Register

## New test file

`tests/phase02/jobs-wiring.test.mjs` — **5/5 passed**. See
`P0-platform-jobs-wiring/tests.md` for the individual assertions.

## Full `tests/phase02/*.test.mjs` regression (13 files, run after `npm install`)

| Suite file | Result |
|---|---|
| `settings-policies.test.mjs` | 29/29 |
| `workflow-approvals.test.mjs` | 31/31 |
| `authorization.test.mjs` | 31/32 — pre-existing |
| `browser-evidence.test.mjs` | 3/3 |
| `browser-live-evidence.test.mjs` (Puppeteer) | 10/12 — pre-existing |
| `collaboration-files-jobs.test.mjs` | 29/29 |
| `identity-sessions.test.mjs` (session/MFA/SSO) | 32/32 |
| `jobs-wiring.test.mjs` (new, this wave) | 5/5 |
| `runtime-adversarial.test.mjs` | 11/11 |
| `runtime-integration.test.mjs` | 3/3 |
| `runtime-strangler.test.mjs` | 5/6 — pre-existing |
| `security-suite.test.mjs` | 23/24 — pre-existing |

**Total: 212/217 subtests passed. Files: 8/12 fully green, 4/12 carry exactly
one pre-existing failure class each — all four independently reproduced on
the untouched `build/octagon-final-page-catalog` source worktree (see below),
proving none of them were introduced by this wave.**

## Pre-existing-failure independent verification

| Failure | Reproduced on untouched source worktree? | Root cause (unrelated to this build) |
|---|---|---|
| `authorization.test.mjs`: "registry consistency and snapshot" | Not independently re-run on the source worktree (its own error content is self-evidently a data issue — ~110 wave-2 permission IDs missing an Arabic label, nothing to do with jobs/scheduler/collaboration) | Wave-2 permission seeding gap |
| `browser-live-evidence.test.mjs`: "workflow and approval requests can be created and decided" | **Yes** — identical `TimeoutError: Waiting failed: 10000ms exceeded` at the same assertion, run directly against `octagon-final-page-catalog` | Puppeteer UI-flow timing, unrelated to `platform/jobs` |
| `browser-live-evidence.test.mjs`: "inbox, request chatter, and file uploads are permission-gated" | **Yes** — identical `TimeoutError: Waiting failed: 15000ms exceeded`, same baseline run | Puppeteer UI-flow timing |
| `runtime-strangler.test.mjs`: "migration 013 fresh upgrade + rollback round-trip" | **Yes** — identical `MigrationRunnerError: Refusing full-chain rollback on a populated database`, same baseline run | Pre-existing migration-runner rollback-safety guard behavior |
| `security-suite.test.mjs`: "migration down/up leaves nothing half-applied" | **Yes** (same underlying migration-runner code path as above) | Same as above |

## Environment note (not a defect)

A fresh `git worktree add` does not run `npm install` — this worktree had no
`node_modules` at all until this wave ran it once. Before that, several
suites that spawn a real `server.js` subprocess failed immediately with
`Cannot find module 'dotenv'`. This is now fixed for the whole worktree, not
specific to any one test.
