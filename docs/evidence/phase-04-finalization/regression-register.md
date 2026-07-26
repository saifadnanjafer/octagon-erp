# Regression Register — Phase 04 Finalization

`package.json` has no `scripts` block, so every suite is invoked directly.
Counts are reported per suite and never aggregated.

## Executed

| Suite | Exact command | Exit | Pass | Fail | Skip | Duration |
|---|---|---:|---:|---:|---:|---:|
| Phase 04 finalization (client + adapter) | `node --test tests/phase04-finalization/*.test.mjs` | 0 | 38 | 0 | 0 | ~0.4 s |
| Phase 04 aggregate | `node --test tests/phase04/*.test.mjs` | 0 | 47 | 0 | 0 | ~15.1 s |
| Permission regression | `node scripts/permission-regression.mjs` | 0 | 35 | 0 | 0 | <1 s |
| Syntax — client | `node --check services/canonicalClient.js` | 0 | — | — | — | — |
| Syntax — adapter | `node --check services/commercialAdapter.js` | 0 | — | — | — | — |
| Syntax — shell | `node --check app.js` | 0 | — | — | — | — |
| Precommit | Octagon precommit hook (automatic, every commit) | 0 | — | — | — | — |

### What each proves — and does not

**Phase 04 finalization (38).** Proves the canonical transport contract
(identity never sent, idempotency and correlation present, envelope unwrapped,
governed machine codes preserved, server cutover decision authoritative,
failures fail closed) and the commercial seam contract (canonical XOR legacy,
no fallback on failure, governed quantities never on a product write).
Does **not** prove browser behavior — `fetch` is a recording stub — and does not
prove the client reaches a real platform runtime.

**Phase 04 aggregate (47).** Proves the server-side canonical engines:
governed ActionExecutor handlers, HTTP envelopes, stock/reservation/valuation
atomicity and rollback, POS cash-shift ownership, cutover flag/lock two-key
behavior. Runs on fresh disposable databases in the OS temp directory. Does
**not** prove the original shell uses any of it.

**Permission regression (35).** Proves role inheritance, mapped page policy,
sensitive action outcomes, unmapped page behavior and high-risk approval
routing. Read-only, seeds roles in memory. Does **not** touch the operational
database.

## Not executed — and why

| Suite | Reason |
|---|---|
| Real Chromium acceptance | Wave 7 not started. **No browser process ran in this session.** No synthetic DOM or static snapshot is offered in its place. |
| Migration contract tests | No migration was added or changed. |
| Opening-cutover real-source run | Blocked: `OPENING_CUTOVER_DATE_REQUIRED`. Not attempted. |
| Writer-retirement activation | Prohibited before browser parity. No flag or lock was flipped. |
| Concurrency / failure-injection beyond the aggregate | Waves 3–5 not started. |
| Phase 01 / 02 / 03 regressions | Not re-run this session. Their last recorded status is in prior evidence and was **not** re-verified here; do not treat it as current. |

## Rule observed

No suite was weakened, skipped, or deleted to obtain a green result. The one
product defect found (`roles` stripping) was fixed in the product code, not in
the test that caught it.
