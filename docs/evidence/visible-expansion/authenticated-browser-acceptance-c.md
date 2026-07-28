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

## C4 Work Management

| Item | Value |
|---|---|
| Runner | `scripts/checkpoint-c-browser-acceptance.mjs` |
| Base URL | `http://127.0.0.1:8097` |
| Chromium | `Chrome/150.0.7871.24` |
| Database | staged disposable copy with migration 049 |
| Trace | `test-artifacts/checkpoint-c-2026-07-28T05-26-01-449Z/` |
| Combined result | **73 passed / 0 failed / 0 skipped** |
| C4 chapter | **15 passed / 0 failed / 0 skipped** |

Proven: nine visible canonical views; retirement of duplicate legacy Kanban and
Workshop TV navigation; create and assign; five-level importance and watchers;
subtask and dependency relations; optimistic Kanban transition; calendar
movement on the same record; predecessor/subtask-gated completion; workload and
completion reporting; Workshop TV; Arabic RTL, English LTR, tablet and mobile;
Workshop-role mutation; restricted-viewer server denial; and no unexpected
browser/runtime/resource error.

Twelve secret-free Work Management PNGs were directly written. The first replay
also exposed and corrected an invalid client route and a delayed-shell rerender
race; the registered final trace was produced after both corrections.

One later screenshot-only replay incorrectly reused an already-mutated staging
copy and therefore reported POS cash `275/100/-175` (72/73). That staging copy
was discarded. The registered trace above was rerun from a fresh byte-staged
database and passed 73/73 with POS cash `100/100/0`.

## C5 Administration and Module Control

| Item | Value |
|---|---|
| Runner | `scripts/checkpoint-c-browser-acceptance.mjs` |
| Base URL | `http://127.0.0.1:8097` |
| Chromium | `Chrome/150.0.7871.24` |
| Database | fresh staged disposable copy with migration 050 |
| Trace | `test-artifacts/checkpoint-c-2026-07-28T05-53-33-383Z/` |
| Combined result | **90 passed / 0 failed / 0 skipped** |
| C5 chapter | **17 passed / 0 failed / 0 skipped** |

Proven: nineteen Administration areas; module health and dependency facts;
company assignment and navigation preview; successful enabled-module action;
navigation removal and `403 MODULE_NOT_ENABLED` after disable; restored
navigation and action after re-enable; `403 MODULE_UNLICENSED`; active-license
recovery; governed feature flag creation/disable; health records; Arabic RTL,
English LTR, tablet and mobile; restricted-viewer server denial; and no
unexpected browser/runtime/resource error.

The first C5 attempt reached 84/84 recorded passes before Puppeteer retained a
feature-card handle across the UI's intentional rerender. The runner now issues
the same canonical browser command and explicitly refreshes the UI. A fresh
byte-staged rerun—not the mutated first staging copy—produced the registered
90/90 trace.
