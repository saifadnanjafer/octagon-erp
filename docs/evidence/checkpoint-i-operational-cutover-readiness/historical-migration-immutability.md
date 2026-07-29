# Checkpoint I — Historical Migration Immutability (I1B)

**Status: REMEDIATED**
**Date:** 2026-07-29

## The violation

The rollback-remediation slice (commit `2c1e79d`) edited
`database/migrations/014_finance_canonical_schema_and_coa.mjs` to make its
`down()` dependency-safe.

That was wrong. Migrations 001–062 are historical and immutable. Editing an
applied migration rewrites recorded history and, once source-checksum
enforcement lands (I1C), would register as tampering on every deployed database.

The fix itself was correct; its location was not.

## Restoration

`014_…` was restored from the source SHA and verified by blob hash, not by eye:

```
$ git checkout 5cdf68bea374d93ccd547b8821875f3d70a9a402 -- \
    database/migrations/014_finance_canonical_schema_and_coa.mjs

historical blob: 425c14c0f378a934092b22f01bc6075b83d2f144
worktree blob  : 425c14c0f378a934092b22f01bc6075b83d2f144
                 IDENTICAL
```

Whole-directory check against the same source SHA:

```
$ git diff --stat 5cdf68bea374d93ccd547b8821875f3d70a9a402 -- database/migrations/
(empty)
```

**No migration in 001–062 differs from its historical content.**

No Git history was rewritten. This is a normal forward corrective commit.

## Where the behaviour now lives

`database/migration-runner/rollback-compatibility.mjs` — runner-owned, forward-maintained.

The runner calls `applyPreDownCompatibility()` immediately before each
migration's own `down()`. Registered steps are keyed by migration id and are:

- narrowly scoped to one migration;
- limited to rows that migration's `down()` is about to orphan;
- idempotent and safe when the tables are already absent;
- documented with the concrete reproduced failure they prevent;
- reported in the run result as `compatibilityApplied`, so the intervention is
  visible rather than silent.

### Registered step: `014_finance_canonical_schema_and_coa`

| Helper | What it resolves |
|---|---|
| `breakSelfReference('finance_accounts', 'parent_id')` | `DROP TABLE` performs an implicit `DELETE FROM`; self-referencing rows violate the FK during the drop |
| `clearModuleSettings('finance_canonical')` | `settings_values.key → platform_settings.key → platform_modules.id`; runtime-registered settings are orphaned when the module row is deleted |

Neither helper destroys data the migration was not responsible for. `DELETE FROM
finance_accounts` is not used — only the self-reference is nulled, and the table
is then dropped by the migration's own unmodified `down()`.

Non-SQLite dialects fall through with an explicit `skipped` note rather than
silently claiming coverage that does not exist.

## Preserved rollback safety

All Checkpoint I rollback guarantees are intact:

| Guarantee | Status |
|---|---|
| Targeted rollback (`--to`, `--steps`) | preserved |
| Outer atomic transaction | preserved |
| Fail-closed — failed rollback changes nothing | preserved |
| Full-chain refusal on populated data | preserved |
| Operational-path rollback refusal | preserved |

## Re-proof on the realistic populated clone

Run against a disposable copy of the staged clone (tip 062, 354 tables, 4,067
legacy rows) with migration 014 at its **historical** content:

```
$ node scripts/migrate.mjs down --db <copy> --to 013_governance_collection_cutover
rolled back: 49   mode: target   tip: 013_governance_collection_cutover

compatibility applied:
[{"id":"014_finance_canonical_schema_and_coa",
  "detail":{
    "selfReference":{"table":"finance_accounts","column":"parent_id","cleared":10},
    "moduleSettings":{"moduleId":"finance_canonical","settingsValues":1,"settings":1}}}]
```

Verified: tip exactly `013_…`, `finance_accounts` dropped, **4,067 legacy rows
preserved**.

Round trip:

```
$ node scripts/migrate.mjs up --db <copy>
re-applied: 49   status: {"applied":62}
```

### Note on the count

The self-reference clear reports **10** rows here, where direct inspection of the
un-rolled-back clone measured **11** non-null `parent_id` values. The difference
is real, not a rounding artefact: by the time 014's pre-down step runs, 49 later
migrations have already been unwound, and one account row was removed by an
earlier `down()` in that sequence. Recorded rather than smoothed over.

## Test results

```
$ npm run test:migration
PASS: rollbackSelectionEdgeCases          PASS: freshInstall
PASS: operationalDatabaseRollbackRefused  PASS: statusAndReRun
PASS: successfulRollbackOnPopulatedClone  PASS: dependencyOrder
PASS: failedRollbackIsAtomic              PASS: dependencyCycleDetection
PASS: fullChainRefusedOnPopulatedData     PASS: missingDependency
PASS: idempotentRerun                     PASS: downRollback
PASS: rollbackToTarget                    PASS: concurrentRunLock
PASS: migration014ForeignKeyDependency    PASS: postgresDialectFailsClosed
       (16 accounts, 11 self-referencing)

ℹ tests 2   ℹ pass 2   ℹ fail 0   EXIT=0
```

`migration014ForeignKeyDependency` still passes unchanged — it asserts the hazard
exists on a freshly installed database and that rollback through 014 succeeds. It
never referenced the edited source, so it now proves the compatibility layer
rather than the edit.

## Operational data

No operational file was read or written during I1B. All work used disposable
clones under gitignored `temp/`, deleted afterwards.
