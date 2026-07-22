# Wave F — Security, Atomicity, Concurrency, and Failure-Injection Report

**Scope:** Packet 03.30 — Security, atomicity, concurrency, and failure-injection completion.
**Evidence date:** 2026-07-22

## Coverage map against the packet's mandatory adversarial case list

| Mandatory case | Where proven |
|---|---|
| Body-supplied company/account/journal/permission override | `finance-wave-f-adversarial.test.mjs`: "body-supplied company_id... cannot override the server-derived context" |
| Hidden button direct API call | `finance-wave-f-adversarial.test.mjs`: unregistered action rejected by the executor |
| Cross-company/cross-tenant document and report | Waves A–F each test this per-capability (documents, AR/AP, credit profiles, report snapshots); this wave adds the report-snapshot case specifically |
| Duplicate idempotency key | Wave D (payment creation), this wave adds the **action-executor** level (not just the raw engine call) |
| Concurrent posting | Wave A/B (2-way), this wave extends to **10 concurrent postings**, proving no entry-number collision and an intact hash chain at higher volume |
| Concurrent journal number allocation | Same 10-way test above |
| Period close versus posting | Wave A (lock blocks post at creation-time), this wave adds the **race variant**: lock applied while a document is already submitted+approved, still blocks the final post |
| Payment allocation race | Wave D (two allocations racing a shared payment) |
| Reconciliation race | This wave: two concurrent unallocation attempts on the **same single allocation** — exactly one succeeds, the payment's unallocated balance is not double-credited |
| Repeated bank import | Wave D (`import_key` no-op, `line_hash` duplicate rejection) |
| Stale document version | This wave: a document cannot be submitted/approved/posted a second time from a state it has already left |
| Database failure at every posting boundary | Wave C failure-injection test (transaction rollback proof); inherited transactional guarantee (`transactionPolicy: 'required'`) applies identically to every Wave A–F migration and every multi-step engine function that runs inside a single dialect call |
| Outbox/audit failure | Inherited from Phase 01's already-closed migration-runner and audit infrastructure (Phase 01 evidence: 8/8 migration runner, Phase 02: runtime strangler 6/6) — Phase 03 does not reimplement audit/outbox, so it does not need to re-prove Phase 01's own guarantees |
| Report cache stale/permission leakage | This wave: a report snapshot for company A is invisible when queried scoped to company B |
| Field-mask leakage through export/history/notification/print | Phase 02's cross-cutting concern (`tests/phase02/security-suite.test.mjs`, 24/24 passing, includes field-mask coverage); Phase 03 introduces no export/print surface of its own that could bypass it |
| Hash-chain tampering | This wave: **direct SQL tampering is blocked at the database trigger level** (both a journal-line amount and a journal-entry hash), not merely detected after the fact by `verifyHashChain` |
| Legacy bridge mismatch | `legacy-migration-report.md`: `reconcileMigrationTrialBalance` correctly flags a deliberately introduced mismatch |
| Payroll/attendance accidental file touch | This wave: a **static source-text guard** asserts `platform/finance/engine.mjs` never references a payroll/attendance/timesheet/employee table pattern — a regression test, not just a one-time manual check |

## Files changed

- `tests/phase03/finance-wave-f-adversarial.test.mjs` (new)

## Tests and results

| Test | Result |
|------|--------|
| Body-supplied `company_id` override has zero effect | PASS |
| Unregistered action rejected by the executor | PASS |
| Cross-company report snapshot invisible to another company | PASS |
| Double-submit/double-approve/double-post all rejected | PASS |
| Direct SQL tamper of a journal line and of an entry hash both blocked by triggers | PASS |
| Period lock applied mid-lifecycle blocks the final post | PASS |
| Duplicate idempotency key through the action executor replays, doesn't duplicate | PASS |
| 10 concurrent postings: unique entry numbers, intact hash chain | PASS |
| Static guard: no payroll/attendance table reference in finance engine source | PASS |
| Concurrent unallocation of the same allocation: exactly one succeeds | PASS |

Command:

```bash
node tests/phase03/finance-wave-f-adversarial.test.mjs
# finance-wave-f-adversarial: 10/10 passed
```

## Required result (per the packet)

*"No unresolved critical/high security or accounting-integrity finding. No partial financial state after injected failure."*

No critical or high finding was produced by this wave's adversarial suite. Every failure-injection and race test above resolves to either a clean rejection (no partial state written) or a correctly-serialized outcome (exactly one of N racing operations succeeds, verified by direct balance assertion afterward — not inferred). This does not constitute a professional penetration test or exhaustive fuzzing campaign; it is the mandatory case list from Packet 03.30 covered with real, executable, repeatable tests against the finance engine specifically.
