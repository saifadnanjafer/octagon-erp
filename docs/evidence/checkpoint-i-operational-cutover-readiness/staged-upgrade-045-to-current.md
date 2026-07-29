# Checkpoint I — Staged Upgrade 045 → 062 (I4)

**Date:** 2026-07-29
**Target:** `temp/checkpoint-i-staged/checkpoint-i_2026-07-29T13-35-40-967Z/staged-disposable.db`
**Operational database:** never targeted, verified unchanged
**Result:** **UPGRADE SUCCEEDED — ROLLBACK DEFECT FOUND**

## Command register

| Step | Command | Exit | Result |
|---|---|---|---|
| Status (pre) | `node scripts/migrate.mjs status --db <staged>` | 0 | 45 applied / 17 pending |
| Dry run | `node scripts/migrate.mjs up --db <staged> --dry-run --actor checkpoint-i-dryrun` | 0 | 17 planned, DB byte-identical after |
| Pre-upgrade backup | file copy → `pre-upgrade-045/` | — | `4cb0e6ba…` |
| Apply | `node scripts/migrate.mjs up --db <staged> --actor checkpoint-i-staged-upgrade` | 0 | 17 applied |
| Status (post) | `node scripts/migrate.mjs status --db <staged>` | 0 | 62 applied / 0 pending |
| Idempotency re-run | `node scripts/migrate.mjs up --db <staged> --actor checkpoint-i-rerun` | 0 | **0 migrations run** |
| Rollback test | `node scripts/migrate.mjs down --db <copy>` | **1** | **FAILED at 014** |

## Dry run

All 17 pending migrations planned in correct dependency order, 046 → 062.

The staged database SHA was identical before and after the dry run
(`4cb0e6ba34f8de1c98d9f28ea382ffd1d57855f5079adba69c8b86c56719ddff`), confirming
`--dry-run` performs no write.

## Upgrade applied — 17/17

```
046_sales_lifecycle_expansion              053_engineering_bom_routing_mrp
047_procurement_lifecycle_expansion        054_mrp_and_manufacturing_orders
048_pos_atomic_workflows                   055_work_orders_shop_floor_and_production_cost
049_work_item_operating_views              056_quality_management_and_subcontracting
050_control_plane_module_management        057_assets_and_depreciation_schedules
051_checkpoint_c_control_entity_policy     058_maintenance_management
052_projects_and_project_costing           059_fleet_and_telematics
                                           060_subcontract_and_cross_domain_closure
                                           061_canonical_cutover_controller
                                           062_warehouse_code_uniqueness
```

Post-upgrade status: **62 applied / 62 total**, tip `062_warehouse_code_uniqueness`.

The runner created its own pre-migration backup automatically at
`temp/checkpoint-i-staged/migration-backups/pre-migration-2026-07-29T14-08-36-887Z-…db`.

### Schema growth

| | Pre-upgrade | Post-upgrade |
|---|---:|---:|
| Tables | 269 | **354** |

85 new tables created across sales, procurement, POS, projects, engineering,
manufacturing, quality, assets, maintenance, fleet and the cutover controller.

## Data preservation — no loss

| Fact | Pre | Post | Result |
|---|---:|---:|---|
| Legacy `collections` rows | 4,067 | 4,067 | preserved |
| Distinct legacy collections | 37 | 37 | preserved |
| `platform_audit_log` | 1,769 | 1,769 | preserved |
| `x_records` | 602 | 602 | preserved |
| `authorization_permissions` | 118 | 118 | preserved |
| `finance_accounts` | 16 | 16 | preserved |
| `finance_journals` | 6 | 6 | preserved |
| `identity_users` | 7 | 7 | preserved |

Canonical business tables remain empty after the upgrade — correct, since these
migrations create schema, not data:

`parties` 0 · `product_templates` 0 · `warehouses` 0 · `stock_quants` 0 ·
`sale_orders` 0 · `purchase_orders` 0 · `pos_orders` 0 · `work_items` 0

## Idempotency — proven

Re-running `up` against the already-upgraded clone executed **0 migrations** and
returned `62 applied`, with `backupPath: null` (no backup taken because no work
was required). The chain is safely re-runnable.

## Warehouse-code duplicate gate (062) — proven enforcing

Migration 062 creates:

```sql
CREATE UNIQUE INDEX idx_warehouses_company_code ON warehouses(company_id, code)
```

The gate was **tested**, not merely inspected. Inside a rolled-back transaction on
the disposable clone:

| Case | Expected | Actual |
|---|---|---|
| First insert `(co_test, DUPCODE)` | accept | accepted |
| Duplicate `(co_test, DUPCODE)` | reject | **rejected** — `UNIQUE constraint failed: warehouses.company_id, warehouses.code` |
| Different company `(co_other, DUPCODE)` | accept | accepted — uniqueness is correctly scoped per company, not global |

Transaction rolled back; `warehouses` returned to 0 rows. No test data persisted.

