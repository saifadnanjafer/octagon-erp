# Octagon Autopilot Protocol

## Operating mode

This is a provider-neutral, supervised continuation controller. It selects a
bounded dependency-safe batch of up to ten tasks and never starts an
unattended retry or multi-round loop. The PowerShell entry point is
`scripts/continue-next-octagon-task.ps1`.

## Required preflight

1. Resolve the Git top-level and confirm it is the requested repository.
2. Fetch `origin --prune`; inspect the controller branch, upstream, local SHA,
   remote-tracking SHA, `git ls-remote`, and the current task evidence.
3. Stop on any dirty file in the controller worktree. Inspect and recover it
   manually; never reset, clean, restore, or auto-stash it.
4. Stop on a `HUMAN_REQUIRED` task or a blocker that affects the candidate.
5. Select the first `READY` or dependency-safe `PENDING` task, then extend the
   batch only with following `PENDING` tasks whose dependencies are either
   published `COMPLETE` tasks or earlier tasks in the same batch. Stop before a
   human gate, blocker, non-read-only task, or the configured batch limit.

## Completion transaction

For one coherent batch: inspect, implement, run every selected task's targeted
tests and affected regressions, and write separate evidence records. Commit the
batch evidence normally, then update `QUEUE.json`, `STATE.json`, and the
handoff in a normal transition commit. Push both commits together and verify
`HEAD == @{u} == git ls-remote origin <branch>`. Each completed queue task must
record the shared evidence commit, branch, and remote commit; the validator
verifies that it is reachable from `origin/<branch>`.

## Lean validation policy

The default is deliberately small: controller-worktree cleanliness, the
selected task's targeted tests, one affected regression check when applicable,
and post-push SHA equality. Do not run broad historical suites or audit other
worktrees on every task. Separate worktrees remain out of scope and must never
be modified by this controller.

## Hard prohibitions

- No operational-data write or writable operational database connection.
- No administrator credential inspection or output.
- No VNext, Telegram-bot worktree, `main` merge, force push, history rewrite,
  destructive Git cleanup, or duplicate canonical authority.
- No state completion based only on documentation, registration, or page
  presence; executable evidence is mandatory.

## Provider boundary

The repository does not declare provider-specific CLI flags or configuration.
The runner can optionally launch a documented installed provider in plan mode;
it never uses automatic-approval or permission-bypass flags. Provider policies
are advisory only; the Git/evidence gates above remain authoritative.

## GitHub publication

`-Publish` is explicit supervised consent to attempt a normal push for an
eligible task. It verifies `gh auth status` without displaying credentials,
requires the configured upstream to be exactly `origin/<current-branch>`,
requires an existing remote branch and a fast-forward relationship, re-runs the
automation tests, then runs ordinary `git push` and proves SHA equality. It
never creates a branch, pushes `main`, force-pushes, or updates task state.
