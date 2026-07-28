# Checkpoint G — failure injection

Closes Checkpoint F blocker H5 for entry-point injection.

Test: `tests/checkpoint-g/failure_injection_complete.test.mjs` — **26/26 pass**

## What kind of injection this is

Each workflow is invoked through its **real registered canonical action** with a
deliberately unsatisfiable precondition: a parent document that does not exist.
The action must reject, and the system must be unchanged afterwards.

This is **entry-point precondition injection**, not **mid-lifecycle fault
injection**. It proves a command that cannot legally proceed leaves no orphan,
no partial posting and no false event. It does **not** prove behaviour when a
fault occurs half-way through an otherwise valid posting.

A guard test asserts all 22 actions genuinely exist in `platform_actions` first,
so a typo or renamed action fails loudly instead of passing vacuously.

## Every named workflow has a result

| # | Workflow | Action | Result |
|---|---|---|---|
| 1 | Sales confirmation | `sales:order:confirm` | PASS |
| 2 | Sales reservation | `sales:order:reserve` | PASS |
| 3 | Delivery | `sales:delivery:post` | PASS |
| 4 | Procurement approval | `procurement:order:approve` | PASS |
| 5 | Receipt | `procurement:receipt:post` | PASS |
| 6 | Three-way match | `procurement:threewaymatch:perform` | PASS |
| 7 | Supplier bill request | `procurement:bill_request:create` | PASS |
| 8 | POS payment | `pos:order:process` | PASS |
| 9 | POS stock posting | `pos:order:process` (with lines) | PASS |
| 10 | POS Finance posting | `pos:session:close` | PASS |
| 11 | Project billing request | `projects:billing:request` | PASS |
| 12 | Production release | `manufacturing:order:release` | PASS |
| 13 | Material issue | `manufacturing:material:issue` | PASS |
| 14 | Production completion | `manufacturing:order:complete` | PASS |
| 15 | Quality hold | `quality:inspection:fail` | PASS |
| 16 | Quality release | `quality:inspection:release` | PASS |
| 17 | Asset capitalization | `assets:asset:capitalize` | PASS |
| 18 | Depreciation posting request | `assets:asset:post_depreciation_request` | PASS |
| 19 | Maintenance parts issue | `maintenance:order:issue_parts` | PASS |
| 20 | Maintenance completion | `maintenance:order:complete` | PASS |
| 21 | Fleet fuel posting | `fleet:fuel:record` | PASS |
| 22 | Work item transition | `work_item:transition` | PASS |
| 23 | Audit | append-only, no duplicate ids | PASS |
| 24 | Outbox | zero events referencing the nonexistent parent | PASS |

## Asserted after every rejection

- **No residue** across 24 tables: stock moves, move lines, quants,
  reservations, valuation facts, stock-to-GL links, account moves, payments,
  sale/purchase/POS orders, production orders, material issues, cost summaries,
  inspections, NCRs, assets, depreciation schedules, maintenance orders, fleet
  trips, fuel logs, work items, projects, outbox.
- **No outbox event** announcing work that never happened — the decisive one,
  because a false event propagates a lie to every downstream consumer.
- **Audit never shrinks** — a rejection cannot rewrite history.
- **The idempotency key is not burned.** A failed command must not consume its
  key, or a legitimate retry after fixing the input would be silently swallowed
  as a replay. This is the subtle failure mode most systems get wrong.

Plus, after all 22 rejections: `PRAGMA integrity_check` = ok, and a valid
`party:create` still succeeds — 22 rejections did not wedge the executor.

## What is NOT proven

Mid-lifecycle fault injection per workflow. That case is covered for stock by
`tests/phase04/canonical_stock.test.mjs` ("finance-port failure rolls back
stock, valuation, balances, audit, and outbox"), which is genuine mid-flight
rollback proof — but only for that one path. The other 21 workflows have
entry-point proof only.
