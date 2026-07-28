# Checkpoint C2 — Canonical Procurement

## Outcome

The original Procurement page is now a visible canonical procure-to-pay
workspace. Its legacy renderer retires when
`__canonicalProcurementAuthorityActive` is set, so delayed shell navigation
cannot overwrite the canonical page.

The workspace exposes the twelve required bilingual areas: Procurement
Dashboard, Purchase Requests, Requisitions, RFQs, Supplier Quotations,
Comparison, Purchase Orders, Receipts, Three-Way Match, Supplier Bill Requests,
Returns, and Supplier Performance. A thirteenth tab exposes canonical
Procurement reports.

All mutations use `CanonicalClient` and the governed
`POST /api/v1/action/:actionId` surface. The visible writer contains no
`saveData`, `Repo.save`, `StateService`, or `localStorage` persistence fallback.

## Lifecycle implemented

`Purchase Request → Approved Requisition → Multi-supplier RFQ → Supplier
Comparison → Award → Purchase Order → Commitment → Inventory Receipt → Quality
Check → Three-Way Match → Finance Supplier Bill Request → Supplier Return /
Debit Note → Supplier Score`

Implemented controls include:

- company-scoped supplier, request, RFQ, quotation, and order validation;
- explicit request submission and approval, followed by requisition approval;
- multiple invited suppliers and line-level price, tax, lead-time, and delivery
  facts;
- awarded-quotation validation when creating the purchase order;
- propagation of the quality requirement from request through requisition and
  RFQ into the order;
- purchase-order approval and canonical commitment;
- partial receipt, backorder, accepted/rejected quantities, and quality facts;
- quantity/price variance and a mismatch worklist;
- clean-match requirement before Finance bill creation;
- canonical supplier return plus Finance supplier credit/debit-note
  consequence;
- supplier scorecards and seven canonical reports;
- attachments, comments, audit timeline, outbox, idempotency, rollback, and
  company-scope proof.

## Browser proof

The final combined C1+C2 trace passed **42/42** in
`Chrome/150.0.7871.24`; the C2 chapter contributed **22/22** checks.

Proven through the visible original-shell UI:

- administrator lifecycle from purchase request through bill, return, and
  supplier score;
- two supplier quotations and visible comparison/award;
- canonical Inventory receipt and quality consequence;
- canonical Finance supplier bill and return consequence;
- operational Procurement-role mutation;
- restricted-viewer server-side denial;
- Arabic RTL, English LTR, desktop, 768px tablet, and 375px mobile;
- no page-level mobile overflow and no unexpected browser/runtime error.

Raw trace:
`test-artifacts/checkpoint-c-2026-07-28T03-06-05-015Z/checkpoint-c-browser-results.json`
(gitignored and secret-free).

## Deterministic proof

| Suite | Result |
|---|---:|
| `migration_047.test.mjs` | 4/4 |
| `procurement_lifecycle.test.mjs` | 6/6 |
| `canonical_procurement_ui.test.mjs` | 7/7 |
| All Checkpoint-C tests | 44/44 |
| Phase 04 finalization regression | 99/99 |
| Permission regression | 35/35 |
| Precommit | PASS |

This closes C2 only. It does not claim C3–C6 or broad Phase 04 writer
retirement.

## C6 closure addendum

Procurement remains green in the 100/100 Checkpoint C aggregate and final
90/90 Chromium run. C6 adds injected three-way-match and supplier-bill outbox
failures proving matches, lines, exceptions, invoice registry, fiscal, Finance,
commitment/order, audit, outbox, and idempotency roll back together.
