# Octagon Autopilot

Use one short command:

```powershell
./scripts/continue-next-octagon-task.ps1
```

The default is read-only preflight and task preparation. It can write a
secret-free context file under ignored `docs/autopilot/runtime/` only after all
preflight gates pass. To open a supported installed provider in plan mode, use
`-Provider Claude -Launch` or `-Provider Kimi -Launch`.

There is intentionally no unattended mode. Enablement would require a separate
disposable-worktree exercise and explicit owner approval.
