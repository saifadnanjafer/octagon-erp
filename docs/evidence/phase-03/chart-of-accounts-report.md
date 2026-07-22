# Wave A — Chart of Accounts Report

**Scope:** `FN-001` Canonical chart of accounts.
**Evidence date:** 2026-07-22
**Branch:** `phase-03/finance-tax-payments-reporting` @ `da0a1a2` + Wave A changes

## What was implemented

- Relational `finance_accounts` table with company scope, hierarchy, type, normal balance, reconcilable flag, currency restriction, control/tax/bank/cash/retained-earnings roles, and localization origin.
- Unique `(company_id, code)` constraint.
- `finance_journals` table for typed journals.
- Default Iraq-style chart of accounts seeded for the default company in migration `014_finance_canonical_schema_and_coa`.
- `seedChartOfAccounts()` helper to install a CoA for any company during tests.
- Actions registered: `finance_account:create`, `finance_account:update`, `finance_account:deactivate`, `finance_journal:create`.
- Engine functions: `createAccount`, `updateAccount`, `deactivateAccount`, `createJournal`, `accountIdByCode`.

## Files changed

- `database/migrations/014_finance_canonical_schema_and_coa.mjs` — schema and default CoA seed.
- `platform/finance/engine.mjs` — account and journal authority.
- `platform/finance/index.mjs` — action handler registration.
- `tests/phase03/finance-wave-a.test.mjs` — Wave A tests.

## Tests and results

| Test | Result |
|------|--------|
| Duplicate account code rejected | PASS |
| Invalid account type rejected | PASS |
| Account hierarchy cycle rejected | PASS |
| Cross-company account access denied | PASS |
| Action executor `finance_account:create` | PASS |

Command:

```bash
node tests/phase03/finance-wave-a.test.mjs
```

Wave A result: `14/14` tests passed.

## Known remaining work

- Localization pack install command (`finance.localization:install`) will be added in Wave C.
- Currency-restriction enforcement at posting time is accepted but not yet tested with multi-currency.
- Deactivate-after-use rule is enforced; no hard-delete path is provided.
