# FP-2E — Authority Governance / Workflow Studio / Approval Policy Studio / Automation Rules (2026-07-31)

Status: four governed read surfaces over the governance wiring completed in
`0c3c005`, wired end-to-end.

All four pages project the canonical engines through the governance query
dispatch (`/api/v1/{policy,workflow,approvals,automation}/*`). No second
workflow/approval/automation/delegation engine was created. Legacy `workflow`,
`approvals`, `automation` pages remain untouched for FP-10 consolidation.

## authority_governance

- Tabs: Delegations, Authority Limits, Segregation of Duties, Conflicts.
- Resources: `policy/delegations`, `policy/authority-limits`,
  `policy/sod-rules`, `policy/conflict-report`.
- Delegation identity validation is the real PolicyEngine's — the page creates
  nothing and therefore cannot bypass it (creation actions are deferred until
  wired through ActionExecutor, see R9).

## workflow_studio

- Tabs: Definitions, Instances.
- Resources: `workflow/definitions`, `workflow/instances`.
- Version state is real: draft vs active version vs retired from the registry.
- Visual editor, simulation, and publish/retire actions are deferred — the
  backend actions exist (`workflow:*` family) but are not yet wired to page UI.

## approval_policy_studio

- Tabs: Policies, Worklist (+ real counts KPI strip from `approvals/counts`).
- Resources: `approvals/policies`, `approvals/worklist`, `approvals/counts`.
- Mode/quorum/threshold/maker-checker columns render the actual
  `approval_policies` columns — quorum is shown because the backend stores it,
  not fabricated.

## automation_rules

- Tabs: Rules, Run Log (per-rule drill via `automation/runs?rule_id=`).
- Resources: `automation/rules`, `automation/runs`.
- Rules display only registered `action_id`s; a rule that never ran shows an
  honest empty log.

## Tests

`tests/final-page-catalog/fp2e-governance-pages.test.mjs` (7 tests, disposable
DB, fixtures seeded through the real executor/engines): definition+version+
activate round-trip, instance visibility, policy mode/threshold fields, rule
trigger-config parsing + honest empty run log, delegation visibility with real
seeded `identity_users`, sod/conflict report from the real engine, and honest
empty states for all four pages on a fresh install.
