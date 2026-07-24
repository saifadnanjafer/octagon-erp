# Runtime API Integration

The active application is the raw Node HTTP runtime in `server.js`.

Implemented surfaces:

- `platform/api/index.mjs::handlePlatformApi`
- `platform/api/commercial.mjs::handleCommercialQuery`
- `platform-runtime-bridge.mjs::createPlatformAuthority`
- `server.js` handling `/api/v1/*` and `/api/x/action/*`

Queries cover parties, products, UOM/pricing, warehouses/locations/balances/reservations/operations/valuation, sales, procurement, POS, and Work Items. Governed actions flow through the Phase 01 registry/executor rather than Express-style route handlers.

`tests/phase04/runtime_http.test.mjs` starts a real raw HTTP server on a disposable database and proves:

- unauthenticated request -> `401`;
- cross-company spoof -> `403`;
- scoped query envelope and correlation ID;
- governed action reaches the ActionExecutor;
- route list is mounted.

The legacy generic CRUD strangler in `server.js` maps protected collections to exact authority error codes. Finance denial remains active from Phase 03. Phase 04 denial is conditional on `phase04.canonical_cutover`; this flag remains disabled because actual-data reconciliation failed.
