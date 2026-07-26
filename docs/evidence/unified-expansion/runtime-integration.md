# Runtime Integration Audit

## Mounted canonical runtime

`server.js:2708-2723` initializes the platform authority and mounts the platform
API at `/api/v1` when SQLite is available. The Phase 02 governance strangler is
created in the same startup path. Phase 04 deterministic runtime tests prove
governed ActionExecutor handlers and HTTP envelopes on isolated databases.

## Current cutover controls

`platform/cutover/legacy-writer-retirement.mjs` is the runtime authority for
Phase 04 legacy-writer denial. `server.js` calls its `enforced(domain)` result.
Finance generic-write denial is unconditional. A Phase 04 domain is denied only
when the global cutover flag and its exact retirement lock/target agree.
`tests/phase04/remediation_phase04.test.mjs` proves that the flag alone, a lock
for another domain, and a wrong target do not retire the writer.

Read-only inspection of the operational database found no Phase 04 cutover flag
row and no Phase 04 opening/retirement tables. This is consistent with the
production-safety rule that the operational database must not be migrated or
cut over automatically.

## Original shell integration gap

The original shell still uses broad `saveData()`/PentagonDB patterns. The
stock service directly mutates governed Phase 04 facts. No complete
server-authoritative Phase 04 client adapter was found. Therefore backend
capability is not equivalent to original-shell cutover.

The authenticated bootstrap now carries server-derived cutover status.
`services/financeService.js` consumes
`__octagonBootstrap.cutover.finance.enforced` before old client-local
overrides, closing the prior default-OFF split. A server-backed Phase 04 stock
client adapter is still absent, so inventory retirement remains prohibited.

## Degraded-mode risk

When SQLite is unavailable, `server.js` can serve `database.json` in degraded
mode. Governed domains must fail closed in this mode; it cannot be accepted as a
production canonical authority because the JSON mirror may be stale.
