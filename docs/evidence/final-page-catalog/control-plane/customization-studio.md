# Customization Studio (`customization_studio`)

Status: functional read surface, wired end-to-end. 2026-07-31.

## What it is

Governed READ projection over the canonical ConfigurationAuthority
(`platform/configuration/index.mjs`) — the same authority that owns custom
fields, view schemas, saved views, and configuration packages. No second
customization backend was created.

## Data flow

- Page JS (`modules/fpc-customization-studio.js`) calls
  `GET /api/v1/control-plane/{custom-fields|view-schemas|saved-views|packages}`.
- Dispatch: `platform/api/index.mjs` → `handleControlPlaneQuery`, gated by the
  existing `control:admin` permission; tenant + in-scope-company filtering in SQL.
- New read resources added in `platform/control_plane/index.mjs` over the
  authority's own tables (`custom_fields`, `view_schemas`, `saved_views`).
  Read-only; no mutation path was added.

## Honesty properties

- Empty states are real query results (test 1 asserts a fresh install returns
  `[]`, not an error, not fabricated rows).
- No fake arrays, no hardcoded KPIs (enforced by the extended §74 regression test).
- The previous draft's `prompt()`-based fake `newField()` mutation was removed:
  no registered ActionExecutor action exists for custom-field/view-schema writes,
  so the page offers no mutation button. Wiring `defineCustomField` /
  `defineViewSchema` / `saveView` behind governed actions is tracked as deferred
  hardening in unresolved-risks.md.

## Protected zones

Unchanged: the authority refuses structural change on protected entities
(`CONFIGURATION_PROTECTED`) and only permits presentation schemas there.

## Tests

`tests/final-page-catalog/customization-studio.test.mjs` (6 tests, disposable DB,
fixtures seeded through the real authority): empty state, custom-field round-trip,
view-schema round-trip, saved-view round-trip, out-of-scope company isolation,
unknown resource → 404.

## Shell registration

- Permission: `services/permissionService.js` (`admin/customization`, high risk,
  roles `system.admin`, `workshop.manager`).
- Nav: `index.html` `navCustomizationStudio` in the admin/org group;
  `app.js` pageMap + prefetch + `admin_org` group.
- Mount: `root.OctagonPageKit.wirePage({...})` literal call (canonical pattern).
