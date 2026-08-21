# Octagon ERP — Page Recovery Execution Matrix

This matrix tracks the audit, root-cause diagnosis, repair actions, and verification status for all audited P0 and P1 pages across Octagon ERP workspace families.

| Page ID | Spec Path | Current Status | Root Cause | Action Taken | Files Changed | Tests | Verification Result |
|---|---|---|---|---|---|---|---|
| `finance` | `finance/income.md` / `finance/expenses.md` | USABLE | BROKEN_REQUEST_CONTRACT | FIX_API / FIX_CLIENT_CONTRACT — resolve 400 POST /api/db and /api/collection on page load | `platform/server/governance-collections.mjs`, `services/auditService.js`, `server.js` | `npm.cmd run test:functional-pages` | PASS |
| `dock_checkin` | `ops/kiosk_device_registry.md` | THIN | NO_FIXTURE_DATA | FIXTURE_ADDED — seed inbound dock checkins | `scripts/review/fixtures/warehouse.mjs` | `npm.cmd run test:review` | PASS |
| `dock_schedule` | `ops/warehouse_kiosk.md` | THIN | NO_FIXTURE_DATA | FIXTURE_ADDED — seed scheduled dock appointments | `scripts/review/fixtures/warehouse.mjs` | `npm.cmd run test:review` | PASS |
| `expiration_queue` | `ops/warehouse_kiosk.md` | THIN | NO_FIXTURE_DATA | FIXTURE_ADDED — seed near-expiration lot records | `scripts/review/fixtures/warehouse.mjs` | `npm.cmd run test:review` | PASS |
| `production_issue_return` | `ops/workflow.md` | THIN | NO_FIXTURE_DATA | FIXTURE_ADDED — seed production return entries | `scripts/review/fixtures/production.mjs` | `npm.cmd run test:review` | PASS |
| `production_material_requests` | `ops/workflow.md` | THIN | NO_FIXTURE_DATA | FIXTURE_ADDED — seed production material requests | `scripts/review/fixtures/production.mjs` | `npm.cmd run test:review` | PASS |
| `production_receipt` | `ops/workflow.md` | THIN | NO_FIXTURE_DATA | FIXTURE_ADDED — seed production completion receipts | `scripts/review/fixtures/production.mjs` | `npm.cmd run test:review` | PASS |
| `quality_hold_queue` | `ops/workflow.md` | THIN | NO_FIXTURE_DATA | FIXTURE_ADDED — seed quality hold queue entries | `scripts/review/fixtures/quality.mjs` | `npm.cmd run test:review` | PASS |
| `recall_analysis` | `ops/workflow.md` | THIN | NO_FIXTURE_DATA | FIXTURE_ADDED — seed lot recall profiles | `scripts/review/fixtures/quality.mjs` | `npm.cmd run test:review` | PASS |
| `rework_workspace` | `ops/workflow.md` | THIN | NO_FIXTURE_DATA | FIXTURE_ADDED — seed NCR rework orders | `scripts/review/fixtures/quality.mjs` | `npm.cmd run test:review` | PASS |
| `scrap_approval` | `ops/workflow.md` | THIN | NO_FIXTURE_DATA | FIXTURE_ADDED — seed pending scrap approvals | `scripts/review/fixtures/quality.mjs` | `npm.cmd run test:review` | PASS |
| `shopfloor_terminal` | `ops/employee_kiosk.md` | THIN | NO_FIXTURE_DATA | FIXTURE_ADDED — seed active shopfloor workcenter jobs | `scripts/review/fixtures/production.mjs` | `npm.cmd run test:review` | PASS |
| `wave_execution` | `ops/workflow.md` | THIN | NO_FIXTURE_DATA | FIXTURE_ADDED — seed released pick waves | `scripts/review/fixtures/warehouse.mjs` | `npm.cmd run test:review` | PASS |
| `work_orders` | `ops/workflow.md` | THIN | NO_FIXTURE_DATA | FIXTURE_ADDED — seed active work orders | `scripts/review/fixtures/production.mjs` | `npm.cmd run test:review` | PASS |
| `workcenter_queue` | `ops/workflow.md` | THIN | NO_FIXTURE_DATA | FIXTURE_ADDED — seed workcenter dispatch queue | `scripts/review/fixtures/production.mjs` | `npm.cmd run test:review` | PASS |
| `fleet_operations_board` | `ops/service_kiosk.md` | THIN | GENERIC_SHELL | STRENGTHEN — wire live fleet vehicle status | `modules/build10-fleet-workspace.js` | `npm.cmd run test:build-10` | PASS |
