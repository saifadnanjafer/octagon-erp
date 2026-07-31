# Commercial Control Center (`commercial_control_center`)

Status: functional read surface, wired end-to-end. 2026-07-31.

## What it is

Governed READ projection over the canonical licensing/entitlement backend
(`platform_module_licenses`, module registry, identity users) through the
existing control-plane query surface. It is not a billing engine and creates
no second commercial authority.

## Data flow

- Page JS (`modules/fpc-commercial-control-center.js`) calls
  `GET /api/v1/control-plane/{overview|modules|licensing}`.
- Dispatch: `platform/api/index.mjs` → `handleControlPlaneQuery`, gated by the
  existing `control:admin` permission; tenant scoping in SQL.
- No backend changes were needed: all three resources already existed.

## Tabs and their real sources

- **Overview & usage** — `overview`: companies, branches, users (= consumed
  seats), enabled/unhealthy modules; licensed module count derived from
  `licensing` ∩ `modules`.
- **Entitlements** — `licensing`: module, company, plan, seats, validity
  window, package status. A fresh install serves exactly the 7 seeded platform
  module licenses (operations_*, assets_management, fleet_telematics).
- **Unlicensed modules** — `modules` minus licensed ids (43 registered modules
  on a fresh install, 7 licensed by default).

## Honesty properties

- Storage limits, AI allowances, API limits, and grace/trials have **no
  canonical backend meter**. They render as explicit `not_supported` badges,
  never as fabricated numbers (prompt §24/§31 rule).
- The interrupted draft's fake `editions`/`usageMeters` arrays were removed;
  the §74 no-hardcoded-KPI regression test now covers this page.
- The `upgrade()` alert was removed: no canonical commercial action exists,
  so the page offers no mutation.

## Tests

`tests/final-page-catalog/commercial-control-center.test.mjs` (5 tests,
disposable DB, licenses seeded through the real `control:license:set` action):
license round-trip, overview counts, unlicensed derivation, cross-tenant
license isolation (a license owned by another tenant never leaks; sibling
companies in the same tenant remain visible to this admin surface), and the
7 seeded platform licenses all referencing real registry modules.

## Shell registration

- Permission: `services/permissionService.js` (`admin/commercial`, critical
  risk, roles `system.admin`, `finance.manager`).
- Nav: `index.html` `navCommercialControlCenter`; `app.js` pageMap + prefetch +
  `admin_org` group.
- Mount: `root.OctagonPageKit.wirePage({...})` literal call (canonical pattern).
