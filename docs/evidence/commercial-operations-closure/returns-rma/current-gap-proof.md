# Returns/RMA — Current Gap Proof

## What was found in the interrupted worktree (661 lines, uncommitted)

`platform/domains/returns/rma.mjs` (369 lines), `returns-actions.mjs` (82
lines), `tests/phase02/returns-rma.test.mjs` (210 lines). Read in full before
any change. Real, substantive defects found:

1. **Runtime DDL.** `ensureReturnsTables(db)` ran `CREATE TABLE IF NOT
   EXISTS` from application code on every call — violates "no runtime DDL."
2. **Fabricated fallback references.** `recordReceipt` caught a failed
   `createReceiptDraft`/picking-validation call and stored
   `rec_fallback_${random}` as `receipt_picking_id` instead of propagating
   the error. `recordInspection` did the same for a failed `createNCR` call
   (`qncr_fallback_${random}`). Both made the RMA claim a canonical record
   existed when it did not.
3. **No canonical wiring for refund/return_to_supplier at all** —
   `recordDisposition`'s `refund`/`return_to_supplier` branches generated
   `cn_req_${crypto.randomUUID()}`/`supp_ret_${crypto.randomUUID()}` and
   stored them directly, never calling Finance or Procurement.
4. **Broken action registration.** `registerReturnsActions` called
   `executor.registerDomainHandler(...)` — a method that does not exist on
   `ActionExecutor`. The real pattern (confirmed against the immediately
   preceding Collaboration wiring) is an imported standalone function
   `registerDomainHandler(executor, actionId, handler)` from
   `platform/kernel/actions/domain-handler.mjs`. As written, the draft's
   action registration silently registered nothing.
5. **No permission/scope enforcement wired at all** — no `platform_actions`
   rows, no permission registry entries; the `permission:` fields in the
   draft's action map were unused metadata.
6. **No idempotency implementation** despite declaring
   `idempotency_policy: 'supported'` on every action.
7. **Multi-statement writes not wrapped in a transaction** (header + N lines
   + timeline insert in `createRMA`).
8. **The test file re-created its own ad-hoc `work_items`/
   `quality_inspections`/`quality_ncrs` schema** instead of using the real
   migrated schema already available via the test harness's `freshInstall()`
   — meaning its "cross-domain integration" assertions were checked against
   a hand-rolled shadow schema, not the real one. (Confirmed by fixing this:
   the real `quality_inspections` table has a different column set than the
   draft assumed — `picking_id` does not exist; `inspection_number`,
   `inspection_type`, `source_type`, `product_id` are required and were
   missing — and this only surfaced once the test used the real schema.)

**Conclusion: the lifecycle skeleton (create → submit → approve/reject →
receipt → inspection → disposition → close) was coherent and worth keeping.
The wiring, honesty, and canonical linkage were not — corrected in
`architecture.md`/`lifecycle-proof.md`.**
