# Phase 01 Source Evidence Lock

**Created:** 2026-07-21  
**Authority:** `PHASE_01_PLATFORM_KERNEL_AND_CONTROL_PLANE.md` Section 4  
**Purpose:** Immutable baseline before any Phase 01 source edit.

---

## Repository identity

```text
Workspace root:  C:\Users\Zahraa dlbooz\Downloads\odoo-19.0
Octagon root:    C:\Users\Zahraa dlbooz\Downloads\odoo-19.0\octagon-erp
Octagon branch:  codex/phase7-safe-baseline
Octagon commit:  f5f4cf559b2301e57401fbd3e6dc0d098f9291c3
Octagon status:  clean (no uncommitted changes)
VNext root:      C:\Users\Zahraa dlbooz\Downloads\odoo-19.0\octagon-erp-commercial-vnext
VNext branch:    automation/r9-marketplace-distribution
VNext commit:    72d2c6b4f568650203795d463c25a12ff06ad55a
VNext status:    clean (no uncommitted changes)
```

---

## Donor snapshot identity

| Alias | Resolved path | Snapshot type | HEAD / status |
|---|---|---|---|
| Odoo | `C:\Users\Zahraa dlbooz\Downloads\odoo-19.0` | workspace root, contains `addons/` and `odoo/` | git branch not applicable; workspace is not a single git repo for this purpose |
| ERPNext | `erp-research\erpnext-develop` | extracted snapshot | no `.git`; directory snapshot |
| Frappe | `erp-research\frappe-develop` | **MISSING** | not present in approved research root |
| RuoYi backend | `erp-research\ruoyi-vue-pro-master` | extracted snapshot | no `.git`; directory snapshot |
| RuoYi frontend | `erp-research\yudao-ui-admin-vue3-master` | **MISSING** | not present in approved research root |
| NocoBase | `erp-research\nocobase-main` | extracted snapshot | no `.git`; directory snapshot |
| AureusERP | `erp-research\aureuserp-master` | extracted snapshot | no `.git`; directory snapshot |
| IDURAR | `erp-research\idurar-erp-crm-master` | extracted snapshot | no `.git`; directory snapshot |

---

## Runtime versions

```text
Node.js:  v24.14.1
npm:      11.11.0
Database: SQLite (node:sqlite DatabaseSync), configured via USE_SQLITE=true
```

---

## Disposable database lanes

| Lane | Purpose | Path / name |
|---|---|---|
| Fresh install | Prove migrations build a clean schema from zero | `octagon-erp/database-test-fresh.db` |
| Current-Octagon compatibility | Baseline current app behavior | `octagon-erp/database.db` is **never** used directly; copies are made to `database-test-compat-*.db` |
| VNext migration replay | Replay VNext migrations in isolation | `octagon-erp-commercial-vnext/vnext-data/vnext-migrations-test.db` |
| Rollback/failure injection | Injected rollback and fingerprint tests | `octagon-erp/database-test-rollback.db` |
| PostgreSQL dialect | Only if PostgreSQL tooling is available; currently not configured | N/A |

**Hard rule:** `database.db` and `database.json` are treated as production-like and are not mutated by Phase 01 tests. Every test uses its own copy or a disposable path.

---

## Baseline commands and results

Current baseline commands are recorded from repository inspection before any edit:

- `node scripts/migrate.mjs status` — VNext migration-runner status (to be exercised on disposable DB).
- `node scripts/r0-isolation-smoke.mjs` — VNext startup isolation smoke.
- `node scripts/permission-regression.mjs` — permission regression (to be ported/re-run).
- `node scripts/smoke-boot.js` — Octagon boot smoke (to be exercised on a copy).

Exact results will be appended after first execution in `test-evidence.md`.

---

## Known missing or renamed paths

1. `FRAPPE_ROOT` = `erp-research\frappe-develop` — directory does not exist. Frappe behavior must be inferred from ERPNext/Frappe references already present in VNext/ERPNext source, or deferred until source is provided.
2. `RUOYI_UI_ROOT` = `erp-research\yudao-ui-admin-vue3-master` — directory does not exist. RuoYi frontend behavior must be inferred from backend code, existing VNext/Vue artifacts, or deferred until source is provided.
3. Frappe MIT files referenced in `SOURCE_TO_TARGET_EXTRACTION_MAP.md` cannot be verified locally; any Frappe-derived behavior will be implemented clean-room or deferred.

---

## Frozen zones

The following Octagon domains are protected and will not be modified during Phase 01:

- Payroll calculation, allowance/deduction logic, and Iraqi payroll behavior.
- Attendance source and smart timesheet behavior.
- Employee records required by payroll.
- Existing `account_moves`, `employee_payroll_closings`, `payroll_periods`, `payroll_payments`, `payroll_adjustments` collections as authoritative write targets.

Phase 01 only establishes platform contracts; it does not rewrite these domains.

---

## Current architecture notes

- Octagon is a single Express-like Node.js server in `server.js` (2812 lines) with a large client-side `app.js` and a single `database.json` / `database.db` store.
- VNext is a side-by-side project-owned repository with the same root shape but a `vnext/` subsystem containing `server/`, `client/`, and a dedicated `migrations/` directory with numbered `.mjs` migrations.
- VNext's `server.js` contains an explicit production-path guard that refuses to use the Octagon `database.json`/`database.db` paths.
- Octagon's `platform/server/` already contains partial implementations of CRUD, ACL, audit, approvals, chatter, sequences, views, workflow, etc., but these are not yet unified into the target modular registry architecture.
- VNext already implements a migration runner, module framework, pack SDK, CRUD engine, ACL engine, state machine, sequences, audit, events/outbox, workflow, and many focused tests.

---

## Next permitted action

Create `phase-01-source-manifest.json` and begin Wave P01.0/P01.1 with the VNext migration-runner as the canonical migration foundation.
