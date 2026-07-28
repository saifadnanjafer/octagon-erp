# Visible Expansion Migration Register

## Checkpoint C1

| Migration | Purpose | Fresh | Sequential | Rerun | Down/up | Failure rollback |
|---|---|---:|---:|---:|---:|---:|
| `046_sales_lifecycle_expansion` | CRM opportunities/activities, quotation governance, delivery-event/backorder lineage, returns, commissions, reports, project references, and registered actions | PASS | PASS from 045 | PASS | PASS | PASS |

Command: `node --test tests/checkpoint-c/migration_046.test.mjs`

Result: **4 passed, 0 failed, 0 skipped**.

The test uses generated disposable SQLite files. No operational database was
migrated.

## Checkpoint C2

| Migration | Purpose | Fresh | Sequential | Rerun | Down/up | Failure rollback |
|---|---|---:|---:|---:|---:|---:|
| `047_procurement_lifecycle_expansion` | requests, requisition quality lineage, RFQ suppliers/lines, supplier quotation lines, commitments, receipts, quality, returns, scorecards, and registered actions | PASS | PASS from 046 | PASS | PASS | PASS |

Command:
`node --test tests/checkpoint-c/migration_047.test.mjs`

Result: **4 passed, 0 failed, 0 skipped**. The sequential C1 migration fixture
was also isolated explicitly to migrations 045→046 so later migrations cannot
invalidate its contract.

## Checkpoint C3

| Migration | Purpose | Fresh | Sequential | Rerun | Down/up | Failure rollback |
|---|---|---:|---:|---:|---:|---:|
| `048_pos_atomic_workflows` | terminal/cashbox configuration, receipt/refund lineage, session events, reconciliation facts, richer POS fields, and registered actions | PASS | PASS from 047 | PASS | PASS | PASS |

Command:
`node --test tests/checkpoint-c/migration_048.test.mjs`

Result: **4 passed, 0 failed, 0 skipped**. All databases are generated under
the OS temporary directory.

## Checkpoint C4

| Migration | Purpose | Fresh | Sequential | Rerun | Down/up | Failure rollback |
|---|---|---:|---:|---:|---:|---:|
| `049_work_item_operating_views` | canonical Work Item operating-view fields, events, recurrence/SLA/link metadata and registered lifecycle actions | PASS | PASS from 048 | PASS | PASS | PASS |

Command:
`node --test tests/checkpoint-c/migration_049.test.mjs`

Result: **4 passed, 0 failed, 0 skipped**. Migration 048's sequential fixture
was explicitly bounded through 048 after 049 became the newest migration.
Generated SQLite databases live only under the OS temporary directory.

## Checkpoint C5

| Migration | Purpose | Fresh | Sequential | Rerun | Down/up | Failure rollback |
|---|---|---:|---:|---:|---:|---:|
| `050_control_plane_module_management` | versioned module assignment, licensing, backup-run metadata, reversible test module/view, and registered Control Plane actions | PASS | PASS from 049 | PASS | PASS | PASS |

Command:
`node --test tests/checkpoint-c/migration_050.test.mjs`

Result: **4 passed, 0 failed, 0 skipped**. Migration 049's fresh-install
assertion was made future-safe by locating its own ID rather than assuming it
would remain the final repository migration. Generated SQLite databases remain
under the OS temporary directory.
