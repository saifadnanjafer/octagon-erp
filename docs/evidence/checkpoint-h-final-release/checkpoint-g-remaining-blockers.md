# Checkpoint H — resolution of Checkpoint G's remaining blockers

| # | Checkpoint G blocker | State | Evidence |
|---|---|---|---|
| 1 | No complete lifecycle Chromium runner | **NOT RESOLVED** | Runner not built — [complete-browser-lifecycle-proof.md](complete-browser-lifecycle-proof.md) |
| 2 | No full domain lifecycles through Chromium | **NOT RESOLVED** | Same |
| 3 | Legacy-writer refusal not observed over real HTTP | **RESOLVED** | 40 observed HTTP refusals — [http-legacy-writer-refusal.md](http-legacy-writer-refusal.md) |
| 4 | Mid-lifecycle failure injection incomplete outside stock | **NOT RESOLVED** | [mid-lifecycle-failure-injection.md](mid-lifecycle-failure-injection.md) |
| 5 | Only 4 of 18 concurrency scenarios exercised | **NOT RESOLVED** | [complete-multiprocess-concurrency.md](complete-multiprocess-concurrency.md) |
| 6 | Release Health view not implemented | **RESOLVED for server diagnostics** | 27 signals, live endpoint — [release-health.md](release-health.md). UI page not added. |
| 7 | Operational warehouse duplicates unchecked | **RESOLVED** | Read-only gate, **CLEAR** — [operational-warehouse-duplicate-gate.md](operational-warehouse-duplicate-gate.md) |
| 8 | PostgreSQL runtime unavailable | **STILL UNAVAILABLE — re-checked** | [postgresql-runtime-result.md](postgresql-runtime-result.md) |

**Closed: 3 of 8** (blockers 3, 6, 7), plus blocker 8 re-verified as genuinely
environment-blocked.

## What closing blocker 7 actually revealed

The duplicate gate came back clear, but for a reason far more significant than
the question asked: **the operational database is seventeen migrations behind
the repository** (tip `045_governed_master_data_and_inventory_actions` versus
`062`), with `platform_actions` at 190 rather than 330, `platform_modules` at 9
rather than 18, the `assets` table absent entirely, and **every canonical
business table empty**.

The live workshop does not run on the canonical schema. It runs on the legacy
JSON collection layer. Migration 062 therefore cannot be applied on its own —
applying it means first applying 046–061, which is the Phase 04 + Checkpoint
C/D/E schema arriving on the live database for the first time.

This reframes the whole release. Everything proven across Checkpoints F, G and H
was proven on **disposable databases at migration 062 with canonical data**. The
operational database is a different system. That gap is not a defect in the
work — it is the deployment step nobody has taken, and it is now measured
instead of assumed.

## Honest accounting of what remains

Three of the eight blockers are closed. Four remain genuinely open (1, 2, 4, 5)
and one is environment-blocked (8). Checkpoint H did not attempt the Chromium
lifecycle runner, mid-lifecycle injection, or the remaining fourteen concurrency
scenarios; it closed the three blockers it could close completely rather than
starting four and finishing none.
