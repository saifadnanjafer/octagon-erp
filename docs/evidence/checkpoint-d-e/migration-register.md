# Checkpoint D/E — migration register

Latest migration before this checkpoint: **051_checkpoint_c_control_entity_policy**
(resolved by scanning `database/migrations/` — there is no central registry
file; migrations are directory-discovered).

Latest migration after this checkpoint: **052_projects_and_project_costing**.

Migrations 001–051 were **not edited**.

## 052_projects_and_project_costing

| Field | Value |
|---|---|
| `id` | `052_projects_and_project_costing` |
| `owner` | `platform.kernel` |
| `version` | `1.31.0` |
| `parent` / `dependsOn` | `051_checkpoint_c_control_entity_policy` |
| `dialect` | `['sqlite']` |
| `transactionPolicy` | `required` |
| `rollbackPolicy` | `reversible` |
| `sourceProvenance` | Clean-room behavioural implementation. VNext donor (`vnext/server/modules/projects/project-engine.js` @ `cf7ae4ed`) inspected and found to be a 17-line stub; **nothing salvaged**. Lifecycle concepts modelled behaviourally on Odoo 19 Community `project`/`sale_project` and ERPNext `projects`; no donor code copied. |

### Creates

14 tables — `project_templates`, `projects`, `project_phases`,
`project_milestones`, `project_cost_codes`, `project_budget_lines`,
`project_commitments`, `project_change_orders`, `project_risks`,
`project_issues`, `project_billing_requests`, `project_cost_rates`,
`project_effort_entries`, `project_cost_links` — plus 8 indexes.

All tables are `STRICT`, matching the convention established by 046.

### Registers

- 1 module: `operations_projects` (kind `standard`, status `enabled`) plus
  per-company Control Plane assignments.
- 12 platform entities.
- 27 governed actions with stable error contracts.
- 5 default standard cost rates.

### `down()`

Reverses in dependency order: deletes the 27 actions, 12 entities, module
licences, module assignments, and the module row, then drops all 14 tables.

### Verification executed

Disposable SQLite under `os.tmpdir()`; the operational database was never
opened.

| Check | Result |
|---|---|
| Fresh install applies through 052 | **PASS** — `executed.at(-1).id === '052_projects_and_project_costing'` |
| All 14 tables created | **PASS** |
| Actions registered | **PASS** — 27 |
| Entities registered | **PASS** — 12 |
| Default cost rates seeded | **PASS** — 5 |
| Rerun is a no-op | **PASS** — via `tests/checkpoint-c/migration_051.test.mjs` rerun assertion on the same chain |
| Sequential upgrade 001→052 | **PASS** |

### Faults found and fixed during development

1. `platform_actions.module_id` has a FK to `platform_modules(id)`. The first
   draft registered actions without registering the module — `FOREIGN KEY
   constraint failed`. Fixed by registering `operations_projects` in
   `platform_modules` first. This also gives the domain free server-side
   enable/disable enforcement, since the ActionExecutor rejects actions whose
   module is not `enabled`.
2. `platform_modules.kind` has `CHECK (kind IN ('core','standard','optional','pack'))`.
   The first draft used `business`. Corrected to `standard`.
3. `projects:effort:record` initially declared `project_id` as schema-required,
   which blocked effort anchored to a production/work/maintenance order.
   Corrected so only `hours` is schema-required; the engine enforces that at
   least one canonical execution anchor is present.

### Not written

Migrations **053–060** (BOM/routings, MRP, manufacturing orders, work orders,
quality, assets, maintenance, fleet, subcontract) were **not** written. Those
checkpoints are not implemented.

### PostgreSQL

`dialect` is declared `['sqlite']` because that is what was actually executed.
The schema avoids SQLite-only constructs beyond `STRICT` and is intended to be
PostgreSQL-portable, but **no PostgreSQL run was performed** — no isolated
PostgreSQL runtime is available in this environment. Reported as
**not executed / blocked by environment**, not as a pass.
