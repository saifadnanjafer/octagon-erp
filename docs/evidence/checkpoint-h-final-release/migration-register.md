# Checkpoint H — migration register

## No new migrations

Checkpoint H added **no** migrations. Migration 063 was considered for Release
Health persistence and deliberately not written: the health report is computed
live from existing tables and git refs, so persisting it would add a schema
surface with no consumer and a second source of truth for facts the live query
already answers. Mission section 25 says "use only when actually needed".

## Migrations 001-062: NOT EDITED

Verified: `git diff 7bcf796..HEAD -- database/migrations/` is **empty**.

| | |
|---|---|
| Repository tip | `062_warehouse_code_uniqueness` |
| Fresh install | 001-062 all applied |
| Rerun | idempotent |
| **Operational database tip** | **`045_governed_master_data_and_inventory_actions`** |
| **Operational gap** | **046 -> 062, seventeen migrations** |

That last row is the most important line in this register. See
operational-warehouse-duplicate-gate.md.
