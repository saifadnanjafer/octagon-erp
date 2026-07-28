# Checkpoint F — migration audit

All checks run against **disposable** databases under the OS temp directory.
The operational store was never opened for write.

## Inventory

| Check | Result |
|---|---|
| Migration files present | **60** (`001` … `060`) |
| Duplicate numeric prefix | **none** |
| Duplicate migration id | **none** |
| Runtime DDL outside a migration | none found |
| Historical migration rewritten in this checkpoint | **none** |

## Execution proof

| Scenario | Command | Result |
|---|---|---|
| Fresh install | `node scripts/migrate.mjs fresh --db <tmp>` | all 60 report `"status":"applied"` |
| Sequential upgrade from empty | `node scripts/migrate.mjs up --db <tmp-2>` | 60 applied |
| **Rerun on an already-migrated database** | `node scripts/migrate.mjs up --db <same>` | `"migrations": []`, `"executed": []` — **idempotent, no re-execution** |
| Status | `node scripts/migrate.mjs status` | every migration reports `applied` with `owner`, `dialect`, `rollbackPolicy`, `sourceProvenance` |

Each migration declares ownership and a rollback policy (`reversible` on the
kernel bootstrap) and records source provenance — a genuinely strong practice.

## Checkpoint D/E migrations 052–060

| Id | Applied on fresh install |
|---|---|
| 052_projects_and_project_costing | yes |
| 053_engineering_bom_routing_mrp | yes |
| 054_mrp_and_manufacturing_orders | yes |
| 055_work_orders_shop_floor_and_production_cost | yes |
| 056_quality_management_and_subcontracting | yes |
| 057_assets_and_depreciation_schedules | yes |
| 058_maintenance_management | yes |
| 059_fleet_and_telematics | yes |
| 060_subcontract_and_cross_domain_closure | yes |

## Registration integrity after migration

Asserted by `tests/checkpoint-f/canonical_authority_coverage.test.mjs`:

- no duplicate action id across 330 actions;
- no entity owned by more than one module across 158 entities;
- every action registers an audit policy and an idempotency policy.

## PostgreSQL dialect design

**Not compatible as written** — 297 `STRICT` declarations plus
`AUTOINCREMENT`, `INSERT OR REPLACE`, `PRAGMA table_info` and `sqlite_master`.
See [postgresql-execution.md](postgresql-execution.md). No corrective migration
was attempted, because rewriting historical migrations to satisfy a claim that
cannot be executed would be unverifiable churn.

## Not verified

- **Down-migration / rollback execution.** `rollbackPolicy` is declared per
  migration but no `down` run was executed in this checkpoint, and down-order
  safety was not exercised.
- **Failure rollback mid-migration** (partial application then abort) was not
  injected.

Recorded in [unresolved-risks.md](unresolved-risks.md).

## Defect found

Migration `050_control_plane_module_management.mjs` inserts
`checkpoint_c_test_module` with `status='enabled'`, plus a `control:test:ping`
action and a view routed at `checkpoint_c_test` in the `administration_preview`
menu. A test fixture therefore ships enabled in every production install.
Severity MEDIUM — gated behind `control:admin`. Not remediated here because the
Checkpoint C suite asserts the module is enabled by default; disabling it
requires editing a currently-passing test, which needs owner review. Detail in
[unresolved-risks.md](unresolved-risks.md).
