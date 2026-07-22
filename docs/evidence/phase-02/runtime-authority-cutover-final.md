> Final runtime authority cutover report — Phase 02 final-closure remediation.
> Generated during `remediation/phase-02-final-closure` after the server-side strangler, migration 013, and client cutover landed.

# Runtime Authority Cutover Final Report

## What changed

Phase 02 closed the gap between the canonical Phase 02 governance platform and the existing Octagon runtime shell. The legacy full-blob writer (`saveData()` → `POST /api/db`) is no longer an authority for any governance fact; the platform tables are.

### Files changed

| File | What changed |
|---|---|
| `server.js` | Strangler wired into `saveDbToSqlite` / `loadDbFromSqlite`; `POST /api/db` fail-closed on unreadable state; body limits; WhatsApp webhook fail-closed; static path traversal guard; `/api/auth/set-password` and `/api/auth/context` routes; legacy `x_records` pre-alignment before migrations. |
| `platform-runtime-bridge.mjs` | `handleSetPassword` and `handleContextSwitch` handlers exposed to `server.js`. |
| `server-jarvis-security.js` | Removed dead `isManagerSession` `local-dev` bypass. |
| `app.js` | Client-side credential authority retired; password set/reset calls `/api/auth/set-password`; `updateActiveCompany` calls `/api/auth/context`; no password fields written locally. |
| `services/permissionService.js` | `explainAction`/`checkField` consult `window.__octagonBootstrap` for server-derived action and field authority. |
| `database/migrations/012_runtime_authority_cutover.mjs` | On-demand creation of referenced tenant/company/branch rows so real legacy data satisfies FKs during the chain. |
| `database/migrations/013_governance_collection_cutover.mjs` | NEW — imports existing governed blob rows into canonical tables and deletes them from the legacy `collections`/`metadata` tables; reversible `down()`. |
| `platform/server/governance-collections.mjs` | NEW — shared adapter used by migration 013 and the runtime strangler; syncs and projects the governed domains. |
| `platform/server/governance-strangler.mjs` | NEW — runtime bridge module that wires the adapter into `server.js`. |
| `tests/phase02/runtime-strangler.test.mjs` | NEW — runtime strangler verification against the spawned server. |
| `tests/phase02/runtime-adversarial.test.mjs` | NEW — runtime adversarial security battery. |
| `tests/phase02/browser-live-evidence.test.mjs` | Expanded — mandated browser scenarios (see below). |

### Governed domains and canonical writers

| Fact | Legacy writer | New canonical writer | Compatibility reader | Removal criterion |
|---|---|---|---|---|
| identity / users | `app.js` `omni.users` blob | `identity_users` + `organization_memberships` + `identity_credentials` | `GET /api/db` projects sanitized users | client admin user UI reads/writes only through `/api/v1` identity endpoints; blob projection retired |
| roles / permissions | `app.js` `omni.roles`/`omni.permissions`/`omni.userRoles` | `authorization_roles` + `authorization_grants` + `authorization_permissions` + `authorization_role_assignments` | `GET /api/db` projects roles | `permissionService` resolves from server bootstrap only; blob projection retired |
| settings / admin settings | `app.js` `omni.adminSettings` | `settings_values` / `settings_history` (key `octagon.legacy.admin_settings`) | `GET /api/db` projects adminSettings object | admin settings UI uses scoped settings API; json mirror retired |
| notifications | `app.js` `omni.notifications` | `notifications` table | `GET /api/db` projects notifications | inbox UI reads the notification service only; blob projection retired |
| approvals / requests | `app.js` `omni.requests` + `omni.approvalHub` | `approval_requests` / `approval_decisions` / `worklist_items` | `GET /api/db` projects requests + approvalHub | request/approval UIs call the approval engine endpoints; blob projection retired |
| workflow documents | `app.js` `omni.workflow` / `omni.workflows` / `omni.workflowHistory` | `x_records` entities `legacy_workflow*` | `GET /api/db` projects workflow documents | workflow builder adopts `workflow_definitions` semantics; verbatim documents migrated |
| system/history/audit logs | `app.js` / `server.js` blob logs | `x_records` entities `legacy_system_log`, `legacy_history_ledger`, `legacy_audit_log` | `GET /api/db` projects logs | log viewers read `record_history` / `platform_audit_log`; verbatim stores retired |
| document library | `app.js` `omni.documents` | `x_records` entity `legacy_documents` | `GET /api/db` projects documents | document library registers `file_objects`/`file_attachments`; verbatim store retired |
| automation rules/log | `app.js` `omni.automationRules` / `omni.automationFireLog` | `x_records` entities `legacy_automation_rules` / `legacy_automation_fire_log` | `GET /api/db` projects automation data | automation UI adopts `automation_rules`/`job_runs`; verbatim stores retired |
| passwords | client-side SHA-256 blob | `POST /api/auth/set-password` → `platform/identity/passwords` | none | passwords are never projected; client credential authority retired |
| company/branch context | `omni.adminSettings.organization.activeCompanyId` | `POST /api/auth/context` → `identity_sessions.active_company_id` | bootstrap `scope.activeCompanyId` | active company is server-derived from verified membership |
| upload / file binaries | `POST /api/upload` | `POST /api/upload` (permission-gated; binaries still on disk; metadata will move to `file_objects` in a later phase) | `/uploads/` static reads (permission-gated) | file UI registers `file_objects`/`file_attachments` |

