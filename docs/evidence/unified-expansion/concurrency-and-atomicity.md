# Concurrency and Atomicity

## Disposable source consistency

`runDisposableMigration` copies DB and WAL to an isolated staging directory,
re-fingerprints the source, and blocks on any component drift before migrating.
The staging database is consolidated with SQLite `VACUUM INTO`; WAL-only
committed facts are therefore present in the target.

The test `consolidates committed WAL facts without opening the source through
SQLite` holds a source connection open with `wal_autocheckpoint = 0`, commits
the material/warehouse/location only to a non-empty WAL, and proves the
disposable migration sees those facts while the WAL remains byte-identical.

## Migration transaction

All source mapping, stock, reservation, valuation, finance lifecycle, audit
relationships, and batch completion execute inside one outer `BEGIN IMMEDIATE`.
The Phase 03 finance engine participates in that transaction and does not insert
pre-posted rows.

Failure injection closes the target fiscal period. The migration raises
`OPENING_CUTOVER_PERIOD_UNAVAILABLE`; batch, stock move, and opening finance
document counts remain zero after rollback.

Existing Phase 04 atomicity tests also prove injected finance-port and outbox
failures roll back business facts, projections, audit, outbox, and idempotency.
