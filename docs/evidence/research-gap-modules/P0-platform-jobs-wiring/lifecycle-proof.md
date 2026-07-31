# P0 — Lifecycle Proof

Proven end to end on a disposable database (`tests/phase02/jobs-wiring.test.mjs`):

1. `createPlatformAuthority(dialect)` → `authority.jobQueue` and
   `authority.webhookService` exist and are functional objects.
2. The `platform_kernel:maintenance_sweep` definition is seeded exactly once,
   even across two `createPlatformAuthority()` calls on the same dialect
   (idempotency proof).
3. `jobQueue.tick()` enqueues a real `job_runs` row from that definition.
4. `jobQueue.drain()` executes it through the registered handler and it
   **succeeds** — not `dead`/`NO_HANDLER`, which is the exact defect this
   slice fixes.
5. `handleControlPlaneQuery({resource:'job-queue'})` reports the succeeded
   run's counts, confirming the read path works end to end from `job_runs` to
   the API contract the new dashboard tab consumes.
6. No collision with any of the 5 legacy `server-scheduler.js` job codes
   (explicit assertion).

See `tests.md` for the full pass/fail table.
