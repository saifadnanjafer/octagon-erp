# Phase 02 Source-Composition Ledger

**Authority:** `PHASE_02_IDENTITY_PERMISSIONS_SETTINGS_AND_WORKFLOW.md` § 7
One entry per capability, written before the capability was implemented.

Dispositions used: `PRESERVE`, `MERGE-CANONICAL`, `MERGE-REFACTOR`, `ADAPTER`,
`SPEC-IMPLEMENT`, `PORT-TESTS`, `EXCLUDE`, `DEFER`. **`DIRECT-ADAPT` was never
used** — no donor source file was copied into Octagon (see `donor-license-ledger.md`).

---

## GV-001 — Authentication and session authority

```text
Capability ID:       GV-001
Outcome:             One revocable, expiring, rotation-capable session authority.
Octagon inspected:   server.js (requireSession, isLocalRequest L1452, isLoopbackSocket L1466,
                     isLocalWriteTrusted L1481, allowLocalDev L1502), server-jarvis-security.js
                     (session.mode === 'local-dev' bypass L266), platform/server/acl.js
                     (isLoopback L230, header fallback L243)
VNext inspected:     vnext/server/auth/auth-hardening.js, auth-routes.js
VNext disposition:   MERGE-REFACTOR — rotateSessionsForUser/isSessionRevoked generalized from a
                     per-user watermark to per-session rows; TOTP/base32/HOTP reused in behavior
Primary donor:       ODOO addons/auth_totp, auth_oauth, auth_signup, auth_password_policy
Secondary donor:     NOCOBASE packages/plugins/@nocobase auth plugins (pluggable authenticator)
License/reuse mode:  SPEC-IMPLEMENT (clean-room)
Target paths:        platform/identity/{sessions,passwords,mfa}/index.mjs
Canonical owner:     identity_sessions / identity_credentials / identity_mfa_methods
Legacy owner:        server.js in-memory session map + octagon_session cookie
Cutover strategy:    Additive. The legacy shell keeps its own session until Phase 07 wires the
                     bootstrap; the canonical authority has NO loopback branch at all.
Tests to port:       VNext auth regression intent (lockout, TOTP verify)
New tests:           17 in tests/phase02/identity.test.mjs (02.02, 02.03)
Known conflicts:     Octagon's OCTAGON_TRUST_LOCALHOST is a production-reachable bypass.
Decision:            PRESERVE the working cookie-session model and Arabic denial text;
                     EXCLUDE every loopback/env trust branch. Recorded as an open legacy risk.
```

## GV-003 – GV-007 — Permission registry, evaluator, scopes, fields, routes

```text
Capability ID:       GV-003, GV-004, GV-005, GV-006, GV-007
Outcome:             One permission vocabulary and one server decision engine.
Octagon inspected:   services/permissionService.js (GROUPS, ROLE_GROUPS, MODEL_PERMISSIONS,
                     ACTION_PERMISSIONS), acl.json (v1, 2026-07-12), platform/server/acl.js
VNext inspected:     vnext/server/acl/acl-engine.js, acl/worklist-counts.js
VNext disposition:   MERGE-CANONICAL — permMatches(), SCOPE_RANK, rowScopeAllows(), maskFields(),
                     maskValue(), checkForbiddenWrites(), atomic grant replacement all preserved
                     in behavior; extended with DENY effect, document states, decision evidence.
Primary donor:       NOCOBASE packages/core/acl/src/acl.ts
Secondary donor:     ODOO odoo/addons/base/models/{ir_rule,res_groups,ir_model}.py (record rules);
                     RUOYI yudao-module-system data-scope + RUOYI_UI src/directives/permission
                     (distinct behavior: menu/button tokens are the SAME tokens the server enforces)
License/reuse mode:  SPEC-IMPLEMENT (NocoBase AGPL, Odoo LGPL -> clean-room; RuoYi MIT -> still rewritten)
Target paths:        platform/authorization/{registry,evaluator,roles,route-coverage}/index.mjs
Canonical owner:     authorization_permissions / _roles / _grants / _role_assignments /
                     _field_rules / _record_scopes / _route_coverage / _decisions
Legacy owner:        platform_acl_roles + platform_acl_grants (Phase 01), acl.json, permissionService.js
Cutover strategy:    Migration 007 mirrors the legacy tables ONCE, then they get no writer.
                     platform/governance/permissions is rewritten as a delegating shim.
Tests to port:       VNext scripts/permission-regression.mjs intent
New tests:           32 in tests/phase02/authorization.test.mjs
Known conflicts:     Legacy Octagon group implication (system.admin implies workshop.manager) has no
                     direct equivalent; mapped via LEGACY_GROUP_TO_ROLE / LEGACY_ROLE_ALIASES.
Decision:            VNext deny-by-default ACL is the project-owned base; completed per § 19.
```

