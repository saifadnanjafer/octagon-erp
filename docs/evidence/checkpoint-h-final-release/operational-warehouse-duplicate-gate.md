# Checkpoint H — operational warehouse duplicate gate

# RESULT: NO DUPLICATES — MIGRATION 062 OPERATIONAL GATE CLEAR

…with a materially more important finding attached. See "The bigger finding".

## Method — read-only, and provably so

The operational store was **not opened in place**. A WAL-aware disposable copy
was taken first (`database.db`, `database.db-wal`, `database.db-shm` copied
together), and every query ran against that copy through a connection opened
with `new DatabaseSync(path, { readOnly: true })`.

Read-only enforcement was **proved, not assumed** — an attempted
`CREATE TABLE ckh_probe(x)` returned:

```
attempt to write a readonly database
```

No migration was run. No temporary table was created inside the operational
database. No vacuum, normalise, repair or lock.

## Byte identity

| File | Before | After | Changed |
|---|---|---|---|
| `database.db` | `1437550f7a5b84b9191bfde80b210fe73a29999470e216bed609cb7f16efd1f2` | identical | **no** |
| `database.db-wal` | `4f7a1f51b2cb1bd97fe2df37c2533eb013afb31a0b476a990fc21b50a380c5ec` | identical | **no** |
| `database.db-shm` | `62dac42ec52f227a29c70481cdfa121f45f17c639e6f6ac743d51dc983fa8a18` | identical | **no** |
| `database.json` | `2e4d7d91b15b053d276cf1b5ac2b73524be3bd73da096e5ba925724b61c700a1` | identical | **no** |

## Warehouse diagnostics

| Query | Result |
|---|---|
| `warehouses` table present | **yes** |
| `SELECT COUNT(*) FROM warehouses` | **0** |
| Duplicate `(company_id, code)` groups | **0** |
| Rows with NULL or empty code | **0** |
| Linked `stock_locations` | 1 row |
| Linked `stock_moves` | 0 |
| Linked `stock_quants` | 0 |
| Linked `stock_reservations` | 0 |
| Linked `stock_valuation_facts` | 0 |
| Linked `sale_orders` | 0 |
| Linked `purchase_orders` | 0 |
| Linked `mfg_production_orders` | table absent |

There are no warehouses, therefore no duplicate codes, therefore **no owner
remediation is required** and migration 062 has nothing to refuse.

## The bigger finding — the operational database is 17 migrations behind

The gate was clear for a reason worth stating plainly:

| Fact | Value |
|---|---|
| Migration ledger table | `schema_migrations` |
| Applied migrations | **45** |
| Migration tip | **`045_governed_master_data_and_inventory_actions`** (applied 2026-07-27) |
| Repository tip | `062_warehouse_code_uniqueness` |
| **Gap** | **046 → 062, seventeen migrations** |
| `platform_actions` | **190** rows (a fresh install registers 330) |
| `platform_modules` | **9** rows (a fresh install registers 18) |
| `assets` table | **absent** — migration 057 never applied |
| `authority_retirement_locks` | 0 rows — cutover correctly not activated |

And every canonical business table is empty: `parties` 0, `product_variants` 0,
`stock_quants` 0, `stock_moves` 0, `work_items` 0, `warehouses` 0.

**The live workshop is not running on the canonical schema.** It runs on the
legacy JSON collection layer. The canonical platform is installed up to
migration 045 and is unpopulated.

## What this means for the release

1. **Migration 062 cannot be applied on its own.** Applying it means first
   applying 046–061 — which is not "add a unique index", it is the Phase 04 +
   Checkpoint C/D/E schema arriving on the live database for the first time.
2. **The gate must be re-run after that upgrade.** `warehouses` will only
   acquire rows once data is migrated into the canonical schema. Today's clear
   result is a statement about an empty table, not about the workshop's real
   warehouse data, which still lives in the legacy layer.
3. **Canonical cutover cannot be activated on this database yet** — there is
   nothing to cut over to. This is consistent with, and explains, the
   fail-closed production gate.

## Owner decision required

Whether and when to apply migrations 046–062 to the operational database, and
whether to migrate legacy collection data into the canonical schema, is an
owner decision about the live business. Checkpoint H does not make it, does not
prepare it, and did not touch the operational store.

## Classification

**NO DUPLICATES — MIGRATION 062 OPERATIONAL GATE CLEAR**
(subject to re-running the gate after the 046–062 upgrade populates the table)
