# Checkpoint D / E — completion status

**Classification: PARTIAL — REMEDIATION REQUIRED**

## Summary

Checkpoint **D1 (Projects and Project Costing)** is delivered, wired into the
original Octagon shell, and proven by 23 passing tests plus a live
authenticated run against a disposable database.

Checkpoint **D2 (Engineering, BOM, Routings, Work Centers, MRP)** is also
delivered and proven — see `engineering-bom-routing.md` and
`mrp-and-planning.md`.

Checkpoints **D3, D4 and E1–E3 are not implemented.** No scaffolding, no
placeholder navigation, and no empty pages were added for them — per the
assignment, a page enters navigation only when it has a real workflow.

## Delivered

| Checkpoint | Scope | Status |
|---|---|---|
| **D1** | Projects, phases, milestones, WBS, tasks, cost codes, budget, commitments, change orders, risks, issues, documents, billing, profitability, resource view, reports | **COMPLETE** (commit `5f18230`, published) |
| **D2** | Engineering, versioned BOMs, ECOs, work centers, versioned routings, MRP | **COMPLETE** (commit `72faccd`, published) |

Evidence: `projects.md`, `frozen-zone-attestation.md`,
`test-suite-register.md`, `starting-state.md`.

- Migration **052** — 14 tables, 1 module, 12 entities, 27 governed actions.
- Visible workspace with **18 real areas**, Arabic RTL + English LTR, loading /
  empty / error / denial states, responsive breakpoints.
- API family `/api/v1/projects/*` (reads) + `/api/v1/action/:actionId` (all
  mutations). No generic CRUD over governed facts.
- Registered in the Control Plane as module `operations_projects`; the
  canonical ActionExecutor already enforces `MODULE_NOT_ENABLED` server-side.
- Project tasks are canonical Work Items. Costs are derived from canonical
  facts. Finance remains the only GL writer. Payroll is untouched.
- New scoped `project_manager` disposable role for authenticated role proof.

## Not implemented

| Checkpoint | Scope | Status |
|---|---|---|
| D3 | Manufacturing orders, work orders, shop floor, WIP, production costing | **NOT STARTED** |
| D4 | Quality | **NOT STARTED** |
| — | Subcontract manufacturing | **NOT STARTED** |
| E1 | Asset register | **NOT STARTED** |
| E2 | Maintenance | **NOT STARTED** |
| E3 | Fleet and telemetry adapters | **NOT STARTED** |

Migrations 054–060 were **not** written. The migration tip is **053**.

## Groundwork confirmed for the remaining checkpoints

Recorded so the next session does not re-derive it:

- **Finance interfaces already exist** from Phase 03 and are the correct entry
  points — `finance_source_fact_schemas` already registers
  `manufacturing_wip_posting`, `project_cost_posting`,
  `asset_depreciation_posting`, `stock_issue_posting`, `landed_cost_posting`.
  Migration 032 provides `finance_asset:capitalize`,
  `finance_asset:post_depreciation`, `finance_asset:dispose`.
- **Work Items already carry the refs** these domains need:
  `work_items.work_order_ref`, `.qc_ref`, `.maintenance_ref`, `.project_ref`.
  No second task authority is needed anywhere.
- **Inventory actions to reuse** (never re-implement): `stock:move:post`,
  `stock:reservation:reserve|consume|release|reverse`,
  `stock:receipt:*`, `stock:transfer:*`, `stock:delivery:*`, `stock:return:*`,
  `stock:lot:create`, `stock:serial:create`.
- **Page hosts already exist** in the shell for every remaining domain:
  `pageMrp`, `pageWorkOrders`, `pageQcCenter`, `pageAssets`, `pageEquipment`,
  `pageMachines`, `pageFleet`.
- **The navigation race is real and must be handled** for each new core-pageMap
  page — see the fix documented in `projects.md`.
- **`app.js` has duplicate top-level function names** (last definition wins).
  Verify which definition is live before editing.

## Environment findings

- **PostgreSQL: not executed.** No isolated PostgreSQL runtime is available
  here. Migration 052 is written to be PostgreSQL-compatible; that is
  **unproven**, not demonstrated.
- **Production backup/restore: not executed**, by policy.
- **Operational data: unchanged** — `database.db` and `database.json` MD5
  hashes identical before and after.
- **VNext: unchanged** — read-only inspection only; it was already dirty when
  found.
- The owner-approved opening-inventory accounting date remains **unresolved**
  and was not invented. It did not block this work.

## Required remediation

1. Implement D2–D6, subcontract manufacturing, and E1–E3 with migrations
   053–060.
2. Write the authenticated Chromium acceptance runner for Checkpoint D/E and
   capture screenshot + trace artefacts for every lifecycle state.
3. Write the dedicated concurrency, failure-injection, and rollback suites.
4. Populate the remaining evidence documents listed in the assignment that are
   not yet applicable.
5. Investigate the pre-existing `tests/phase02/browser-live-evidence` failure
   (fails at the source commit too).


## D2 addendum

Migration **053** — 15 tables, 2 modules (`operations_engineering`,
`operations_mrp`), 14 entities, 24 governed actions. A visible 12-area
Engineering & Material Planning workspace mounts on `#pageMrp`.

Key contracts proven: versioned BOM/routing immutability with separation of
duties and automatic supersession; ECOs that open a governed revision rather
than editing an approved version in place; one standard-cost authority shared
by Projects and Manufacturing; and MRP that emits governed proposals only —
never a commitment and never a stock move.

A previous record is corrected here: the D1 report's duplicate-`switchPage`
claim was wrong. See `dispatcher-audit.md`, locked by
`tests/checkpoint-d-e/shell_dispatcher.test.mjs`.

Next session starts from `HANDOFF.md`.
