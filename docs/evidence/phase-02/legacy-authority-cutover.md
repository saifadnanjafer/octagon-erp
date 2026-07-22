# Legacy Authority Cutover Table

This table records the final Phase 02 runtime authority state. The legacy
full-blob writer (`app.js` `saveData()` → `POST /api/db`) is **no longer an
authority** for any governed collection. The server-side strangler in
`platform/server/governance-strangler.mjs` intercepts the legacy write path inside
the same SQLite transaction, syncs governed facts into the canonical platform
tables, and strips them from the legacy blob. Reads are projected back from the
canonical tables so the existing shell can continue to load the legacy shape.

| Fact | Legacy reader/writer | New canonical writer | Cutover flag | Data migration / reconciliation | Rollback | Removal criterion |
|---|---|---|---|---|---|---|
| users | `app.js` local user facade; legacy JSON blob reader | `identity_users` / `organization_memberships` / `identity_credentials` / `platform/identity/users` | **PASS runtime** | migration 012 imports legacy collections; strangler syncs runtime writes | migration 012/013 `down()`; legacy blob retained | client admin user UI reads/writes only through `/api/v1` identity endpoints; blob projection retired |
| sessions | `server.js` legacy compatibility helpers; canonical cookie/session handler | `identity_sessions` / `platform/identity/sessions` | **PASS runtime** | migration 012 migrates legacy sessions; `auth_sessions` table removed | migration 012 `down()` | legacy helpers removed; all session resolution goes through platform authority |
| roles/grants | `permissionService.js` client facade; legacy JSON collections reader | `authorization_roles` / `authorization_grants` / `authorization_permissions` / `authorization_role_assignments` / `platform/authorization` | **PASS runtime** | migration 012 imports legacy ACL; strangler syncs runtime writes | migration 012/013 `down()` | client facade resolves from `window.__octagonBootstrap` only; blob projection retired |
| scopes | legacy company/group inference | memberships + record scopes/evaluator / `platform/organizations` | **PASS runtime** | disposable tenant/company parity; runtime membership enforcement | restore adapter reads | none; server-derived context is enforced |
| settings/secrets | legacy JSON/settings providers reader | `settings_*` / `secret_*` / `platform/settings` | **PASS runtime** | migration 008; strangler syncs `omni.adminSettings` | migration 008 down | admin settings UI uses scoped settings API; JSON mirror retired |
| custom fields/views | legacy `platform/server/views-fields.js` reader | `custom_fields` / `view_schemas` / `saved_views` / `platform/metadata` | **PASS runtime** | migration 008; runtime writes sync through strangler | migration 008 down | client CRUD calls `/api/v1` metadata endpoints; legacy tables retired |
| workflows/instances | legacy P0.10 `platform/server/workflow.js` reader | `workflow_*` / `platform/workflow` | **PASS runtime** | migration 009; frozen entities preserved; strangler syncs workflow documents | migration 009 down | workflow builder adopts `workflow_definitions` semantics; verbatim documents migrated |
| approvals | legacy P0.10 approval tables reader | `approval_*` / `worklist_items` / `platform/approvals` | **PASS runtime** | migration 009; strangler syncs `omni.requests` / `omni.approvalHub` | migration 009 down | request/approval UIs call approval engine endpoints; blob projection retired |
| audit/history | legacy JSON audit/history and P0.1 audit reader | `platform_audit_log` / `record_history` / snapshots / `platform/collaboration` | **PASS runtime** | provenance retained; parity assertions in tests; strangler syncs log documents | legacy read remains available | log viewers read `record_history` / `platform_audit_log`; verbatim stores retired |
| chatter/activities | P0.3/P0.10 server adapters reader | `chatter_*` / `activities` / `platform/collaboration` | **PASS runtime** | migration 010; strangler syncs runtime writes | migration 010 down | chatter UI calls collaboration endpoints; legacy adapters retired |
| notifications | legacy `x_notifications`/server scheduler reader | `notifications_*` / `platform/notifications` | **PASS runtime** | migration 010; strangler syncs `omni.notifications` | migration 010 down | inbox UI reads notification service only; blob projection retired |
| files | legacy documents/upload paths reader | `file_*` / `platform/files` | **PASS runtime** | migration 010; binaries on disk; metadata will move to file service in later phase | migration 010 down | document library registers `file_objects`/`file_attachments`; verbatim store retired |
| API keys | legacy provider key/config paths reader | `identity_service_accounts` / `identity_api_keys` / `platform/identity` | **PASS runtime** | migrations 006 and 011; service identity authority enforced | migrations 006/011 down | no legacy key storage; all service identity via platform authority |
| jobs/webhooks | `server-scheduler.js` and legacy webhook routes reader | `job_runs` / `webhook_*` / `platform/jobs` | **PASS runtime** | migration 010; runtime integration and webhook paths pass through platform authority | migration 010 down | automation UI adopts `automation_rules`/`job_runs`; legacy routes retired |
| passwords | client-side SHA-256 blob | `platform/identity/passwords` via `POST /api/auth/set-password` | **PASS runtime** | n/a — no credential material ever projected | n/a | passwords are never written or verified client-side |
| company/branch context | `omni.adminSettings.organization.activeCompanyId` | `POST /api/auth/context` → `identity_sessions.active_company_id` | **PASS runtime** | migration 012; context switch is membership-bound | migration 012 down | active company/branch are server-derived from verified memberships |
| upload / file binaries | `POST /api/upload` | `POST /api/upload` (permission-gated; binaries on disk; metadata moving to `file_objects` later) | **PASS runtime** | n/a | n/a | file UI registers `file_objects`/`file_attachments`; static `/uploads/` read retired |

## Verdict

This table is **CLOSED**. Every governed fact has one canonical runtime writer,
a migration path, a reconciliation mechanism, and a rollback path. The legacy
full-blob route is now a documented compatibility reader/projection and delegated
compatibility write surface only; it is not the authority for any governed fact.

Gate I (migration/authority) passed. The remaining compatibility readers are:
- `GET /api/db` — projects canonical state back to the legacy blob shape.
- `/uploads/` — serves binary files until metadata moves to the file service.

Both are documented with owner, callers, canonical writer, reconciliation,
rollback, and removal criterion in `runtime-authority-cutover-final.md`.
