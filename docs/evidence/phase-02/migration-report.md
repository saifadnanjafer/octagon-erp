# Phase 02 Migration Report

## Migrations

| Migration | Scope |
|---|---|
| `006_identity_authority.mjs` | identity, credentials, sessions, MFA, SSO, service accounts, API keys, impersonation, memberships |
| `007_authorization_registry.mjs` | permissions, roles/templates, grants, assignments, field rules, record scopes, routes, decisions |
| `008_settings_secrets_policies.mjs` | typed values/history, secret references/values/events, policy limits/delegation/SoD, custom fields/views, configuration packages |
| `009_workflow_approvals_sla.mjs` | definitions/versions/instances/steps/timers, approvals/worklists, calendars/SLA, automation |
| `010_collaboration_files_jobs.mjs` | history/snapshots, chatter, activities, notifications, files, exchange, jobs, webhooks |
| `011_service_identity_authorization.mjs` | actor-type-safe assignment migration without editing applied migration 007 |
| `012_runtime_authority_cutover.mjs` | retires legacy `auth_sessions`, migrates legacy users/companies/branches/ACL, aligns `x_records` |

All Phase 02 migrations declare SQLite, required transaction policy, reversible
down behavior, and source provenance. Applied migrations 001–011 are not edited;
new migration 012 starts from 011 and has an explicit down path.

## Evidence

`tests/phase02/security-suite.test.mjs` passed fresh installation, all Phase 01
tables surviving Phase 02, and full down/up rollback. `tests/migration/runner.test.mjs`
passed fresh install, rerun, dependency order, cycle/missing dependency, rollback,
concurrent lock, and PostgreSQL stub behavior. Tests use disposable `os.tmpdir()`
SQLite files only; `database.db` and `database.json` were not opened by tests.

Migration 012 is wired into fresh SQLite startup after the legacy JSON import and
its identity/session/ACL migration is covered by the focused suites. It does not
retire the legacy full-blob governance writer: `app.js` still calls `saveData()`
and settings/workflow/collaboration/files/jobs callers remain mixed. The
runtime-writer cutover is therefore **PARTIAL**; see `legacy-authority-cutover.md`
and `runtime-authority-map.md`.

