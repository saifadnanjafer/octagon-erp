# Dependency and Build Order

See `VERIFIED_MISSING_MODULE_AND_SERVICE_REGISTER.md` for the full 18-item
table. Summary of the reasoning used to pick the P0 build:

## Why `platform/jobs` wiring was chosen as P0

Per the assignment's own tie-breaker rules ("prefer the item that unlocks
more modules, reuses more canonical authorities, requires fewer duplicate-risk
changes, has clearer tests, has no licensing ambiguity"):

- **Unlocks more modules:** a real job queue is a prerequisite for report
  dispatch (#2), notification retry sweeps (#3), and any future
  IoT/telemetry-retention or dunning-schedule work — nothing else in the
  candidate list unlocks as many downstream items.
- **Reuses more canonical authorities:** 100% — zero new schema, zero new
  domain logic; the entire slice is import + instantiate + one additive seed
  row + a read-only query + a dashboard tab.
- **Fewest duplicate-risk changes:** the slice explicitly avoided touching
  `server-scheduler.js`'s five live cron jobs (real operational behavior,
  higher blast radius) and instead proved the new path is safe and additive —
  a test explicitly asserts no collision with the legacy scheduler's job
  codes.
- **Clearest tests:** `platform/jobs` already had a full, passing test suite
  before this wave (`tests/phase02/collaboration-files-jobs.test.mjs`); this
  wave only had to prove the *wiring*, not the underlying engine correctness.
- **No licensing ambiguity:** confirmed in `licensing-and-provenance.md`.

## Why collaboration/chatter (§7.1) was *not* also built this wave

It is the next-clearest P0-tier candidate (identical defect class, identical
fix shape) — deliberately deferred so this slice stays reviewable as one
coherent, testable unit rather than two half-finished ones in the same commit
set, per the assignment's own §11 rule ("Do not begin a second half-built
module while the first coherent slice is uncommitted").

## Continuation order (unchanged from the verified-missing register)

1. ~~Jobs/scheduler wiring~~ — done.
2. Collaboration/chatter wiring.
3. Notification provider completion (now job-queue-driven).
4. Report dispatch (needs #1, done, plus a new rendering/export capability).
5. Returns/RMA consolidation (highest business-duplication risk).
6. Credit/collections UI, print/template consolidation, sales-commission
   rewire — independent of each other, can proceed in any order.
7. Master data governance, service entitlements — new modules, need design.
8. IoT, kiosk, marketplace, workshop pack, tenant provisioning — lower
   priority per the source matrix's own phase assignments.
