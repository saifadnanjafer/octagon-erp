# Module Control and Licensing Evidence

## Decision order

For every action, the server derives company and branch from the authenticated
context and evaluates:

1. registered module existence and global enabled status;
2. branch assignment, then company assignment, then inherited access;
3. explicit company license status and validity dates;
4. the action's registered permission and handler contract.

The UI is only a projection of that decision. Hiding navigation does not grant
or revoke authority by itself.

## Governed facts

| Concern | Canonical fact / proof |
|---|---|
| Module state | `platform_modules.status`; optional module toggle is versioned |
| Dependencies | registered dependency graph; missing/disabled dependency fails closed |
| Scope assignment | `platform_module_assignments`; branch overrides company |
| Navigation preview | assignment visibility plus server access result |
| Licensing | `platform_module_licenses`; active/trial allowed, unlicensed/expired/suspended denied |
| Package and plan | license plan and feature list are read through the scoped Control Plane |
| Feature flags | existing feature registry through `control:feature:set` |
| Jobs | existing job registry through `control:job:set` |
| Health | existing health registry plus module access/configuration warnings |
| Audit/outbox | every mutation runs inside the ActionExecutor transaction |
| Secrets | API-key response contains prefixes only; no hash or secret fields |

## Failure and recovery proof

Deterministic tests prove company and branch precedence, dependency failure,
kernel lockout, licensing, idempotent replay, changed-payload rejection, and
rollback across state, audit, outbox, and idempotency.

Authenticated Chromium proves the owner scenario on a disposable database:

`enabled → navigation visible → action succeeds → disabled → navigation hidden
→ direct action denied → enabled → action restored`.

It separately proves `unlicensed → direct action denied → active → action
restored`. The restricted viewer cannot read or mutate the Control Plane.

## Safety

## C6 correction and final proof

Migration 051 corrects `control_plane.lifecycle_policy` from unregistered
`governed` to `generic`. Four executable scenarios cover fresh/rerun,
sequential 050→051, refusal to restore the invalid value on down/up, and
injected update failure. Final Administration browser proof is in the 90/90
trace.

Migration 050 has fresh-install, sequential 049→050, rerun, down/up, and
injected-failure coverage. All executable migration tests use generated SQLite
files under the operating-system temporary directory. No operational database
was migrated.
