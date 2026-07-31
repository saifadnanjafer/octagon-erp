# Migration Register

One new forward migration this wave:

| ID | Purpose | Tables created | Reversible |
|---|---|---|---|
| `084_returns_rma_consolidation` | Returns/RMA orchestration schema | `returns_rma`, `returns_rma_lines`, `returns_rma_timeline` + `platform_modules`/`platform_module_assignments`/`platform_entities`/`platform_actions` registration rows | Yes — `down()` drops all three tables and deregisters the module/entities/actions |

Replaces the interrupted draft's runtime `db.exec('CREATE TABLE IF NOT
EXISTS ...')` called from application code on every request — a direct
violation of "no runtime DDL" (program rule, and matches every other
domain's own established pattern, e.g. `057_assets_and_depreciation_schedules.mjs`).

Verified via `freshInstall()` (applies 001→084 in one pass, deterministic,
rerunnable — `ON CONFLICT DO UPDATE`/`DO NOTHING` throughout) and via the
full 14-file phase02 regression run (see `test-suite-register.md`), which
exercises this migration as part of every disposable database it creates.

Migration tip after this wave: **084** (was 083 at entry).
