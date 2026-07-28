# Checkpoint H — operational data integrity

## Result: UNCHANGED

| File | Entry SHA-256 | Exit SHA-256 | Changed |
|---|---|---|---|
| `database.db` | `1437550f7a5b84b9191bfde80b210fe73a29999470e216bed609cb7f16efd1f2` | identical | **no** |
| `database.db-wal` | `4f7a1f51b2cb1bd97fe2df37c2533eb013afb31a0b476a990fc21b50a380c5ec` | identical | **no** |
| `database.db-shm` | `62dac42ec52f227a29c70481cdfa121f45f17c639e6f6ac743d51dc983fa8a18` | identical | **no** |
| `database.json` | `2e4d7d91b15b053d276cf1b5ac2b73524be3bd73da096e5ba925724b61c700a1` | identical | **no** |

Identical across Checkpoints F, G **and** H.

## The one time operational data was touched at all

Checkpoint H is the first checkpoint to read the operational database. It was
read for the warehouse duplicate gate, and it was done as safely as the
inspection allows:

1. A WAL-aware **copy** was taken first (`.db`, `.db-wal`, `.db-shm` together).
2. Every query ran against the copy, not the original.
3. The copy was opened with `{ readOnly: true }`.
4. Read-only enforcement was **proved** — an attempted `CREATE TABLE` returned
   `attempt to write a readonly database`.

No migration was run on operational data. No temporary table was created inside
it. No vacuum, normalise, repair or lock. No canonical cutover activated. No
production backup or restore. No browser fixture written into it.

## Disposable databases used

All under `os.tmpdir()`, destroyed afterwards:

- `octagon-ckh-http-*` — real server + HTTP writer refusal
- `octagon-ckh-health-*` — release health
- `opgate/op.db` (scratchpad) — the read-only copy of the operational store

## Cutover safety, structurally

The cutover controller cannot be pointed at operational data.
`assessDatabasePath()` refuses `database.db`, `database.json`, `database.db-wal`
and `database.db-shm` by basename and treats anything not provably disposable as
operational. Three independent guards must hold; there is no bypass flag.

## Frozen zone

Payroll, attendance and timesheet data were neither read for mutation nor
written. Checkpoint H additionally proved over **real HTTP** that the frozen-zone
paths (`employees`, `omni.employeeAttendance`, `omni.workshopTimesheetCases`,
`omni.jobOrders`) are NOT refused by the cutover — so activating it does not
break the writers the running workshop depends on.

## Opening inventory

The owner-approved opening inventory accounting date remains **unresolved**. It
was not invented and not defaulted. `GET /api/release/health` reports
`opening_inventory_gate` as **blocked**, and a regression test asserts it can
never report otherwise.
