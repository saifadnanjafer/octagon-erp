# Wave D — Open-Item Reconciliation and Banking Report

**Scope:** Packet 03.17 (open-item reconciliation engine) and Packet 03.18 (banking and statement import).
**Evidence date:** 2026-07-22

## What was implemented — reconciliation sessions

- `finance_reconciliation_sessions` / `finance_reconciliation_matches` — a session groups candidate matching for one partner/AR-or-AP target; `suggestReconciliationCandidates` pairs unallocated payments against open items by exact amount first, then within a caller-supplied tolerance with a confidence score; `confirmReconciliationMatch` calls the real `allocatePayment` (no separate settlement path); `undoReconciliationMatch` calls `unallocatePayment` and marks the match `undone` (never deleted).

## What was implemented — banking

- Directly ported from VNext `bank-engine.js` (project-owned): `finance_bank_accounts`, `finance_bank_match_rules`, `finance_bank_statement_batches`, `finance_bank_statement_lines`, `finance_bank_reconciliations`.
- Import dedup at two levels: `import_key` makes a whole repeated batch a no-op (returns `{ duplicate: true }` with the existing lines); `line_hash` (company + external id + date + amount + currency + description) rejects an individual duplicate line even inside a differently-keyed import.
- `matchBankStatementLine` — auto-matches against posted, unallocated-amount-agnostic `finance_payments` by amount within a rule's tolerance and an optional description-pattern filter.
- `recordBankDifference` posts a real adjustment document (bank account vs. a caller-chosen difference account) through the standard create→submit→approve→post pipeline, then reconciles the line against that new document.
- `unreconcileBankLine` reverses the reconciliation status (never deletes the row) and only flips the statement line back to `unmatched` if no other active reconciliation still covers it.

## Files changed

- `database/migrations/024_open_item_reconciliation_engine.mjs`
- `database/migrations/025_banking_and_statement_import.mjs`
- `platform/finance/engine.mjs` (+16 exported functions)
- `platform/finance/index.mjs` (+11 handler registrations)
- `tests/phase03/finance-wave-d.test.mjs`

## Tests and results

| Test | Result |
|------|--------|
| Reconciliation session: exact match suggestion, confirm, undo, closed-session rejection | PASS |
| Aging reconciles to zero after full reconciliation-session allocation | PASS |
| Repeated batch import is a no-op; duplicate line in a new batch is rejected | PASS |
| Malformed statement line (invalid amount) is rejected | PASS |
| Auto-match by amount within tolerance; already-reconciled line rejects a second match; unmatch restores it | PASS |
| Bank difference posts an adjustment document and reconciles the line | PASS |

Command:

```bash
node tests/phase03/finance-wave-d.test.mjs
# finance-wave-d: 22/22 passed (6 of the 22 are reconciliation/banking-specific)
```

## Reconciliation evidence

Posted a 750 IQD invoice and a 750 IQD payment for the same customer, opened an AR reconciliation session, and asked for suggestions: exactly one candidate returned with `method: 'exact'`. Confirming it drops `getCustomerOpenItems` to zero rows; undoing it restores the 750 open amount exactly — proven by direct assertion, not inferred.

## Scope boundary (explicit, not a gap)

Statement-line auto-matching in Wave D matches against `finance_payments` (money already entered into Octagon), not directly against unposted external bank feeds or a live provider API — "external-feed adapter boundary" from Packet 03.18 is satisfied by the `import_key`/line-array shape (any adapter can call `importBankStatement` with normalized lines), but no live provider connector was built, matching the packet's own "no real network" test fixture convention already established in `source-lock.md` (`bank_test_provider`).
