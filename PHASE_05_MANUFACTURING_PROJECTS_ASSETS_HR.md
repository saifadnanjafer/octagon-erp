# PHASE 05 — MANUFACTURING, PROJECTS, ASSETS & HR

**Document status:** DRAFT — awaiting owner approval before any code is written
**Drafted:** 2026-07-26
**Governing authority for:** Phase 05 execution
**Predecessor:** `docs/evidence/phase-04-opening-cutover/26_cutover_signoff_manifest.md` (Phase 04 CLOSED, 43/43)
**Migration block reserved:** `045` onward (last applied: `044_opening_stock_cutover_and_equity_coa`)

---

## 0. Rule Zero — the frozen zone

**Payroll, attendance, and timesheet data are frozen. Phase 05 never writes them.**

This is the first rule because Phase 05 is the first phase to touch HR, and HR is
where that boundary is easiest to cross by accident.

Frozen collections — read-only, in every wave, without exception:

```
employees                      employee_advances
employee_payroll_closings      payroll_payments
payroll_periods                omni.employeeAttendance
omni.workshopAdvances          omni.workshopTimesheetCases
```

Concretely this means:

1. No Phase 05 migration may create, alter, or drop a table that stores payroll,
   attendance, or timesheet facts.
2. No Phase 05 command may issue an `INSERT`/`UPDATE`/`DELETE` against the
   collections above. Wave D ships a **fail-closed guard** that rejects such an
   attempt with `FROZEN_ZONE_WRITE_DENIED`, and a test that proves the guard
   fires rather than merely exists.
3. HR facts Phase 05 *does* own (positions, org structure, recruitment, leave
   requests, skills, appraisals, expense claims) live in **new, additive** tables.
   Where they must reference an employee they carry a read-only `employee_ref`.
4. Salary calculation stays exactly where it is. Phase 05 adds no payroll engine,
   no second calculator, and no "improved" attendance import.
5. Every wave's evidence package records a before/after digest of the frozen
   collections proving they are byte-identical.

If a Phase 05 requirement appears to need a payroll write, the requirement is
wrong — stop and raise it, do not implement it.

---

## 1. Mandate

Phase 05 brings the last four operational domains onto the canonical platform
established by Phases 01–04:

| Wave | Domain | Why it is in this phase |
|---|---|---|
| **A** | Manufacturing / Workshop production | The workshop is the actual business. It is still the least canonical domain. |
| **B** | Projects & service delivery | Must be rebuilt *on* Phase 04's canonical Work Items rather than beside them. |
| **C** | Assets & maintenance | Phase 03 built and tested the finance contract and explicitly deferred the register to here. |
| **D** | HR (additive only) | The one domain that abuts the frozen zone; scoped tightly and deliberately last. |
| **E** | Evidence, reconciliation & closure | The gate. Phase 04 taught us this is not a formality. |

Phase 05 does **not** start Phase 06.

---

## 2. Non-negotiable rules

These are carried forward from Phases 03–04, several of them learned the hard way.

1. **Rule Zero above outranks everything in this document.**
2. **`database.db` is never written during phase work.** Its SHA256 is recorded at
   wave entry and at closure, and both must match. All migration rehearsal runs
   against a byte-for-byte disposable copy.
3. **No fake browser tests.** Phase 04's first closure was overturned because its
   "browser suite" performed source-text and in-memory checks. A browser test
   drives the real UI in a real browser and proves a real workflow, or it does not
   count. An unreachable resource is a failure, never a pass.
4. **A test count is not a closure.** Every closure claim must name what was
   proven *and what was not*. Independent re-audit is expected and welcome.
5. **Additive first.** Existing modules and pages keep working. Legacy writers are
   retired only after a reconciled migration and browser parity, behind the same
   cutover-flag discipline Phase 04 used — never in the same change that
   introduces the canonical path.
6. **One posting authority.** Anything financial routes through the Phase 03
   finance pipeline (`create → submit → approve → post`). Phase 05 introduces no
   second GL writer.
