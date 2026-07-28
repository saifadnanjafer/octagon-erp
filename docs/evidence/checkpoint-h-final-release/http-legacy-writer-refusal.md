# Checkpoint H — legacy writer refusal over real HTTP

Closes Checkpoint G blocker 3.

Test: `tests/checkpoint-h/http_legacy_writer_refusal.test.mjs` — **62/62 pass**

## Why this was still open

Checkpoint G proved refusal at the **decision layer**: it called
`createLegacyWriterRetirementGuard(db)` — the same constructor `server.js`
consults — and showed every governed collection resolved to an enforced
authority. What it never did was issue an HTTP request and observe a refusal, so
the wiring between that decision and a real response was inferred from source.

## Method

The real `server.js` is spawned on a disposable OS-allocated port against a
disposable database with canonical cutover **active**, then authenticated as the
**owner** — deliberately the highest-privilege user, so a 403 cannot be
misread as an ordinary permission failure.

Two preconditions are asserted before any write attempt:

- the fixture really has cutover active (all 13 domains enforced);
- the owner session really is established (`GET /api/auth/session` → 200).

## Results — 40 observed HTTP refusals

Every governed collection, on both generic per-collection routes:

| Domain | Collection | `POST /api/collection` | `POST /api/record` |
|---|---|---|---|
| COMMERCIAL | `customers` | 403 | 403 |
| COMMERCIAL | `suppliers` | 403 | 403 |
| COMMERCIAL | `omni.materials` | 403 | 403 |
| INVENTORY | `warehouses` | 403 | 403 |
| INVENTORY | `locations` | 403 | 403 |
| INVENTORY | `quants` | 403 | 403 |
| INVENTORY | `stock_moves` | 403 | 403 |
| SALES | `salesOrders` | 403 | 403 |
| PROCUREMENT | `purchaseOrders` | 403 | 403 |
| POS | `posOrders` | 403 | 403 |
| WORK_ITEM | `tasks` | 403 | 403 |
| PROJECT | `omni.projects` | 403 | 403 |
| ENGINEERING | `omni.boms` | 403 | 403 |
| MANUFACTURING | `omni.workOrders` | 403 | 403 |
| QUALITY | `omni.quality` | 403 | 403 |
| ASSET | `omni.assets` | 403 | 403 |
| MAINTENANCE | `omni.maintenance` | 403 | 403 |
| FLEET | `omni.fleet` | 403 | 403 |
| FINANCE | `account_moves` | 403 | 403 |
| FINANCE | `finance.accounts` | 403 | 403 |

Each refusal was asserted to carry:

- `ok: false`
- `code: <DOMAIN>_CANONICAL_AUTHORITY_REQUIRED` — the exact domain, not a
  generic error
- an error message naming the canonical replacement,
  `POST /api/v1/action/:actionId`

## Full-state route

| Case | Route | Observed |
|---|---|---|
| Mutating a governed path | `POST /api/db` with `X-Octagon-Full-Sync: yes` | **409** `COMMERCIAL_CANONICAL_AUTHORITY_REQUIRED`, `collection: "customers"` — it names the offending path |
| Missing intent header | `POST /api/db` bare | **409** — still bounced |
| Unauthenticated | `POST /api/collection` with no cookie | **401/403** — never reaches the authority check |

## Frozen-zone negative control

This is the control that proves the cutover did not overreach. These paths must
**not** be refused, because they are the writers the running workshop depends
on:

`employees`, `omni.employeeAttendance`, `omni.workshopTimesheetCases`,
`omni.jobOrders`

All four returned a status other than 403 and no
`*_CANONICAL_AUTHORITY_REQUIRED` code. Payroll, attendance, timesheet and the
workshop job-order chain remain outside canonical retirement, deliberately.

## Nothing reached the database

The HTTP status is half the proof. The other half, asserted against the fixture
database after all 40 attempts:

- **0** outbox events referencing any probe record;
- **0** audit entries referencing any probe record;
- **0** audit rows with `result='success'` for any probe record;
- `parties`, `warehouses`, `stock_moves`, `stock_quants`, `work_items` all still
  at **0 rows**.

## Compatibility adapters

No compatibility adapter that routes a legacy call through a canonical command
was found or exercised. The current design refuses rather than adapts. That is a
deliberate choice by the original authors — the refusal names the canonical
replacement — but it means a legacy UI page writing a governed collection will
**fail** after cutover rather than silently keep working. Recorded in
[unresolved-risks.md](unresolved-risks.md).
