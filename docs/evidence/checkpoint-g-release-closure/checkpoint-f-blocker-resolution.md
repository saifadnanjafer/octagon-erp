# Checkpoint G — Checkpoint F blocker resolution

Every blocker Checkpoint F recorded, and its actual state now. No blocker is
marked closed without a test that fails if it regresses.

| # | Checkpoint F blocker | State | Evidence |
|---|---|---|---|
| 1 | Canonical cutover not activated for 12 of 13 domains | **RESOLVED (disposable)** | `canonical_cutover_controller.test.mjs` activates all 13; production activation remains fail-closed by design |
| 2 | `phase04.canonical_cutover = 0` on fresh install | **RESOLVED (disposable)** | Controller enables it only behind three safety guards |
| 3 | `authority_retirement_locks` empty | **RESOLVED (disposable)** | 13 RETIRED locks written and verified to persist |
| 4 | Finance the only enforced authority | **RESOLVED (disposable)** | `createLegacyWriterRetirementGuard` — the constructor `server.js` itself consults — reports all 13 enforced |
| 5 | Legacy generic writers remained competing writers | **RESOLVED at the decision layer; HTTP transport UNPROVEN** | 28 governed collections all resolve to an enforced authority; no HTTP round trip was executed |
| 6 | D/E lifecycle Chromium proof incomplete | **NOT RESOLVED** | No lifecycle runner was built — see [browser-acceptance.md](browser-acceptance.md) |
| 7 | Prior 8/8 Chromium claim proved module opening only | **STILL TRUE, still rejected** | Unchanged from Checkpoint F |
| 8 | Backup/restore not executed | **RESOLVED** | `disposable_backup_restore.test.mjs` 10/10 |
| 9 | Multi-process concurrency not proven | **RESOLVED** | `multi_process_concurrency.test.mjs` 5/5, distinct OS pids asserted |
| 10 | Failure injection covered 3 of 20 | **RESOLVED for entry-point injection** | 22 named workflows, each its own test; mid-lifecycle injection still partial |
| 11 | PostgreSQL dialect a fail-closed stub | **IMPLEMENTATION RESOLVED; RUNTIME NOT EXECUTED** | Real adapter + 22 unit tests; never run against a live server |
| 12 | ~297 SQLite-only `STRICT` declarations | **RESOLVED by translation** | Verified across every migration file using STRICT (47 files, 297+ occurrences), all STRICT-free after translation |
| 13 | Phase 02 failure is a suite-isolation defect | **PARTIALLY RESOLVED — and my first diagnosis was WRONG** | See [phase02-test-isolation.md](phase02-test-isolation.md) |
| 14 | Browser-artifact churn | **CONTAINED, not cleaned** | See [artifact-hygiene.md](artifact-hygiene.md) |

## Corrections to my own Checkpoint G work

**Blocker 13 — I misdiagnosed it first.** I found that
`browser-live-evidence.test.mjs` (ports 19080–19680) and
`runtime-adversarial.test.mjs` (19080–19580) used overlapping random port
ranges with `OCTAGON_FALLBACK_PORTS=''`, concluded that was the cause, and
fixed it across 37 call sites in 8 files. The aggregate run **still failed**.
The real error is `TimeoutError: Waiting failed: 30000ms exceeded` in
"role-specific navigation hides privileged pages" — resource starvation from
parallel Chromium launches, not port collision. The port fix is a genuine
latent-defect fix and is kept, but it was not the cause. Reported in full.

**Migration 062 came from a failing test, not from a hunch.** The concurrency
suite's warehouse case failed on first run. Before writing any fix I checked
whether it was a race: it was not — two warehouses with the same code can be
created sequentially too, because `warehouses` had no uniqueness constraint at
all. The migration addresses the real defect rather than the symptom.

**Three of my assertions were wrong about the schema, not the schema about
itself.** `assets` uses `asset_number`/`name_ar`, not `code`/`name`; companies
live in `platform_companies`; and my "secret-looking column" heuristic falsely
flagged `platform_settings.secret`, which is a one-character boolean flag —
migration 008 is explicit that secret *values* live in `secret_values` by
reference. Each assertion was corrected to the real contract, and the
corrected checks are stronger than what I first wrote.
