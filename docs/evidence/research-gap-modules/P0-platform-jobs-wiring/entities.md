No new entity. One new row in the pre-existing `platform_jobs` definition
table: `platform_kernel:maintenance_sweep` (module_id `platform_kernel`,
handler `platform.jobs.maintenance_sweep`, schedule `every_5_minutes`,
enabled). Seeded idempotently by `seedDefaultJobDefinitions()` in
`platform-runtime-bridge.mjs`.
