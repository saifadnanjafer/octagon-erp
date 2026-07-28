# Checkpoint C5 — Administration and Module Control

## Outcome

The original Administration page now owns a bilingual Control Plane workspace.
It exposes nineteen governed areas: Companies, Branches, Users, Roles,
Permissions, Data Scopes, Modules, Feature Flags, Packages, Licensing,
Settings, Numbering Sequences, Integrations, API Keys, Jobs, Audit, Health,
Backups, and Localization.

The module view combines status, dependency validation, company/branch
assignment, license and plan state, health, missing-configuration warnings,
configuration links, and a role-aware navigation preview. API-key reads expose
prefix metadata only; hashes and secret material never enter the UI response.

## Server authority

Migration `050_control_plane_module_management` adds versioned module
assignments, explicit company licenses, backup-run metadata, a reversible test
module, its view, and registered Control Plane actions. Existing modules remain
in inherited-access mode unless an assignment or license explicitly narrows
them.

Every registered action is checked against its owning module inside
`ActionExecutor` before its handler runs. A disabled, scope-blocked, expired, or
unlicensed module therefore fails on the server even if a caller bypasses
navigation. Control actions remain owned by `platform_kernel`, allowing an
authorized administrator to recover a disabled optional module. The kernel
itself cannot be disabled.

## Authenticated browser proof

The final fresh-staging trace is:

`test-artifacts/checkpoint-c-2026-07-28T05-53-33-383Z/checkpoint-c-browser-results.json`

`Chrome/150.0.7871.24` passed **90/90** combined and **17/17** for C5. The
scenario executed:

1. assign the test module to the authenticated company and verify navigation;
2. call its server action successfully;
3. disable it and verify navigation removal;
4. bypass the UI and receive `403 MODULE_NOT_ENABLED`;
5. re-enable it and verify access restoration;
6. mark it unlicensed and receive `403 MODULE_UNLICENSED`;
7. restore an active license and verify access;
8. create and disable a governed feature flag;
9. inspect health, Arabic RTL, English LTR, tablet, and mobile surfaces;
10. authenticate as the restricted viewer and receive a server-side Control
    Plane denial.

Twelve reviewed, secret-free PNGs are under
`docs/evidence/visible-expansion/screenshots-c/administration/`.

## Executable gates

- C5 focused deterministic slice: 20/20.
- All Checkpoint C deterministic tests through C5: 92/92.
- Phase 04 finalization regression: 99/99.
- Permission regression: 35/35.
- Precommit: PASS.

The first aggregate run exposed that migration 049's older test assumed it
would always be the final migration. Its assertion was corrected to locate 049
by ID, matching the already future-safe migration 048 test. The rerun passed
92/92. No product behavior or acceptance threshold was weakened.

## Boundary

C5 is complete; C6 cross-domain closure remains. PostgreSQL execution, broad
Phase 04 writer retirement, production cutover, and the owner-approved opening
inventory accounting date are not claimed. Operational files were never
written.
