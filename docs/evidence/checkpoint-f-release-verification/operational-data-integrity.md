# Checkpoint F — operational data integrity

## Result: UNCHANGED

Entry and exit SHA-256 are **identical for every file**.

| File | Entry SHA-256 | Exit SHA-256 | Changed |
|---|---|---|---|
| `database.db` | `1437550f7a5b84b9191bfde80b210fe73a29999470e216bed609cb7f16efd1f2` | `1437550f7a5b84b9191bfde80b210fe73a29999470e216bed609cb7f16efd1f2` | **no** |
| `database.db-wal` | `4f7a1f51b2cb1bd97fe2df37c2533eb013afb31a0b476a990fc21b50a380c5ec` | `4f7a1f51b2cb1bd97fe2df37c2533eb013afb31a0b476a990fc21b50a380c5ec` | **no** |
| `database.db-shm` | `62dac42ec52f227a29c70481cdfa121f45f17c639e6f6ac743d51dc983fa8a18` | `62dac42ec52f227a29c70481cdfa121f45f17c639e6f6ac743d51dc983fa8a18` | **no** |
| `database.json` | `2e4d7d91b15b053d276cf1b5ac2b73524be3bd73da096e5ba925724b61c700a1` | `2e4d7d91b15b053d276cf1b5ac2b73524be3bd73da096e5ba925724b61c700a1` | **no** |

The WAL is unchanged as well as the main database, which matters: a write that
had been committed to WAL but not yet checkpointed would have shown here.

## How this was achieved

Every verification ran against a **disposable** database created by
`freshInstall()` under the OS temp directory, then deleted:

- `scratchpad/rc-fresh.db` — registry probing, enforcement-state probing,
  migration rerun and status
- `scratchpad/rc-seq.db` — sequential upgrade from empty
- `os.tmpdir()/octagon-checkpoint-f-*` — authority coverage suite
- `os.tmpdir()/octagon-ckf-atomicity-*` — atomicity and idempotency suite
- `os.tmpdir()/octagon-ckf-xdomain-*` — cross-domain integrity suite

The live server was never started against the operational database. No
`POST /api/db`, `POST /api/collection` or `POST /api/record` was issued against
it — consistent with the standing rule that a partial `POST /api/db` can destroy
collections.

## Frozen zone

Payroll, attendance and timesheet data were neither read for mutation nor
written. No new payroll engine, calculator, or attendance import was created.

Enforced by test, not by intention:
`no canonical authority claims a frozen-zone path` asserts that **no** canonical
authority claims `employees`, `employee_advances`,
`employee_payroll_closings`, `payroll_payments`, `payroll_periods`,
`omni.employeeAttendance`, `omni.workshopAdvances`,
`omni.workshopTimesheetCases`, or `omni.jobOrders`.

`omni.jobOrders` was deliberately left unclaimed when the seven new authority
domains were registered — it is the workshop execution chain, a different
authority from MRP work orders, and remains protected by
`HARD_PROTECTED_COLLECTIONS`.

## VNext freeze

| | Entry | Exit | Changed |
|---|---|---|---|
| HEAD | `cf7ae4ed73eac91a325c964178036290bc0736c1` | `cf7ae4ed73eac91a325c964178036290bc0736c1` | **no** |
| Dirty paths | 17 | 17 | **no** |
| `git status --porcelain` SHA-256 | `bf69e28926ceee96c7b568e1748626dab2afb30ffa42fd7970e2ac1e6779eec6` | `bf69e28926ceee96c7b568e1748626dab2afb30ffa42fd7970e2ac1e6779eec6` | **no** |

VNext was read once, for the freeze fingerprint only. No modification, commit,
branch, migration, cleanup, or execution. No code was salvaged from it in this
checkpoint.

## Opening cutover

The owner-approved opening inventory accounting date remains **unresolved**. It
was not invented and not defaulted. The opening cutover and production
activation gate remain fail-closed. This did not block verification, because all
Checkpoint F work ran on disposable data.
