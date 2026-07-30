# Checkpoint J — Starting State and Completion Matrix (J0)

**Date:** 2026-07-30
**Branch:** `cutover/octagon-operational-canonical-migration`
**Minimum known SHA:** `b6b56f1701a1527692d0ac499feff486f3def207`
**Actual starting SHA:** `2566708086ea412b57d9d6635a411defd2730e3a` — the branch was **2 commits ahead**

## Commits after the minimum SHA

| SHA | Subject |
|---|---|
| `02cd692` | feat: complete Checkpoint I governed legacy-to-canonical cutover engine and staged migration |
| `2566708` | fix(integration-hub): resolve browser freeze by guarding MutationObserver render loop |

`02cd692` delivered 13 cutover modules, 5 test files and 10 evidence documents
(2,974 insertions). That work is real and is **not** repeated here.

## Uncommitted work found in the worktree — preserved, not touched

| Path | State |
|---|---|
| `app.js` | modified (+49) |
| `server.js` | modified (+176) |
| `platform/integrations/telegram-bot.cjs` | untracked, 128 lines |
| `tests/unit/telegram-bot.test.mjs` | untracked, 36 lines |

This is a Telegram-bot integration from another session, unrelated to Checkpoint J.
It was left exactly as found — not staged, not committed, not reverted. One stash
entry (`stash@{0}`, Phase 02 era) was listed and left untouched.

## Verification method

Every claim below was checked against something executable. Documents were not
accepted as evidence for themselves. The pipeline was run end to end on a
disposable staged clone and its real return values recorded.

---

## Completion matrix

| Item | Status | Executable evidence |
|---|---|---|
| I5A source inventory | **COMPLETE AND PROVEN** | `runSourceInventory` → 4,067 rows / 37 collections; 961 frozen, 1,233 non-business, 1,873 candidates |
| Mapping registry | **COMPLETE AND PROVEN** | `seedDefaultMappings` → 10 rules (5 UOM + location authority) |
| Cutover batch engine | **COMPLETE AND PROVEN** | `createCutoverBatch` → `cut_batch_*`, state `draft` |
| Lineage | **COMPLETE AND PROVEN** | 709 lineage rows for one batch |
| Quarantine | **COMPLETE AND PROVEN** | 5 rows: `legacy_demo_record` ×4, `quarantined_duplicate_location_definition` ×1 |
| Master-data migration | **COMPLETE AND PROVEN** | 78 migrated, 1 merged, 2 quarantined |
| Product migration | **COMPLETE AND PROVEN** | `product_templates` 8, `product_variants` 8 |
| Party migration | **COMPLETE AND PROVEN** | `parties` 6, `party_roles` 6 (demo customer excluded) |
| Warehouse / Location migration | **COMPLETE AND PROVEN** | `warehouses` 1, `stock_locations` 6; duplicate `LOC_MAIN` quarantined |
| Opening Inventory | **COMPLETE AND PROVEN** (accounting date OWNER-GATED) | 8 materials, on-hand 401, reserved 86, available 315, IQD 1,963,000, `reconciliationStatus: exact` |
| Finance 568-vs-568 equivalence | **COMPLETE AND PROVEN** | 568/568, 568 exact, 0 compatible-diff, 0 material mismatch, 0 unmatched either side, 0 hash breaks |
| Finance account/journal merge | **COMPLETE AND PROVEN** | 34 accounts + 5 journals merged; `finance_accounts` 16→50, `finance_journals` 6→11 |
| Finance history migration | **COMPLETE AND PROVEN** | 568 entries, 1,136 lines, debit = credit = 102,339,538; 568 validation rows skipped, not migrated |
| Operations migration | **COMPLETE AND PROVEN** | 7 BOMs, 7 routings, 7 QC plans, 3 QC inspections, 3 quarantined |
| Domain reconciliation | **COMPLETE AND PROVEN** | all four domains `reconciled`; per-metric rows `status: exact`, `difference: 0` |
| Idempotency | **COMPLETE AND PROVEN** | `tests/cutover/idempotency.test.mjs` passing |
| Cutover failure injection | **PARTIAL** | `tests/cutover/failure-injection.test.mjs` covers cutover guards only — the §18 domain matrix (Sales, Procurement, POS, Projects, Manufacturing, Quality, Assets, Maintenance, Fleet) is **not** covered |
| Cutover concurrency | **PARTIAL** | `tests/cutover/concurrency.test.mjs` covers multi-batch isolation — the §19 28-scenario independent-process matrix is **not** covered |
| Staged activation readiness | **IMPLEMENTED BUT UNPROVEN** | `assessStagedActivationReadiness` → `isReady: true`; actual lock activation + server restart + persistence not exercised |
| Legacy UI writer enumeration | **NOT STARTED** | no caller map exists |
| Legacy UI canonical adaptation | **NOT STARTED** | — |
| Staged activation (locks + HTTP refusal) | **NOT STARTED** | `authority_retirement_locks` never populated in any test |
| Backup / restore | **NOT STARTED** | no staged backup→restore→verify cycle |
| Browser lifecycle proof | **PARTIAL** | health-only mode proven in Chromium (Checkpoint I); the 27 §17 lifecycles are **not** proven |
| Release Health UI | **NOT STARTED** | server endpoint exists; no Administration page |
| Migration source checksums (I1C) | **NOT STARTED** | carried over from Checkpoint I |
| Operational migration authorization manifest (I1D-6) | **NOT STARTED** | carried over from Checkpoint I |
| PostgreSQL runtime | **NOT STARTED** | 046–060 remain SQLite-only regardless |

