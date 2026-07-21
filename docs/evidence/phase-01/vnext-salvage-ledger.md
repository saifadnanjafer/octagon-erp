# Phase 01 VNext Salvage Ledger

**Phase:** 01  
**Date:** 2026-07-21  
**VNext root:** `octagon-erp-commercial-vnext`  
**VNext commit:** `72d2c6b4f568650203795d463c25a12ff06ad55a`  

---

## Disposition legend

- `direct merge` — project-owned VNext code reused with minimal adaptation.
- `refactor` — VNext code reused as a behavioral reference but restructured for Octagon target architecture.
- `adapter` — VNext pattern adapted into an Octagon compatibility layer.
- `test-only` — VNext tests inspected or copied as evidence/behavioral reference.
- `archive evidence` — VNext asset not reused but recorded here for provenance.

---

| VNext source | Target owner | Disposition | Runtime dependencies | Data tables | Routes/Actions | Events/Audit/Outbox | Tests | Retirement condition |
|---|---|---|---|---|---|---|---|---|
| `vnext/server/db/migration-runner.mjs` | `database/migration-runner/index.mjs` | refactor | dialect abstraction | `schema_migrations` | — | audit on migration | `tests/migration/runner.test.mjs` | VNext runner no longer invoked directly; Octagon runner is canonical. |
| `migrations/001_r0_scope_contract.mjs` | `database/migrations/001_platform_kernel_bootstrap.mjs` | refactor | platform kernel | `platform_modules`, `platform_entities`, `platform_actions`, `platform_views`, `platform_events`, `platform_settings`, `platform_sequences`, `platform_audit_log`, `platform_outbox` | — | — | migration runner tests | VNext R0 migration no longer applied to target. |
| `migrations/101_r1_lane_a_tables.mjs` | `database/migrations/002_platform_kernel_entities_and_storage.mjs` | refactor | platform kernel | `x_records`, `x_audit`, `x_sequences`, `x_chatter`, `x_followers`, `x_views`, `x_custom_fields`, `x_notifications`, `x_approvals` | — | audit on entity changes | `tests/unit/entities.test.mjs`, `tests/unit/repositories.test.mjs` | VNext R1 migration no longer applied to target. |
| `vnext/server/state/doc-state.js` | `platform/governance/document-state/index.mjs`, `platform/kernel/actions/index.mjs` | refactor | platform kernel | `x_doc_state_defs`, `x_doc_states`, `x_doc_state_history`, `action_idempotency` | lifecycle actions | audit + outbox | `tests/unit/actions.test.mjs` | VNext doc-state engine no longer invoked. |
| `vnext/server/crud/crud-engine.js` | `platform/data/repositories/index.mjs`, `platform/api/index.mjs` | refactor | platform kernel | `x_records`, `x_audit` | `/api/v1/x/:entity` | audit on CRUD | `tests/unit/repositories.test.mjs`, `tests/unit/api.test.mjs` | VNext CRUD engine no longer invoked. |
| `vnext/server/compat/LegacyEntityAdapter.mjs` | `platform/data/repositories/legacy-adapter.mjs` | adapter | legacy `database.json` files | — | read-only legacy queries | — | `tests/unit/repositories.test.mjs` | Retired when all legacy collections are migrated to canonical tables. |
| `vnext/server/sequences/sequences.js` | `platform/records/sequences/index.mjs` | refactor | platform kernel | `platform_sequences` | — | — | `tests/unit/sequences.test.mjs` | VNext sequence engine no longer invoked. |
| `vnext/server/events/events.js` | `platform/events/index.mjs` | refactor | platform kernel | `platform_events` | — | — | `tests/unit/events.test.mjs` | VNext event registry no longer invoked. |
| `vnext/server/events/outbox.js` | `platform/outbox/index.mjs` | refactor | platform kernel | `platform_outbox` | — | delivery tracking | `tests/unit/events.test.mjs` | VNext outbox no longer invoked. |
| `vnext/server/modules/module-framework.js` | `platform/kernel/modules/index.mjs` | refactor | platform kernel | `platform_modules` | — | audit on lifecycle | `tests/unit/modules.test.mjs` | VNext module framework no longer invoked. |
| `vnext/server/modules/packs/pack-sdk-engine.js` | `platform/kernel/modules/index.mjs` (extension points) | archive evidence | — | — | — | — | — | Pack SDK vertical expansion deferred to Phase 06/08. |
| `vnext/server/modules/r3-infra.js` | `platform/kernel/actions/index.mjs`, `platform/outbox/index.mjs`, `platform/kernel/jobs/index.mjs` | refactor | platform kernel | `action_idempotency`, `platform_outbox`, `platform_jobs` | action execution | audit + outbox | multiple | VNext r3-infra no longer invoked. |
| `vnext/server/modules/r3-routes.js`, `module-routes.js` | `platform/api/index.mjs` | refactor | platform kernel | — | `/api/v1/*` | — | `tests/unit/api.test.mjs` | VNext route mounts no longer used. |
| `vnext/server/acl/acl-engine.js` | `platform/governance/permissions/index.mjs` | refactor | platform kernel | `platform_acl_roles`, `platform_acl_grants` | permission checks | — | `tests/unit/control-plane.test.mjs` | VNext ACL engine no longer invoked. |
| `vnext/client/r3-ui.js`, `views-fields.js` | `platform/kernel/views/index.mjs` | refactor | platform kernel | `platform_views`, `platform_view_versions` | — | audit on registration | `tests/unit/views.test.mjs` | VNext UI descriptors no longer used directly. |
| R1 organization migrations (`401_*`) | `database/migrations/005_platform_kernel_control_plane.mjs`, `platform/identity/context/index.mjs` | refactor | platform kernel | `platform_tenants`, `platform_companies`, `platform_branches`, `platform_users` | — | — | `tests/unit/control-plane.test.mjs` | VNext R1 organization migrations no longer applied to target. |
| R8 licensing migrations (`802_*`) | `platform/governance/feature-flags/index.mjs`, `platform/kernel/settings/index.mjs` | archive evidence | — | — | — | — | — | Full licensing engine deferred to Phase 08. |
| R8 supportability migrations (`805_*`) | `platform/kernel/health/index.mjs` | archive evidence | — | — | — | — | `tests/unit/control-plane.test.mjs` | Full support bundle export deferred to Phase 08. |

---

## License / provenance

All VNext sources listed above are project-owned and may be reused freely. No third-party restricted code was copied from VNext. Donor references are recorded in the individual wave evidence files and in `deferred-items.md`.

---

## Next review

This ledger must be updated at the start of every subsequent phase when new VNext assets are salvaged or existing dispositions change.
