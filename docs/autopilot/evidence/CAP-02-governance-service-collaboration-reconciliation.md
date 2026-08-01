# CAP-02 — Governance, Service, and Collaboration Reconciliation

## Scope and method

This is a read-only reconciliation of the selected canonical cutover baseline.
It does not merge, cherry-pick, rebase, or otherwise integrate expansion work.
It does not open operational data through a writable connection.

The authoritative safety baseline is
`cutover/octagon-operational-canonical-migration` at
`4c7e58bb3ba3cb149561826146b91d5cc96683e2`.

## Canonical ownership finding

`build/octagon-original-shell-visible-expansion` resolves to
`6adcd0df19788867c336d5020fe0d15cb7a123bb`, which is an ancestor of the
selected baseline. A path-limited comparison found no difference between that
lineage and the baseline for the Phase 02 governance, authorization, workflow,
approvals, collaboration, governance-server, or migrations 009 through 013
paths. The baseline is therefore the existing canonical owner of those
governed-service capabilities.

`build/octagon-research-gap-modules` resolves to
`87473d9b6bb121c3c5b300cb0c60d00166eea451` and diverges from the baseline at
`00e60a8d894ed5e4b9a613246fe1b46264e20550`. Its P0 collaboration commit
modifies `platform/collaboration/index.mjs`, `platform/workflow/index.mjs`,
`platform/approvals/index.mjs`, and the authorization evaluator. Those are
overlapping canonical paths, so that implementation remains an unintegrated
candidate, not a second write authority.

## Executable evidence

All checks used disposable databases or read-only source and Git inspection:

| Check | Result | What it proves |
| --- | --- | --- |
| `node scripts/permission-regression.mjs` | 35/35 passed | Role inheritance, page/action policy, denial, and approval routing remain enforced. |
| `node tests/unit/actions.test.mjs` | 13 checks passed | Canonical lifecycle actions are permission-checked, idempotent, audited in `platform_audit_log`, and emitted through the outbox only after commit. |
| `node tests/phase02/collaboration-files-jobs.test.mjs` | 29/29 passed | Collaboration inherits record permission; cross-record and cross-tenant attachment access is denied; notifications, files, jobs, and webhooks preserve scope, masking, replay protection, and post-commit delivery. |

## Decision and boundary

CAP-02 is complete as a reconciliation only. The selected baseline remains the
single authority for permissions, audit, governed workflow, and collaboration.
No integration of the divergent research branch is authorized by this record.
Operational cutover remains owner-gated under AP-B03.

CAP-03 may proceed only as its own read-only planning and finance review.
