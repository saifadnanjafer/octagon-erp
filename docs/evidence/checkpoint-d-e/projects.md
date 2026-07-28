# Checkpoint D1 — Projects

Status: **DELIVERED AND PROVEN**

## What was built

| Layer | Path |
|---|---|
| Migration | `database/migrations/052_projects_and_project_costing.mjs` |
| Errors | `platform/projects/errors.mjs` |
| Register / structure | `platform/projects/projects.mjs` |
| Budget / governance | `platform/projects/budget.mjs` |
| Effort (frozen-zone safe) | `platform/projects/effort.mjs` |
| Derived costing | `platform/projects/costing.mjs` |
| Billing | `platform/projects/billing.mjs` |
| Action registration | `platform/projects/index.mjs` |
| Query surface | `platform/api/projects.mjs` |
| Router wiring | `platform/api/index.mjs` (`/api/v1/projects/*`) |
| Runtime wiring | `platform-runtime-bridge.mjs` (`registerProjectActions`) |
| Client transport | `services/canonicalClient.js` (`CanonicalClient.projects`) |
| Visible workspace | `modules/canonical-projects.js` + `.css` |
| Shell wiring | `index.html`, `app.js` |
| Tests | `tests/checkpoint-d-e/projects_lifecycle.test.mjs` |

## Schema (migration 052)

14 tables: `project_templates`, `projects`, `project_phases`,
`project_milestones`, `project_cost_codes`, `project_budget_lines`,
`project_commitments`, `project_change_orders`, `project_risks`,
`project_issues`, `project_billing_requests`, `project_cost_rates`,
`project_effort_entries`, `project_cost_links`.

Registered: **1 module** (`operations_projects`), **12 entities**,
**27 governed actions**, **5 default standard cost rates**.

## Visible areas (18)

Project Dashboard · Projects · Templates · Phases · Milestones · Work
Breakdown Structure · Project Tasks · Budget · Commitments · Cost Codes ·
Change Orders · Risks · Issues · Documents · Billing · Profitability ·
Resource View · Project Reports.

Confirmed live in the running app: 18 tabs, 6 KPI tiles, Arabic RTL
(`document.documentElement.dir === "rtl"`), real data rendered.

## Authority boundaries honoured

**Project tasks are canonical Work Items.** `projects:task:create` delegates to
`createWorkItemLifecycle` and writes `work_items` with `source_type='project'`
and `project_ref=<project id>`. A test asserts no table named
`project_tasks` / `projects_tasks` / `project_task` exists.

**Cost is derived, never stored.** `projectCostBreakdown` /
`projectProfitability` compute from canonical source facts at read time:
stock moves (via the link-only `project_cost_links`), commitments, effort
entries, and posted finance documents. `project_cost_links` deliberately
carries **no amount column** — amounts are always read from the source fact.
A test asserts `projects.actual_cost` and `projects.margin` do not exist as
stored columns, and that re-reading after new effort changes the derived
figure with no recalculation step.

**Finance is the only GL writer.** `projects:billing:approve` posts revenue
only through `postSourceFact('sales_invoice_posting')` — the Phase 03
authority — and only when an explicit account mapping is supplied. Without it
the request stays `approved` and the GL is untouched. A test asserts the
`finance_documents` row count is identical before and after approval.

**Payroll is never touched.** See `frozen-zone-attestation.md`.

## Governed business rules proven by test

| Rule | Denial code |
|---|---|
| Project status transitions follow a state machine | `PROJECT_TRANSITION_INVALID` |
| Cannot complete with unresolved critical issues | `PROJECT_HAS_OPEN_CRITICAL_ISSUES` |
| Commitments require an approved budget line | `PROJECT_BUDGET_NOT_APPROVED` |
| Approved budget cannot be silently overwritten | `PROJECT_BUDGET_ALREADY_APPROVED` |
| Revision cannot fall below open commitments | `PROJECT_BUDGET_BELOW_COMMITMENTS` |
| Commitment cannot be over-released | `PROJECT_COMMITMENT_OVER_RELEASE` |
| Decided change order is terminal | `PROJECT_CHANGE_ORDER_CLOSED` |
| Milestone billing requires an achieved milestone | `PROJECT_MILESTONE_NOT_ACHIEVED` |
| A milestone cannot be billed twice | `PROJECT_MILESTONE_ALREADY_BILLED` |
| A milestone cannot be achieved twice | `PROJECT_MILESTONE_ALREADY_ACHIEVED` |
| Billing cannot exceed contract value | `PROJECT_BILLING_EXCEEDS_CONTRACT` |
| T&M billing cannot exceed recorded unbilled effort | `PROJECT_EFFORT_OVER_BILLED` |
| Effort must be anchored to an execution context | `PROJECT_EFFORT_UNANCHORED` |
| Caller cannot assert its own company scope | `UNTRUSTED_ACTION_SCOPE` |

Approved budget baselines are preserved on revision: `approved_amount` stays
at the approved figure, `revised_amount` moves, and `revision_no` increments.

## Test result

```
node --test tests/checkpoint-d-e/projects_lifecycle.test.mjs
pass 23   fail 0
```

## Live browser proof

Against a **disposable** database (`scripts/preview-authenticated-server.mjs`,
port 8091), authenticated as the new `test.project` project-manager role, the
full chain executed over real HTTP:

```
create (PRJ-00001) -> activate -> cost code -> budget line -> approve budget
  -> commitment (4000) -> task (work_items id wi_964a9c7712e69d43)
  -> effort (6h engineer -> cost 54, basis "configured_standard_rate",
             payroll_consulted false)
  -> milestone -> achieve -> billing request (gross 10000, retention 500,
                                              net 9500)
  -> derived profitability (actual_cost 54, derived true)
  -> budget vs actual (budget 20000, committed 4000, variance 16000)
```

Navigating the shell to `projects` mounts the canonical workspace and the
retired legacy markup (`#projectsBody`) is gone.

### Navigation race — found and fixed

`projects` is a core `pageMap` entry, so the shell asynchronously hydrates
`views/projects.html` into `#pageProjects`. That fetch resolves *after*
`switchPage`'s synchronous render dispatch and overwrote the workspace with the
retired legacy markup. Fixed in `modules/canonical-projects.js` by wrapping
`switchPage` and activating only once `ensurePageTemplateLoaded('projects')`
has settled — deterministic ordering instead of a race. This follows the
established module wrap pattern (`modules/appointments.js`).

## Known limitation

`projects:change_order:approve` applies its cost impact to a cost code
supplied by the caller (`cost_code_id`). The workspace currently passes the
project's first cost code. A change order that should target a specific cost
code must be approved through the API with that `cost_code_id`. Recorded
rather than hidden.
