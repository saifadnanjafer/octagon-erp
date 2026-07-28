# Checkpoint F — claim-to-evidence matrix

Every claim carried into Checkpoint F was re-derived from the repository and
from runtime, not read back from the previous report.

Verdicts: **PASS** (independently reproduced) · **PARTIAL** (true in part) ·
**FAIL** (contradicted) · **NOT PROVEN** (no evidence either way).

---

## Test-count claims

| Claim | Actual result | Verdict |
|---|---|---|
| "134/134 repository tests" | No suite, and no combination of suites, produces 134. Measured totals per suite (run separately, never aggregated): Checkpoint D/E **56**, Checkpoint C **100**, Phase 04 **47**, Phase 04 finalization **100**, Phase 03 **12**, Migration **1**, Unit **9**, Phase 02 **11**. Repository total **336**, of which **335 pass**. | **FAIL** — the number 134 does not correspond to anything in this repository. The true count is higher; the claim is wrong, not conservative. |
| "56/56 Checkpoint D/E" | `node --test "tests/checkpoint-d-e/*.test.mjs"` → exit 0, tests 56, pass 56, fail 0, duration 7.08 s | **PASS** |
| "8/8 Checkpoint D/E Chromium checks" | No Checkpoint D/E Chromium runner exists. `scripts/checkpoint-d-e-browser-acceptance.mjs` is present but the branch's own `docs/evidence/checkpoint-d-e/test-suite-register.md` states the runner is "**not written**" and that "no screenshot artefacts were captured for this checkpoint". No D/E screenshots exist on disk. | **NOT PROVEN** |
| Repository test register is accurate | `docs/evidence/checkpoint-d-e/test-suite-register.md` reports Checkpoint D/E as **50 pass** and declares the Manufacturing, Quality, Assets, Maintenance, Fleet and Subcontract suites "**not written**". All five files exist and pass; the real count is 56. | **FAIL (documentation)** — the register is stale, understating its own work. Corrected in [test-suite-register.md](test-suite-register.md). |

## Migration claims

| Claim | Actual result | Verdict |
|---|---|---|
| Migrations 001–060 present | 60 files in `database/migrations/`. No duplicate numeric prefix. | **PASS** |
| Migrations 053–060 apply | `node scripts/migrate.mjs fresh` on a disposable database applied all 60, including 053–060, each reported `"status":"applied"`. | **PASS** |
| Fresh install works | Confirmed, exit 0. | **PASS** |

## Runtime registration claims

Probed against a disposable fresh-install database, not from source text.

| Claim | Actual result | Verdict |
|---|---|---|
| Canonical modules are registered | 18 modules in `platform_modules`. | **PASS** |
| Actions are registered | **330** rows in `platform_actions` across 18 modules. | **PASS** |
| One canonical authority per fact — action level | `SELECT id, COUNT(*) ... GROUP BY id HAVING c>1` → **0 rows**. No duplicate action id. | **PASS** |
| One canonical authority per fact — entity level | `SELECT id, COUNT(DISTINCT module_id) ... HAVING m>1` → **0 rows**. No entity owned by two modules. | **PASS** |
| Audit on every governed action | `audit_policy != 'required'` → **0 rows**. | **PASS** |
| Idempotency on every governed action | `idempotency_policy = 'none'` → **0 rows**. | **PASS** |
| Seven visible canonical D/E modules | `operations_projects`, `operations_engineering`, `operations_mrp`, `operations_manufacturing`, `operations_quality`, `assets_management`, `operations_maintenance`, `fleet_telematics` all registered with actions (27/19/5/19/9/8/7/6). | **PASS** |

## Canonical-backend / competing-writer claims

This is where the release claim does not hold.

