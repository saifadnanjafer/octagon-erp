# Phase 05 — Starting State

Recorded before any Phase 05 code was written.

## Repository

| Item | Value |
|---|---|
| Repository root | `C:\Users\Zahraa dlbooz\Downloads\odoo-19.0\octagon-erp` |
| Origin | `https://github.com/saifadnanjafer/octagon-erp.git` |
| Source branch | `integration/octagon-unified-platform-expansion` |
| Local source commit | `643d9300a87f1376091ecd957a297f91937ec66b` |
| Remote source commit | `643d9300a87f1376091ecd957a297f91937ec66b` |
| Local == remote | yes (verified after `git fetch origin --prune`) |
| Target branch | `phase-05/projects-manufacturing-assets-maintenance-fleet` |
| `origin/main` | `8815b00b2c5281167aad3bbe8370270efffb61b8` (not merged into; untouched) |
| Worktree at entry | clean — `git status --porcelain` returned 0 lines |
| Uncommitted work preserved | none existed; nothing was stashed, reset, or discarded |

`git rev-parse --show-toplevel` resolves to the product repository itself. The
older note that the project Git repository was gutted does not apply to
`octagon-erp/`: it has a healthy `.git`, a real object store, 13 local branches
and a working `origin`.

## Migration state

| Item | Value |
|---|---|
| Migration directory | `database/migrations/` |
| Migration count at entry | 44 files (`005` … `044`) |
| Latest migration at entry | `044_opening_stock_cutover_and_equity_coa` |
| Phase 05 block reserved | `045` onward |
| Historical migrations modified | none — Phase 05 only appends forward migrations |

Phase 03 migration `034_cross_module_source_fact_adapters` already registered the
fact types `manufacturing_wip_posting`, `project_cost_posting` and
`asset_depreciation_posting` for this phase. Phase 05 posts through those
registered contracts rather than adding a second posting path.

## Operational database (read-only; never modified)

Hashes taken with `node` + `crypto.createHash('sha256')` on the byte content of
each file. The live path was **not** opened by a SQLite driver during this
phase; every migration and test run uses a fresh disposable database in the OS
temp directory.

| File | Bytes | SHA256 (entry) |
|---|---:|---|
| `database.db` | 17,084,416 | `36da81437da7383c9ec42bc9b15f6ace8d99d18e9e1d8bd6907262a7a4c106c5` |
| `database.db-wal` | 4,783,352 | `a650756a7f3a9fe8070925df59eca0b645a3c0c258b525188d45943ca8bbcd41` |
| `database.db-shm` | 32,768 | `41d846cd9e5d2438ee017e407e4d11a97c8bb27e08ef8c8a89367ebdc21c01ef` |
| `database.json` | 6,309,472 | `2e4d7d91b15b053d276cf1b5ac2b73524be3bd73da096e5ba925724b61c700a1` |

Closure re-verification of these four hashes is recorded in
`PHASE_05_CLOSURE.md`.

## Toolchain

Node v24.14.1 · npm 11.11.0 · Git 2.53.0.windows.2 · Windows 11 Pro 10.0.26200.

## Previous-phase classification (as inherited, not re-asserted)

| Phase | Inherited claim | This phase's treatment |
|---|---|---|
| 01–02 | closed, checkpointed | regression only |
| 03 | closed after remediation | regression only; Phase 05 posts through its pipeline |
| 04 | closed, then re-opened by `docs/evidence/unified-expansion/phase-04-closure-claim-audit.md` | treated as **not closed**; Phase 05 does not depend on Phase 04 cutover being active |
| unified expansion | `PARTIAL — REMEDIATION REQUIRED` | inherited as-is; no Phase 04 claim upgraded here |

## Phase 05 had not been started

`git log --oneline` shows `c315f79 docs: add Phase 05 specification …` as the
only Phase 05 commit at entry — a specification document, no code. No
`platform/manufacturing`, `platform/projects`, `platform/assets`,
`platform/maintenance`, `platform/quality` or `platform/fleet` directory existed.
No migration `045+` existed. No `docs/evidence/phase-05/` existed.

## Inherited unresolved risks carried into Phase 05

From `docs/evidence/unified-expansion/unresolved-risks.md`, unchanged by this
phase:

1. The approved opening-inventory accounting date is still absent, so the real
   opening migration stays fail-closed with `OPENING_CUTOVER_DATE_REQUIRED`.
2. Original-shell stock/reservation/commercial/task writers remain active; the
   canonical client adapter is incomplete.
3. No real Chromium Phase 04 browser suite has run since the remediation.
4. The Phase 04 flag and retirement locks are inactive in the operational
   database, by design.
5. The operational database is intentionally unmigrated; production cutover is
   not authorized.

### Why Phase 05 proceeded

Risks 1, 4 and 5 are deliberate fail-closed states that *protect* the
operational database; they are not corruption. Risk 2 and 3 are Phase 04
acceptance gaps. Phase 05 is additive: it creates new canonical tables and
commands, changes no Phase 04 authority, does not enable the Phase 04 cutover
flag, and does not touch the operational database. No inherited blocker was
resolved by this phase, and none is claimed as resolved. The Phase 04 gate
remains open and is restated in `unresolved-risks.md`.

`PHASE_05_MANUFACTURING_PROJECTS_ASSETS_HR.md` carries a `HOLD` banner from the
same audit. The owner issued a direct instruction to execute Phase 05 on
2026-07-26. That instruction is the authority for proceeding; the hold is
recorded here rather than silently dropped.

## Frozen zone baseline

Payroll, attendance and timesheet remain read-only. Phase 05 creates no table
that stores payroll, attendance or timesheet facts, and issues no write against
them. See `frozen-zone-attestation.md`.
