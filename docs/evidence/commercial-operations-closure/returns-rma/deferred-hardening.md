# Returns/RMA — Deferred Hardening

1. **`replace`/`refurbish`/`scrap` dispositions have no canonical
   execution.** The decision is recorded honestly (no fabricated reference,
   proven by test 12), but no stock movement, valuation, or replacement
   fulfillment actually happens yet. Next step: `replace` → canonical
   Sales/Inventory replacement fulfillment; `scrap` → governed Inventory
   scrap/valuation action; `refurbish` → likely a Work Item, same pattern as
   `repair`.
2. **`return_to_supplier` success path not tested end to end** — only the
   honest-refusal path (test 11) is proven. A success-path test needs a real
   posted purchase order + warehouse + receipt fixture, which was not built
   this wave given time.
3. **No live-browser proof for the new RMA tab.**
4. **The old local `omni.warrantyHub.claims` registry was not migrated or
   retired** — see `../duplicate-authority-retirement.md`.
5. **No audit/outbox event is emitted** beyond the `returns_rma_timeline`
   row — this wave did not wire the platform outbox dispatcher for RMA
   events (e.g. for a future notification-on-status-change).
6. **No stock quantity/valuation numeric assertions** on the receipt path —
   only that a real picking is created and validated.
