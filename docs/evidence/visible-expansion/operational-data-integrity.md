# Operational Data Integrity — Checkpoint C

## C1 baseline and C2 post-acceptance hashes

The preview launcher byte-staged four files to a temporary directory, verified
the SQLite hash against the source, and logged that operational `database.db`
was not opened.

| File | Bytes | Last write UTC | SHA-256 |
|---|---:|---|---|
| `database.db` | 17,084,416 | `2026-07-27T22:45:02.0877708Z` | `1437550f7a5b84b9191bfde80b210fe73a29999470e216bed609cb7f16efd1f2` |
| `database.db-wal` | 4,783,352 | `2026-07-27T22:45:11.6487270Z` | `4f7a1f51b2cb1bd97fe2df37c2533eb013afb31a0b476a990fc21b50a380c5ec` |
| `database.db-shm` | 32,768 | `2026-07-27T22:45:01.8614407Z` | `62dac42ec52f227a29c70481cdfa121f45f17c639e6f6ac743d51dc983fa8a18` |
| `database.json` | 6,309,472 | `2026-07-23T21:16:38.1176478Z` | `2e4d7d91b15b053d276cf1b5ac2b73524be3bd73da096e5ba925724b61c700a1` |

All browser mutations targeted the staged disposable copy. These ignored
runtime files are not staged for Git. The same byte counts, timestamps, and
SHA-256 values were re-recorded after the final C2 browser run.
