# Legacy Data Migration Evidence

Command:

`node scripts/migrate_legacy_data.mjs`

Exit code: `2` (`BLOCKED` by design).

## Source safety

- Source: `C:\Users\Zahraa dlbooz\Downloads\odoo-19.0\octagon-erp\database.db`
- SHA-256 before/after: `36da81437da7383c9ec42bc9b15f6ace8d99d18e9e1d8bd6907262a7a4c106c5`
- Size before/after: `17,084,416` bytes
- Modified at: `2026-07-23T21:16:27.758Z`
- Disposable path: OS temporary `octagon-phase04-migration-*\database-disposable.db`
- Disposable pre-migration hash: identical to source
- Disposable copy removed after the proof run
- Original unchanged: `true`

## Source and migrated counts

| Fact | Source | Canonical | Result |
|---|---:|---:|---|
| Customers | 1 | included in 7 parties | pass |
| Suppliers | 6 | included in 7 parties | pass |
| Materials/products | 8 | 8 | pass |
| Warehouses | 1 | 1 | pass |
| Locations | 4 | 4 | pass |
| Categories | 4 | 4 | pass |
| UOMs | 5 | 5 | pass |
| Price lists/items | 6 / 8 | 6 / 8 | pass |
| Work orders | 3 | included in 11 Work Items | pass |
| Task Manager tasks | 5 | included in 11 Work Items | pass |
| Kanban cards | 3 | included in 11 Work Items | pass |
| Barcodes | 0 | 0 | pass |

Stable source maps: `37`. Open quarantine records: `16`.

## Reconciliation hard stop

| Reconciliation | Source | Canonical | Result |
|---|---:|---:|---|
| Parties | 7 | 7 | pass |
| Products | 8 | 8 | pass |
| Work Items | 11 | 11 | pass |
| Quantity | 401 | 0 | fail |
| Reservations | 86 | 0 | fail |
| Valuation (IQD) | 1,963,000 | 0 | fail |
| Stock-to-GL | 1,963,000 | 0 journal debit | fail |

Every one of 8 materials reports aggregate stock and reservation values but lacks executed movement/reservation lineage. The migrator quarantines one `RESERVATION_LINEAGE_MISSING` and one `OPENING_STOCK_GL_POLICY_REQUIRED` condition per material. It does not invent stock movements, reservation owners, opening journal policy, dates, accounts, or approval identity.

Rerun counts were identical (`37` maps, `16` quarantines, `7` parties, `8` products, `11` Work Items). Idempotent rerun: `true`. Rollback probe: `true`.

Sales, procurement, and POS source collections did not expose safely migratable open-document facts in this source rehearsal; no zero-defect reconciliation claim is made for them.

Safest remediation: obtain an approved opening-stock accounting policy and source-backed reservation lineage (or formally approved quarantine disposition), then rerun the disposable migration. UI cutover and writer retirement must remain disabled until it returns `PASSED`.
