# Operational Data Integrity

This worktree (`octagon-commercial-operations-closure`) has no `database.db`
of its own — it is a checkout of `build/octagon-research-gap-modules`, and no
step in this wave ran the application server against any operational path.

- All Returns/RMA tests (`tests/phase02/returns-rma.test.mjs`) use
  `tests/phase02/harness.mjs`'s `setup()`, which creates a disposable SQLite
  file under `os.tmpdir()` via `freshInstall()` and deletes it in
  `cleanup()`. No test opens `database.db`, `database.json`, or any path
  under the real `octagon-erp` worktree.
- The finance-closure-audit and checkpoint-d-e regression runs used to check
  for collateral damage also ran exclusively against disposable databases
  (the same `tests/*/harness.mjs` pattern throughout this codebase).
- The only file in the real `octagon-erp` worktree touched by this wave was
  read via `git status`/`git rev-parse`/`git log`/`git reflog` — never its
  `database.db`.

**Result: operational data untouched — this worktree has no operational data
path, and none was created.**
