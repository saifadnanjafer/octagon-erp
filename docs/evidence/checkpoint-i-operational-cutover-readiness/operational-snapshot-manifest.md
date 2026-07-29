# Checkpoint I — Operational Snapshot Manifest (I2)

**Date:** 2026-07-29
**Tool:** [`scripts/cutover/create-staged-clone.mjs`](../../../scripts/cutover/create-staged-clone.mjs)
**Result:** `STAGED CLONE VERIFIED`

## Snapshot mechanism

The operational database was opened **read-only** (`DatabaseSync(path, { readOnly: true })`),
which makes a journal-mode change, schema write, or WAL checkpoint against the
operational file impossible at the driver level.

The snapshot itself used the **SQLite online backup API** (`node:sqlite` `backup`),
which produces a WAL-consistent point-in-time image including committed WAL
frames. A plain file copy was deliberately not used: with a 4.7 MB WAL present, a
raw copy of `database.db` alone would have silently omitted every committed
transaction still resident in the WAL.

The server was confirmed not running before the snapshot (no process listening on
the application ports; last operational write 2026-07-28 01:45).

## Operational source — before and after

| File | SHA-256 | Bytes | Unchanged |
|---|---|---:|---|
| `database.db` | `1437550f7a5b84b9191bfde80b210fe73a29999470e216bed609cb7f16efd1f2` | 17,084,416 | **YES** |
| `database.db-wal` | `4f7a1f51b2cb1bd97fe2df37c2533eb013afb31a0b476a990fc21b50a380c5ec` | 4,783,352 | **YES** |
| `database.json` | `2e4d7d91b15b053d276cf1b5ac2b73524be3bd73da096e5ba925724b61c700a1` | 6,309,472 | **YES** |
| `database.db-shm` | see note | 32,768 | **NO — expected** |

### Honest reporting of the `-shm` change

`database.db-shm` **did change** during this checkpoint:

```
pre-work baseline : 62dac42ec52f227a29c70481cdfa121f45f17c639e6f6ac743d51dc983fa8a18
after snapshot    : 479980d8730c8ee62235dd23974fbdc88715ae489714be6978f681d80597cbed
```

This is expected and benign. `-shm` is SQLite's **shared-memory index** for WAL
coordination. It is rebuilt whenever any connection — including a strictly
read-only one — attaches to a WAL-mode database. It contains no durable business
data and is reconstructed from the WAL on demand; deleting it is non-destructive.

Per the Checkpoint I instruction to "report the expected hash change honestly
rather than claiming the complete operational store stayed byte-identical":

> **The three authoritative stores (`database.db`, `database.db-wal`,
> `database.json`) are byte-identical to their pre-work baseline. The volatile
> `-shm` index changed as a side effect of read-only attachment. No operational
> business data was modified.**

## Staged target

| Property | Value |
|---|---|
| Directory | `temp/checkpoint-i-staged/checkpoint-i_2026-07-29T13-35-40-967Z/` |
| Database | `staged-disposable.db` |
| SHA-256 | `4cb0e6ba34f8de1c98d9f28ea382ffd1d57855f5079adba69c8b86c56719ddff` |
| Bytes | 17,084,416 |
| Legacy JSON | `staged-database.json` (`2e4d7d91…`, identical to source) |
| Disposable | yes — flagged in `cutover_staged_fixture` table |
| Committed to Git | **no** |

### Commit exclusion — verified

The staged clone is excluded by two independent `.gitignore` rules:

```
$ git check-ignore -v temp/checkpoint-i-staged/
.gitignore:77:temp/     temp/checkpoint-i-staged/
```

plus `.gitignore:23-24` (`*.db`, `*.db-*`). No operational data is committed.

### Disposability marker

The clone carries a `cutover_staged_fixture` row asserting `is_disposable = 1`
and recording the source database hash it was taken from. This is the anchor a
cutover path-guard can assert against before permitting destructive rehearsal
operations.

## Secret redaction

Credentials, sessions and login history were structurally preserved but emptied
so the staged environment cannot replay operational identity material:

| Table | Action |
|---|---|
| `identity_credentials` | cleared 3 rows |
| `identity_sessions` | cleared 6 rows |
| `identity_session_events` | cleared 23 rows |
| `identity_login_attempts` | cleared 27 rows |
| `identity_api_keys`, `identity_api_key_usage`, `identity_password_resets`, `identity_mfa_methods`, `identity_sso_logins`, `identity_federated_links`, `identity_service_accounts` | already empty — cleared 0 |
| `secret_values`, `secret_references`, `secret_events` | already empty — cleared 0 |

`identity_users` (7 rows) and the authorization tables were **retained**, since
role and permission structure is required input to the I1 identity-domain
migration. No password material accompanies them.

## Fidelity check

| Check | Result |
|---|---|
| Source tables | 268 |
| Staged tables | 269 (+ `cutover_staged_fixture`) |
| Source migration tip | `045_governed_master_data_and_inventory_actions` |
| Staged migration tip | `045_governed_master_data_and_inventory_actions` |
| Unexpected row-count mismatches | **0** |
| Legacy collections carried | 37 distinct / 4,067 rows |

Every non-redacted table in the clone matches the operational row count exactly,
and every redacted table is exactly zero. The clone is a faithful, secret-free,
WAL-consistent image of the operational system at migration tip 045.

## Path-guard proof

**Status: NOT YET EXECUTED.** Proving the canonical-cutover guard accepts the
staged path and refuses the operational path is part of I7 and has not been
performed. It is not claimed here.
