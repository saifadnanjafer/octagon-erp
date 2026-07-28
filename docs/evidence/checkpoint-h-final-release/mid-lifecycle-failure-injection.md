# Checkpoint H — mid-lifecycle failure injection

# RESULT: NOT PERFORMED in Checkpoint H. Coverage unchanged from Checkpoint G.

## Current state

| Injection kind | Coverage |
|---|---|
| **Command boundary** (precondition rejection at the entry point) | **22 of 22 named workflows** — Checkpoint G, `failure_injection_complete.test.mjs` 26/26 |
| **Mid-lifecycle** (fault after intermediate side effects begin) | **1 path only** — stock, via `tests/phase04/canonical_stock.test.mjs` |

The one genuine mid-lifecycle proof is real and worth naming: *"finance-port
failure rolls back stock, valuation, balances, audit, and outbox"* injects a
failure **after** the stock move would have been written and asserts that
`stock_moves`, `stock_valuation_facts`, `stock_quants` and `action_idempotency`
all end at zero rows. That is exactly the shape mission section 20 asks for —
for one of roughly forty listed injection points.

## What was not done

None of the injection points in mission section 20 were added: the Sales,
Procurement, POS, Projects, Manufacturing, Quality, Assets, Maintenance and
Fleet mid-lifecycle points remain unproven.

## Why

Mid-lifecycle injection is materially harder than command-boundary injection.
It needs a fully staged happy-path fixture per domain (a confirmed sales order
with reserved stock, an approved PO with a posted receipt, an open POS session
with payments, a released production order with issued materials), plus a fault
seam inside each engine at a specific point in the transaction.

Checkpoint H spent its capacity closing three blockers completely rather than
opening a fourth it could not finish. This is a deliberate scoping decision,
stated rather than hidden.

## What the existing evidence does and does not license

All governed actions share one `ActionExecutor.execute()` transaction boundary,
and the stock path demonstrates that boundary rolling back correctly under a
mid-flight fault. That is a reasonable *argument* that the other paths behave
the same way.

It is not proof. Each engine performs its own sequence of writes inside that
boundary, and a missing `throw` or a side effect performed outside the
transaction would not be caught by the shared-boundary argument. Twenty-one
workflows therefore have command-boundary proof only.

Recorded as a HIGH risk in unresolved-risks.md.
