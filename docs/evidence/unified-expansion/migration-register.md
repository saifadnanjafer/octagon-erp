# Unified Expansion Migration Register

## Wave 2 remediation

No new schema migration was added. Existing migration
`database/migrations/044_opening_stock_cutover_and_equity_coa.mjs` remains the
schema owner for opening equity, opening journal/location, and Phase 04 batch
tables.

The executable migration path is
`scripts/migrate_legacy_data.mjs:runDisposableMigration`.

Changes in this checkpoint:

- requires explicit `cutoverDate` (`YYYY-MM-DD`) before creating a disposable;
- stages byte copies of DB+WAL, consolidates the staged pair with `VACUUM INTO`,
  and never opens the operational SQLite path;
- fingerprints DB, WAL, SHM, and sibling JSON before/after;
- removes fake warehouse, location, account, and journal fallbacks;
- requires one active warehouse, one internal location, canonical accounts
  `104000` and `390000`, one opening journal, and one open fiscal period;
- posts via Phase 03 `createDocument` → `submitDocument` → `approveDocument` →
  `postDocument`;
- records source type `opening_inventory_cutover` and reservation type/status
  `legacy_opening_reservation` / `reserved_unallocated`;
- reruns idempotently and verifies transaction rollback.

Real operational execution is **not run** because the accounting cutover date is
not source-backed or owner-approved. No production migration/cutover occurred.
