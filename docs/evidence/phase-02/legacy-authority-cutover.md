# Legacy Authority Cutover Table

This table records the current state required by packet 02.32. `canonical-test`
means the new writer is proven in the disposable Phase 02 platform; `runtime`
means the current live Octagon shell/server path.

| Fact | Legacy reader/writer | VNext writer | New canonical writer | Cutover flag | Data migration / reconciliation | Rollback | Retirement commit |
|---|---|---|---|---|---|---|---|
| users | `app.js` local user facade and legacy JSON blob writer | VNext auth/ACL source | `identity_users` / `platform/identity/users` (runtime login adapter; shell facade remains) | **PARTIAL runtime** | migration 012 imports legacy collections before canonical migration | migration 012 down; legacy blob retained | pending shell reader retirement |
| sessions | `server.js` legacy compatibility helpers; canonical cookie/session handler | VNext auth hardening | `identity_sessions` / `platform/identity/sessions` (runtime) | **PASS runtime** | migration 012 migrates legacy sessions and removes `auth_sessions` | migration 012 down | legacy helpers still need removal audit |
| roles/grants | `permissionService.js` client facade and legacy JSON collections | VNext ACL engine | `authorization_*` / `platform/authorization` (runtime server evaluator) | **PARTIAL runtime** | migration 012 imports legacy ACL before canonical seeding | migration 012 down | pending client writer retirement |
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

This table is **PARTIAL — NOT CLOSED**. The server-side session and permission
boundaries are now live, but the table’s prior `DONE runtime` claims were too
strong. The existing shell still calls `saveData()` for governance collections;
that writer reaches the legacy full-blob `/api/db` endpoint. Settings/secrets,
custom fields/views, workflows, approvals, chatter, notifications, files, API
keys, and jobs/webhooks remain canonical-test only until their live callers are
strangled to the platform services.

Gate I remains open until every applicable row has one runtime writer, an
atomic migration/reconciliation plan, a rollback path, and an evidence-backed
retirement commit.

