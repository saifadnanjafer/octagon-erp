# coordination/ — Multi-Agent Lock & Handoff System

All agents (any vendor) share ONE working directory and ONE git repo.
This directory is the traffic control. Read `AGENT_PROMPT.txt` for the full protocol.

## claims/ — one file per task = the lock

To claim task `T3.2`, create `coordination/claims/T3.2.md`:

```
task: T3.2
lane: B2
agent: <vendor + model, e.g. codex-gpt5 / claude-sonnet / gemini-pro>
started: <ISO datetime>
status: CLAIMED          # CLAIMED | DONE | BLOCKED | HANDOFF
gates: —                 # e.g. "A,B,C,F pass" or "deferred"
notes: —                 # on HANDOFF: exact state + next step. on BLOCKED: full error.
```

Then commit ONLY that file: `git add coordination/claims/T3.2.md && git commit -m "chore: claim T3.2"`.
- If the file already exists with `status: CLAIMED` and `started` < 24h ago → the task is TAKEN. Pick another.
- `started` older than 24h with no DONE → abandoned; you may take over (overwrite, note the takeover).
- On finish: update the SAME file to `status: DONE` + gates, commit it together with your code.
- `status: HANDOFF` = resumable; the next same-lane agent finishes it FIRST before claiming anything new.

## integration-queue.md — requests for SHARED files

`index.html`, `server.js`, `server-jarvis-security.js`, `app.js`, `MASTER_ROADMAP.md`,
and §13 of `AGENT_EXECUTION_PLAN.md` are owned by LANE-A ONLY.
Every other lane appends a request line to `integration-queue.md` instead of editing them:

```
- [ ] (T3.2) add to index.html <head>: <link rel="stylesheet" href="modules/import-wizard.css">
- [ ] (T3.2) add before app.js: <script src="modules/import-wizard.js"></script>
```

LANE-A applies pending requests at the START and END of each of its sessions, checks the boxes,
and commits. A feature is not "live" until its queue lines are applied — plan your gates accordingly
(mark them `deferred` until integration lands).

## verify.lock — runtime lock for the verification server (port 8090)

Before starting the 8090 verify server: if `coordination/verify.lock` exists and its timestamp
is < 30 min old → someone else is verifying; defer your gates. Otherwise write the file
(`agent + ISO datetime`), run your verification, DELETE the file when done.
`verify.lock` is runtime-only — NEVER commit it (it is gitignored).

## Git discipline (absolute, because we share one working tree)

1. Commit by EXPLICIT paths only. `git add <your files>` — NEVER `git add .`, `git add -A`,
   `git commit -a`, `git stash`, or `git checkout -- <not-your-file>`.
2. Dirty files you don't own in `git status` are ANOTHER AGENT'S work in progress.
   Never touch, commit, or revert them.
3. If `git commit` hits an index.lock error, wait 10s and retry (another agent mid-commit).