## GV-008 / GV-009 / GV-010 — Tenants, companies, branches, memberships, operating scopes

```text
Capability ID:       GV-008, GV-009, GV-010
Outcome:             Membership is the scope authority; a request can never assert a company.
Octagon inspected:   modules/multi-entity.js, services/tenantService.js, Phase 01 migration 005
VNext inspected:     R1 organization/fiscal migrations
VNext disposition:   MERGE-CANONICAL
Primary donor:       RUOYI yudao-framework tenant package (MIT reference, behavior only)
License/reuse mode:  SPEC-IMPLEMENT
Target paths:        platform/organizations/memberships/index.mjs, platform/identity/context/index.mjs
Canonical owner:     organization_memberships (+ _departments, _operating_scopes, _scope_assignments)
Legacy owner:        platform_users.company_id (Phase 01)
Cutover strategy:    platform_users becomes a derived VIEW; the table is dropped in migration 006.
New tests:           8 (02.01) plus § 58.2 / § 58.4 adversarial cases
Decision:            One membership graph; resolveActiveScope() is the only way to pick a company.
```

## PK-011 — Settings registry and scope inheritance

```text
Capability ID:       PK-011
Outcome:             One typed settings authority with explicit inheritance.
Octagon inspected:   settings routes in server.js, modules/admin-panel.js, modules/multi-entity.js
VNext inspected:     R1 organization/fiscal settings work, R5 configurable features, R8 entitlement state
VNext disposition:   MERGE-CANONICAL
Primary donor:       NOCOBASE settings plugins (definition/value separation)
Secondary donor:     FRAPPE System Settings — SPEC-IMPLEMENT ONLY, FRAPPE_ROOT IS ABSENT;
                     RUOYI system config + dictionary (MIT reference)
License/reuse mode:  SPEC-IMPLEMENT
Target paths:        platform/settings/index.mjs (re-exports the Phase 01 registry unchanged)
Canonical owner:     platform_settings (definitions, Phase 01) + settings_values + settings_history
Legacy owner:        JSON settings blobs in database.json / localStorage
Cutover strategy:    legacyReader() adapter declares owner, write authority, and expiry P02-D2.
New tests:           6 (02.13)
Decision:            EXTEND Phase 01 in place. No second settings authority exists.
```

## GV-012 / GV-017 / GV-018 — Delegation, policy engine, segregation of duties

```text
Capability ID:       GV-012, GV-017, GV-018
Outcome:             Central declarative policy with authority limits, delegation, and SoD.
Octagon inspected:   ACTION_PERMISSIONS thresholds in services/permissionService.js
VNext inspected:     vnext/server/modules/governance/policy-engine.js, vnext/server/approvals/approvals.js
VNext disposition:   MERGE-REFACTOR — requiresEscalation()'s "limit > 0 && amount > limit",
                     coverageReport(), assertCovered()'s fail-closed stance, and the maker-not-checker
                     rule from getApprovedApproval() are all preserved; generalized from a fixed
                     SENSITIVE_TRANSITIONS array to a versioned policy table.
Primary donor:       RUOYI yudao-module-bpm delegation; ERPNEXT/ODOO finance role separation (clean-room)
License/reuse mode:  SPEC-IMPLEMENT
Target paths:        platform/policies/index.mjs
Canonical owner:     policy_definitions/_versions/_authority_limits/_delegations/_sod_rules/_overrides
New tests:           9 (02.12, 02.22)
Decision:            Engine plus governance policies now; finance/stock rules activate in Phase 03/04.
```

## GV-015 / GV-016 — Workflow definitions, durable runtime, automation

