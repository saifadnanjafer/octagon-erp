# Startup Migration Policy (I1D-2 / I1D-3)

**Status: IMPLEMENTED AND PROVEN**
**Date:** 2026-07-30

Remediation for the [operational auto-migration incident](operational-auto-migration-incident.md).

## The problem

`server.js:2618` applied every pending migration on every boot:

```js
const migrationResult = await runMigrations({
  dbPath: SQLITE_DB_FILE, direction: 'up', actor: 'system'
});
```

The rule "do not apply migrations 046+ operationally" could not be honoured while
this existed — starting the application violated it. The rule needed to become
structural rather than procedural.

## The authority

`database/migration-runner/startup-policy.mjs`

### Classification is by database identity, not environment

An environment flag can be set by a stale shell, a copied script, or a test
harness. It must never be sufficient on its own to authorise migrating a live
store. Precedence is deliberate:

1. **Operational basename first.** `database.db` / `database.json` classify as
   operational *before* any environment variable is consulted.
2. **Contents can prove disposability.** A staged clone carrying the
   `cutover_staged_fixture` marker with `is_disposable = 1` is recognised even if
   it reuses an operational basename.
3. **Everything unproven is `unknown`,** which never auto-migrates.

| Class | Auto-migrate | Behaviour |
|---|---|---|
| `operational` | **never** | `status_only` at tip; **`refuse`** when behind |
| `production` | **never** | same |
| `staged_clone` | yes | requires disposable marker in its own contents |
| `disposable_fixture` | yes | requires disposable flag **and** disposable path |
| `test` | yes | test identity |
| `development` | no by default | opt-in via `OCTAGON_DEV_AUTO_MIGRATE` |
| `unknown` | **never** | fails closed |

### Operational behaviour

- **At repository tip:** server starts normally. Zero migration writes, no
  backup created, no ledger row inserted.
- **Behind repository tip:** startup throws
  `OPERATIONAL_MIGRATION_AUTHORIZATION_REQUIRED` before any business route becomes
  writable. The error carries current tip, repository tip, pending count, and the
  pending migration IDs.

### Server wiring

`server.js` now calls `enforceStartupMigrationPolicy()` instead of
`runMigrations()`. The stale comment claiming a bounded "001–012 suite" was
corrected to describe what the code actually does — a test asserts the old
wording cannot return.

## Explicit operational migration command — designed, NOT executed

Operational migration is separated from startup and must satisfy all of: explicit
`--operational`, owner-approved authorization manifest, exact target DB identity,
expected current tip, expected target tip, verified pre-migration backup, staged
rehearsal result, checksum health, clean readiness report, explicit actor.

No generic force flag. No environment-only bypass. **This command was not run
against operational data in this checkpoint.**

## Tests — `tests/migration/startup-policy.test.mjs`

```
PASS: operationalAtTipStartsWithoutWriting
PASS: operationalBehindRefusesAndChangesNothing
PASS: disposableAutoMigrates
PASS: unknownIdentityRefuses
PASS: environmentVariableAloneCannotAuthorise
PASS: operationalBasenameInTempIsStillOperational
PASS: productionClassification
PASS: developmentDefaultsToStatusOnly
PASS: serverBootstrapUsesPolicyAuthority
PASS: realChainOperationalRefusalAtTip045Shape (17 pending, refused, unchanged)

All startup migration policy tests passed.
```

| Requirement | Test | Proof |
|---|---|---|
| Operational at tip: zero writes | `operationalAtTipStartsWithoutWriting` | file compared byte-for-byte before/after |
| Operational behind: refuses | `operationalBehindRefusesAndChangesNothing` | typed error; hash and ledger unchanged |
| Disposable still auto-migrates | `disposableAutoMigrates` | 2 migrations applied |
| Unknown identity refuses | `unknownIdentityRefuses` | fails closed |
| Env var alone cannot authorise | `environmentVariableAloneCannotAuthorise` | all three hostile flags set; still `refuse` |
| Operational basename in temp | `operationalBasenameInTempIsStillOperational` | operational unless marker proves otherwise |
| Bootstrap uses the authority | `serverBootstrapUsesPolicyAuthority` | scans `server.js`; no direct up-call; stale comment gone |
| **Incident scenario** | `realChainOperationalRefusalAtTip045Shape` | real 62-migration chain, 17 pending — refused, database untouched |

The last test reproduces the incident exactly: a database 17 migrations behind
carrying the operational basename. Before this change it silently migrated; now
it fails closed with the database byte-identical.

### Test-harness corrections made during this slice

Recorded rather than hidden:

1. Two tests originally built their "behind" state by rolling back a database
   already named `database.db`. The I1B guard correctly refused. Fixed by
   building under a neutral name and renaming — the guard was right.
2. `require()` used in an ESM test file (third occurrence of this slip today).
   Fixed with a top-level import.
3. The bootstrap scan initially matched the incident write-up **comment** in
   `server.js`, which quotes the old call verbatim. Fixed to strip comments
   before scanning. A prose mention is not a call site.

## Historical immutability gate

`database/migration-manifests/historical-001-062.json` binds all 62 migrations to
sha256 checksums, the accepted source commit
`5cdf68bea374d93ccd547b8821875f3d70a9a402`, and an acceptance reason. Paths are
repo-relative — no machine-specific absolutes.

`tests/migration/historical_immutability.test.mjs`:

```
PASS: manifestIsWellFormed (62 entries, commit 5cdf68be)
PASS: historicalMigrationsMatchAcceptedHashes (62 verified)
PASS: migration014RemainsHistorical
PASS: compatibilityBehaviourLivesOutsideMigrations
PASS: everyMigrationOnDiskIsAccountedFor (62 on disk, 0 forward)
```

`migration014RemainsHistorical` additionally asserts the compatibility SQL has not
crept back into the migration file. Forward migrations numbered above 062 are
allowed; deleting an accepted migration fails.

## Suite result

```
$ npm run test:migration
✔ historical_immutability.test.mjs   (572ms)
✔ rollback-remediation.test.mjs   (11,670ms)
✔ runner.test.mjs                 (12,074ms)
✔ startup-policy.test.mjs          (7,492ms)
ℹ tests 4   ℹ pass 4   ℹ fail 0   EXIT=0

$ node scripts/precommit.js
Octagon precommit passed.
```

## Operational data during this slice

The operational server was **not started**. All work used disposable databases
under the OS temp directory. Verified unchanged against the incident baseline:

| File | SHA-256 | Status |
|---|---|---|
| `database.db` | `75cfc408ab7e224ea03294dfb6757afc326dc0c74cce16e099ffddd193524e8b` | unchanged |
| `database.db-wal` | `63ea57446e283a53a17bccc52a04dc33570120208b65c09f9c05ea0f52173b21` | unchanged |
| `database.db-shm` | `38619b106aab11d7e23fd17466714fdee55e9b76ac76536fdd71c151d052d743` | unchanged |
| `database.json` | `2e4d7d91b15b053d276cf1b5ac2b73524be3bd73da096e5ba925724b61c700a1` | unchanged |

Tip remains 062, legacy rows 4,067, `authority_retirement_locks` 0. No rollback
attempted. No WAL manipulation.

## Residual risk

The policy prevents *automatic* migration. It does not prevent a deliberate
`migrate.mjs up --db database.db`, which remains available and is the intended
owner-authorised path. The approval-manifest requirements above are designed but
**not yet implemented as enforced gates** on that command — that remains open work.
