# Frozen-zone attestation — Checkpoint D1

## Payroll / attendance / timesheet

The frozen tables are read-only, always:

```
employees                      employee_advances
employee_payroll_closings      payroll_payments
payroll_periods                omni.employeeAttendance
omni.workshopAdvances          omni.workshopTimesheetCases
```

### What this checkpoint did instead

Manufacturing and project labour cost is a **new canonical fact** owned by
this module, stored in `project_effort_entries`, priced from **configured
standard rates** in `project_cost_rates`.

Resolution order in `platform/projects/effort.mjs :: resolveHourlyCost` is
most-specific-first — work centre rate, then employee standard cost rate, then
role rate, then the `default` role rate. Payroll is not consulted at any step.
If no configured rate matches, the action is denied
(`PROJECT_COST_RATE_NOT_CONFIGURED`) rather than falling back to a payroll
figure.

`project_effort_entries.employee_ref` is an opaque, read-only reference string
used for reporting only. It is never joined back into payroll and no payroll
value is ever reinterpreted as a cost input.

Every successful effort record returns explicit provenance:

```json
{ "cost_basis": "configured_standard_rate", "payroll_consulted": false }
```

### Fail-closed guard

`platform/projects/effort.mjs` exports `FROZEN_TABLES` and `assertNotFrozen()`.
Any attempt to route a write at a frozen table through this module raises
`FROZEN_ZONE_WRITE_DENIED` (HTTP 403).

### Tests

`tests/checkpoint-d-e/projects_lifecycle.test.mjs`:

1. **`frozen payroll tables are rejected fail-closed`** — every entry in
   `FROZEN_TABLES` throws `FROZEN_ZONE_WRITE_DENIED`; a non-frozen table
   (`projects`) passes.
2. **`the Projects module never references a frozen payroll table`** — static
   scan of every `.mjs` in `platform/projects/`, with comments stripped so the
   documented frozen-table list does not self-trip, asserting no
   `FROM|JOIN|INTO|UPDATE <frozen table>` appears in executable code.
3. **`effort cost comes from configured standard rates, never from payroll`** —
   8h at the `engineer` role rate (9.0) yields exactly 72.00 with
   `rate_source: "role"` and `payroll_consulted: false`.

Both guard tests pass. Live browser run confirmed the same
(`cost_basis: "configured_standard_rate"`, `payroll_consulted: false`).

## VNext freeze

| Item | Value |
|---|---|
| VNext HEAD | `cf7ae4ed73eac91a325c964178036290bc0736c1` |
| Worktree when found | already dirty (pre-existing uncommitted edits) |
| Files written by this checkpoint | **none** |
| Branches / migrations created | **none** |
| Cleaned / reset / deleted | **none** |

VNext was opened **read-only** to assess donor value. Findings:

| VNext path | Lines | Salvage outcome |
|---|---|---|
| `vnext/server/modules/projects/project-engine.js` | 17 | **Nothing salvaged** — a stub with no lifecycle |
| `vnext/server/modules/manufacturing/manufacturing-engine.js` | 4 | **Nothing salvaged** — a stub |
| `vnext/server/modules/manufacturing/mrp-engine.js` | 92 | Not yet used (Checkpoint D3 scope) |
| `vnext/server/modules/shopfloor/quality-engine.js` | 189 | Reviewed; behavioural pattern noted for D6 (inspection → auto-NCR → containment → verified, plus a defect Pareto report). Not yet ported |
| `vnext/server/modules/shopfloor/maintenance-engine.js` | 272 | Reviewed; not yet ported (Checkpoint E2 scope) |
| `migrations/615_r3_manufacturing_core.mjs` | 19 | Inspected only |
| `migrations/704_r7_quality.mjs` | 56 | Inspected only |
| `migrations/705_r7_maintenance.mjs` | 62 | Inspected only |

**Checkpoint D1 salvaged no VNext code**, because the project-owned donor for
this domain is a 17-line stub carrying no reusable lifecycle. Migration 052
records this in its `sourceProvenance` field. The Projects implementation is a
clean-room behavioural implementation on Octagon's own canonical authorities;
lifecycle *concepts* (phase → milestone → billing, budget vs committed vs
actual) were modelled behaviourally after Odoo 19 Community `project` /
`sale_project` and ERPNext `projects`. No donor source was copied.

## Operational data

| File | Before | After |
|---|---|---|
| `database.db` | `ab024b2cbf46837d966cdf2966fc7441` | `ab024b2cbf46837d966cdf2966fc7441` |
| `database.json` | `644bc345d38d9dc1a826018ed5d4aecf` | `644bc345d38d9dc1a826018ed5d4aecf` |

Unchanged. No production backup or restore was run.
