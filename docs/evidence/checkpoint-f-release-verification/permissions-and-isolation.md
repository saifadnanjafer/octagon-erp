# Checkpoint F — permissions and isolation

## Server-side enforcement — proved

Authorization is enforced server-side, not by browser visibility.

| Property | Evidence |
|---|---|
| Every governed action declares a required permission and required scope | `normalizeAction()` in `platform/kernel/actions/index.mjs` defaults `required_permission` to `<module>:<entity>:<action>` and `required_scope` to `company`; all 330 registered actions carry both |
| Module access checked before execution | `assertModuleAccess()` is called by the executor; disabled and unlicensed modules are refused |
| A caller cannot assert its own company scope | `a caller cannot assert its own company scope` (Checkpoint F) plus the D/E scope-spoofing denial tests |
| Direct API calls to hidden actions are denied | `tests/phase02/browser-live-evidence.test.mjs` calls the API directly for actions the UI hides; they are refused |
| Sessions revoked server-side on logout | same suite |
| Tenant / company isolation enforced by the platform authority | same suite |
| Field-masking metadata delivered in the bootstrap payload | same suite |

Module denial codes are real and distinct — `MODULE_NOT_ENABLED`,
`MODULE_SCOPE_DENIED`, `MODULE_UNLICENSED` — each exercised by Checkpoint C.

## Permission regression suite

`node scripts/permission-regression.mjs` → exit 0, **35/35 pass**.

Representative cases:

- `finance_manager` cannot access inventory; `workshop_manager` cannot access banking
- `operator_user` cannot access the people_ops manager page
- `viewer_user` cannot access finance or route health
- writes that route to **approval** instead of executing: inventory adjustment
  by `operator_user`, salary change by `workshop_manager`, high-risk AI write by
  `viewer_user`, direct edit of a used COA account
- `viewer_user` blocked on an unmapped critical delete without an approval flag

Approval-routing rather than a silent allow or deny is the correct behaviour for
a governed system, and is confirmed in 6 of the 35 cases.

Note on scope: this suite exercises the **page/action ACL layer**. It is not the
same mechanism as the canonical `required_permission` check inside the
ActionExecutor. Both exist; both were exercised, but by different suites.

## Roles covered

`tests/phase04-finalization` asserts an exact 9-role disposable manifest,
including a scoped `project_manager` that holds Projects permissions and
explicitly does **not** hold `control:admin`, `pos:session:write`, or
`sales:order:write`.

## Limits — what was NOT verified

The mission's 13-role × per-domain matrix (allowed read / allowed write /
denied write / company isolation / branch isolation / disabled-module denial /
unlicensed-module denial / expired-session denial / revoked-session denial /
field masking, for each of system administrator, finance manager, sales user,
procurement user, POS operator, project manager, manufacturing manager,
manufacturing operator, quality user, asset user, maintenance user, fleet user
and restricted viewer) was **not executed in full**.

Specifically unverified:

- **branch-level isolation** for the Checkpoint D/E domains;
- **expired-session** denial as a case distinct from revoked-session;
- per-role denial for the manufacturing operator, quality, asset, maintenance
  and fleet roles individually.

The enforcement mechanism is shared across all domains, but shared code is an
argument, not a proof. Recorded in [unresolved-risks.md](unresolved-risks.md).