---

## DEFECT — full rollback fails on a database containing real data

**Severity: HIGH. Blocks any claim of clean rollback proof for the migration chain.**

### What happened

`node scripts/migrate.mjs down --db <copy>` was run against a copy of the
upgraded clone. It exited non-zero with:

```
MigrationRunnerError: Migration "014_finance_canonical_schema_and_coa" failed
during down: FOREIGN KEY constraint failed
  at database/migrations/014_finance_canonical_schema_and_coa.mjs:75
  errcode: 787 (SQLITE_CONSTRAINT_FOREIGNKEY)
```

### Two distinct problems

**1. `down` rolls back everything, not one step.**
There is no target/step argument. Invoking `down` attempts to unwind the entire
chain from the current tip to zero. An operator intending to undo one migration
would instead trigger a full teardown.

**2. The teardown is not atomic — it left the database mid-rollback.**

| State | Value |
|---|---|
| Migrations still applied | 14 (was 62) |
| Tip after failure | `014_finance_canonical_schema_and_coa` |
| Tables remaining | 140 (was 354) |
| `collections` rows | 4,067 — intact |
| `finance_accounts` rows | 15 — table survived the failed drop, but is now orphaned from its chain |

48 migrations were successfully rolled back and 214 tables dropped before the
failure. Those 48 were **not** re-applied. The database was left in a state that
is neither the pre-rollback tip nor a clean lower tip.

### Root cause

`014_finance_canonical_schema_and_coa.down()` executes a bare
`DROP TABLE IF EXISTS finance_accounts` (and sibling finance tables). With
`PRAGMA foreign_keys = ON` — set by the SQLite dialect on every open — and 15
surviving `finance_accounts` rows still referenced by other records, SQLite
refuses the drop.

This never surfaced before because prior rollback testing ran against **empty or
synthetic fixtures**, where `finance_accounts` had no referencing rows. It only
appears against a realistic clone carrying operational data — which is precisely
what Checkpoint I was created to test.

### What this does and does not affect

- **Does not affect the upgrade path.** 045 → 062 applied cleanly and is
  idempotent. The forward path is sound.
- **Does affect rollback safety.** A failed operational cutover could not be
  cleanly reversed by `migrate down` today. Recovery would depend entirely on the
  pre-migration backup file, not on the migration chain's own rollback.
- **Raises the stakes on backup verification.** Since rollback cannot be relied
  on, the pre-upgrade backup becomes the only recovery mechanism, and its restore
  path must be proven before any operational cutover.

### Recommended remediation (not performed — outside I4 scope)

1. Give `down` an explicit target so single-step rollback is possible.
2. Wrap the full teardown in one transaction so a mid-chain failure restores the
   starting tip rather than leaving a partial state.
3. Make `014.down()` FK-safe — delete or nullify referencing rows in dependency
   order before dropping, or drop with `PRAGMA foreign_keys = OFF` inside a
   guarded transaction.
4. Re-run this rollback test against a realistic clone as a regression gate.

Note that `051_checkpoint_c_control_entity_policy` is declared
`irreversible-safety-correction`, so a full rollback past 051 was never intended
to be possible regardless. The failure at 014 is a separate and more serious
issue, since 014 is declared reversible.

## Operational data integrity

Verified after every step. All three authoritative stores byte-identical to the
pre-work baseline:

| File | SHA-256 | Status |
|---|---|---|
| `database.db` | `1437550f7a5b84b9191bfde80b210fe73a29999470e216bed609cb7f16efd1f2` | unchanged |
| `database.db-wal` | `4f7a1f51b2cb1bd97fe2df37c2533eb013afb31a0b476a990fc21b50a380c5ec` | unchanged |
| `database.json` | `2e4d7d91b15b053d276cf1b5ac2b73524be3bd73da096e5ba925724b61c700a1` | unchanged |

Every migration command in this checkpoint was issued with an explicit `--db`
pointing inside `temp/checkpoint-i-staged/`. The runner's default target is
`database-test-migrations.db`, never `database.db`.

The rollback-test copy was deleted after assessment. The upgraded staged clone
remains at tip 062 with all 4,067 legacy rows intact, ready for I5.

## PostgreSQL portability observation

Of the 17 migrations applied, **only 2 declare postgres support**:

| Dialect declaration | Count | Migrations |
|---|---:|---|
| `sqlite` only | 15 | 046–060 |
| `sqlite` + `postgres` | 2 | 061, 062 |

This is a material constraint on the Section 19 PostgreSQL runtime requirement:
the migration chain cannot currently run end-to-end on PostgreSQL regardless of
whether a server is available. Recorded here as a finding, not attempted.

## Not done

- Restore-into-second-environment (Section 11 step 20) — not yet run.
- Canonical legacy-data migration (I5) — not started; the engine does not exist yet.
- Authority-lock activation and writer-refusal proof (I7) — not started.
