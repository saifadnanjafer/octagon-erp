# Authenticated Browser Acceptance — Checkpoint C

## C1 Sales

| Item | Value |
|---|---|
| Runner | `scripts/checkpoint-c-browser-acceptance.mjs` |
| Base URL | `http://127.0.0.1:8097` |
| Chromium | `Chrome/150.0.7871.24` |
| Database | staged disposable copy |
| Trace | `test-artifacts/checkpoint-c-2026-07-28T03-06-05-015Z/` |
| Result | **20 passed / 0 failed / 0 skipped** |

Proven: system-admin authentication; eleven visible Sales areas; governed test
catalogue and stock; lead creation and conversion; opportunity transition and
follow-up activity; quotation create with project/attachment/profitability
detail; submit/approve/accept; atomic confirmation/reservation;
Inventory delivery; Finance invoice; return/credit note; Sales report; Arabic
RTL; English LTR; tablet; mobile; operational Sales-role success; restricted
viewer denial; and no unexpected browser/runtime/resource error.

## Visual-review correction

An initially green DOM trace revealed that the canonical workspace was mounted
below the delayed Phase 7J Sales pack. Canonical Sales now replaces the whole
`#pageSales`, and the legacy pack observes
`__canonicalSalesAuthorityActive` and retires its delayed render. Final
screenshots were manually inspected after this correction.

## C2 Procurement

| Item | Value |
|---|---|
| Runner | `scripts/checkpoint-c-browser-acceptance.mjs` |
| Base URL | `http://127.0.0.1:8097` |
| Chromium | `Chrome/150.0.7871.24` |
| Database | staged disposable copy with migration 047 |
| Trace | `test-artifacts/checkpoint-c-2026-07-28T03-06-05-015Z/` |
| Combined result | **42 passed / 0 failed / 0 skipped** |
| C2 chapter | **22 passed / 0 failed / 0 skipped** |

Proven: twelve required Procurement areas plus reports; request creation,
submission and approval; requisition approval; two-supplier RFQ and quotations;
price/tax/delivery comparison and award; quality-controlled purchase order;
approval and commitment; confirmation and receipt demand; Inventory receipt and
quality check; clean three-way match; Finance supplier bill; supplier return
and debit-note consequence; supplier score; Arabic RTL; English LTR; tablet;
mobile; operational Procurement-role success; restricted viewer denial; and no
unexpected browser/runtime/resource error.

Twelve secret-free Procurement PNGs were directly written and manually
reviewed. Raw profiles, cookies, fixture manifests, logs, and credentials remain
outside Git.

## C3 Point of Sale

| Item | Value |
|---|---|
| Runner | `scripts/checkpoint-c-browser-acceptance.mjs` |
| Base URL | `http://127.0.0.1:8097` |
| Chromium | `Chrome/150.0.7871.24` |
| Database | staged disposable copy with migration 048 |
| Trace | `test-artifacts/checkpoint-c-2026-07-28T03-51-11-913Z/` |
| Combined result | **58 passed / 0 failed / 0 skipped** |
| C3 chapter | **16 passed / 0 failed / 0 skipped** |

Proven: ten complete POS areas; duplicate legacy POS navigation retirement;
terminal/cashbox configuration; cashier session and opening cash; catalogue,
barcode foundation, and Inventory availability; split cash/card sale; fiscal
receipt; stock-restoring return and card refund; derived expected cash, count,
variance, and close; visible audit/outbox; Arabic RTL, English LTR, tablet and
mobile; operational POS-role open/sell/reconcile; restricted viewer denial; and
no unexpected browser/runtime/resource error.

Twelve secret-free POS PNGs were directly written and manually reviewed.
