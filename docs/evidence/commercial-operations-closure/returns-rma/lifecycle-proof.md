# Returns/RMA — Lifecycle Proof

Proven end to end on disposable databases, `tests/phase02/returns-rma.test.mjs`, 15/15:

1. Customer-return creation with valid payload.
2. `MISSING_CUSTOMER` refused for a customer_return with no customer_id.
3. `INVALID_QUANTITY` refused for a non-positive line quantity.
4. Idempotent replay (`idempotency_key`) returns the same RMA, does not
   duplicate the row (unique index proven, not just application-level logic).
5. Cross-company access denied at the domain layer (`CROSS_COMPANY_DENIED`).
6. Full happy-path lifecycle: submit → approve → receipt → inspection
   (fail → real NCR row created) → disposition (repair → real Work Item row
   created, linked back to the real NCR via `quality_ref`) → close.
7. `INVALID_STATE` refused for out-of-order approve.
8. Reject transitions to `rejected`, records the reason.
9. Multi-company isolation in list queries.
10. Refund without a source finance document is honestly refused
    (`SOURCE_DOCUMENT_REQUIRED_FOR_REFUND`) — no fabricated credit-note id
    stored.
11. Supplier return without a purchase order is honestly refused
    (`PURCHASE_ORDER_REQUIRED_FOR_SUPPLIER_RETURN`) — no fabricated
    supplier-return id stored.
12. `replace`/`refurbish`/`scrap` dispositions record the decision with no
    fabricated side-effect reference (all three reference fields stay null).
13. `INVALID_STATE` refused for closing an unresolved RMA.
14. Timeline records every transition in exact order.
15. **Refund against a real posted invoice** — seeds a real chart of
    accounts, posts a real customer invoice through
    `createDocument`/`submitDocument`/`approveDocument`/`postDocument`,
    creates an RMA referencing it, and proves `recordDisposition({disposition:
    'refund'})` creates a real row in `finance_documents` with
    `move_type='customer_credit_note'`, `source_type='credit_note_of'`, and
    `source_id` equal to the real original invoice's id — the credit note's
    lines are a genuine reversal of the invoice's own posted GL lines, not
    derived from RMA product data (which carries no `account_id`).

Not exercised this wave (see `deferred-hardening.md`): a working
`return_to_supplier` success path (needs a real posted purchase order +
warehouse fixture — the failure/refusal path IS proven, test 11), and stock
quantity/valuation assertions on the receipt path (proven only that a real
picking is created and validated, not the resulting quant/valuation numbers).
