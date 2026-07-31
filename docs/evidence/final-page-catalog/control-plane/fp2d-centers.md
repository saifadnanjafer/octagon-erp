# FP-2D — Organization / Identity / Permission Centers (2026-07-31)

Status: three governed read surfaces, wired end-to-end.

All three are projections over **existing** canonical authorities served through
`/api/v1/control-plane/*` (gated by `control:admin`). No new backend authority
was created. `multi_entity` (legacy currencies/branches page) is untouched and
remains for FP-10 consolidation.

## organization_center

- Tabs: Companies, Branches, Operating Scopes, Localization.
- Resources: `companies`, `branches`, `data-scopes`, `localization` (all
  pre-existing in `handleControlPlaneQuery`).
- Real facts on a fresh install: 1 default company, 0 branches, 0 scopes,
  0 localization packs — rendered as honest empty states.
- The 16 tabs in the FP-2 brief (Sites, Departments, BUs, Cost Centers,
  Hierarchy, Calendars, Fiscal, Legal IDs, Addresses, Module/Pack Assignment)
  have no canonical backend resources; they are not faked. Deferred.

## identity_center

- Tabs: Users, API Keys, SSO Providers.
- Resources: `users`, `api-keys`, `integrations`.
- Never renders passwords, hashes, tokens, recovery codes, or secret values —
  the canonical projections expose prefixes/metadata only; a dedicated test
  asserts no secret-like key appears in the served user row.
- Login history, sessions, lockouts, password policy, TOTP, passkey: no
  canonical read resources exist; not faked. Deferred.

## permission_center

- Tabs: Roles, Permissions, Data Scopes, Access Simulation.
- Resources: `roles`, `permissions`, `data-scopes` + the governance
  `permissions/explain` evaluator query (read-only).
- Access Simulation is a real evaluation through the canonical evaluator —
  not a mock. It accepts a permission token, optional target user, optional
  entity/amount, and renders allow/deny with the evaluator's own explanation.
- Role comparison, field masks, record rules, exportable evidence: no
  canonical resources yet; not faked. Deferred.

## Tests

`tests/final-page-catalog/fp2d-centers.test.mjs` (8 tests, disposable DB):
company/branch scoping incl. cross-tenant branch isolation, honest empty
states, owner row without secret-like fields, empty API-key/SSO lists, roles
with grant counts, the 156+ permission registry, and no permission
referencing an unknown module.

## Shell registration

- Permissions: `organization_center` (admin/org, high), `identity_center`
  (admin/identity, critical), `permission_center` (admin/permissions,
  critical). Roles: org → admin+workshop.manager+finance.manager;
  identity/permission → system.admin only.
- Nav buttons `navOrganizationCenter` / `navIdentityCenter` /
  `navPermissionCenter` in `admin_org`; pageMap, prefetch, CSS+JS includes.
- Mount: literal `root.OctagonPageKit.wirePage({...})` on all three.
