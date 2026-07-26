# Runtime Integration Audit

## Mounted canonical runtime

`server.js:2708-2723` initializes the platform authority and mounts the platform
API at `/api/v1` when SQLite is available. The Phase 02 governance strangler is
created in the same startup path. Phase 04 deterministic runtime tests prove
governed ActionExecutor handlers and HTTP envelopes on isolated databases.

## Current cutover controls

`server.js:1958-1975` reads `phase04.canonical_cutover` from
`platform_feature_flags`. Finance generic-write denial is unconditional; Phase
04 generic-write denial is conditional on that flag.

Read-only inspection of the operational database found no Phase 04 cutover flag
row and no Phase 04 opening/retirement tables. This is consistent with the
production-safety rule that the operational database must not be migrated or
cut over automatically.

## Original shell integration gap

The original shell still uses broad `saveData()`/PentagonDB patterns. The
stock service directly mutates governed Phase 04 facts. No complete
server-authoritative Phase 04 client adapter was found. Therefore backend
capability is not equivalent to original-shell cutover.

Finance has an additional split: the server always protects finance generic
writes, while the browser finance service defaults its canonical flag OFF.
This can select a legacy client path that the server then rejects. Runtime
acceptance must exercise both successful canonical actions and rejected legacy
mutations.

## Degraded-mode risk

When SQLite is unavailable, `server.js` can serve `database.json` in degraded
mode. Governed domains must fail closed in this mode; it cannot be accepted as a
production canonical authority because the JSON mirror may be stale.
