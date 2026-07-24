# Action Registry Integration

Migration 043 registers 42 Phase 04 actions with:

- module/entity IDs;
- `kind=domain`;
- permission and company scope;
- input schema;
- `transaction_owner=platform_action_executor`;
- required idempotency, audit, and outbox;
- stable error contract.

Every domain `index.mjs` now uses `registerDomainHandler` from `platform/kernel/actions/domain-handler.mjs`, which rejects body/query attempts to supply company, branch, or actor authority and injects session-derived scope.

`ActionExecutor` supports multi-segment action IDs and records business mutation, idempotency, audit, and outbox inside the same database transaction. `SqliteDialect.isTransaction` prevents nested transaction ownership.

Proof:

- `canonical_runtime.test.mjs`: 42 registry rows/42 handlers, scope spoof denial, idempotent replay, injected outbox rollback.
- `remediation_phase04.test.mjs`: fresh install, live handler census, cutover flag disabled.
- `runtime_http.test.mjs`: actual raw HTTP reachability and denial.
