# Wave C — Accounts Receivable / Accounts Payable Subledger Report

**Scope:** Packet 03.13 (accounts receivable) and Packet 03.14 (accounts payable).
**Evidence date:** 2026-07-22

## What was implemented — shared design

AR and AP are **derived queries** over `finance_documents` + `finance_journal_lines`, not a duplicated balance table — consistent with Phase 03 Section 5 ("no second... reporting engine may exist"). `finance_due_schedules` is the only new table for AR; `finance_payment_holds` and `finance_approval_authority_limits` are the only new tables for AP.

## What was implemented — AR (Packet 03.13)

- `setDueSchedule` — installment schedule per document; enforced to be settable **only while the document is `draft`** (frozen once posted, consistent with posted-fact immutability), and the schedule total must equal the document total.
- `createCreditNote` — wraps `createDocument` with the `source_type: 'credit_note_of'` / `source_id` convention; only accepts a posted original invoice.
- `getCustomerOpenItems` — posted invoices minus posted credit notes linked via `source_type`/`source_id`.
- `getCustomerAging` — current/1-30/31-60/61-90/90+ buckets from `getCustomerOpenItems`, keyed off each item's earliest due schedule (or the document date if none is set).
- `getPartnerStatement` — posted documents with a running balance, ordered by date.

## What was implemented — AP (Packet 03.14)

- `getSupplierOpenItems` / `getSupplierAging` — mirror of AR, over `supplier_bill` documents.
- Duplicate-invoice detection — added directly to the shared `createDocument` (Wave A/B function): if `source_canonical_key` is present, rejects a second document with the same `(company_id, partner_id, move_type, source_canonical_key)` that isn't cancelled. Gated on the field being present, so it is a pure addition with zero effect on Wave A/B documents (none of which pass it) — confirmed by the full Wave A/B regression staying green.
- `holdPayment` / `releasePaymentHold` / `isDocumentOnHold` — payment-hold lifecycle with reason, held-by/released-by audit fields.
- `setApprovalAuthorityLimit` / `checkApprovalAuthority` — per-role/user posting or payment ceiling; forward hook for Phase 04's three-way match (explicitly named in the governing spec's Packet 03.14 "future three-way-match hook").

## Files changed

- `database/migrations/020_accounts_receivable_subledger.mjs`
- `database/migrations/021_accounts_payable_subledger.mjs`
- `platform/finance/engine.mjs` (+13 exported functions, +duplicate-reference check inside `createDocument`)
- `platform/finance/index.mjs` (9 new handler registrations)
- `tests/phase03/finance-wave-c.test.mjs`

## Tests and results

| Test | Result |
|------|--------|
| Due schedule can only be set before posting; total must match the document | PASS |
| Credit note reduces customer open amount; aging reconciles to receivable GL balance | PASS |
| Partner statement running balance is correct | PASS |
| Cross-company AR open items stay isolated | PASS |
| Duplicate supplier invoice (same partner + reference) is rejected; different partner is allowed | PASS |
| Payment hold blocks/release lifecycle, including double-release rejection | PASS |
| Supplier aging reconciles to the payable GL balance | PASS |
| Approval authority limit blocks amounts above the configured ceiling | PASS |

Command:

```bash
node tests/phase03/finance-wave-c.test.mjs
# 29/29 passed (8 of the 29 are AR/AP-specific)
```

## Reconciliation evidence (the load-bearing proof for this packet)

**AR:** posted a 1,000 IQD customer invoice with a due schedule of 2026-04-15, then a 300 IQD credit note against it. `getCustomerOpenItems` returns `open_amount = 700`. `getCustomerAging({ as_of_date: '2026-04-20' })` returns `total = 700`, `d1_30 = 700` (5 days overdue). Independently, `SUM(debit) - SUM(credit)` on the receivable control account filtered to that partner in `finance_journal_lines` also equals `700`. The aging report and the raw GL balance agree exactly.

**AP:** posted an 800 IQD supplier bill due 2026-03-15. `getSupplierAging({ as_of_date: '2026-05-01' })` returns `total = 800`, `d31_60 = 800` (47 days overdue). `SUM(credit) - SUM(debit)` on the payable control account for that partner also equals `800`.

## Scope boundary (explicit, not a gap)

Full payment-allocation-based residual (Packet 03.17, "Open-item reconciliation engine") is Wave D by the governing spec's own wave order. Wave C's open amount only nets invoices against credit notes, not against payments — there are no payments yet (`finance_payments` does not exist until Wave D, Packet 03.15). This is recorded in `unresolved-risks.md` and in `source-composition-ledger.md` under both AR and AP capability entries.
