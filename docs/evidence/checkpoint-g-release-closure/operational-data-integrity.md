# Checkpoint G — operational data integrity

## Result: UNCHANGED

| File | Entry SHA-256 | Exit SHA-256 | Changed |
|---|---|---|---|
| `database.db` | `1437550f7a5b84b9191bfde80b210fe73a29999470e216bed609cb7f16efd1f2` | identical | **no** |
| `database.db-wal` | `4f7a1f51b2cb1bd97fe2df37c2533eb013afb31a0b476a990fc21b50a380c5ec` | identical | **no** |
| `database.db-shm` | `62dac42ec52f227a29c70481cdfa121f45f17c639e6f6ac743d51dc983fa8a18` | identical | **no** |
| `database.json` | `2e4d7d91b15b053d276cf1b5ac2b73524be3bd73da096e5ba925724b61c700a1` | identical | **no** |

The WAL is unchanged as well as the main database — a write committed to WAL but
not yet checkpointed would have shown there.

## How

Every database used by Checkpoint G was created by `freshInstall()` under
`os.tmpdir()` and destroyed afterwards:

- `octagon-ckg-cutover-*` — cutover controller rehearsal
- `octagon-ckg-concurrency-*` — multi-process races
- `octagon-ckg-failure-*` — 22-workflow failure injection
- `octagon-ckg-backup-*` — backup source and restore target
- scratchpad `g-fresh.db`, `g-seq.db` — migration probes

The operational store was never opened for write. No migration ran against it.
No canonical cutover was activated on it. No production backup or restore ran.

## Cutover safety, structurally

The cutover controller cannot be pointed at operational data even by mistake.
`assessDatabasePath()` refuses `database.db`, `database.json`, `database.db-wal`
and `database.db-shm` **by basename**, and treats any path it cannot prove
disposable as operational (`NOT_PROVABLY_DISPOSABLE`). Combined with the
`OCTAGON_DISPOSABLE_FIXTURE` flag and the non-production runtime-mode guard,
three independent conditions must hold. There is no bypass flag.

Asserted by `the operational database path is refused outright` and
`a path that cannot be proven disposable fails closed`.

## Frozen zone

Payroll, attendance and timesheet data were neither read for mutation nor
written. Enforced by test rather than intention: nine frozen paths — including
`omni.jobOrders`, the workshop execution chain — are asserted to be claimed by
**no** canonical authority, both before and after cutover activation.

## Opening inventory

The owner-approved opening inventory accounting date remains **unresolved**. It
was not invented and not defaulted. The production opening cutover and
activation gate remain fail-closed.
