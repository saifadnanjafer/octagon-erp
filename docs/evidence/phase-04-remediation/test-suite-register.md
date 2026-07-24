# Phase 04 Remediation Test Suite Register

Counts are unique per command and are not added across overlapping aggregate runs.

| Suite | Exact command | Exit | Pass | Fail | Skip | Duration / artifact |
|---|---|---:|---:|---:|---:|---|
| Phase 01 unit/migration | `node --test tests/unit/*.test.mjs tests/migration/*.test.mjs` | 0 | 80 internal cases in 10 files | 0 | 0 | 14.937s; stdout |
| Phase 02 deterministic | ten individual commands for identity, authorization, settings, workflows, collaboration, security, runtime integration, browser contract, runtime strangler, runtime adversarial | 0 each | 200 | 0 | 0 | command list below |
| Phase 02 live browser | `node tests/phase02/browser-live-evidence.test.mjs` | 1 | 8 | 4 | 0 | full run; isolated retries did not produce a clean suite |
| Phase 03 deterministic | individual Wave A-F, HTTP, UI parity, closure audit, final cutover commands | 0 each | 138 | 0 | 0 | command list below |
| Phase 03 live browser | `node --test tests/phase03/finance-browser-evidence.test.mjs` | 1 | 5 | 4 | 0 | `docs/evidence/phase-03/browser-results/finance-browser-evidence_2026-07-24T00-11-15-761Z.json` |
| Original Phase 04 waves | `node --test tests/phase04/wave-*.test.mjs` | 0 | 19 | 0 | 0 | 8.659s final separated run |
| Corrected Phase 04 | `node --test tests/phase04/canonical_*.test.mjs tests/phase04/migration_contract.test.mjs tests/phase04/legacy_migration.test.mjs tests/phase04/runtime_http.test.mjs tests/phase04/remediation_phase04.test.mjs` | 0 | 21 | 0 | 0 | 14.022s; includes parallel migration regression |
| Disposable actual-data migration | `node scripts/migrate_legacy_data.mjs` | 2 | 3 count reconciliations | 4 accounting/stock reconciliations | 0 | `BLOCKED`; original hash unchanged |
| Phase 04 browser gate | `node tests/phase04/browser_phase04_remediation.mjs` | 2 | 0 | 0 | 0 | blocked pre-execution; JSON artifact |
| Repository precommit | `node scripts/precommit.js` | 0 | gate pass | 0 | 0 | 31.2s; staged secret/path/syntax/duplicate scan |

## Phase 02 deterministic commands

- `node tests/phase02/identity.test.mjs` - exit 0; 32/0/0; 29.0s
- `node tests/phase02/authorization.test.mjs` - exit 0; 32/0/0; 49.9s
- `node tests/phase02/settings-policies.test.mjs` - exit 0; 29/0/0; 41.7s
- `node tests/phase02/workflow-approvals.test.mjs` - exit 0; 31/0/0; 41.4s
- `node tests/phase02/collaboration-files-jobs.test.mjs` - exit 0; 29/0/0; 33.8s
- `node tests/phase02/security-suite.test.mjs` - exit 0; 24/0/0; 34.0s
- `node tests/phase02/runtime-integration.test.mjs` - exit 0; 3/0/0; 7.6s
- `node tests/phase02/browser-evidence.test.mjs` - exit 0; 3/0/0; 5.2s
- `node tests/phase02/runtime-strangler.test.mjs` - exit 0; 6/0/0; 11.0s
- `node tests/phase02/runtime-adversarial.test.mjs` - exit 0; 11/0/0; 43.2s

Total: 200, correcting the current model's early arithmetic error and not including live-browser scenarios.

## Phase 03 deterministic commands

- `node tests/phase03/finance-wave-a.test.mjs` - exit 0; 14/0/0; 16.7s
- `node tests/phase03/finance-wave-b.test.mjs` - exit 0; 9/0/0; 11.3s
- `node tests/phase03/finance-wave-c.test.mjs` - exit 0; 29/0/0; 47.9s
- `node tests/phase03/finance-wave-d.test.mjs` - exit 0; 22/0/0; 23.6s
- `node tests/phase03/finance-wave-e.test.mjs` - exit 0; 15/0/0; 21.2s
- `node tests/phase03/finance-wave-f-adversarial.test.mjs` - exit 0; 10/0/0; 10.2s
- `node tests/phase03/finance-wave-f-migration.test.mjs` - exit 0; 12/0/0; 13.7s
- `node tests/phase03/finance-http-api.test.mjs` - exit 0; 4/0/0; 10.6s
- `node tests/phase03/finance-ui-parity.test.mjs` - exit 0; 3/0/0; 8.7s
- `node tests/phase03/finance-closure-audit.test.mjs` - exit 0; 14/0/0; 17.3s
- `node tests/phase03/finance-final-cutover.test.mjs` - exit 0; 6/0/0; 10.5s

Total: 138.

All deterministic-suite artifacts are the command stdout and disposable databases removed by their harnesses. Only the live browser suites persist JSON/screenshots, as listed in the table.

## Coverage interpretation

The corrected Phase 04 tests prove startup registration, scope spoof denial, idempotency, audit/outbox rollback, immutable stock/valuation, quant rebuild, reservation serialization, sales delivery/invoicing, procurement receipt/match/AP, POS rollback and close, Work Item parity, raw HTTP, migration fresh/upgrade/down-up/failure/rerun/parallel behavior, and fail-closed legacy migration.

They do not satisfy every item in the prompt's exhaustive failure-injection/concurrency/browser matrices. Those omissions remain explicit blockers/risks; no 100% coverage claim is made.
