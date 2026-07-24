# Migration Status and Policy

## Applied design

- Migrations 036-042 retain historical SQL behavior but now expose runner-recognized `dependsOn` metadata and complete `sourceProvenance`.
- Migration `043_phase04_canonical_registry_and_lineage.mjs` is additive and reversible.
- Operational `database.db` had migrations 001-034 at audit time. Therefore 036-042 were not treated as already-applied operational history.
- No migration command was executed against the operational database.

## Migration 043 scope

- Registers 7 Phase 04 modules, 25 entities, and 42 governed actions.
- Creates stock lot/serial/package and traceability facts.
- Creates immutable valuation, FIFO consumption, landed-cost, reservation, and stock-accounting linkage tables.
- Adds sales/procurement fulfilment and three-way-match facts.
- Adds POS finance/tax/payment configuration and linkage.
- Adds Work Item relations/watchers/approval/version support.
- Adds stable legacy source maps, quarantine, and migration-run records.
- Seeds `phase04.canonical_cutover` as disabled.

## Executable proof

`tests/phase04/migration_contract.test.mjs` covers:

- fresh install and idempotent rerun;
- sequential 042-to-043 upgrade;
- down/up rollback;
- injected registry failure rollback;
- parallel disposable installs with collision-safe backup paths.

The parallel test was added after a real collision exposed millisecond-only backup names. `database/migration-runner/index.mjs::backupBeforeMigration` now adds PID plus a cryptographic nonce.

All migrations use the actual `migration.dependsOn` graph. Migration 043 declares:

- owner: `platform.kernel`
- dialect: `sqlite`
- transaction policy: `required`
- rollback policy: `reversible`
- source provenance: independent Phase 04 remediation

The legacy rehearsal applies pending migrations only to the disposable byte copy. Its `BLOCKED` result is a data-reconciliation hard stop, not a schema-runner failure.
