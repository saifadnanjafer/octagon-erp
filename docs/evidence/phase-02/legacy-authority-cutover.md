# Legacy Authority Cutover Table

This table records the current state required by packet 02.32. `canonical-test`
means the new writer is proven in the disposable Phase 02 platform; `runtime`
means the current live Octagon shell/server path.

| Fact | Legacy reader/writer | VNext writer | New canonical writer | Cutover flag | Data migration / reconciliation | Rollback | Retirement commit |
|---|---|---|---|---|---|---|---|
| users | `server.js` JSON user reader/writer; `platform_users` compatibility view | VNext auth/ACL source | `identity_users` / `platform/identity/users` (canonical-test) | **DONE runtime** | migration 006 preserves IDs and memberships; fresh DB parity tested | migration 006 down restores `platform_users` | none; baseline `f5f4cf5` |
| sessions | `server.js` in-memory + `auth_sessions` persistence | VNext auth hardening | `identity_sessions` / `platform/identity/sessions` (canonical-test) | **DONE runtime** | no live DB migration run | keep legacy cookie/session until approved cutover | none |
| roles/grants | `acl.json`, `permissionService.js`, Phase 01 ACL tables | VNext ACL engine | `authorization_*` / `platform/authorization` (canonical-test) | **DONE runtime** | migration 007 read-once mirror and role aliases | migration 007 down | none |
| scopes | legacy company/group inference | VNext scope engine | memberships + record scopes/evaluator | **DONE runtime** | disposable tenant/company parity | restore adapter reads | none |
| settings/secrets | legacy JSON/settings providers | VNext governance settings | `settings_*`, `secret_*` | canonical-test only | migration 008; no production target touched | migration 008 down | none |
| custom fields/views | legacy `platform/server/views-fields.js` tables | VNext metadata clients | `custom_fields`, `view_schemas`, `saved_views` | canonical-test only | migration 008 | migration 008 down | none |
| workflows/instances | legacy P0.10 `platform/server/workflow.js` | VNext workflow engine | `workflow_*` / `platform/workflow` | canonical-test only | migration 009; frozen entities preserved | migration 009 down | none |
| approvals | legacy P0.10 approval tables | VNext approvals | `approval_*`, `worklist_items` / `platform/approvals` | canonical-test only | migration 009 | migration 009 down | none |
| audit/history | legacy JSON audit/history and P0.1 audit | VNext audit/chatter | `platform_audit_log`, `record_history`, snapshots | additive reads | provenance retained; parity assertions in tests | legacy read remains available | none |
| chatter/activities | P0.3/P0.10 server adapters | VNext chatter | `chatter_*`, `activities` / `platform/collaboration` | canonical-test only | migration 010 | migration 010 down | none |
| notifications | legacy `x_notifications`/server scheduler | VNext notify | `notifications_*` / `platform/notifications` | canonical-test only | migration 010 | migration 010 down | none |
| files | legacy documents/upload paths | VNext file contracts | `file_*` / `platform/files` | canonical-test only | migration 010 | migration 010 down | none |
| API keys | legacy provider key/config paths | VNext service identities | `identity_service_accounts`, `identity_api_keys` | canonical-test only | migrations 006 and 011 | migrations 006/011 down | none |
| jobs/webhooks | `server-scheduler.js` and legacy webhook routes | VNext integration engine | `job_runs`, `webhook_*` / `platform/jobs` | canonical-test only | migration 010 | migration 010 down | none |

## Verdict

All pending runtime cutover flags are now resolved: `server.js` initializes the
Phase 02 platform authority after migrations, all legacy session/ACL/local-bypass
checks are retired, and the app shell consumes `/api/auth/bootstrap` for
platform-controlled navigation and action visibility. Gate I is **PASSED** and
Phase 02 runtime authority is closed.

The remaining canonical-only capabilities (settings/secrets, custom fields/views,
workflows, approvals, chatter, notifications, files, API keys, jobs/webhooks) remain
proven in disposable-database tests and are not dually written by the legacy
runtime.

