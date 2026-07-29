# Checkpoint I — Rollback Remediation

**Date:** 2026-07-29
**Branch:** `cutover/octagon-operational-canonical-migration`
**Base:** `3a789d6`
**Scope:** the rollback defect found during I4. **I5 not started.**
**Result:** **REMEDIATED — verified on a disposable clone of the real populated database**

## The defect, as found in I4

`node scripts/migrate.mjs down` against a populated clone at tip 062:

```
MigrationRunnerError: Migration "014_finance_canonical_schema_and_coa" failed
during down: FOREIGN KEY constraint failed (errcode 787)
```

It left the clone at 14 migrations / 140 tables after dropping 214 — neither the
original tip nor a clean lower tip.

## Root causes — three, not one

The FK error was a symptom. Investigation on disposable clones found three
independent defects, each of which had to be fixed for rollback to work.

### 1. No rollback target

`runMigrations({ direction: 'down' })` selected **every** applied migration. There
was no way to say "undo the last one" or "go back to 045". An operator intending
a single-step undo would trigger a full teardown.

### 2. The run was not atomic

Each migration declares `transactionPolicy: 'required'`, so each was individually
wrapped in `BEGIN IMMEDIATE`/`COMMIT`. But the **sequence** had no transaction.
When step 49 failed, the 48 already-committed teardowns stayed committed.
Per-migration atomicity is not run atomicity.

### 3. `014.down()` left dependent data behind — two levels of it

Found empirically with `PRAGMA foreign_key_check` inside a deferred transaction,
not by reading the source:

**(a) Self-referencing chart of accounts.**
`finance_accounts.parent_id` references `finance_accounts(id)`. `DROP TABLE`
performs an implicit `DELETE FROM`, and on the real clone **11 of 16** account
rows point at a parent row in the same table, so the drop violated immediately.

**(b) A runtime-registered settings chain.**
After fixing (a), one violation remained, then another behind it:

```
settings_values.key -> platform_settings.key -> platform_modules.id
```

`014.down()` deleted its `platform_modules` row while
`finance.approval_authority.fail_closed` (a `platform_settings` row) and its
`settings_values` row still referenced it.

This chain is **runtime data, not migration seed data** — the rows carry
`created_at 2026-07-23` / `updated_at 2026-07-27` and are inserted by no
migration. That is precisely why no later migration's `down()` cleaned them up,
and why the defect could only surface against a realistic clone.

## Changes

### `database/migration-runner/index.mjs`

| Addition | Behaviour |
|---|---|
| `resolveRollbackSelection()` | Selects by `target` (unwind everything after it), `steps` (N most recent), or full chain. Rejects ambiguous/unknown/out-of-range input with typed error codes. |
| `databaseIsPopulated()` | True when any table outside `schema_migrations` holds a row. |
| `isOperationalDatabasePath()` | Classifies `database.db` / `database.json` by basename. |
| `assertRollbackAllowed()` | Refuses `down` against an operational path **before opening the file**. |
| Outer transaction for `down` | Whole rollback commits together or not at all; failure triggers `ROLLBACK` of every step. |
| `PRAGMA defer_foreign_keys = ON` | FK enforcement deferred to the outermost commit, so teardown order within a run does not matter. |

Forward migration behaviour is unchanged. `up` still runs per-migration
transactions and is **not** blocked by the operational-path guard, because
forward migration of the operational database is a legitimate owner-authorised
action. Only the destructive direction is refused.

### `database/migrations/014_finance_canonical_schema_and_coa.mjs`

`down()` only — `up()` is untouched, so no already-applied database changes shape.

1. `UPDATE finance_accounts SET parent_id = NULL` before the drops, so the
   rollback is safe even if the caller has not deferred foreign keys.
2. Delete `settings_values` for the module's setting keys, then
   `platform_settings`, then `platform_modules` — innermost dependency first.

### `scripts/migrate.mjs`

New flags: `--to <migration_id>`, `--steps <n>`, `--allow-full-chain`, plus usage
text stating that rollback is refused against the operational database.

## Tests

New file `tests/migration/rollback-remediation.test.mjs` — 8 cases, all real:

```
PASS: rollbackSelectionEdgeCases
PASS: operationalDatabaseRollbackRefused
PASS: successfulRollbackOnPopulatedClone
PASS: failedRollbackIsAtomic
PASS: fullChainRefusedOnPopulatedData
PASS: idempotentRerun
PASS: rollbackToTarget
PASS: migration014ForeignKeyDependency (16 accounts, 11 self-referencing)

All rollback remediation tests passed.
```

| Requirement | Test | How it proves it |
|---|---|---|
| Rollback to a specific target | `rollbackToTarget` | Full chain installed, rolled back to `013_…`; asserts tip is exactly the target, 001 survives, 014 and 062 are gone |
| Success on a populated clone | `successfulRollbackOnPopulatedClone` | Fixture migrations insert rows; `steps: 2` unwinds two, surviving table keeps its data |
| Failed rollback atomicity | `failedRollbackIsAtomic` | Fixture whose `002.down()` throws; asserts `schema_migrations` **and** the full table list are byte-identical to pre-attempt, including the step that ran *before* the failure |
| 014 FK dependency handling | `migration014ForeignKeyDependency` | Asserts the hazard exists first (populated CoA with self-referencing rows), then rolls back through 014 and asserts the tables are gone |
| Idempotent rerun | `idempotentRerun` | Second rollback to the same target does nothing; forward re-run restores and stays idempotent |
| Refusal on operational DB | `operationalDatabaseRollbackRefused` | Asserts `OPERATIONAL_ROLLBACK_REFUSED` fires on a **non-existent** path, proving the guard runs before any file is opened |

