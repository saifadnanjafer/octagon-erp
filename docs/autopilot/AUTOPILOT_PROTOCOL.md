# Octagon Autopilot Protocol

## Operating mode

This is a provider-neutral, supervised continuation controller. It selects at
most one task and never starts an unattended retry or multi-round loop. The
PowerShell entry point is `scripts/continue-next-octagon-task.ps1`.

## Required preflight

1. Resolve the Git top-level and confirm it is the requested repository.
2. Fetch `origin --prune`; inspect branch, upstream, local SHA, remote-tracking
   SHA, `git ls-remote`, worktree status, and current evidence.
3. Stop on any dirty file in the controller worktree. Inspect and recover it
   manually; never reset, clean, restore, or auto-stash it.
4. Stop on a `HUMAN_REQUIRED` task or a blocker that affects the candidate.
5. Select only the first `READY` task, or first `PENDING` task whose
   dependencies are all `COMPLETE` with valid completion evidence.

## Completion transaction

For exactly one coherent slice: inspect, implement, run the task's targeted
tests and affected regressions, write evidence, commit normally, push normally,
then verify `HEAD == @{u} == git ls-remote origin <branch>`. Only after those
facts are true may the agent update `QUEUE.json`, `STATE.json`, and this handoff.
Each completed queue task must record `completion.commit`, `completion.branch`,
and `completion.remote_commit`; the validator verifies that the commit is
reachable from `origin/<branch>`.

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
