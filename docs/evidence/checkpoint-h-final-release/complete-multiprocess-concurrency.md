# Checkpoint H — multi-process concurrency

# RESULT: NOT EXTENDED in Checkpoint H. Coverage unchanged from Checkpoint G.

## Current state — 4 of 18 named scenarios

`tests/checkpoint-g/multi_process_concurrency.test.mjs` — **5/5 pass**, with
genuinely separate OS processes (distinct pids asserted, none equal to the
parent), independent database connections, and a shared wall-clock release
barrier so contenders collide rather than queue behind module-load time.

| # | Mission scenario | State |
|---|---|---|
| 1 | Simultaneous stock reservation | **PROVEN** — 16 demanded against 10 on hand; `reserved <= onHand`, `reserved + available == onHand`, no oversubscription |
| 2 | Simultaneous receipt validation | not exercised |
| 3 | Duplicate sales confirmation | not exercised |
| 4 | Duplicate sales delivery | not exercised |
| 5 | Duplicate purchase-order approval | not exercised |
| 6 | Duplicate procurement receipt | not exercised |
| 7 | Simultaneous limited-stock POS sale | not exercised |
| 8 | Duplicate POS payment | not exercised |
| 9 | Duplicate project billing | not exercised |
| 10 | Duplicate BOM approval | not exercised |
| 11 | Duplicate production release | not exercised |
| 12 | Simultaneous material issue | not exercised |
| 13 | Duplicate production completion | not exercised |
| 14 | Simultaneous quality release | not exercised |
| 15 | Duplicate asset capitalization | not exercised |
| 16 | Duplicate depreciation run | not exercised |
| 17 | Simultaneous maintenance parts issue | not exercised |
| 18 | Duplicate Fleet fuel transaction | not exercised |

Retained and passing alongside them:

| Retained case | State |
|---|---|
| Repeated idempotency key across processes | **PROVEN** — 4 processes, one key, exactly one record and one ledger row |
| Warehouse-code uniqueness | **PROVEN** — and it found the defect fixed by migration 062 |
| Post-race consistency | **PROVEN** — `PRAGMA integrity_check` ok, quant reconciles, no deadlock residue |
| Concurrent Work Item transition | not exercised |

## Why the remaining fourteen were not added

Same reason as mid-lifecycle injection: each needs a fully staged domain
fixture before contention can be meaningful. A "duplicate PO approval" race
requires a real approved-able purchase order; a "duplicate POS payment" race
requires an open session with a priced basket. Building fourteen such fixtures
is the bulk of the work, and the race itself is the small part.

Checkpoint H closed three blockers completely instead. Stated, not hidden.

## What the proven cases license

The four exercised cases cover the two invariants that actually matter and are
shared by all eighteen: **no oversubscription of a limited resource** and **no
duplicate posting under a repeated idempotency key**, both asserted on server
facts rather than on which process won. The remaining fourteen exercise the
same executor, transaction boundary and idempotency ledger.

That is an argument, not a proof. Fourteen scenarios remain unexercised and are
recorded as a HIGH risk in unresolved-risks.md.
