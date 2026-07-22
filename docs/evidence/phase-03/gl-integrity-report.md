# Wave A — General Ledger Integrity Report

**Scope:** `FN-003` Immutable double-entry general ledger.
**Evidence date:** 2026-07-22

## What was implemented

- `finance_journal_entries` — posted header with company, journal, entry number, posting date, totals, hash, prev_hash.
- `finance_journal_lines` — append-only GL lines with account, debit/credit, currency, dimensions, partner, source document/line.
- SQLite triggers:
  - `t_finance_journal_lines_no_update` — rejects `UPDATE` on GL lines.
  - `t_finance_journal_lines_no_delete` — rejects `DELETE` on GL lines.
  - `t_finance_journal_entries_no_update` / `_no_delete` — rejects mutation/deletion of posted journal entries.
- `finance_integrity_hashes` stores the full hash input for every posted entry.
- `verifyHashChain()` recomputes and validates the entire chain.
- `getTrialBalance()` and `getGeneralLedger()` derive from `finance_journal_lines` only.

## Files changed

- `database/migrations/014_finance_canonical_schema_and_coa.mjs`
- `platform/finance/engine.mjs`
- `tests/phase03/finance-wave-a.test.mjs`

## Tests and results

| Test | Result |
|------|--------|
| Append-only GL trigger blocks direct UPDATE | PASS |
| Append-only GL trigger blocks direct DELETE | PASS |
| Hash chain verifies after multiple postings | PASS |
| Trial balance reconciles after posting | PASS |
| Reversal produces net-zero trial balance | PASS |

Command:

```bash
node tests/phase03/finance-wave-a.test.mjs
```

## Reconciliation evidence

After posting a 2,500 IQD expense/cash entry:

- Total debit on GL = 2,500
- Total credit on GL = 2,500
- Trial balance debit/credit totals equal.

After reversal:

- Expense account balance = 0 (within rounding tolerance).
- Reversal document is posted and linked to original.


## Wave B update

- Verified append-only GL triggers still block direct mutation/deletion.
- Verified hash chain integrity after full document lifecycle and reversal.
- Verified trial balance reconciles after approved-only posting.

### Tests added

| Test | Suite | Result |
|------|-------|--------|
| Hash chain verifies after lifecycle and reversal | `finance-wave-b.test.mjs` | PASS |
| Cross-company document access denied | `finance-wave-b.test.mjs` | PASS |
| Append-only GL trigger blocks direct mutation | `finance-wave-a.test.mjs` | PASS |

Command:

```bash
node tests/phase03/finance-wave-b.test.mjs
# PASS: 9/9
```
