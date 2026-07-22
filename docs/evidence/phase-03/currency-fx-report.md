# Wave C — Currency and Exchange-Rate Report

**Scope:** Packet 03.09 — Currency and exchange-rate engine.
**Evidence date:** 2026-07-22

## What was implemented

- `finance_currencies` — currency master (`IQD`, `USD`, `EUR` seeded; `decimal_places`, symbol, Arabic name).
- `finance_exchange_rates` — dated, company-scoped rates keyed by `(company_id, from_currency, to_currency, rate_date, rate_type)`; `rate_type` is `spot`/`average`/`custom`.
- `finance_fx_revaluation_runs` — one row per revaluation run, linking to the posted revaluation document.
- `getExchangeRate` — nearest-dated-rate lookup (rate on or before the requested date), with inverse-rate fallback; throws `no exchange rate found for X->Y on/before <date>` when nothing qualifies.
- `convertAmount` — 2-decimal-rounded conversion; same-currency conversion is a no-op.
- `computeRealizedFx` — pure function (`{ bookedLocal, settledLocal, delta, direction }`) for Wave D's payment engine to call at settlement time. No I/O.
- `revalueForeignBalances` — for a caller-specified list of accounts, sums foreign-currency balances from `finance_journal_lines`, converts at the current rate, and posts a single balanced `fx_revaluation` document (new `DOCUMENT_TYPES` entry) through the existing create/submit/approve/post pipeline. Reversible via the existing `reverseDocument`.

## Files changed

- `database/migrations/017_currency_and_exchange_rates.mjs`
- `platform/finance/engine.mjs` (+`round2` helper, +6 exported functions, +`fx_revaluation` document type and sequence template)
- `platform/finance/index.mjs` (3 new handler registrations)
- `tests/phase03/finance-wave-c.test.mjs`

## Tests and results

| Test | Result |
|------|--------|
| Missing exchange rate throws a clear error | PASS |
| Rate change: later rate wins; earlier lookups use the rate in effect on that date | PASS |
| `convertAmount` rounds to 2 decimals; same-currency is a no-op | PASS |
| `computeRealizedFx` returns gain/loss/none by direction | PASS |
| Revaluation posts a balanced document and is reversible | PASS |

Command:

```bash
node tests/phase03/finance-wave-c.test.mjs
# 29/29 passed (5 of the 29 are currency/FX-specific)
```

## Reconciliation evidence

Revaluation test: booked a 100 USD receipt into the bank account at rate 1300 (130,000 IQD local). Rate moved to 1310. `revalueForeignBalances` computed `totalGain = 1000` (100 × (1310 − 1300)) and posted a document with:

- Debit bank account 1,000 (revaluation gain adjustment)
- Credit gain account 1,000

Document posts as balanced (enforced by the same `validateDocumentBalanced` gate every document goes through) and reverses cleanly via `reverseDocument`, leaving the original revaluation document in `reversed` state with its `doc_number` preserved.

## Scope boundary (explicit, not a gap)

Realized FX (gain/loss recognized when a foreign-currency open item is *settled* by a payment) is implemented as the pure `computeRealizedFx` helper only — it is not wired into any payment flow yet because `finance_payments`/payment allocation do not exist until Wave D (Packet 03.15/03.16). This matches the governing document's own wave split; see `source-composition-ledger.md` Capability Wave C.2.
