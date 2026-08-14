# BUILD-13 Feature Gap Register

Companion to `BUILD13_FEATURE_GAP_REGISTER.json` (same data, machine-readable).
Hand-curated, not generated — gap analysis is a judgment task, not a
mechanical derivation. Every entry cites the concrete evidence it rests on.
This is **not** a claim of exhaustive coverage of all 231 pages — it's what
this session's investigation actually turned up, evidenced rather than
guessed.

## Summary

| | Count |
|---|---|
| Total gaps logged | 9 |
| Owner decision required | 5 |
| Verified / fixed this pass | 1 (GAP-005) |
| Fixture-only, closed this pass | 1 (GAP-007) |
| Open P1 | 1 (GAP-006) |
| Open P2 | 1 (GAP-005B) |

## The headline finding: duplicate-authority pairs, not missing features

GAP-001 and GAP-002 are not "features to build" — they're **existing**
duplicate-authority situations (`inventory` vs `canonical_inventory`, `mrp`
vs an apparent canonical manufacturing equivalent) that directly collide
with this project's own explicit rule against duplicate Inventory/
Manufacturing authorities. This predates this session; investigating and
documenting it is not creating it. GAP-003 (`work_orders`) is the same
pattern one level less certain — pre-retirement legacy code still linked
from primary navigation, with a formal but unused retirement mechanism
already built for exactly this situation. All three are explicitly flagged
`OWNER_DECISION_REQUIRED` rather than resolved unilaterally — redirecting or
retiring a primary page is a business-process call, and getting it wrong in
either direction (retiring live capability, or leaving confirmed dead code
on primary nav) has real cost.

## Gaps

### GAP-001 — `inventory` duplicates `canonical_inventory` (P0, owner decision required)
**Evidence**: `modules/advanced-inventory.js` uses `typeof omni`, zero canonical API calls. `modules/canonical-inventory.js` is confirmed canonical.
**Ask**: does `inventory` carry any capability `canonical_inventory` lacks? If not — alias/retire. If so — port it, then alias/retire.

### GAP-002 — `mrp` appears to duplicate a canonical manufacturing authority (P0, owner decision required)
**Evidence**: `modules/mrp.js` confirmed legacy (`typeof omni`, `omni.mrpCapacity`). A separate `modules/canonical-manufacturing.js` exists; the extent of overlap is not yet characterized.
**Ask**: same shape as GAP-001, needs one more investigation pass before a recommendation can be made.

### GAP-003 — `work_orders` (P0) is pre-retirement legacy code (owner decision required)
**Evidence**: `modules/work-orders.js` header explicitly names `omni.jobOrders`; `database/migrations/042` already retired that in favor of canonical `work_items`; `platform/cutover/legacy-writer-retirement.mjs` tracks the authority key formally.
**Ask**: is `work_orders` fully superseded by `task_manager`/`command_center` (both already canonical), or does it carry unported capability (op-pack generation, machine-queue linkage, SOP/QC-gate/rework loop, audit timeline — all named in its own header comment)?

### GAP-004 — 5 more pages confirmed legacy, no known canonical duplicate (P1-P2, owner decision required)
`route_health`, `budgeting`, `tax_compliance`, `workshop_ledger`, `multi_entity` — confirmed by direct code reading (`typeof omni` present, zero canonical API calls). Unlike GAP-001-003, no confirmed canonical replacement exists for these specifically, so this reads as un-migrated rather than actively duplicated. Migrating any of these is real BUILD-13 feature work (a canonical backend would need to exist first), not a quick fix — case-by-case prioritization needed. `route_health` is lowest priority (a diagnostic tool, not a business workflow).

### GAP-005 — WMS pages 422'd on load, no warehouse-picker UI (VERIFIED — fixed this pass)
~20 pages required `warehouse_id` with nothing to supply it. Fixed by defaulting `ctx.warehouseId` from the `warehouses.is_default` flag (already in the schema, never read) in `platform-runtime-bridge.mjs`'s `resolveApiContext()`. Re-inspection confirms: `CLIENT_CONTRACT_BUG` signatures dropped from 29 to 11, and `pick_task_queue`/`wave_planning`/`mobile_picking` moved from erroring to USABLE.

### GAP-005B — 4 WMS sub-resources have no fixture rows (P2, open)
Surfaced by fixing GAP-005: `crossdock_workspace`, `staging_board`, `downtime_board`, `count_session` now load cleanly (no error, `denied:false`) but show empty because `scripts/review/fixtures/warehouse.mjs` never seeded rows for these specific sub-resources. Same class of fix as GAP-007 (fixture extension, not new code) — not yet done.

### GAP-006 — `my_work` 404s on saved-views call (root-caused and fixed, verification pending server restart)
Root cause found via direct HTTP trace (`curl` against the live review server, authenticated as `review.sysadmin`): **every** `platform`-namespace resource 404s identically (`notifications`, `activities`, `saved-views` all returned `"unknown route"`), not just saved-views. `platform-runtime-bridge.mjs` defines two different API-mounting functions: `authority.mountApi` (unused anywhere) correctly passes `notifications`/`jobs`/`scheduledReports`/`platformSearch`/`chatter`/`configuration`; the standalone exported `mountPlatformApi` — the one `server.js:2938` actually calls — passed none of them. Every `resource === X && Y` check in `platform/api/index.mjs`'s `platform` namespace block silently fell through because `Y` was always `undefined`, landing on the generic 404 fallback instead of a diagnosable error. Fixed by bringing `mountPlatformApi` to parity with `authority.mountApi`. Not yet re-verified live — needs a review-server restart, queued behind the in-progress final full re-inspection so as not to kill that background run.

### GAP-007 — CRM/Sales/Procurement fixture gap (FIXTURE_ONLY — closed this pass)
`platform/sales/*`, `platform/procurement/*`, and `modules/canonical-sales.js` were real, wired, and fully unpopulated. Closed via `scripts/review/fixtures/commercial-pipeline.mjs`. Verified: `sales` moved from a false-positive "STRONG, 7 records" (tab-button chrome) to genuine USABLE with real rendered data. `sales_price_lists`/`supplier_portal` remain thin, but are now understood to be a **different, legacy-authority issue** (see GAP-004) rather than the same fixture gap.

## What this register deliberately does not claim

- It is not a complete map of all 231 pages' architecture (legacy vs canonical) — only a sample of P0 pages plus what surfaced incidentally. `docs/product/OWNER_PRODUCT_DECISIONS.md` §5b scopes the full trace as its own task.
- It does not include the 10 real-Chromium-journey acceptance tests the BUILD-13 directive calls for, or a full negative-security-path test suite. Those remain open, larger undertakings.
