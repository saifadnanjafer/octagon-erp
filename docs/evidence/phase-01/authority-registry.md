# Phase 01 Authority Registry

**Phase:** 01  
**Date:** 2026-07-21  

---

## Registry conventions

- **Current write authority** — the code path that currently writes the data in production-like Octagon.
- **Current read authority** — the code path that currently reads the data.
- **Target authority** — the canonical owner after Phase 01.
- **Adapter path** — how the current authority is bridged during transition.
- **Cutover gate** — the condition that must be met before the target authority becomes the sole writer.
- **Retirement condition** — when the old authority/adapter can be removed.

---

## Platform kernel tables (Phase 01 canonical authority)

| Capability / Table | Current write authority | Current read authority | Target authority | Adapter path | Cutover gate | Retirement condition |
|---|---|---|---|---|---|---|
| `platform_modules` | new Octagon registry | new Octagon registry | `platform/kernel/modules/index.mjs` | none | P01.2 tests pass | VNext `module-framework.js` no longer invoked. |
| `platform_entities` | new Octagon registry | new Octagon registry | `platform/kernel/entities/index.mjs` | `legacy-adapter.mjs` for old JSON | P01.3 tests pass | Legacy `entities.json` read-only; all writes via registry. |
| `platform_actions` | new Octagon registry | new Octagon registry | `platform/kernel/actions/index.mjs` | none | P01.4 tests pass | Direct state mutation in `app.js`/`server.js` replaced by actions. |
| `x_doc_state_defs`, `x_doc_states`, `x_doc_state_history` | new Octagon registry | new Octagon registry | `platform/governance/document-state/index.mjs` | none | P01.4 tests pass | Old `services/stateService.js` no longer authoritative. |
| `platform_views`, `platform_view_versions` | new Octagon registry | new Octagon registry | `platform/kernel/views/index.mjs` | existing shell reads its own menu until Phase 07 | P01.5 tests pass | Shell consumes `platform_views` instead of hard-coded menu. |
| `platform_sequences` | new Octagon sequence service | new Octagon sequence service | `platform/records/sequences/index.mjs` | legacy numbering generators remain active | P01.6 tests pass + domain phase adopts canonical service | All legacy generators replaced. |
| `platform_events`, `platform_outbox` | new Octagon event/outbox | new Octagon event/outbox | `platform/events/index.mjs`, `platform/outbox/index.mjs` | none | P01.7 tests pass | Old event/listener paths replaced. |
| `/api/v1/*` | new Octagon API router | new Octagon API router | `platform/api/index.mjs` | legacy routes remain active | P01.8 tests pass | Domain phases migrate routes to `/api/v1`. |
| `platform_tenants`, `platform_companies`, `platform_branches`, `platform_users` | new Octagon control plane | new Octagon control plane | `platform/identity/context/index.mjs` + control-plane registries | existing company/branch collections remain active | P01.9 tests pass | Admin UI and legacy collections converge in Phase 02. |
| `platform_acl_roles`, `platform_acl_grants` | new Octagon permission hook | new Octagon permission hook | `platform/governance/permissions/index.mjs` | `acl.json` / `services/permissionService.js` remain active | P01.10 tests pass + Phase 02 full engine | Legacy ACL replaced by Phase 02 engine. |
| `platform_jobs`, `platform_health_contributors` | new Octagon control plane | new Octagon control plane | `platform/kernel/jobs/index.mjs`, `platform/kernel/health/index.mjs` | existing scheduler and health routes remain active | P01.11 tests pass | Phase 08 worker topology replaces ad-hoc scheduler. |
| `x_records` / `x_audit` | new Octagon repository | new Octagon repository | `platform/data/repositories/index.mjs` | `legacy-adapter.mjs` for old JSON | per-domain phase | All legacy collections migrated to canonical tables. |

---

## Frozen zones (authority unchanged in Phase 01)

| Domain | Current write authority | Current read authority | Target authority | Notes |
|---|---|---|---|---|
| Payroll calculations | existing Octagon payroll modules | existing Octagon payroll modules | unchanged | Phase 01 does not touch. |
| Attendance / smart timesheet | existing Octagon attendance modules | existing Octagon attendance modules | unchanged | Phase 01 does not touch. |
| Employee records required by payroll | existing Octagon HR modules | existing Octagon HR modules | unchanged | Phase 01 does not touch. |
| Accounting posting (`account_moves`, etc.) | existing Octagon finance modules | existing Octagon finance modules | unchanged | Finance phase will propose cutover. |
| Stock movements | existing Octagon inventory modules | existing Octagon inventory modules | unchanged | Inventory phase will propose cutover. |

---

## Dual-write / dual-read policy

- **No uncontrolled dual-write.** Any temporary dual-write must be documented with a cutover gate.
- **Temporary dual-read** is allowed for shadow comparison during migration, with explicit provenance.
- **Reference slice** (`product_category`, `crm_lead`) has exactly one writer: the new Octagon repository/action executor.

---

## Next review

Update this registry at the start of each domain phase when authority is transferred.
