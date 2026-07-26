# Legacy Data Reconciliation

## Operational source observation

Command:

`node scripts/inspect_legacy_opening_snapshot.mjs database.db`

Exit code: `0` on 2026-07-26.

The inspector staged DB+WAL byte copies, opened only the staging path, and
verified all four source components unchanged.

| Measure | Current source |
|---|---:|
| Materials | 8 |
| On hand | 401 |
| Reserved | 86 |
| Available | 315 |
| Valuation | IQD 1,963,000 |
| Positive-on-hand materials with invalid cost | 0 |

Component SHA256 values before and after:

- `database.db`: `36da81437da7383c9ec42bc9b15f6ace8d99d18e9e1d8bd6907262a7a4c106c5`
- `database.db-wal`: `a650756a7f3a9fe8070925df59eca0b645a3c0c258b525188d45943ca8bbcd41`
- `database.db-shm`: `41d846cd9e5d2438ee017e407e4d11a97c8bb27e08ef8c8a89367ebdc21c01ef`
- `database.json`: `2e4d7d91b15b053d276cf1b5ac2b73524be3bd73da096e5ba925724b61c700a1`

## Disposable fixture reconciliation

`tests/phase04/opening_cutover_phase04.test.mjs` proves:

- 401 source = 401 canonical on hand;
- 86 source = 86 canonical reserved;
- 315 source = 315 canonical available;
- IQD 1,963,000 source valuation = canonical valuation = GL debit;
- GL debit = GL credit = IQD 1,963,000;
- 8 source materials = 8 batch lines = 8 opening moves = 8 valuation facts;
- exactly one opening finance document and one hashed journal entry;
- second run adds no facts;
- closed-period failure rolls every migrated fact back.

This is fixture-backed deterministic proof, not a completed migration of the
operational source. The latter remains blocked by the missing approved date.