7. **Migrations are numbered, reviewed, and reversible**, with a genuine
   schema-restoring `down()` proven by a rollback probe.
8. **`docs/evidence/model-execution-ledger.md` is append-only.** Prior records are
   never edited, including when they were wrong.
9. **No Git history rewrite, no force-push.**
10. **Source facts only.** Migration figures come from the legacy store. Nothing is
    invented, inferred, or rounded into existence to make a reconciliation close.

---

## 3. Entry gate

Phase 05 may not begin until all of these are verified and recorded:

- [ ] Phase 04 closure manifest present and signed off (43/43).
- [ ] `database.db` SHA256 recorded as the Phase 05 baseline.
- [ ] Phase 01–04 test suites re-run green on the current tree.
- [ ] Frozen-collection digest recorded as the Phase 05 baseline.
- [ ] `phase04.canonical_cutover` flag state recorded (Phase 05 does not change it).

---

## 4. Wave A — Manufacturing / Workshop production

**The problem.** Production is spread across `omni.workOrders`, `omni.jobOrders`,
`omni.boms`, `omni.machines`, `omni.opPacks`, `omni.sops`, `omni.qcTemplates`, and
`omni.qcRecords`, with the real execution chain living on `omni.jobOrders` and the
MRP-shaped records on `omni.workOrders`. Materials and stock became canonical in
Phase 04; production did not, so production still consumes stock through legacy
paths.

**Canonical targets** (`platform/manufacturing/**`, migration `045`):

| Fact | Legacy representation | Canonical owner |
|---|---|---|
| Bills of material | `omni.boms` | `bom_headers`, `bom_lines` (versioned, effective-dated) |
| Routings / operation packs | `omni.opPacks`, `omni.sops` | `routings`, `routing_operations`, `work_instructions` |
| Work centres / machines | `omni.machines` | `work_centers` (capacity, cost rate) |
| Production orders | `omni.workOrders` | `production_orders`, `production_order_lines` |
| Workshop job execution | `omni.jobOrders` | `production_executions` linked to Work Items |
| Material issue / backflush | legacy direct writes | Phase 04 `stock_moves` — **no new stock writer** |
| WIP & production cost | not represented | `production_cost_facts` → Phase 03 finance |
| Quality control | `omni.qcTemplates`, `omni.qcRecords` | `quality_plans`, `quality_inspections`, NCR lifecycle |

**Hard requirements**

- Material consumption posts through the Phase 04 inventory path. Wave A adds
  **zero** direct stock writers; a test proves consumption produces canonical
  `stock_moves` and correct valuation.
- A production order that fails mid-post leaves no partial stock, WIP, or GL
  effect — proven by fault injection, as Phase 04 required.
- `omni.jobOrders` remains readable and intact throughout; the workshop keeps
  running on it until cutover.
- BOM explosion is deterministic and handles multi-level plus phantom components.

**Wave A exit:** canonical production order → material issue → execution → QC →
completion → stock and GL effects, proven end to end, plus a real browser run of
the workshop flow.

---

## 5. Wave B — Projects & service delivery

**The problem.** `modules/project-management.js` predates Phase 04's canonical
Work Items. Rebuilding projects beside Work Items would recreate exactly the
duplication Phase 04 spent a remediation cycle removing.

**Canonical targets** (`platform/projects/**`, migration `046`):

| Fact | Canonical owner |
|---|---|
| Projects, phases, milestones | `projects`, `project_phases`, `project_milestones` |
| Project tasks | **Phase 04 `work_items`** — projects contribute a dimension, not a second task table |
| Project costs | `project_cost_facts` (material via Phase 04 stock, services via AP) |
| Project billing | Phase 03 finance — fixed-price, T&M, and milestone billing |
| Profitability | derived query; never a stored duplicate |

**Hard requirements**

- No second task entity. If Work Items lack a field projects need, extend Work
  Items.
