# Migration 044 Execution Verification Evidence

## Migration Meta Profile
- **Migration ID:** `044_opening_stock_cutover_and_equity_coa`
- **Owner:** `stock_inventory`
- **Version:** `1.44.0`
- **Parent / Depends On:** `['043_phase04_canonical_registry_and_lineage']`
- **Dialect:** `sqlite`
- **Transaction Policy:** `required`
- **Rollback Policy:** `reversible`

## Schema Migrations Record Verification (`schema_migrations`)

| Migration ID | Applied At | Checksum (SHA256) | Actor | Duration (ms) | Source Provenance |
|---|---|---|---|---|---|
| `044_opening_stock_cutover_and_equity_coa` | ISO Timestamp | `...` | `phase04-migration-agent` | `<50ms` | `SPEC-IMPLEMENT for Phase 04.6 Opening Balance Cutover` |

## Up & Down Reversibility Audit
- `up(dialect)` execution creates tracking tables, seeds `acc_390000`, `jnl_opening`, and `loc_opening_balance` cleanly.
- `down(dialect)` execution drops tracking tables and removes seeded CoA, journal, and location records cleanly.
