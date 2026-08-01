# Octagon ERP continuation rules

This repository is operated through `docs/autopilot/`. Read, in order:

1. `docs/autopilot/AUTOPILOT_PROTOCOL.md`
2. `docs/autopilot/QUEUE.json` and `docs/autopilot/STATE.json`
3. `docs/autopilot/CURRENT_HANDOFF.md` and `docs/autopilot/BLOCKERS.md`
4. the selected task prompt in `docs/autopilot/prompts/`

The repository and executable evidence override queue or handoff claims. Do
not update task status until required tests, evidence, a normal commit, a
normal push, and exact local/upstream/remote SHA equality have all succeeded.

Never reset, restore, clean, stash, force-push, rewrite history, merge `main`,
or discard unknown work. Do not modify or open operational data through a
writable connection. Do not inspect or print administrator credentials. Do not
touch the Telegram-bot worktree or frozen `octagon-erp-commercial-vnext`.

`continue the next eligible Octagon task` means run the supervised controller
and follow its stop gates. The controller may prepare a bounded dependency-safe
batch; this does not authorize bypassing human gates or starting a task outside
that prepared batch.
