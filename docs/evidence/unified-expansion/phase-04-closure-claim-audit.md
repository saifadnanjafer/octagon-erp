# Phase 04 Closure Claim Audit

**Audit date:** 2026-07-26

**Audited tree:** `c315f7976353f3fd483091977136c645cf92e483`

**Independent classification:** `PARTIAL — REMEDIATION REQUIRED`

## What is valid

The Phase 04 canonical backend and disposable opening-balance implementation are
substantive. Current deterministic verification passed 43/43 tests. It proves
fresh/upgrade migration behavior, canonical stock/sales/procurement/POS/Work
Item commands, opening quantities and reservations, IQD 1,963,000 valuation,
balanced opening debit/credit totals, idempotent rerun, and rollback probes on
disposable databases.

The following source-backed policy is now explicit in the owner's 2026-07-26
assignment:

- `opening_inventory_cutover` for opening stock;
- source material quantity and cost;
- `legacy_opening_reservation` with `reserved_unallocated`;
- no fabricated receipts, purchase orders, or sales-order lines;
- stock-to-GL through the Phase 03 canonical finance authority;
- no production cutover before migration, rollback, rerun, reconciliation,
  security, concurrency, and browser gates pass.

## Claims not supported by the current tree

| Claim | Finding | Evidence |
|---|---|---|
| Real Phase 04 browser acceptance passed | False | `tests/phase04/browser_phase04_remediation.mjs` still writes a hard-coded `BLOCKED`, `executed:false` result and exits 2; no post-opening-cutover browser suite exists |
| Legacy Phase 04 writers are retired | False in the current runtime | `server.js:1971-1975` enforces Phase 04 denials only when `phase04.canonical_cutover` is enabled |
| Cutover is active after migration | False | migration 043 seeds the flag disabled; `scripts/migrate_legacy_data.mjs` does not enable it |
| Runtime reads/writes use canonical Phase 04 services | False for the original shell | `services/stockService.js` still mutates PentagonDB arrays directly; no Phase 04 canonical client adapter or flag-aware proxy was found |
| Authority-retirement rows are runtime enforcement | False | the runtime guard reads `platform_feature_flags`, not `authority_retirement_locks`; ledger rows are evidence/configuration only |
| Opening GL posted through Phase 03 authority | False | `scripts/migrate_legacy_data.mjs:747-789` directly inserts a `posted` finance document, journal entry, and journal lines |
| Disposable snapshot is byte-identical to the live logical SQLite state | Not proven | the Phase 04 script copies only `database.db`; the live store has a non-empty `database.db-wal`, so committed WAL pages are not included by `fs.copyFileSync` |
| Operational database has Phase 04 cutover schema/state | False at audit time | read-only inspection found `platform_feature_flags` but no `phase04.canonical_cutover` row, no `authority_retirement_locks` table, and no `phase04_opening_stock_batches` table |
| Phase 04 is deployment-ready | Not proven | production cutover is explicitly prohibited; the operational database remains legacy, and real UI/browser/writer-retirement proof is absent |

## Finance split-authority warning

`services/financeService.js:75-92` defaults `FF_CANONICAL_FINANCE` to OFF, while
`server.js:1971-1975` always enforces canonical authority for finance on generic
legacy routes. The backend canonical finance engine is real and mounted, but the
original client can still select legacy behavior. This must be reconciled
before claiming a single live finance authority.

## Source safety finding

The audit opened `database.db` with Node SQLite `readOnly:true`. Hashes of
`database.db`, `database.db-wal`, `database.db-shm`, and `database.json` were
identical before and after. The read-only query found:

```json
{
  "platform_feature_flags_table": true,
  "phase04_canonical_cutover_row": null,
  "authority_retirement_locks_table": false,
  "phase04_opening_stock_batches_table": false
}
```

The first query attempted a non-existent `rollout_percentage` column and failed
read-only. It was corrected using `PRAGMA table_info`; no source file changed.

## Corrected decision

The deterministic Phase 04 work is preserved and credited. The words `CLOSED`,
`FULL COMPLIANCE`, `legacy writers retired`, `operational runtime deployment`,
and `independently verified` are not accepted as current closure-equivalent
claims.

Wave 2 must:

1. create a WAL-aware disposable snapshot;
2. post opening GL through the Phase 03 canonical finance lifecycle;
3. fail closed on missing/ambiguous accounts, company, currency, or dates;
4. prove source DB/WAL/SHM/JSON unchanged;
5. enable cutover only inside disposable acceptance;
6. prove generic legacy writers reject governed changes;
7. route the original shell through canonical queries/actions;
8. run real browser, permission, company/branch, concurrency, rollback, rerun,
   reconciliation, and prior-phase regression gates.
