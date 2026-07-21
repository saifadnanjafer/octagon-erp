# Phase 02 Runtime Authority Map

Verified against the current Octagon checkout on 2026-07-21. This is a
cutover map, not a closure claim.

| Governance fact | Current live reader/writer | Canonical platform authority | Current result | Required closure evidence |
|---|---|---|---|---|
| identity and sessions | `server.js` login/session routes; `app.js` client identity facade | `platform/identity/users`, `platform/identity/sessions` | Server login/session is live; client facade remains | Remove local credential/user authority and prove refresh/revocation in browser |
| roles, permissions, tenant/company/branch/scope | server permission guards; client `PermissionService`; legacy blob callers | `platform/authorization`, memberships, decision context | Server routes fail closed and derive context from cookie; full caller parity is open | Route inventory with owner/list/detail/export/report/file/job/AI parity and no body/header spoofing |
| full database and governance collections | `app.js` `saveData()` -> `POST /api/db` full blob | repositories and domain services under `platform/` | Duplicate runtime writer remains | Atomic strangler or one-way migration, reconciliation, rollback, and retirement test |
| settings/secrets/custom fields/views | legacy shell state plus `saveData()` | `platform/settings`, secret vault, metadata authorities | Canonical-test only for live governance callers | Live settings UI/API read/write and secret non-disclosure evidence |
| workflows and approvals | legacy `omni.workflow`, approval collections, `saveData()` | `platform/workflow`, `platform/approvals` | Canonical-test only for the current shell | Browser create/submit/approve/reject/delegate/timeout and audit proof |
| chatter, notifications, files | legacy collections, scheduler, `/api/upload`, static `/uploads` consumers | collaboration/notification/file services | Upload and static reads are now permission-gated; legacy domain writers remain | Tenant/company file isolation, field masks, chatter/inbox browser evidence, writer retirement |
| jobs and webhooks | `server-scheduler.js` and legacy webhook routes | `platform/jobs` | Canonical job contracts pass tests; live topology remains mixed | Worker ownership, lease/retry/dead-letter browser/API proof and legacy route retirement |

## Immediate blocker

The remaining `saveData()` call graph is broad and crosses protected/frozen
operational surfaces. Removing it or silently redirecting it would create an
unverified dual-write or risk data loss. Phase 02 therefore remains partial until
those callers are migrated in bounded, independently tested slices.
