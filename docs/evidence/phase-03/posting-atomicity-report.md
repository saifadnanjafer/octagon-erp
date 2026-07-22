# Wave A — Posting Atomicity Report

**Scope:** `FN-004` Atomic posting pipeline.
**Evidence date:** 2026-07-22

## What was implemented

- `postDocument` runs inside the transaction already started by `ActionExecutor.execute()` (`BEGIN IMMEDIATE`).
- Pipeline steps (all within one transaction):
  1. Load document and verify state.
  2. Period and lock-date checks.
  3. Balance validation (base + foreign currency).
  4. Sequence allocation via `platform/records/sequences` (`nextSeq`).
  5. Hash chain computation.
  6. Insert immutable journal entry and GL lines.
  7. Insert integrity hash row.
  8. Update document to `posted` with number and post date.
- Failure at any step rolls back via the action executor.
- The action executor writes `platform_audit_log` and `platform_outbox` for every executed action.
- Idempotency is enforced by the action executor (`idempotency_policy: 'required'`).

## Files changed

- `platform/finance/engine.mjs` — `postDocument`.
- `platform/finance/index.mjs` — action handler registration.
- `database/migrations/014_finance_canonical_schema_and_coa.mjs` — action definitions.

## Tests and results

| Test | Result |
|------|--------|
| Unbalanced document rejected (no partial state) | PASS |
| Period lock prevents posting | PASS |
| Trial balance reconciles after posting | PASS |
| Hash chain verifies after multiple postings | PASS |
| Action executor integration (`finance_account:create`) | PASS |

Command:

```bash
node tests/phase03/finance-wave-a.test.mjs
```

## Failure-injection status

Wave A does not yet inject failures at every boundary. Mandatory failure-injection suite is scheduled for Wave F and will be added to `tests/phase03/finance-failure-injection.test.mjs`.
