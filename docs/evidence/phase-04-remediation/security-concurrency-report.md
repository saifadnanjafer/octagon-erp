# Security, Concurrency, and Failure Injection

Verified:

- payload company/branch/actor spoof rejection before mutation;
- raw HTTP unauthenticated and cross-company denial;
- 42 registered action handlers with required company scope;
- idempotent action replay;
- ActionExecutor outbox failure rolls back business/audit/idempotency;
- stock finance-port failure rolls back move/quant/valuation/GL/audit/outbox;
- reservation serialization prevents over-allocation and supports partial reserve;
- POS failure cannot leave a paid order or partial stock/finance effect;
- migration registry failure rolls back migration 043;
- migration rerun is idempotent;
- parallel fresh installs use distinct backup paths;
- Work Item optimistic version/approval behavior.

Not fully verified:

- every boundary in the prompt's 21-item failure-injection matrix;
- every item in the 17-item concurrency matrix;
- live revoked-session/role/field/export/attachment browser scenarios;
- warehouse/branch denial for every domain operation;
- compatibility-adapter failure injection.

The deterministic backend proof is strong but not exhaustive. Phase 02/03 live-browser failures and the migration hard stop prevent a no-high-risk claim.