### Minor count corrections

The brief stated 1,232 non-business and 1,874 candidates. The engine reports
**1,233** and **1,873**. Frozen (961) and total (4,067) match exactly. The
one-record difference is a classification boundary, not a data discrepancy; the
engine's figures are used throughout since they are what the code actually
produces.

---

## DEFECT FOUND AND FIXED — cutover tests wrote to the operational database

**Severity: HIGH.** Found while verifying the suite rather than reading its docs.

All five cutover test files began with:

```js
const opDb = new SqliteDialect().open('database.db');
opDb.backup('database.db', tmpDb);
```

`SqliteDialect.open()` executes `PRAGMA journal_mode = WAL` and opens the file
**read-write**. Running the suite therefore wrote to the operational database
every time: the journal-mode toggle plus the checkpoint-on-close rewrote the file
header. The standing rule since Checkpoint I is that the operational database is
strictly read-only, and a test suite must never be the thing that breaks it.

### What changed and what did not

`database.db` moved from `75cfc408…` (end of Checkpoint I) to `acfd3ab8…`.

Verified afterwards, read-only:

| Check | Result |
|---|---|
| `PRAGMA integrity_check` | **ok** |
| `PRAGMA foreign_key_check` | **0 violations** |
| Migration tip | **062** — unchanged, no migration applied |
| Legacy `collections` | **4,067** — unchanged |
| `authority_retirement_locks` | **0** — cutover still inactive |
| Canonical business rows | **0** — nothing populated |
| `cutover_batches` | **table absent** — migration 063 correctly not applied operationally |
| `database.json` | `2e4d7d91…` — **unchanged** |

No business data changed. The delta is a SQLite header/journal-mode artefact.

### Attribution — stated honestly

I ran the suite during this session's verification step, so I am at minimum a
contributing cause. I did **not** hash `database.db` before that first run, so I
cannot prove whether the prior session's runs had already moved it. I am not
going to claim the change was pre-existing when I cannot demonstrate it.

`acfd3ab89e805abd49a724e2e177f75f14594b80861e3260639b387bca3a4683` is recorded as
the corrected operational baseline for the remainder of Checkpoint J.

### The fix

`tests/cutover/_staged-clone.mjs` takes a WAL-consistent snapshot through a
strictly **read-only** connection using the SQLite online backup API. A read-only
connection cannot change journal mode, cannot checkpoint, and cannot write the
header. The helper also:

- hashes the operational database before and after the snapshot and **throws** if
  it moved;
- stamps the disposable-fixture marker so the startup policy and cutover guards
  recognise the clone as staged.

All five test files now use it, and each asserts in its cleanup that the
operational hash is unchanged — so this regression fails the suite instead of
passing silently.

Re-run after the fix:

```
✔ Concurrency and Multi-Batch Isolation
✔ Full Pipeline Execution on Staged Disposable Clone
✔ Failure Injection & Operational Safety Guards
✔ Idempotency and Hash Consistency
✔ Staged Activation Readiness Evaluation
ℹ tests 5  ℹ pass 5  ℹ fail 0

operational BEFORE: acfd3ab89e805abd49a724e2e177f75f14594b80861e3260639b387bca3a4683
operational AFTER : acfd3ab89e805abd49a724e2e177f75f14594b80861e3260639b387bca3a4683
UNCHANGED
```

### My own errors during the fix

Both caught by the tooling and corrected:

1. The scripted import insertion placed the new import **inside** a multi-line
   `import { … }` block, producing `SyntaxError: Unexpected reserved word` in all
   five files. Fixed by anchoring on the last statement-terminating line.
2. I initially reported the suite as passing before noticing the harness opened
   the operational database — the pass was real, the safety property was not.

---

## Operational safety baseline for the rest of Checkpoint J

```
database.db    acfd3ab89e805abd49a724e2e177f75f14594b80861e3260639b387bca3a4683
database.json  2e4d7d91b15b053d276cf1b5ac2b73524be3bd73da096e5ba925724b61c700a1
```

Tip 062 · legacy 4,067 · canonical 0 · locks 0 · cutover inactive ·
credential unchanged · 063 not applied operationally.

**VNext:** `cf7ae4ed73eac91a325c964178036290bc0736c1`, 17 pre-existing dirty
files — untouched.

## Remaining work, in dependency order

1. Legacy UI writer enumeration and adaptation (J6) — nothing exists yet
2. Staged activation: real lock activation, restart persistence, HTTP writer refusal (J7)
3. Backup / restore cycle (J7)
4. Release Health Administration UI (J8)
5. Complete Chromium lifecycles (J8)
6. §18 failure-injection matrix and §19 concurrency matrix (J9)
7. Carried from Checkpoint I: migration checksums, operational authorization manifest, PostgreSQL

**Classification at J0: PARTIAL — REMEDIATION REQUIRED.**