- **Project labour cost must not read the frozen payroll store.** It uses
  project-specific effort records or a configured standard cost rate. This is a
  Rule Zero surface — treat it as such.
- Billing posts through the Phase 03 pipeline only; no direct invoice writer.

**Wave B exit:** project → phases → work items → costs → billing → P&L, with
no duplicate task authority and no frozen-zone read on the cost path.

---

## 6. Wave C — Assets & maintenance

**The problem.** Phase 03 built and tested the finance-side asset contract
(`finance_asset_categories`, `capitalizeAsset`, `postAssetDepreciation`,
`disposeAsset`) and *deliberately* shipped no asset register, naming Phase 05 as
the owner of everything above that contract. Meanwhile
`modules/asset-maintenance.js` and `modules/equipment-management.js` track assets
and depreciation in their own store and post nothing.

**Canonical targets** (`platform/assets/**`, migration `047`):

| Fact | Legacy representation | Canonical owner |
|---|---|---|
| Asset register | `asset-maintenance.js` store | `assets`, `asset_components` |
| Equipment | `omni.equipment` | `assets` (equipment class) — one register, not two |
| Custody & location | scattered | `asset_assignments` (read-only employee ref) |
| Depreciation schedule | ad-hoc computation | `depreciation_schedules` → calls Phase 03 `postAssetDepreciation` |
| Acquisition / disposal | not posted | Phase 03 `capitalizeAsset` / `disposeAsset` |
| Maintenance plans & orders | maintenance logs, machine PM | `maintenance_plans`, `maintenance_orders` |
| Warranty | warranty fields | `asset_warranties` with expiry alerting |

**Hard requirements**

- Phase 05 **computes and schedules** depreciation; Phase 03 **posts** it. The
  scheduler never writes GL directly.
- Assets and Equipment converge on one register. The duplicate is retired only
  after reconciliation proves every legacy record mapped.
- Maintenance orders link to Work Items (Wave B) rather than inventing a third
  task concept.
- Opening asset balances follow the Phase 04.6 opening-cutover pattern: source
  facts, single timestamp, reconciled to variance 0, one opening GL entry.

**Wave C exit:** acquisition → capitalization → scheduled depreciation posting →
maintenance → disposal with correct gain/loss, all through the Phase 03 pipeline.

---

## 7. Wave D — HR (additive only)

**Read Rule Zero again before starting this wave.**

**The problem.** `modules/people-ops.js` holds recruitment, leave, expense claims,
and appraisals in `omni.peopleOps`. These are legitimate Phase 05 facts. They sit
directly beside frozen payroll data, which is why this wave is last and tightly
bounded.

**Canonical targets** (`platform/hr/**`, migration `048`):

| Fact | Canonical owner | Frozen-zone relationship |
|---|---|---|
| Positions & org structure | `hr_positions`, `hr_org_units` | additive; `employee_ref` read-only |
| Recruitment (ATS) | `hr_requisitions`, `hr_candidates`, `hr_stages` | fully additive |
| Leave & time-off | `hr_leave_types`, `hr_leave_requests`, `hr_leave_balances` | **additive; never writes attendance or payroll** |
| Skills & certifications | `hr_skills`, `hr_employee_skills` | additive; expiry alerting |
| Appraisals | `hr_appraisal_cycles`, `hr_appraisals` | fully additive |
| Expense claims | `hr_expense_claims` | reimbursement posts via Phase 03 AP |
| Payroll / attendance / timesheet | **NOT OWNED** | **read-only; legacy app remains sole authority** |

**Hard requirements**

- A `FROZEN_ZONE_WRITE_DENIED` guard, with a test that proves it *fires*.
- Leave approval adjusts an HR leave balance and nothing else. It does not touch
  attendance, and it does not feed payroll. If leave should ever affect payroll,
  that is an owner decision (O-3 class), not an implementation detail.
- Expense reimbursement posts through Phase 03 AP — no direct GL write.
- Any payroll figure displayed in an HR screen is read-only and clearly labelled
  as owned by the legacy application.

