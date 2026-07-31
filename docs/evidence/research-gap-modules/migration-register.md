# Migration Register

**No new forward migration was added this wave.** The migration tip remains
`083_final_page_catalog_registry.mjs` (verified: `ls database/migrations/*.mjs
| wc -l` = 83, files 001–083, no gaps).

The P0 build needed zero new schema: `platform_jobs` (definitions) and
`job_runs` (durable queue) already existed from migrations `005` and `010`
respectively. The one new row this wave adds
(`platform_kernel:maintenance_sweep`) is an idempotent **data seed**
(`ON CONFLICT(id) DO NOTHING`) performed by `platform-runtime-bridge.mjs` at
authority-creation time — the same idiom already used by
`seedDefaultOwnerRole`/`seedDefaultFieldRules` in that same file — not a
migration.
