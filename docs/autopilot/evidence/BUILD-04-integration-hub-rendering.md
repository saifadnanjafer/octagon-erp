# BUILD-04 evidence — Integration Hub rendering hardening

The existing Integration Hub route remains the only surface changed. The
Marketplace workspace is now scheduled only for an `integration_hub` page
activation, and its generic observer renders the hub only while that page is
active. The E-Commerce workspace no longer eagerly renders during application
boot; it retains its page-scoped activation hook.

No route, connector state, external provider call, payment capture, or
operational data path was added or activated. Connector actions remain staged,
logged, and rollback-aware.

Focused validation on 2026-08-01:

- `node --check modules/platform-marketplace.js`
- `node --check modules/ecommerce-connectors.js`
- `npm.cmd run test:build-04` — 2/2 passed
- `node scripts/permission-regression.mjs` — 35/35 passed
- `npm.cmd run test:autopilot` — 3/3 passed
