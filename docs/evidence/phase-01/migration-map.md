# Phase 01 Migration Map

**Phase:** 01  
**Date:** 2026-07-21  
**Dialect:** SQLite (node:sqlite DatabaseSync) with PostgreSQL-target abstraction planned.  

---

## Migration list

| ID | Owner | Depends on | Dialects | Transaction policy | Rollback policy | Tables created | Seeded data | Source provenance |
|---|---|---|---|---|---|---|---|---|
| `001_platform_kernel_bootstrap` | platform.kernel | — | sqlite | required | reversible | `platform_modules`, `platform_entities`, `platform_actions`, `platform_views`, `platform_events`, `platform_settings`, `platform_sequences`, `platform_audit_log`, `platform_outbox` | `platform_kernel` module enabled | VNext `001_r0_scope_contract.mjs` mapped to target architecture |
| `002_platform_kernel_entities_and_storage` | platform.kernel | `001` | sqlite | required | reversible | `x_records`, `x_audit`, `x_sequences`, `x_chatter`, `x_followers`, `x_views`, `x_custom_fields`, `x_notifications`, `x_approvals` | `platform_kernel` module + default entities from `default-entities.json` | VNext `101_r1_lane_a_tables.mjs` + Octagon legacy `entities.json` |
| `003_platform_kernel_actions_and_lifecycle` | platform.kernel | `002` | sqlite | required | reversible | `x_doc_state_defs`, `x_doc_states`, `x_doc_state_history`, `action_idempotency` | `crm_lead` lifecycle + actions (create, submit, approve, cancel, reverse_approval, amend) | VNext `doc-state.js` + `r3-infra.js` |
| `004_platform_kernel_views` | platform.kernel | `003` | sqlite | required | reversible | `platform_view_versions` | `kernel_reference_page` view | VNext `r3-ui.js` + `views-fields.js` |
| `005_platform_kernel_control_plane` | platform.kernel | `004` | sqlite | required | reversible | `platform_tenants`, `platform_companies`, `platform_branches`, `platform_users`, `platform_feature_flags`, `platform_jobs`, `platform_health_contributors`, `platform_acl_roles`, `platform_acl_grants` | default tenant, company, branch, system user; `admin` role with `*` grant | VNext R1/R8 organization + RuoYi tenant reference |

---

## Upgrade path

1. Fresh install applies `001` → `002` → `003` → `004` → `005` in dependency order.
2. The migration runner verifies dependencies, checksums, and locks before applying any pending migration.
3. Each migration is applied inside a single transaction.
4. Failed migrations roll back and record a failure state; no partial schema is left.

---

## Rollback path

- Each migration exports a `down(dialect)` function that drops the tables it owns and deletes its seed rows.
- Down migrations are applied in reverse dependency order when the runner is invoked with `direction: 'down'`.
- Rollback is tested on disposable databases only; production rollback requires a documented cutover plan.

---

## PostgreSQL notes

- All migrations use ANSI SQL where possible.
- SQLite-specific features used in Phase 01: `STRICT` tables (SQLite 3.37+), `ON CONFLICT`, `VACUUM INTO` for backups.
- PostgreSQL dialect adapter will map `STRICT` to standard column types and `VACUUM INTO` to `pg_dump` or filesystem copy.
- No runtime DDL is performed outside the migration runner.

---

## Next review

This map must be updated for every new migration added in subsequent phases.
