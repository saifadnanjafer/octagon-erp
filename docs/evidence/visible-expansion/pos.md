# Checkpoint C3 — Canonical Point of Sale

## Outcome

The original `pos` page is now the single visible POS workspace. The former
local `modules/pos.js` writer retires under
`__canonicalPosAuthorityActive`, the separate `pos_deepening` navigation entry
is hidden, and a late-wrapper guard keeps canonical POS as the final shell
route owner.

The bilingual workspace exposes POS dashboard, sessions/cashbox, catalogue and
availability, cart and split payments, completed sales, fiscal receipts,
returns/refunds, reconciliation, audit/outbox, and reports.

Every visible mutation uses `CanonicalClient` and a registered ActionExecutor
action. There is no `saveData`, localStorage write, `recordStockMovement`, or
`addFinanceTransaction` fallback in the canonical renderer.

## Atomic lifecycle

`Terminal → Finance cashbox → POS session → cart → split payment → Inventory
stock/valuation → tax/fiscal Finance document → receipt → audit/outbox →
commit`

A governed return validates the original paid receipt and remaining returnable
quantity, moves stock from the customer location back to the original
warehouse, posts a customer credit-note fact, records the refund payment and
lineage, and writes audit/outbox in the same transaction.

Session closing derives expected cash from canonical Finance, records the cash
count, closes the Finance shift, and persists opening/sales/refunds/expected/
counted/variance reconciliation facts.

## Controls proven

- terminal company/branch/warehouse/account scope;
- one open session per cashier and canonical cash-shift ownership;
- product catalogue price plus canonical tax computation;
- catalogue/SKU/barcode search and Inventory-derived availability;
- cash, card, and configured account-payment foundations;
- exact split-payment-total validation;
- receipt and Finance document lineage;
- partial refund and over-return prevention;
- duplicate-click/idempotency replay;
- limited-stock contention with one winner and no negative stock;
- rollback at payment, stock, valuation, Finance, cashbox, audit, and outbox;
- operational POS-role success and restricted-viewer server denial.

## Browser proof

The final original-shell Chromium trace passed **58/58** overall, with the C3
chapter contributing **16/16**, under `Chrome/150.0.7871.24`.

Raw trace:
`test-artifacts/checkpoint-c-2026-07-28T03-51-11-913Z/checkpoint-c-browser-results.json`
(gitignored, disposable, and secret-free).

Twelve reviewed PNGs cover Arabic RTL desktop, session/cashbox, catalogue,
split payment, receipt register, refund, reconciliation, audit/outbox, English
LTR, tablet, mobile, and viewer denial.

## Boundaries

This closes C3 only. C4 Work Management, C5 Administration/Module Control, and
C6 cross-domain closure remain open. The operational database was not migrated
or written; all browser mutations targeted a disposable staged copy.
