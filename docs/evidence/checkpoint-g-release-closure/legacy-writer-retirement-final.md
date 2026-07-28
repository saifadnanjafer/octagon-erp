# Checkpoint G — legacy writer retirement (final)

## Writer classification

| Writer | Classification | State after disposable cutover |
|---|---|---|
| `POST /api/db` (full sync) | Canonical-guarded | Refuses any governed path whose value differs; also refuses emptying a `HARD_PROTECTED_COLLECTIONS` path |
| `POST /api/collection` | Canonical-guarded | Refuses every governed collection (403 `<DOMAIN>_CANONICAL_AUTHORITY_REQUIRED`) |
| `POST /api/record` | Canonical-guarded | Refuses every governed collection |
| `GET /api/db` | Read-only compatibility adapter | Permitted to remain |
| `POST /api/upload`, `/api/operation-lock/*`, `/api/backup*`, `/api/restore*` | Not business-fact writers | Out of scope |
| `/api/sequence/*`, `/api/auth/*` | Not business-fact writers | Out of scope |
| Payroll / attendance / timesheet writers | **Frozen-zone exception** | Untouched, and asserted to remain unclaimed |

No writer was deleted. No legacy page was removed. The remediation is
enforcement, not amputation — a legacy UI that mutates a governed fact now
fails closed with a message naming the canonical replacement
(`POST /api/v1/action/:actionId`).

## Governed collections proven to fail closed

All 28 resolve to an authority that is enforced after the disposable cutover
(`every governed legacy collection now maps to an enforced authority`):

| Domain | Collections |
|---|---|
| COMMERCIAL | `customers`, `suppliers`, `omni.materials`, `contacts` |
| INVENTORY | `quants`, `stock_moves`, `warehouses`, `locations`, `transfers` |
| SALES | `salesOrders`, `omni.crm`, `leads` |
| PROCUREMENT | `purchaseOrders` |
| POS | `posOrders` |
| WORK_ITEM | `tasks`, `omni.kanban.cards` |
| PROJECT | `omni.projects` |
| ENGINEERING | `omni.boms`, `omni.routings` |
| MANUFACTURING | `omni.workOrders`, `omni.productionOrders` |
| QUALITY | `omni.quality` |
| ASSET | `omni.assets` |
| MAINTENANCE | `omni.maintenance` |
| FLEET | `omni.fleet`, `omni.vehicles` |
| FINANCE | `account_moves`, `finance.accounts` |

## Frozen zone — proven untouched

Nine paths remain claimed by **no** canonical authority, asserted by
`the frozen zone is NOT captured by the cutover`:

`employees`, `employee_advances`, `employee_payroll_closings`,
`payroll_payments`, `payroll_periods`, `omni.employeeAttendance`,
`omni.workshopAdvances`, `omni.workshopTimesheetCases`, `omni.jobOrders`

`omni.jobOrders` is deliberately excluded from MANUFACTURING: it is the
workshop execution chain, a different authority from MRP work orders. Cutting
over must never start refusing the writes the running business depends on.

## The gap — stated plainly

This is **decision-layer** proof. The tests call
`createLegacyWriterRetirementGuard(db)` — the same constructor `server.js`
consults — so `enforced === true` is the same decision the server makes. But
**no HTTP request was issued against a running server with cutover active**, so
the transport wiring between that decision and an actual 403 response is
inferred from source, not observed.

Mission section 8 items 10–11 ("attempt every legacy generic writer", "prove
every governed legacy write is denied") are therefore **NOT fully satisfied**.
Recorded in [unresolved-risks.md](unresolved-risks.md).

## Not audited

Direct SQLite writes outside domain engines, legacy page submit handlers, and
JSON compatibility writers in `app.js` were **not** individually enumerated in
this checkpoint. The three generic HTTP writers were audited; the client-side
call sites that use them were not.
