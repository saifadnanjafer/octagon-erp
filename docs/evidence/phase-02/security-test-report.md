# Phase 02 Security and Concurrency Test Report

## Focused results

| Suite | Result |
|---|---:|
| `tests/phase02/identity.test.mjs` | 32/32 |
| `tests/phase02/authorization.test.mjs` | 32/32 |
| `tests/phase02/settings-policies.test.mjs` | 29/29 |
| `tests/phase02/workflow-approvals.test.mjs` | 31/31 |
| `tests/phase02/collaboration-files-jobs.test.mjs` | 29/29 |
| `tests/phase02/security-suite.test.mjs` | 24/24 |
| `tests/phase02/runtime-integration.test.mjs` | 3/3 |
| `tests/phase02/browser-evidence.test.mjs` | 3/3 |
| `tests/phase02/browser-live-evidence.test.mjs` | 3/3 |
| **Phase 02 total** | **186/186** |

All nine commands were run individually on 2026-07-21 under Node v24.14.1 with
SQLite `DatabaseSync` and disposable temp databases.

The adversarial cases in Phase 02 §58 all passed: hidden-action calls, body-
supplied identity/scope, loopback bypass, cross-tenant list/detail/export/file,
masked history/notification, duplicate decisions/dispatch, worker crash,
webhook replay, reset/MFA replay, API-key rotation/revocation, secret leakage,
public-link guessing, import bypass, and AI/service-identity overreach. Failure
injection and concurrency cases also passed.

The protected server boundaries and bounded browser run are evidenced by
`tests/phase02/runtime-integration.test.mjs` and
`tests/phase02/browser-live-evidence.test.mjs` (Puppeteer). This does not close
the remaining legacy full-blob writer or prove every live domain caller; those
risks remain recorded in `unresolved-risks.md`.