```text
Capability ID:       GV-015, GV-016
Outcome:             Versioned definitions with a persisted, resumable, idempotent runtime.
Octagon inspected:   platform/server/workflow.js, modules/automation-engine.js,
                     platform/client/workflow-builder.js (canvas save shape)
VNext inspected:     vnext/server/workflow/workflow-engine.js,
                     vnext/server/modules/governance/workflow-templates.js
VNext disposition:   MERGE-REFACTOR. PRESERVED: NODE_TYPES whitelist, current_node_index resume
                     cursor, 60/min rate limit, depth-10 loop guard, {{path}} interpolation,
                     compare() operators, and isFrozen() — the employee/timesheet/attendance/
                     payroll write refusal. REPLACED with justification: runs stored as JSON in
                     x_records (not recoverable by query after a crash), no leases, no timers,
                     no compensation boundary.
Primary donor:       NOCOBASE packages/plugins/@nocobase/plugin-workflow Processor.ts,
                     Dispatcher.ts, RunningExecutionRegistry.ts, ExecutionTimeoutManager.ts
Secondary donor:     ODOO addons/base_automation/models/base_automation.py — distinct behavior:
                     BOUNDARY CROSSING (fire on transition into a condition, not on every save)
License/reuse mode:  SPEC-IMPLEMENT
Target paths:        platform/workflow/index.mjs, platform/automation/index.mjs
Canonical owner:     workflow_definitions/_versions/_instances/_steps/_timers, automation_rules/_runs
Legacy owner:        platform/server/workflow.js (x_records-based runs)
Cutover strategy:    fromCanvas()/toCanvas() adapters keep the existing Octagon canvas working.
New tests:           17 (02.17, 02.18, 02.21) plus § 58.7
Known conflicts:     The VNext webhook node performed a live outbound call inside the run.
                     EXCLUDED — external effects now leave through the outbox after commit.
Decision:            Salvage VNext; add durability from the verified NocoBase behavior.
```

## GV-013 / GV-014 — Approval policy engine, decisions, worklists

```text
Capability ID:       GV-013, GV-014
Outcome:             One approval engine and one permission-aware worklist.
Octagon inspected:   platform/server/approvals.js, existing approval pages/queues
VNext inspected:     vnext/server/approvals/approvals.js, vnext/server/acl/worklist-counts.js
VNext disposition:   MERGE-CANONICAL. PRESERVED: the nine boxes (my/todo/done/cc/delegated/
                     escalated/withdrawn/rejected/returned), payload_hash binding,
                     canonicalize()/payloadHash(), step_entered_at plus escalation columns,
                     maker-not-checker, authority-limit chain escalation.
                     REPLACED: hasColumn() runtime schema probing -> declared columns;
                     payload._policy chain cursor -> first-class columns plus a unique decision index.
Primary donor:       RUOYI yudao-module-bpm (process/task/definition/listener) and
                     RUOYI_UI src/views/bpm (task-centre interaction patterns)
Secondary donor:     NOCOBASE approval workflows (concurrency-safe decision recording)
License/reuse mode:  SPEC-IMPLEMENT
Target paths:        platform/approvals/index.mjs
Canonical owner:     approval_policies/_requests/_decisions, worklist_items
New tests:           10 (02.19, 02.20) plus § 58.6
Decision:            Salvage VNext wholesale in behavior; make concurrency structural.
```

## OP-022 — Business calendars and SLA clock

```text
Capability ID:       OP-022
Outcome:             One shared business-time service.
VNext inspected:     migration 620 business clocks and tests
VNext disposition:   MERGE-CANONICAL
Primary donor:       ODOO working-calendar / resource.calendar semantics (clean-room)
Secondary donor:     ERPNEXT SLA examples (supporting specification only)
License/reuse mode:  SPEC-IMPLEMENT
Target paths:        platform/sla/index.mjs
Canonical owner:     business_calendars/_shifts/_holidays, sla_clocks
New tests:           4 (02.23)
Decision:            Snapshot the calendar at clock start so a later edit cannot move a due date.
```

## PK-015 / PK-016 / PK-017 — History, snapshots, chatter, activities, notifications

```text
Capability ID:       PK-015, PK-016, PK-017
Outcome:             Business history distinct from security audit; one collaboration service.
Octagon inspected:   services/auditService.js, platform/server/{audit,chatter,notify}.js,
                     modules/{documents,knowledge,esign}.js
VNext inspected:     vnext/server/audit/audit.js, chatter/chatter.js, notify/notify.js,
                     fields/snapshot-fields.js, vnext/client/{chatter,inbox}.js, migration 624
VNext disposition:   MERGE-CANONICAL (append-only history, thread-per-record, inbox contract);
                     MERGE-REFACTOR for permission inheritance, which is now evaluator-driven.
Primary donor:       ODOO addons/mail/models/{mail_thread,mail_activity,mail_followers}.py
Secondary donor:     AUREUS plugins/webkul/chatter/src/Traits/HasChatter.php (MIT reference);
                     NOCOBASE history/snapshot plugins (clean-room)
License/reuse mode:  SPEC-IMPLEMENT
Target paths:        platform/collaboration/index.mjs, platform/notifications/index.mjs
Canonical owner:     record_history/_snapshots/_lineage, chatter_threads/_messages/_followers,
                     activities, notifications/_templates/_preferences/_deliveries
New tests:           13 (02.24, 02.25, 02.26)
Decision:            Preserve VNext append-only audit; add masking parity across every surface.
```