### Existing test adapted, not weakened

`runner.test.mjs::testDownRollback` previously did an unqualified full-chain
rollback. A fresh install seeds real rows, so it is populated and is now
correctly refused. The test was **strengthened**: it first asserts the refusal
fires, then repeats with `allowFullChain: true` and keeps its original
assertions.

### Suite result

```
$ npm run test:migration
✔ tests\migration\rollback-remediation.test.mjs (8809.8566ms)
✔ tests\migration\runner.test.mjs (9456.8409ms)
ℹ tests 2   ℹ pass 2   ℹ fail 0   ℹ skipped 0
EXIT=0

$ node scripts/precommit.js
Octagon precommit passed.   EXIT=0
```

## End-to-end proof on the real populated clone

Run against disposable copies of the staged clone (tip 062, 354 tables, 4,067
legacy rows) — the exact database that failed in I4.

### A. The original failing command is now refused

```
$ node scripts/migrate.mjs down --db <copy>
MigrationRunnerError: Refusing full-chain rollback on a populated database.
  code: 'FULL_CHAIN_ROLLBACK_REFUSED', details: { applied: 62 }
```

State after refusal: **62 migrations, 354 tables, 4,067 legacy rows — untouched.**

### B. Targeted rollback — the case that crashed at 014

```
$ node scripts/migrate.mjs down --db <copy> --to 013_governance_collection_cutover
rolled back: 49
mode: target   resultingTip: 013_governance_collection_cutover
status: {"applied":13,"pending":49}
```

Verified: tip exactly `013_…`, 129 tables, `finance_accounts` dropped, and
**4,067 legacy `collections` rows preserved** — rollback removed canonical schema
without touching legacy business data.

### C. Round trip

```
$ node scripts/migrate.mjs up --db <copy>
re-applied: 49   status: {"applied":62}
```

Back to tip 062 with **354 tables — identical to the original count** — and 4,067
legacy rows. The chain is now fully reversible and re-appliable.

### Intermediate failure — reported, not hidden

Between fixes (a) and (b), run B failed again at `COMMIT` with the deferred FK
check. That failure is itself evidence the atomicity fix works: the clone was
left at **62 applied / 354 tables / 4,067 rows — completely unchanged**. Under
the old runner the same failure destroyed 214 tables.

## Operational data integrity

Verified after every step. All three authoritative stores byte-identical to the
Checkpoint I pre-work baseline:

| File | SHA-256 |
|---|---|
| `database.db` | `1437550f7a5b84b9191bfde80b210fe73a29999470e216bed609cb7f16efd1f2` |
| `database.db-wal` | `4f7a1f51b2cb1bd97fe2df37c2533eb013afb31a0b476a990fc21b50a380c5ec` |
| `database.json` | `2e4d7d91b15b053d276cf1b5ac2b73524be3bd73da096e5ba925724b61c700a1` |

No `.env`, backup, upload, or runtime file was read or written. All work used
disposable clones under `temp/`, which is gitignored; the clones were deleted
afterwards. Credential scan for the owner-supplied literal: **0 matches** in
tracked content and in the worktree.

## PostgreSQL

No migration's dialect declaration was changed. 046–060 remain sqlite-only;
only 061 and 062 declare postgres. Nothing here claims PostgreSQL support that
does not exist. `PRAGMA defer_foreign_keys` is SQLite-specific and is applied
only on the SQLite path; a PostgreSQL rollback would need
`SET CONSTRAINTS ALL DEFERRED`, which is **not implemented and not claimed**.

## Observations not fixed (out of scope)

1. **Migration checksums are recorded but never verified.** `schema_migrations`
   stores a `checksum`, but no code compares it against the file on later runs.
   Editing an applied migration's source is therefore undetected. This is why
   changing `014.down()` cannot break the operational database at tip 045 — but
   it also means genuine drift would go unnoticed. Worth a future gate.
2. **`down` has no per-migration `rollbackPolicy` enforcement.**
   `051_checkpoint_c_control_entity_policy` is declared
   `irreversible-safety-correction`, yet the runner will still attempt its
   `down()`. Rolling back past 051 should arguably be refused outright.
3. **The settings dependency chain is hand-cleaned.** `platform_settings` and
   `settings_values` lack `ON DELETE CASCADE`, so every module-owning migration
   must remember this cleanup. 014 is now correct; sibling migrations were not
   audited for the same pattern.

## Status

The I4 rollback blocker is cleared. Rollback is targetable, atomic, fail-closed,
refused on the operational database, and proven on a disposable clone of the real
populated system.

**I5 was not started.**
