# Phase 01 Provenance Register

**Phase:** 01  
**Date:** 2026-07-21  

---

## Provenance model

Every migrated or transformed record in Phase 01 must be traceable to:

- source system/path
- source record/key
- migration/action run
- actor or system identity
- target record
- transformation version
- reconciliation result

---

## Migration provenance

| Migration | Source system/path | Source record/key | Target table | Actor | Transformation version | Reconciliation |
|---|---|---|---|---|---|---|
| `001_platform_kernel_bootstrap` | VNext `migrations/001_r0_scope_contract.mjs` | R0 scope contract | `platform_modules`, `platform_entities`, `platform_actions`, `platform_views`, `platform_events`, `platform_settings`, `platform_sequences`, `platform_audit_log`, `platform_outbox` | system | `1.0.0` | `schema_migrations` row records checksum and source provenance. |
| `002_platform_kernel_entities_and_storage` | VNext `migrations/101_r1_lane_a_tables.mjs` + Octagon `platform/server/entities.json` | R1 tables + legacy entity descriptors | `x_records`, `x_audit`, `x_sequences`, `x_chatter`, `x_followers`, `x_views`, `x_custom_fields`, `x_notifications`, `x_approvals`, `platform_entities` seed | system | `1.0.0` | `schema_migrations` row records checksum and source provenance. |
| `003_platform_kernel_actions_and_lifecycle` | VNext `vnext/server/state/doc-state.js` + `r3-infra.js` | State machine + idempotency patterns | `x_doc_state_defs`, `x_doc_states`, `x_doc_state_history`, `action_idempotency`, `platform_actions` seed | system | `1.0.0` | `schema_migrations` row records checksum and source provenance. |
| `004_platform_kernel_views` | VNext `vnext/client/r3-ui.js` + `views-fields.js` | View descriptor patterns | `platform_view_versions`, `platform_views` seed | system | `1.0.0` | `schema_migrations` row records checksum and source provenance. |
| `005_platform_kernel_control_plane` | VNext R1 organization + R8 supportability | Organization/fiscal tables + ACL schema | `platform_tenants`, `platform_companies`, `platform_branches`, `platform_users`, `platform_feature_flags`, `platform_jobs`, `platform_health_contributors`, `platform_acl_roles`, `platform_acl_grants` | system | `1.0.0` | `schema_migrations` row records checksum and source provenance. |

---

## Runtime provenance

| Operation | Source channel | Actor | Correlation ID | Target record | Audit row | Outbox row |
|---|---|---|---|---|---|---|
| Action execution | `api` or `action` | `userId` from header | generated or header | `x_records` + `x_doc_states` | `platform_audit_log` (`action.execute.{actionId}`) | `platform_outbox` (`action.execute`) |
| Entity registration | `registry` | `system` | — | `platform_entities` | `platform_audit_log` (`entity.register`) | — |
| Module lifecycle | `registry` | `system` or actor | — | `platform_modules` | `platform_audit_log` (`module.install/disable/uninstall`) | — |
| View registration | `registry` | actor | — | `platform_views` + `platform_view_versions` | `platform_audit_log` (`view.register`) | — |
| Feature flag change | `registry` | actor | — | `platform_feature_flags` | `platform_audit_log` (`feature_flag.set`) | — |

---

## Legacy adapter provenance

| Legacy source | Adapter | Target shape | Read/Write | Notes |
|---|---|---|---|---|
| `database.json` collections | `platform/data/repositories/legacy-adapter.mjs` | `x_records` document shape | read-only | `_legacy: true` marker; no writes allowed. |
| `platform/server/entities.json` | `platform/kernel/entities/default-entities.json` + migration 002 | `platform_entities` rows | read-only seed | Original descriptors normalized into registry schema. |

---

## Next review

This register must be updated for every data migration, adapter change, and cutover in subsequent phases.