| Claim | Actual result | Verdict |
|---|---|---|
| "No competing writer for delivered canonical facts" | On a **fresh install**, `phase04.canonical_cutover` = **0 (disabled)** and `authority_retirement_locks` is **empty**. `canonicalAuthorityEnforced()` therefore returns true for **FINANCE only**. COMMERCIAL, INVENTORY, SALES, PROCUREMENT, POS and WORK_ITEM legacy writers remain **fully live** on `POST /api/collection` and `POST /api/record`. | **FAIL** — see [legacy-writer-retirement.md](legacy-writer-retirement.md). Finance alone is closed. |
| Checkpoint D/E domains are canonical end-to-end | The seven D/E domains had **no entry at all** in the legacy-writer strangler table and **no retirement lock definition**, so their legacy collections (`omni.workOrders`, `omni.boms`, `omni.assets`, `omni.fleet`, `omni.projects`, …) could not be refused even in principle. | **FAIL at entry — REMEDIATED** in this checkpoint (all 13 non-finance domains are now claimed and lockable). Enforcement itself remains owner-gated. |
| Legacy writers fail closed | True **only** for FINANCE today. The mechanism is correct and fails closed by design; it is simply not switched on for 12 of 13 domains. | **PARTIAL** |

## Operational-data and freeze claims

| Claim | Actual result | Verdict |
|---|---|---|
| Operational data unchanged | Entry and exit SHA-256 recorded for `database.db`, `-wal`, `-shm`, `database.json`. All verification ran on disposable temp databases. | **PASS** — see [operational-data-integrity.md](operational-data-integrity.md) |
| VNext frozen | HEAD `cf7ae4e…` and a 17-path dirty fingerprint recorded at entry and exit, identical. | **PASS** |
| Frozen zone untouched | No canonical authority claims `employees`, payroll, attendance, timesheet, or `omni.jobOrders` — asserted by test, not by inspection. | **PASS** |

## Claims that remain unproven

| Claim | Why unproven |
|---|---|
| Complete lifecycle browser proof for the 13 domains | No authenticated Chromium lifecycle runner exists for Checkpoint D/E. Opening a page is not a lifecycle. |
| Atomicity / failure injection | `tests/rollback` contains **0 test files**. |
| Concurrency | `tests/concurrency` contains **0 test files**. |
| Contract / integration / provenance / security suites | All four directories contain **0 test files**. Their "pass" is an absence of tests. |
| PostgreSQL execution | Not attempted at time of writing; see [postgresql-execution.md](postgresql-execution.md). |
| Backup/restore | Not attempted at time of writing; see [disposable-backup-restore.md](disposable-backup-restore.md). |

## Corrected finding — the Phase 02 "pre-existing failure"

The previous report recorded `tests/phase02/browser-live-evidence.test.mjs` as a
failing test inherited from the source commit.

Re-derived:

| Run | Command | Result |
|---|---|---|
| Whole-glob | `node --test "tests/phase02/*.test.mjs"` | tests 11, pass 10, **fail 1**, exit 1 (481 s) |
| Isolated | `node --test tests/phase02/browser-live-evidence.test.mjs` | tests 1, **pass 1**, fail 0, **exit 0** |

The same file **passes when run alone**. The failure is therefore **suite
interference** under the glob run — shared port/resource contention between
concurrent Phase 02 browser tests — and is not evidence of a product defect.
This reclassifies the finding: it is a **test-harness isolation defect**, not an
application defect. Recorded in [test-suite-register.md](test-suite-register.md)
and carried as an open item in [unresolved-risks.md](unresolved-risks.md).

## New defect found by Checkpoint F

| Defect | Evidence | Severity |
|---|---|---|
| A test module ships **enabled** in every production install | Migration `050_control_plane_module_management.mjs` inserts `checkpoint_c_test_module` with `status='enabled'`, plus a `control:test:ping` action and a `view_checkpoint_c_test_module` view routed at `checkpoint_c_test` under the `administration_preview` menu. Confirmed present and enabled on a fresh install. | **MEDIUM** — gated behind `control:admin`, so not a privilege issue, but a test fixture in the shipped module list, admin menu and licensing surface. Not remediated: the Checkpoint C suite asserts the module is enabled by default, so disabling it requires editing a passing test. Recommendation recorded in [unresolved-risks.md](unresolved-risks.md). |
