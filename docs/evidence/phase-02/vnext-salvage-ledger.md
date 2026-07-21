# Phase 02 VNext Salvage Ledger

**Rule (§ 3.6):** reuse or refactor valid VNext code before writing a replacement.
VNext is project-owned source. It is **never** a deployed target (§ 68).

| # | VNext path | Disposition | Preserved behavior | Target |
|---|---|---|---|---|
| 1 | `vnext/server/acl/acl-engine.js` | MERGE-CANONICAL | `permMatches()` colon-wildcard matcher; `SCOPE_RANK` {all,dept,own}; `rowScopeAllows()`; `maskFields()` + `maskValue()` two-and-two masking; `checkForbiddenWrites()` reject-don't-drop; atomic replace-all-grants inside `BEGIN IMMEDIATE`; 401-vs-403 separation; Arabic denial text; **the "no localhost/loopback bypass" rule adopted verbatim as policy** | `platform/authorization/{registry,evaluator,roles,route-coverage}` |
| 2 | `vnext/server/acl/worklist-counts.js` | MERGE-CANONICAL | scoped count aggregation | `platform/approvals` `counts()` |
| 3 | `vnext/server/auth/auth-hardening.js` | MERGE-REFACTOR | `base32Decode/Encode`, `generateHOTP`, `verifyTotp`, `createTotpEnrollment`, `confirmTotpEnrollment`, `buildOtpAuthUri`; `DEFAULT_PASSWORD_POLICY` + `checkPasswordPolicy` character-class logic + Arabic messages; `clampInt`/`boolInt`; `hashApiKey`; one-time raw-key display; `rotateSessionsForUser`/`isSessionRevoked` | `platform/identity/{passwords,mfa,sessions,service-identities}` |
| 4 | `vnext/server/auth/auth-routes.js` | PRESERVE (reference) | route shape only; the canonical path exposes no HTTP itself | — |
| 5 | `vnext/server/modules/governance/sso-engine.js` | MERGE-REFACTOR | provider record shape, tenant binding, email-domain matching, JIT switch | `platform/identity/sso` |
| 6 | `vnext/server/modules/governance/sso-routes.js` | PRESERVE (reference) | callback contract | — |
| 7 | `vnext/server/workflow/workflow-engine.js` | MERGE-REFACTOR | `NODE_TYPES` whitelist; `current_node_index` resume cursor; 60-runs/min rate limit; depth-10 loop guard; `getPath`/`interpolate`/`interpolateDeep`; `compare()` operators; **`isFrozen()` / `FROZEN_ENTITY_PARTS` payroll-zone refusal** | `platform/workflow`, `platform/automation` |
| 8 | `vnext/server/approvals/approvals.js` | MERGE-CANONICAL | the nine boxes; `canonicalize()`/`payloadHash()`; `payload_hash` binding; `step_entered_at`/`escalated`/`escalated_from_role`; maker-not-checker from `getApprovedApproval()`; authority-limit chain append | `platform/approvals` |
| 9 | `vnext/server/modules/governance/policy-engine.js` | MERGE-REFACTOR | `requiresEscalation()` limit rule; `coverageReport()`; `assertCovered()` fail-closed stance | `platform/policies` |
| 10 | `vnext/server/modules/governance/workflow-templates.js` | PRESERVE (reference) | template catalogue shape | `platform/workflow` `fromCanvas()` |
| 11 | `vnext/server/audit/audit.js` | MERGE-CANONICAL | append-only history rows | `platform/collaboration` `HistoryService` |
| 12 | `vnext/server/fields/snapshot-fields.js` | MERGE-CANONICAL | snapshot-the-relations (name/address/tax/price must not drift after posting) | `record_snapshots.relations` |
| 13 | `vnext/server/chatter/chatter.js` + `vnext/client/chatter.js` | MERGE-REFACTOR | thread-per-record, mentions, internal visibility | `platform/collaboration` `ChatterService` |
| 14 | `vnext/server/notify/notify.js` + `vnext/client/inbox.js` | MERGE-CANONICAL | in-app rows, read state, inbox contract | `platform/notifications` |
| 15 | `vnext/server/fields/custom-fields.js` | MERGE-CANONICAL | **metadata-declared fields stored in the record JSON — no runtime DDL** | `platform/configuration` |
| 16 | `vnext/server/modules/r3-infra.js` | MERGE-REFACTOR | lease / idempotency / retry patterns; company-scope derivation | `platform/jobs`, `platform/identity/context` |
| 17 | `vnext/server/modules/governance/integration-engine.js` + `integration-routes.js` | MERGE-REFACTOR | credential-by-reference; webhook signing | `platform/jobs` `WebhookService`, `platform/settings/secrets` |
| 18 | `vnext/server/print/print-templates.js` | MERGE-CANONICAL | template registration, RTL output | `platform/data-exchange` |
| 19 | `vnext/client/excel.js` | MERGE-CANONICAL | export column shaping | `platform/data-exchange` `toCsv()` |
| 20 | `vnext/server/modules/governance/security-audit.js` + `support-engine.js` | MERGE-REFACTOR | one read-only report per surface; support-bundle redaction | `platform/security-evidence` |
| 21 | `vnext/server/modules/governance/licensing-engine.js` | **DEFER** | commercial licensing is Phase 08 | — |
| 22 | `vnext/server/modules/governance/collaboration.js` | PRESERVE (reference) | superseded by rows 13/14 | — |
| 23 | `vnext/server/modules/governance/consolidation-engine.js` | **EXCLUDE** | finance scope — Phase 03 | — |
| 24 | `governance/ai-tool-registry.js`, `ai-vnext-tools.js` | **DEFER** | AI tool permission registration is hooked (`kind: 'ai_tool'`); the catalogue is later scope | `authorization_permissions` kind only |
| 25 | R1 organization/fiscal migrations | MERGE-CANONICAL | tenant/company/branch/fiscal vocabulary | migration 006 |
| 26 | migration 620 (business clocks) | MERGE-CANONICAL | calendar/shift/holiday model | migration 009, `platform/sla` |
| 27 | migrations 622/623 (approval/workflow) | MERGE-CANONICAL | chain and instance columns | migration 009 |
| 28 | migration 624 (collaboration indexes) | MERGE-CANONICAL | thread/message indexes | migration 010 |
| 29 | migrations 804/805 (integration/API key) | MERGE-REFACTOR | key hashing, credential storage | migrations 006, 010 |
| 30 | migration 629 (print/public forms) | MERGE-CANONICAL | template + public submission model | migration 010 |
| 31 | `scripts/permission-regression.mjs` | PORT-TESTS (intent) | deny-by-default regression intent re-expressed as 32 native tests | `tests/phase02/authorization.test.mjs` |
| 32 | `scripts/test-r4-approval-policies.mjs` | PORT-TESTS (intent) | chain/quorum/escalation intent | `tests/phase02/workflow-approvals.test.mjs` |
| 33 | `scripts/test-r4-workflow-templates.mjs` | PORT-TESTS (intent) | template validation intent | same |
| 34 | `scripts/test-r8-sso.mjs` | PORT-TESTS (intent) | state/nonce/JIT intent | `tests/phase02/identity.test.mjs` |
| 35 | `scripts/test-r4-security-audit.mjs` | PORT-TESTS (intent) | evidence-completeness intent | `tests/phase02/security-suite.test.mjs` |

## Explicitly rejected VNext behavior

| Behavior | Where | Why rejected |
|---|---|---|
| Live outbound `fetch` inside a workflow `webhook` node | `workflow-engine.js` `executeNode` | A rolled-back workflow would already have called the outside world. § 68 forbids it. Replaced by outbox-queued delivery after commit. |
| `hasColumn()` runtime `PRAGMA table_info` probing | `approvals.js` | Hides schema drift and makes behavior depend on migration order. Columns are now declared by migration 009. |
| `payload._policy` chain cursor inside the JSON payload | `approvals.js` | A JSON cursor cannot carry a unique index, so a duplicate decision was structurally possible. Now first-class columns plus `ux_decision_once`. |
| Workflow runs stored as `x_records` JSON | `workflow-engine.js` | A crashed worker could not be located by query. Now `workflow_instances` with leases and a cursor. |
| `cachedDb` module-level singleton | `acl-engine.js` | Ambient state; the evaluator takes its dialect explicitly. |
| `x-user` / `x-roles` header fallback | `approvals.js` `userContext()` | Header-asserted identity. The canonical path derives everything from a verified session or API key. |

**No VNext file was copied into Octagon.** Every row above is a behavior
reimplementation in the Octagon module layout, verified by the listed tests.