## PK-025 / PK-026 / GV-019 — Files, import/export/print, jobs, webhooks, integrations

```text
Capability ID:       PK-025, PK-026, GV-019, TR-012/013/017 (security portions)
Outcome:             Private-by-default files; durable jobs; signed, replay-protected webhooks.
Octagon inspected:   server-scheduler.js, webhook/WhatsApp routes in server.js,
                     server-jarvis-security.js (AI key proxy), modules/documents.js
VNext inspected:     vnext/server/modules/r3-infra.js, governance/integration-engine.js,
                     governance/integration-routes.js, print/print-templates.js,
                     vnext/client/excel.js, migrations 804/805/629
VNext disposition:   MERGE-REFACTOR (lease/idempotency/retry, encrypted credentials, webhook signing)
Primary donor:       ODOO odoo/addons/base/models/ir_cron.py (cron creates jobs, never mutates)
Secondary donor:     RUOYI Quartz/idempotency/rate-limit/signature/file-storage starters;
                     NOCOBASE file plugin; AUREUS webkul Excel/PDF export (all MIT/clean-room refs)
License/reuse mode:  SPEC-IMPLEMENT
Target paths:        platform/files/index.mjs, platform/jobs/index.mjs,
                     platform/data-exchange/index.mjs
Canonical owner:     file_objects/_attachments/_shares/_access_log, job_runs,
                     webhook_subscriptions/_deliveries/_inbound_seen, import_jobs/_rows, export_jobs
Legacy owner:        platform_jobs (Phase 01) remains the DEFINITION registry — extended, not replaced
New tests:           16 (02.27, 02.28, 02.29) plus § 58.8 / § 58.12 / § 58.13
Decision:            Preserve Octagon's scheduler philosophy; make delivery durable and signed.
```

## PK-012 / PK-013 / GV-011 — Feature state, configuration packages, licensing hooks

```text
Capability ID:       PK-012, PK-013, GV-011
Outcome:             Foundation only (§ 4.2). Commercial packaging remains Phase 08.
VNext inspected:     R8 feature/entitlement work, governance/licensing-engine.js
VNext disposition:   DEFER for commercial licensing; MERGE-CANONICAL for config packages
Primary donor:       NOCOBASE configuration export; FRAPPE fixtures (SPEC-IMPLEMENT, root absent)
Target paths:        platform/configuration/index.mjs
New tests:           3 (02.16)
Decision:            Package configuration only. Ledgers/audit/secrets/sessions are refused at build.
```

## GV-020 — Security administration and evidence

```text
Capability ID:       GV-020
Outcome:             Minimum operational visibility to run the governance platform safely.
Octagon inspected:   existing admin/log pages
VNext inspected:     vnext/server/modules/governance/security-audit.js, support-engine.js
VNext disposition:   MERGE-REFACTOR (one read-only report per surface; support-bundle redaction)
Primary donor:       RUOYI yudao-module-system login-log / operate-log (MIT reference)
License/reuse mode:  SPEC-IMPLEMENT
Target paths:        platform/security-evidence/index.mjs
Canonical owner:     reads only; owns no table of its own
New tests:           1 aggregate test covering all 14 views (§ 55)
Decision:            Read-only, scoped, permission-gated, redacted. Dashboard polish is Phase 08.
```

## EXCLUDED and DEFERRED

| Item | Disposition | Reason |
|---|---|---|
| WebAuthn / passkeys | **DEFER** | § 28 stop condition: no local source, no threat model. `beginLogin` has no passkey path. |
| SAML | **DEFER** | § 66 requires an approved ADR. `identity_sso_providers` accepts kind `saml`; `beginLogin`/`completeLogin` throw `SAML_NOT_IMPLEMENTED`. |
| VNext live webhook node inside a workflow run | **EXCLUDE** | Violates "no external effect before commit" (§ 68). Replaced by outbox delivery. |
| VNext `hasColumn()` runtime schema probing | **EXCLUDE** | Schema is migration-declared; runtime probing hides drift. |
| Commercial licensing enforcement | **DEFER** | Phase 08. |
| Frappe-sourced detail | **SPEC-IMPLEMENT only** | `FRAPPE_ROOT` absent — see `source-lock.md` stop list. |
