# Checkpoint G — release candidate decision

# PARTIAL — REMEDIATION REQUIRED

Repository `saifadnanjafer/octagon-erp` ·
branch `review/octagon-unified-release-candidate` ·
starting SHA `81801c4ef7fc3e75ce952abe7dae4ec3b621d6cc`

---

## The decision in one paragraph

Checkpoint G closed six of the seven blockers Checkpoint F recorded, and closed
them with executable proof rather than argument: canonical cutover can now be
rehearsed, activated, audited and rolled back behind three unbypassable safety
guards, and a disposable rehearsal enforced **all 14 canonical authorities** with
zero conflicts; all 22 named failure-injection workflows have individual
results; concurrency is proven across genuinely separate OS processes; backup and
restore round-trip with every source link, audit chain and cutover lock intact;
the PostgreSQL stub is replaced by a real adapter with a portability layer that
neutralises the 297-`STRICT` blocker; and the Phase 02 aggregate — red since
before Checkpoint F — is **green, 11/11, exit 0**. Every repository suite now
passes: **448 tests, 448 pass, 0 fail**. What prevents verification is what was
not attempted: no end-to-end lifecycle was driven through the browser, so the
system is proven consistent and proven safe under failure, but not yet proven
*arithmetically correct across a complete business cycle*.

## Why not "VERIFIED"

| Requirement | Status |
|---|---|
| Disposable canonical cutover activated successfully | **MET** — 14/14 authorities, 0 conflicts |
| No competing writer in disposable cutover | **MET at the decision layer** — not observed over HTTP (H2) |
| All complete lifecycle browser workflows proven | **NOT MET** — runner not built (H1) |
| Full failure injection completed | **MET for entry-point injection**; mid-lifecycle covers 1 of 22 (H5) |
| Real multi-process concurrency proven | **MET** — 4 of 18 named cases (H6) |
| Phase 02 aggregate isolation fixed | **MET** — 11/11, exit 0 |
| Disposable backup/restore proven | **MET** — 10/10 |
| PostgreSQL result honestly classified | **MET** — adapter done, runtime NOT executed (H4) |
| Operational hashes unchanged | **MET** — 4 SHA-256 identical |
| VNext unchanged | **MET** |
| No critical/high unresolved defect | **NOT MET** — 0 critical, **6 high** |
| Evidence complete | **MET** for what was executed; gaps named, not papered over |
| Local/remote SHA equal | **MET** after every push |

## Why not "BLOCKED"

Nothing prevented the work. Six blockers closed, two real product defects found
and fixed, every repository suite green for the first time in the arc.

## Defects found and fixed

**1. Warehouse codes had no uniqueness constraint.** Found by the multi-process
concurrency suite — four processes each created a warehouse with code `RACEWH`
and all four succeeded. Before writing a fix I checked whether it was a race: it
was not. Two warehouses with the same code can be created sequentially too;
`warehouses` carried only its primary-key autoindex. Warehouse code is the
human-facing identifier used in lookups, transfers and reporting, so duplicates
silently split a location's stock across records that look identical to an
operator. **Migration 062** adds the unique index and fails loudly if an
installation already holds duplicates, rather than deleting stock-bearing rows.

**2. Phase 02 aggregate failure — root cause found, and my first diagnosis was
wrong.** I found overlapping random port ranges (`browser-live-evidence`
19080–19680 vs `runtime-adversarial` 19080–19580, with no fallback), fixed it
across 37 call sites, and the aggregate **still failed**. The real cause is
`TimeoutError: Waiting failed: 30000ms exceeded` — resource starvation from
parallel Chromium launches. Serial execution fixes it: 11/11, exit 0. The port
fix is kept because it is a genuine latent defect, but it was not the cause, and
I have said so everywhere it appears.

## What Checkpoint G built

| Artefact | Purpose |
|---|---|
| `platform/cutover/canonical-cutover-controller.mjs` | Governed cutover: status, dry run, validation, activation, rollback, attempt audit, three safety guards |
| `database/migrations/061` | Cutover attempts + approvals (approvals empty = production fail-closed) |
| `database/migrations/062` | Warehouse code uniqueness |
| `database/dialects/postgres-dialect.mjs` | Real adapter replacing the throwing stub |
| `database/dialects/sql-portability.mjs` | Migration SQL transformer — one strategy instead of porting 60 migrations |
| `tests/helpers/allocate-port.mjs` | OS port allocation replacing 37 random guesses |
| `tests/checkpoint-g/**` | 85 tests across 6 files |
| `package.json` scripts | Pins the browser gates to serial execution, with the reason recorded inline |

## Path to verified

1. **Build the lifecycle Chromium runner** and execute all 13 domain lifecycles
   with authoritative server-side assertions. This is the gating item.
2. Issue real HTTP writes against a cutover-active disposable server and observe
   the 403 (closes H2).
3. Rehearse cutover against a disposable **copy of production-shaped data**, and
   check the operational database for duplicate warehouse codes before migration
   062 is ever applied there (closes H3).
4. `npm install pg`, provision a disposable database, run the chain (closes H4).
5. Extend mid-lifecycle fault injection beyond stock (closes H5).
6. Extend concurrency to the remaining 14 named cases (closes H6).

## Statement

This is an independent verification result, not a production certification. **No
merge into `main` was performed or attempted.** Canonical cutover was activated
**only** on disposable databases; the operational store is byte-identical at
entry and exit, and the path guard makes activating it there impossible without
editing the guard itself.

**Classification: PARTIAL — REMEDIATION REQUIRED**
