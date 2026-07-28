# Checkpoint G — disposable backup and restore

Closes Checkpoint F blocker H2.

Test: `tests/checkpoint-g/disposable_backup_restore.test.mjs` — **10/10 pass**

No operational backup or restore was run. Both databases were disposable, under
`os.tmpdir()/octagon-ckg-backup-*`, and were destroyed afterwards.

## Sequence executed

1. Fresh disposable database, migrations 001–062 applied.
2. **Disposable canonical cutover activated**, so the backup carries cutover state.
3. Representative cross-domain facts staged:
   - Party (customer) and Party (supplier), each with roles
   - Warehouse, supplier location
   - UOM category + UOM, product category + product
   - A valued `stock:move:post` receipt of 12 units — producing a stock move,
     move line, quant, valuation fact **and** a stock-to-GL link
   - Asset category + asset
4. Backup created via `backupBeforeMigration()`.
5. Manifest written: timestamp, paths, byte size, SHA-256, schema fingerprint,
   and per-table counts.
6. Restored into a **second isolated path**.
7. Verified (below).
8. Both environments destroyed.

## Results

| Check | Result |
|---|---|
| Backup exists and is non-trivial (>100 KB) | PASS |
| Backup SHA-256 is stable between reads | PASS |
| Restored copy byte-identical to the backup | PASS |
| All migrations report applied on the restored database | PASS |
| Schema fingerprint identical to source | PASS |
| All 19 critical table counts identical | PASS |
| Stock move keeps its valuation fact link | PASS |
| Stock move keeps its stock-to-GL link | PASS |
| Party keeps its roles | PASS |
| Audit chain length unchanged | PASS |
| Outbox state unchanged | PASS |
| **All 13 cutover locks still enforced after restore** | PASS |
| Arabic text uncorrupted by the round trip | PASS |
| `PRAGMA integrity_check` = ok | PASS |
| No live sessions copied | PASS |
| `secret_values` empty in the backup | PASS |
| No populated MFA secrets | PASS |
| `platform_settings.secret` holds only flag-length values | PASS |

## Two findings worth naming

**Restoring does not reopen a legacy back door.** A restored database still
reports all 13 domains enforced. A restore that silently reverted cutover would
be a severe regression — operators would believe the back door was shut.

**Arabic survives the round trip.** The staged customer name
`زبون النسخ الاحتياطي` reads back byte-correct. Given this project's history of
mojibake corruption through tooling, this is worth asserting rather than
assuming.

## A correction to my own test

My first version flagged `platform_settings.secret` and
`identity_mfa_methods.secret` as leaked credential columns, purely by column
name. That was a false positive: `platform_settings.secret` is a
**one-character boolean flag** marking a setting as secret-bearing, and
migration 008 is explicit that a secret *value* never lands in settings —
only a reference does, with values in `secret_values`.

The assertion was replaced with the real check: `secret_values` empty, MFA
secrets empty, and the flag column never longer than one character. The schema
was right; my heuristic was wrong.

## Not covered

`POST /api/backup`, `GET /api/backup/verify` and `POST /api/restore/dry-run`
were **not** exercised over HTTP. This proof covers the migration-runner backup
path, not the server's backup endpoints.
