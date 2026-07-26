# Duplicate Authority Retirement

## Current findings

No new duplicate authority was added by Waves 0-1. Existing duplicates remain
and are not represented as retired.

| Priority | Duplicate | Evidence | Retirement gate |
|---|---|---|---|
| P0 | Phase 04 inventory/reservation writer | `services/stockService.js` directly mutates legacy `stock_moves`, quants, transfers, lots, and material reservations while canonical `platform/inventory/**` exists | WAL-aware migration, canonical UI adapter, parity, real browser, flag-on writer denial |
| P0 | Opening GL writer | `scripts/migrate_legacy_data.mjs` inserts posted finance rows directly beside `platform/finance/engine.mjs` | replace with Phase 03 create → submit → approve → post lifecycle |
| P0 | Finance client selection | `services/financeService.js` client flag defaults OFF although server generic finance guard is always enforced | server-authoritative cutover configuration and complete canonical client coverage |
| P0 | Phase 04 generic write routes | `/api/db`, `/api/collection`, `/api/record` reject Phase 04 changes only when the cutover flag is enabled | disposable acceptance activates flag and proves all protected paths reject mutations |
| P1 | Work Item/task persistence | canonical `work_items` exists beside `tasks`, Kanban cards, task manager, and work-order task views | migrate/reconcile every view and replace writes with Work Item commands |
| P1 | Commercial master persistence | canonical parties/products/pricing exist beside legacy customer/supplier/material structures | projection parity and UI/API cutover |

## Retirement rule

A row in `authority_retirement_locks`, a document statement, or a disabled
feature flag does not retire a writer. Retirement requires a runtime-unreachable
legacy mutation path or a fail-closed guard proven under the active accepted
configuration.

## Prohibited retirement

- Do not enable the cutover flag on the operational database.
- Do not delete legacy data or pages before parity and deep-link proof.
- Do not route around a missing canonical operation with direct SQL/JSON writes.
- Do not retire payroll, attendance, or timesheet behavior.
