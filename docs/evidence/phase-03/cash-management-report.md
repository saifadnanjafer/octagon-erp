# Wave D — Cash Management, Payment Terms, and Credit Exposure Report

**Scope:** Packet 03.19 (cashboxes/petty cash/custody), Packet 03.20 (payment terms/installments/retainage), Packet 03.21 (credit exposure and policy foundation).
**Evidence date:** 2026-07-22

## What was implemented — cashboxes and petty cash

- `finance_cashboxes` (per company/branch, custodian, currency, optional max balance), `finance_cash_shifts` (open/closed, opening/expected/actual/variance), `finance_cash_counts` (append-only count history with variance).
- `openCashShift` enforces exactly one open shift per cashbox at a time.
- `expectedShiftBalance` computes expected cash as opening balance plus every `finance_journal_lines` net movement on the cashbox's GL account since the shift opened — not a separately tracked running total, so it can never drift from the ledger.
- `recordCashCount` and `closeCashShift` both compute variance against that same live-derived expected balance; a closed shift rejects further counts or a second close.

## What was implemented — payment terms and installments

- `finance_payment_term_templates` / `finance_payment_term_lines` — percent/fixed/balance line types, three due-date rules (`days_after_date`, `days_after_month_end`, `fixed_day_next_month`), early-discount and retainage fields carried on the template.
- `generateDueScheduleFromTerm` computes each line's amount and due date, with the **last line absorbing the rounding remainder** so the generated schedule always sums to the exact document total (verified: a 33.33/33.33/balance split of 1,000 sums to exactly 1,000.00, not 999.99 or 1,000.01), then calls Wave C's `setDueSchedule` — no separate schedule-writing path.

## What was implemented — credit exposure and policy

- `finance_credit_profiles` (limit, overdue grace days, temporary override with expiry, guarantees/disputed inclusion flags), `finance_credit_holds` (reason, held/released audit trail).
- `getCreditExposure` is a **composition** of Wave C's `getCustomerOpenItems`/`getCustomerAging` plus the profile — it introduces no second receivables-balance authority. Returns exposure, limit (temporary override if not expired), available headroom, over-limit flag, hold status, and an explain trace.

## Files changed

- `database/migrations/026_cashboxes_and_petty_cash.mjs`
- `database/migrations/027_payment_terms_and_installments.mjs`
- `database/migrations/028_credit_exposure_and_policy.mjs`
- `platform/finance/engine.mjs` (+15 exported functions)
- `platform/finance/index.mjs` (+9 handler registrations)
- `tests/phase03/finance-wave-d.test.mjs`

## Tests and results

| Test | Result |
|------|--------|
| Only one open shift per cashbox; count/close reconcile against real GL activity | PASS |
| Payment-term schedule rounds to the exact document total | PASS |
| Month-end due-date rule computes the correct calendar date | PASS |
| Credit exposure reflects open receivables against the limit; expired override ignored | PASS |
| Credit hold/release lifecycle; payment+allocation releases exposure to zero | PASS |
| Cross-company credit profiles stay isolated | PASS |

Command:

```bash
node tests/phase03/finance-wave-d.test.mjs
# finance-wave-d: 22/22 passed (6 of the 22 are cash/terms/credit-specific)
```

## Reconciliation evidence

Opened a cashbox shift with a 100 opening balance, posted a 250 cash receipt, then counted: `expected_amount = 350` (100 + 250, computed live from `finance_journal_lines`, not a stored running total) with `variance = 0`. Closing at an actual of 345 correctly reports `variance = -5`.

Credit exposure: an 8,000 open invoice against a 5,000 limit reports `exposure: 8000`, `available: -3000`, `is_over_limit: true`. Fully allocating a matching payment against that invoice drops exposure to exactly 0 in the same call chain used by AR reporting — no separate "credit balance" ever gets out of sync with the ledger because none is stored.
