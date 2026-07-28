# Checkpoint G — migration register

## Migrations 001-060: NOT EDITED

Verified: `git diff 81801c4..HEAD -- database/migrations/` touches only new
files. No historical migration was rewritten to make a claim pass.

## New forward migrations

### 061_canonical_cutover_controller

| Field | Value |
|---|---|
| owner | `platform.kernel` |
| version | 1.40.0 |
| dependsOn | `060_subcontract_and_cross_domain_closure` |
| dialect | `sqlite`, `postgres` |
| transactionPolicy | required |
| rollbackPolicy | reversible |
| provenance | Checkpoint G — governed cutover controller state; closes blocker C1 |

Adds `canonical_cutover_attempts` (every attempt including REFUSED ones, so a
refused activation is auditable evidence rather than a silent no-op) and
`canonical_cutover_approvals` (created EMPTY — an empty approvals table is what
keeps production activation fail-closed).

### 062_warehouse_code_uniqueness

| Field | Value |
|---|---|
| owner | `platform.kernel` |
| version | 1.41.0 |
| dependsOn | `061_canonical_cutover_controller` |
| dialect | `sqlite`, `postgres` |
| transactionPolicy | required |
| rollbackPolicy | reversible |
| provenance | Checkpoint G — duplicate warehouse codes observed under multi-process contention and reproduced sequentially |

Adds `UNIQUE INDEX idx_warehouses_company_code ON warehouses(company_id, code)`.
**Fails loudly** with an actionable message if an installation already holds
duplicates, rather than silently skipping the constraint or picking a winner
and deleting stock-bearing records.

## Portability

Both new migrations are written dialect-neutral: no `STRICT`, no
`AUTOINCREMENT`, only types that carry the same meaning in PostgreSQL. New
migrations from 061 onward stop the portability debt growing while the adapter
is built out.

## Execution proof

| Scenario | Result |
|---|---|
| Fresh install | 001-062 all `applied` |
| Sequential upgrade from empty | 62 applied |
| Rerun on migrated database | `executed: []` — idempotent |
| Rerun with cutover active | locks and canonical records still valid |
| Down/rollback | `downRollback` in the migration runner suite passes |
| Restore + status | all applied on the restored database |
