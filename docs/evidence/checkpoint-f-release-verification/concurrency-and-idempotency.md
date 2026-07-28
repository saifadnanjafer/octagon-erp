# Checkpoint F — concurrency and idempotency

`tests/concurrency` contained **zero test files** at the source commit.

Test: `tests/checkpoint-f/atomicity_and_idempotency.test.mjs` — 9/9 pass.

## Idempotency — proved

| Case | Assertion | Result |
|---|---|---|
| Repeat the same key | `party:create` twice with one key → `parties` count +1, same returned id | PASS |
| Distinct keys not conflated | two `warehouse:create` with different keys → count +2, different ids | PASS |
| Interleaved duplicate submission | two `assets:category:create` submitted through the microtask queue with one key → `asset_categories` count +1, identical ids | PASS |
| Replay protection is durable | a row exists in `action_idempotency` for the key | PASS |

Server facts — row counts and the idempotency ledger — are the assertion. No
timing-sensitive DOM row count is used anywhere.

## Concurrency — scope stated honestly

The executor runs against a **synchronous** SQLite driver inside a single
process. Two `execute()` calls cannot physically overlap in this runtime.

What the interleaved test proves: under duplicate and interleaved submission —
the real-world failure mode, i.e. double-click, client retry, at-least-once
delivery — the second submission takes the dedup path instead of inserting
again.

What it does **not** prove: behaviour when two OS processes write the same
SQLite file concurrently. The 17 concurrency cases named in the mission
(simultaneous stock reservation, duplicate PO approval, simultaneous material
issue, concurrent Work Item transition, and the rest) were **not** exercised
under genuine multi-process contention.

This matters for this deployment specifically: the project has a recorded
dual-server WAL incident, and `operation_locks` plus `/api/operation-lock/*`
exist precisely because a client-side in-memory lock could not close a cross-tab
race. Those server-side locks were **not** load-tested here.

**Classification: multi-process concurrency is UNPROVEN.** Recorded in
[unresolved-risks.md](unresolved-risks.md), and one of the reasons this
checkpoint is not a release-candidate verification.
