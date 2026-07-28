# Checkpoint F — test suite register

Every suite run **separately**. Counts are exactly as reported by
`node --test`. Nothing is aggregated across suites to inflate a total, and no
nested test is counted twice.

## Repository suites

| Suite | Command | Exit | Pass | Fail | Skip | Duration | What it proves |
|---|---|---|---|---|---|---|---|
| Checkpoint C | `node --test "tests/checkpoint-c/*.test.mjs"` | 0 | **100** | 0 | 0 | 24.8 s | Control plane, module management, licensing, entity/action policy |
| Phase 04 | `node --test "tests/phase04/*.test.mjs"` | 0 | **47** | 0 | 0 | 27.2 s | Phase 04 canonical domains |
| Phase 04 finalization | `node --test "tests/phase04-finalization/*.test.mjs"` | 0 | **100** | 0 | 0 | 13.3 s | Auth fixtures, role manifests, finalization gates |
| Checkpoint D/E | `node --test "tests/checkpoint-d-e/*.test.mjs"` | 0 | **56** | 0 | 0 | 7.1 s | Projects, engineering/BOM/routing/MRP, manufacturing, quality + subcontracting, assets, maintenance, fleet, shell dispatcher |
| Phase 03 | `node --test "tests/phase03/*.test.mjs"` | 0 | **12** | 0 | 0 | 315.9 s | Finance canonical cutover |
| Unit | `node --test "tests/unit/*.test.mjs"` | 0 | **9** | 0 | 0 | 38.2 s | Unit-level helpers |
| Migration | `node --test "tests/migration/*.test.mjs"` | 0 | **1** | 0 | 0 | 9.0 s | Migration runner |
| Phase 02 | `node --test "tests/phase02/*.test.mjs"` | **1** | 10 | **1** | 0 | 481.2 s | Platform bootstrap, permissions, live browser evidence |
| **Checkpoint F (new)** | `node --test "tests/checkpoint-f/*.test.mjs"` | 0 | **27** | 0 | 0 | 2.9 s | Authority coverage, atomicity, idempotency, cross-domain integrity |

**Repository total: 363 tests, 362 pass, 1 fail.**

## Script suites

| Suite | Command | Exit | Result |
|---|---|---|---|
| Permission regression | `node scripts/permission-regression.mjs` | 0 | **35/35 pass** |
| Precommit | run automatically on every commit | 0 | pass |

## Correction to the inherited register

`docs/evidence/checkpoint-d-e/test-suite-register.md` is **stale**. It reports:

- Checkpoint D/E total as **50** — the measured total is **56**;
- the Manufacturing, Quality, Assets, Maintenance, Fleet and Subcontract suites
  as "**not written**" — all of those files exist and pass.

The register understated its own work. Corrected here; the original is left in
place as the historical record for that checkpoint.

## Correction to the "pre-existing failure"

`tests/phase02/browser-live-evidence.test.mjs` was carried forward as a
pre-existing product failure. Re-derived:

| Run | Command | Result |
|---|---|---|
| Whole-glob | `node --test "tests/phase02/*.test.mjs"` | 11 tests, 10 pass, **1 fail**, exit 1 |
| **Isolated** | `node --test tests/phase02/browser-live-evidence.test.mjs` | 1 test, **1 pass**, 0 fail, **exit 0** |

The file **passes when run alone**. The failure appears only under the glob run,
which points at suite interference — shared port or resource contention between
concurrent Phase 02 browser tests — not an application defect.

**Reclassified: test-harness isolation defect, not a product defect.** It is
still a real defect and is carried in
[unresolved-risks.md](unresolved-risks.md); it is simply not evidence that the
shell is broken.

## Suites that do not exist

These directories exist and contain **zero test files**. Their "0 pass / 0 fail"
is an absence of tests, not a pass:

`tests/rollback`, `tests/concurrency`, `tests/security`, `tests/contract`,
`tests/integration`, `tests/provenance`, `tests/browser`

Checkpoint F supplies rollback/atomicity, concurrency (single-process) and
cross-domain integrity coverage under `tests/checkpoint-f/`. Contract,
provenance and multi-process concurrency remain unwritten.

## Suites not run in this checkpoint

| Suite | Reason |
|---|---|
| Phase 01 | No `tests/phase01` directory exists |
| Phase 02 browser (as a separate gate) | Covered inside the Phase 02 suite |
| Phase 03 browser (as a separate gate) | Covered inside the Phase 03 suite |
| Checkpoint D/E authenticated Chromium | **Runner does not exist** — see [browser-acceptance.md](browser-acceptance.md) |
| PostgreSQL | Adapter is a fail-closed stub — see [postgresql-execution.md](postgresql-execution.md) |
| Backup/restore | Not executed — see [disposable-backup-restore.md](disposable-backup-restore.md) |

## Integrity of this register

No assertion was removed, loosened, or weakened. No test was modified to
preserve an implementation. Two assertions in the new cross-domain suite failed
on first run because **my** schema assumptions were wrong (`parties.name_en`,
`is_customer`, `is_supplier`; table `organization_companies`). The schema was
correct; the test was corrected to the real contract — `party_roles` and
`platform_companies` — which produced a stronger assertion than the original.
