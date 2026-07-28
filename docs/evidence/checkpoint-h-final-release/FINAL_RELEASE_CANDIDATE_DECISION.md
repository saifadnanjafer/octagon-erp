# Checkpoint H — final release candidate decision

# PARTIAL — REMEDIATION REQUIRED

Repository `saifadnanjafer/octagon-erp` ·
branch `review/octagon-unified-release-candidate` ·
starting SHA `7bcf7960aa9bf892ff06eab91fff83f14a54f23a`

---

## The decision in one paragraph

Checkpoint H closed three of Checkpoint G's eight blockers with executable
proof — legacy-writer refusal is now **observed over real HTTP** (40 refusals,
correct per-domain error codes, frozen-zone negative control, nothing reaching
the database), Release Health is a **live server-derived endpoint** built so it
cannot report green for work nobody did, and the operational warehouse gate ran
**read-only and provably so**. But that gate returned something more important
than the answer it was asked for: **the operational database is seventeen
migrations behind the repository and its canonical tables are empty.** The live
workshop is not running the schema this release candidate has been verified
against. Everything proven across three checkpoints was proven on disposable
databases at migration 062 with canonical data; the production system is at 045
on the legacy JSON layer. That gap, not any defect in the code, is now the
dominant release risk.

## Why not "VERIFIED"

| Requirement | Status |
|---|---|
| Operational warehouse duplicate gate executed read-only | **MET** — clear; read-only enforcement proved |
| Full HTTP legacy-writer refusal proven | **MET** — 40 observed refusals across 14 domains |
| All primary browser lifecycles proven | **NOT MET** — runner not built (H1) |
| Complete mid-lifecycle failure injection | **NOT MET** — 1 of ~40 points (H2) |
| All 18 multi-process concurrency scenarios | **NOT MET** — 4 of 18 (H3) |
| Phase 02 aggregate green | **MET** — serial, exit 0 |
| Backup/restore green | **MET** — 10/10 (Checkpoint G) |
| Release Health complete | **MET for server diagnostics**; UI page not built (M1) |
| Operational hashes unchanged | **MET** — identical across F, G, H |
| VNext unchanged | **MET** — identical fingerprint across F, G, H |
| No critical/high unresolved defect | **NOT MET** — **1 critical**, 5 high |
| Full evidence | **MET** for what was executed; gaps named, not papered over |
| Local/remote SHA equal | **MET** after every push |

PostgreSQL runtime is explicitly permitted to remain unexecuted, and it is —
re-verified as genuinely environment-blocked and reported as `not_executed` by
the health endpoint, with a test that prevents it ever reading healthy.

## What Checkpoint H proved

**Legacy writers really are refused.** Real `server.js`, disposable port,
cutover active, authenticated as **owner** so a 403 cannot be mistaken for a
permission failure. 20 governed collections × 2 routes = 40 refusals, each
carrying its exact domain code and naming the canonical replacement.
`POST /api/db` returns 409 and names the offending collection. Unauthenticated
callers never reach the check. And the frozen-zone negative control passed:
`employees`, `omni.employeeAttendance`, `omni.workshopTimesheetCases` and
`omni.jobOrders` are **not** refused — the cutover does not break the running
workshop. Nothing reached the database: 0 rows, 0 outbox events, 0 audit
successes.

**Release Health cannot lie.** 27 signals from real state. `unknown` for what
cannot be computed, `not_executed` for what nobody ran — both distinct from
`healthy` by design. The suite is mostly negative assertions: PostgreSQL runtime
can never be green and cannot inherit green from the adapter; the
opening-inventory gate stays blocked; an un-activated cutover reads warning with
the reason attached; an unreadable database rolls up to not-healthy; and the
shipped test fixture is surfaced rather than hidden.

**The operational gate ran safely.** WAL-aware copy first, `readOnly: true`
second, and read-only enforcement *proved* by a refused write. Four hashes
byte-identical afterwards.

## What Checkpoint H did not attempt

The Chromium lifecycle runner, mid-lifecycle injection, and the remaining
fourteen concurrency scenarios. Each needs fully staged per-domain fixtures
before the interesting assertion can even be made. Checkpoint H closed three
blockers completely rather than starting four and finishing none. That is a
scoping decision, stated rather than disguised.

## Two defects in my own work, caught by my own tests

1. `domain_lock_state` was expected to read `0/14` before cutover; it reads
   `1/14` because FINANCE is enforced unconditionally since Phase 03. My
   expectation was wrong, not the module.
2. `applied_migration_count` reported **healthy** against an unmigrated
   database, because the ledger table is created on open so the count is a known
   `0`. A database with zero migrations applied is not healthy — it now reports
   **blocked**.

Also: my audit-residue assertion used a `payload` column that does not exist on
`platform_audit_log`. Corrected to the real schema and strengthened to assert no
audit row records a refused write as `result='success'`.

## Path to verified

1. **Resolve C1** — decide whether to apply migrations 046–062 to the
   operational database and migrate legacy data into the canonical schema, then
   **re-run the warehouse gate**. Nothing else in this list matters until the
   production system and the verified system are the same system.
2. Enumerate the legacy UI call sites that write governed collections (H5/M5) —
   they will break the moment cutover is activated.
3. Build the lifecycle Chromium runner (H1).
4. Extend mid-lifecycle injection beyond stock (H2).
5. Complete the remaining fourteen concurrency scenarios (H3).
6. Install `pg`, provision a disposable database, run the chain (H4).

## Statement

This is an independent verification result, not a production certification.
Canonical cutover was activated **only** on disposable databases. The
operational store is byte-identical at entry and exit, was opened read-only
once, and the controller's path guard makes activating cutover there impossible
without editing the guard. **No merge into `main` was performed or attempted.**

**Classification: PARTIAL — REMEDIATION REQUIRED**
