# Authenticated Browser Acceptance — Checkpoint C

## C1 Sales

| Item | Value |
|---|---|
| Runner | `scripts/checkpoint-c-browser-acceptance.mjs` |
| Base URL | `http://127.0.0.1:8097` |
| Chromium | `Chrome/150.0.7871.24` |
| Database | staged disposable copy |
| Trace | `test-artifacts/checkpoint-c-2026-07-28T02-17-32-594Z/` |
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
