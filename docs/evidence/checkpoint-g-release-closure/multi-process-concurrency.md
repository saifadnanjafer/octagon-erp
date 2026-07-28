# Checkpoint G — multi-process concurrency

Closes Checkpoint F blocker H3.

Test: `tests/checkpoint-g/multi_process_concurrency.test.mjs` — **5/5 pass**
Worker: `tests/checkpoint-g/concurrency-worker.mjs`

## Why the previous evidence was insufficient

Checkpoint F used `Promise.all` inside one process. The synchronous SQLite
driver serialises those calls inside a single event loop, so it proved the dedup
branch is reachable and nothing about two OS processes writing the same file.

## Method

Every contender is a separate `node` process spawned with `execFile`, each
opening its **own** database connection to the same disposable SQLite file.
Workers are released against a shared wall-clock barrier and busy-wait to it, so
they collide rather than queue behind each other's module-load cost — without
that, ESM graph loading dominates and the race never actually happens.

Distinct OS process ids are **asserted**, not assumed: 4 distinct pids, none
equal to the parent.

The disposable canonical cutover is active on the fixture, so contention is
exercised under the enforcement the release candidate targets.

## What counts as a correct outcome

Under real contention SQLite may reject a writer with `SQLITE_BUSY`, and the
domain engine may reject with insufficient stock or a duplicate error. Both are
deterministic rejections and are acceptable. Assertions are therefore on final
**server facts**, never on which process won.

## Results

| Case | Assertion | Result |
|---|---|---|
| Separate processes | 4 distinct pids, none the parent | PASS |
| Simultaneous stock reservation | 4 processes x 4 units against 10 on hand (16 demanded). At least one winner AND at least one loser; `onHand` unchanged at 10; `reserved <= onHand`; `available >= 0`; `reserved + available == onHand` | PASS — **no oversubscription** |
| Repeated idempotency key across processes | 4 processes, one key → exactly 1 party row, exactly 1 `action_idempotency` row, at most 1 distinct returned id | PASS — **no duplicate posting** |
| Duplicate warehouse code across processes | 4 processes, distinct keys, same business code → at most 1 warehouse | **FAILED first, then fixed — see below** |
| Post-race consistency | `PRAGMA integrity_check` = ok; quant still reconciles | PASS — **no deadlock residue** |

## Defect found and fixed

The warehouse case failed on first run: **four processes each created a
warehouse with code `RACEWH`, and all four succeeded.**

Before writing a fix I checked whether it was actually a race. It was not —
creating two warehouses with the same code **sequentially** also succeeds. The
`warehouses` table carried only its primary-key autoindex and had no uniqueness
constraint on the business identifier at all. Product SKU is already protected,
so this was a targeted gap, not a systemic one.

It matters beyond tidiness: warehouse code is the human-facing identifier used
in lookups, transfers and reporting, and duplicates silently split a location's
stock across two records that look identical to an operator.

**Migration `062_warehouse_code_uniqueness`** adds a unique index on
`warehouses(company_id, code)`. If an installation already holds duplicates the
migration **throws with an actionable message** rather than silently skipping
the constraint or picking a winner and deleting stock-bearing records —
resolving real duplicates is an owner decision about real stock.

## Cases NOT exercised

The mission names 18 concurrency cases; 4 were exercised. Not exercised:
simultaneous receipt validation, duplicate sales confirmation, duplicate PO
approval, simultaneous limited-stock POS sale, duplicate POS payment, duplicate
project billing, duplicate BOM approval, duplicate production release,
simultaneous material issue, duplicate production completion, simultaneous
quality release, duplicate capitalization, duplicate depreciation run,
simultaneous maintenance parts issue, duplicate fleet fuel transaction,
concurrent Work Item transition.

They share the executor's transaction boundary and idempotency ledger, which the
exercised cases prove sound — but shared code is an argument, not a proof.
Recorded in [unresolved-risks.md](unresolved-risks.md).
