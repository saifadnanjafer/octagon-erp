# Security and Scope Report

## Writer retirement

Runtime module: `platform/cutover/legacy-writer-retirement.mjs`.

Protected domains are COMMERCIAL, INVENTORY, SALES, PROCUREMENT, POS, and
WORK_ITEM. For each, enforcement requires:

1. `platform_feature_flags.phase04.canonical_cutover = 1`;
2. the exact `authority_retirement_locks.authority_key`;
3. status `RETIRED`;
4. the expected canonical target.

Missing schema, missing row, wrong target, wrong domain, or disabled flag does
not claim retirement. Finance remains independently canonical and denied on
generic legacy writes.

`tests/phase04/remediation_phase04.test.mjs` proves the two-key rule.
`tests/phase04/runtime_http.test.mjs` proves unauthenticated 401, permission 403,
scope-spoof 403, and server-derived company scope on canonical routes.

## Client selection

`platform-runtime-bridge.mjs:handleBootstrap` returns server-derived cutover
state. `services/financeService.js:canonicalFinanceEnabled` consumes that
decision before old local overrides.

## Frozen data

No payroll, attendance, or timesheet file or collection was changed. No
operational database component was written.