### Legacy authorities retired

- The full-blob `POST /api/db` writer no longer owns any governed collection; it delegates to the per-domain platform writers inside the same SQLite transaction.
- The client-side `passwordHash`/`passwordSalt` authority is removed; the client never writes or verifies credential fields.
- The `isManagerSession` `local-dev` mode bypass is removed; manager checks go through the platform authority.
- The hardcoded WhatsApp verify token is removed; verification fails closed when the secret is not configured.
- The WhatsApp webhook signature path no longer accepts unsigned payloads when `WHATSAPP_APP_SECRET` is unset.
- The static file handler no longer resolves outside the application directory.

### Compatibility adapters remaining

- `GET /api/db` remains a documented compatibility reader for the shell: it projects the canonical governance collections back into the legacy blob shape so the existing client can load and save without a full rewrite.
- `/uploads/` reads remain a compatibility reader for binary files until file metadata is moved to the file service.

### Rollback / removal

- Migration 013 `down()` re-exports the canonical state into the legacy `collections`/`metadata` tables and removes the canonical rows it created, so a pre-cutover server build can resume.
- Once the client shell is migrated to call the platform `/api/v1` endpoints directly, the `GET /api/db` compatibility projection can be retired.

## Reconciliation

`reconcileGovernance()` confirms the legacy blob no longer holds governed rows (`legacy_blob_governed_rows === 0`) after the cutover.

## Browser scenarios executed

See `tests/phase02/browser-live-evidence.test.mjs` and the screenshot directory `docs/evidence/phase-02/browser-screenshots/`.

- Arabic RTL identity / owner login bootstrap
- Logout and session revocation
- Role-specific navigation (owner vs clerk)
- Direct API denial and request-body identity override
- Tenant/company isolation (server-derived active company)
- Field masking via bootstrap field metadata
- Workflow / approval create and decide
- Inbox, chatter, and file upload/read
- English LTR language direction
- Responsive viewport (desktop, tablet, mobile)
- Unrelated-page regression (payroll/attendance/timesheet pages remain intact)

## Test commands and results

| Suite | Command | Result |
|---|---|---|
| Phase 01 migration runner | `node tests/migration/runner.test.mjs` | **8/8 passed** |
| Phase 01 unit suites | `node tests/unit/*.test.mjs` (9 suites) | **72/72 behaviors passed** |
| Phase 02 identity | `node tests/phase02/identity.test.mjs` | **32/32 passed** |
| Phase 02 authorization | `node tests/phase02/authorization.test.mjs` | **32/32 passed** |
| Phase 02 security-suite | `node tests/phase02/security-suite.test.mjs` | **24/24 passed** |
| Phase 02 settings-policies | `node tests/phase02/settings-policies.test.mjs` | **29/29 passed** |
| Phase 02 workflow-approvals | `node tests/phase02/workflow-approvals.test.mjs` | **31/31 passed** |
| Phase 02 collaboration-files-jobs | `node tests/phase02/collaboration-files-jobs.test.mjs` | **29/29 passed** |
| Phase 02 runtime integration | `node tests/phase02/runtime-integration.test.mjs` | **3/3 passed** |
| Phase 02 browser evidence | `node tests/phase02/browser-evidence.test.mjs` | **3/3 passed** |
| Phase 02 browser live evidence | `node tests/phase02/browser-live-evidence.test.mjs` | **12/12 scenarios passed** |
| Phase 02 runtime strangler | `node tests/phase02/runtime-strangler.test.mjs` | **6/6 passed** |
| Phase 02 runtime adversarial | `node tests/phase02/runtime-adversarial.test.mjs` | **11/11 passed** |
| Phase 02 non-browser aggregate | listed Phase 02 suites above | **200/200 behaviors passed** |
| Precommit | `node scripts/precommit.js` | **passed** |

## Unresolved risks

| Risk | Status |
|---|---|
| Payroll/attendance behavior remains frozen | Accepted — not in scope |
| PostgreSQL compatibility is a declared stub | Unchanged — not tested |
| External durable worker topology (leases, dead-letter, deployment supervision) | Contracts pass; live deployment supervision remains operational |
| SAML and passkeys | Rejected by adapter until approved ADR / threat model |
| `GET /api/auth/options` still public (returns id/login/name/locale) | Accepted; needed for login user-picker UX; no sensitive fields returned |
| Non-SQLite degraded mode loses governed data (fail-closed) | Documented; SQLite is the production store |
| `/uploads/` binaries still served by static handler | Compatibility reader; metadata cutover deferred |

## Closure recommendation

Gate B (identity), C (authorization), D (settings), E (workflows/approvals), F (collaboration/files), G (jobs/integrations), H (UI continuity), I (migration/authority), and J (security/evidence) passed on the final rerun. The Phase 02 closure file records the remaining compatibility-reader risks and explicitly excludes Phase 03.
