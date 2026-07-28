# Checkpoint C1 — Canonical Sales

## Outcome

The original Sales page is now a visible canonical workspace. The delayed
Phase 7J legacy pack is retired when canonical Sales is active, so it cannot
reclaim the page after navigation.

The workspace exposes eleven bilingual areas: Sales Dashboard, Leads,
Opportunities, Quotations, Sales Orders, Reservations, Deliveries, Returns,
Invoice Requests, Customer Balances, and Sales Reports.

All mutations use `CanonicalClient` and the governed
`POST /api/v1/action/:actionId` surface. The module contains no `saveData`,
`Repo.save`, `StateService` write, or `localStorage` persistence fallback.

## Lifecycle implemented

`Lead → Opportunity → Quotation → Submit → Approve → Accept → Confirm/Reserve
→ Inventory Delivery → Finance Invoice Request → Customer Return → Credit Note`

Additional governed behavior:

- opportunity stage, follow-up activity, and win/loss transitions;
- quotation validity, revision, approval, pricelist, discounts, project
  reference, comments, and attachments;
- credit-limit and credit-hold enforcement;
- atomic confirmation plus partial reservation and shortage recording;
- explicit execution-warehouse selection for multi-warehouse use;
- partial delivery with explicit delivery-event and backorder lineage;
- cancellation with reservation release and open-picking cancellation;
- commission accrual, approval, and paid states;
- customer-balance and Sales reports;
- order profitability, payment/balance navigation, and audited timeline;
- idempotent replay, delivery-outbox rollback, and concurrency protection.

## Cross-domain consequences

| Sales action | Canonical consequence |
|---|---|
| Confirm order | creates fulfilment demand, delivery picking, and stock reservation in one transaction |
| Deliver order | posts canonical stock movement, consumes reservation/stock, and creates a backorder when partially delivered |
| Request invoice | posts the canonical Finance customer invoice and updates invoiced fulfilment |
| Return delivered goods | posts reverse stock movement and a Finance credit-note request |

## Visible UI behavior

- Arabic RTL and English LTR render from the same canonical state.
- Desktop, 768px tablet, and 375px mobile were exercised.
- Mobile has no page-level horizontal overflow.
- Loading, empty, validation, authorization, and server-error states render
  inside the Sales page.
- Restricted users see the server-derived denial state.
- A canonical-authority `409` from the retired legacy full-sync writer is no
  longer misreported as a dead local server.

## Proof

| Suite | Result |
|---|---:|
| `tests/checkpoint-c/migration_046.test.mjs` | 4/4 |
| `tests/checkpoint-c/sales_lifecycle.test.mjs` | 14/14 |
| `tests/checkpoint-c/canonical_sales_ui.test.mjs` | 9/9 |
| `tests/phase04-finalization/test_auth_fixture.test.mjs` | 20/20 |
| Authenticated Chromium C1 | 20/20 |
| Phase 04 finalization regression | 99/99 |
| Permission regression | 35/35 |
| Precommit | PASS |

Chromium: `Chrome/150.0.7871.24`.

Raw trace:
`test-artifacts/checkpoint-c-2026-07-28T03-06-05-015Z/checkpoint-c-browser-results.json`
(gitignored; no cookies or credentials are copied into evidence).

This closes C1 only. It does not claim C2–C6 or legacy-writer cutover.
