# Wave A — Period, Lock, and Close Report

**Scope:** `FN-007` Fiscal periods and locks.
**Evidence date:** 2026-07-22

## What was implemented

- `finance_fiscal_years` and `finance_periods` tables with company scope.
- Default 2026 fiscal year and 12 monthly periods seeded for the default company in migration 014.
- `seedChartOfAccounts()` installs 2026 fiscal year/periods for any new company in tests.
- Period status: `open`, `soft_closed`, `hard_closed`, `locked`.
- `finance_locks` table for module-specific lock dates (e.g., `gl`).
- `postDocument` checks period status and lock date before posting.
- Period commands: `openPeriod`, `softClosePeriod`, `hardClosePeriod`, `reopenPeriod`.
- Reopen of a hard-closed period requires an explicit reason.

## Files changed

- `database/migrations/014_finance_canonical_schema_and_coa.mjs`.
- `platform/finance/engine.mjs` — period and lock helpers, `setPeriodStatus`, `setLockDate`.
- `platform/finance/index.mjs` — period action handlers.
- `tests/phase03/finance-wave-a.test.mjs`.

## Tests and results

| Test | Result |
|------|--------|
| Period lock prevents posting | PASS |
| Reopen reason required for hard-closed period | implemented in `reopenPeriod` (test in Wave B) |
| Backdated posting blocked by lock date | implemented in `checkPeriodAndLock` (test in Wave B) |

Command:

```bash
node tests/phase03/finance-wave-a.test.mjs
```

## Remaining work

- Full close checklist, unresolved-reconciliation warnings, and close-reconciliation reports are scheduled for Wave B/E.
- Period-close versus posting race concurrency test is scheduled for Wave F.