**Wave D exit:** the full additive HR lifecycle works, and the frozen collections
are byte-identical to their Phase 05 entry digest.

---

## 8. Wave E — Evidence, reconciliation & closure

Phase 05 closes only when all of the following exist and pass. Wave E is where
Phase 04's first attempt failed; it is not paperwork.

**Required evidence** (`docs/evidence/phase-05/`):

- [ ] `starting-state.md` — entry gate results, baseline hashes, frozen digest.
- [ ] `CANONICAL_BUSINESS_FACT_REGISTER.md` — every Phase 05 fact: current
      representation → canonical owner → migration/parity rule → UI disposition.
- [ ] `current-authority-map.md` — who owns what, and the honest runtime status.
- [ ] `legacy-data-migration.md` — disposable-copy migration with per-collection
      reconciliation and **variance 0 or a documented, owner-visible reason**.
- [ ] `stock-to-gl-reconciliation.md` — production consumption vs GL.
- [ ] `asset-accounting-reconciliation.md` — register vs Phase 03 postings.
- [ ] `frozen-zone-attestation.md` — before/after digests plus proof the guard fires.
- [ ] `browser-regression-report.md` — **real** browser runs of the four domains.
- [ ] `test-suite-register.md` — every test, what it proves, what it does not.
- [ ] `unresolved-risks.md` — written honestly; an empty file is a red flag.
- [ ] `rollback-probe.md` — migrations 045–048 down/up restore the schema exactly.
- [ ] `model-execution-record.md` — appended, never edited.
- [ ] `PHASE_05_CLOSURE.md` — the claim, with its limits stated.

**Closure gates**

1. All Phase 01–05 suites green, with counts and scope stated per suite.
2. Real browser regression green across Manufacturing, Projects, Assets, HR.
3. Every migrated collection reconciled to variance 0, or deferred with a reason.
4. `database.db` SHA256 unchanged from the Phase 05 baseline.
5. Frozen collections byte-identical, and the write guard proven to fire.
6. Rollback probe passed for every Phase 05 migration.
7. No second posting authority, no second task authority, no second asset register.
8. Phase 06 not started.

---

## 9. Explicitly out of scope

Named now so they cannot quietly creep in:

- Any payroll, attendance, or timesheet write — permanently out of scope, not deferred.
- Payroll integration of leave balances — owner decision required first.
- MRP scheduling, capacity planning, and finite scheduling — Phase 06 candidates.
- Shop-floor terminal hardware and IoT machine telemetry.
- Advanced project resource levelling and Gantt critical path.
- Predictive maintenance and condition-based triggers.
- Retiring `phase04.canonical_cutover` or changing its state.
- Any new fork, parallel codebase, or rewrite.

---

## 10. Suggested execution order

`Entry gate → A (Manufacturing) → C (Assets) → B (Projects) → D (HR) → E (Closure)`

Assets before Projects is deliberate: the Phase 03 asset contract is already built
and tested, so Wave C is the lowest-risk way to establish the Phase 05 rhythm,
and maintenance orders give Wave B a proven Work-Item integration to copy.

Each wave ends with its own evidence and a stop. No wave begins before the
previous wave's exit is recorded.

---

## 11. Open questions for the owner

1. **Wave order** — accept A → C → B → D, or run strict A → B → C → D?
2. **Project labour cost** — standard cost rate per role, or project-specific
   effort entry? (Both avoid the frozen zone; this is a modelling preference.)
3. **Assets vs Equipment** — confirm they should converge on one register. The
   39 `omni.equipment` records and the asset-maintenance store appear to overlap.
4. **Depreciation posting cadence** — monthly scheduled batch, or manual
   manager-approved run as the current module does it?
5. **Cutover appetite** — should Phase 05 stop at "canonical path proven,
   legacy still authoritative" like Phase 04 did, or carry through to retiring
   the legacy writers within this phase?
