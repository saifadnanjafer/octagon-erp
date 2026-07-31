# Operational Data Integrity

This worktree (`octagon-research-gap-modules`) has **no `database.db` of its
own** — it is a fresh checkout of `build/octagon-final-page-catalog`, and no
step in this wave ran the application server against any operational path.

- All tests in this wave (`tests/phase02/jobs-wiring.test.mjs`) use
  `tests/phase02/harness.mjs`'s `setup()`, which creates a disposable SQLite
  file under `os.tmpdir()` via `freshInstall()` and deletes it in `cleanup()`.
  No test opens `database.db`, `database.json`, or any path under the real
  `octagon-erp` worktree.
- The only file in the real `octagon-erp` worktree touched by this wave was
  read via `git status`/`git rev-parse` (see `telegram-worktree-isolation.md`)
  — never its `database.db`.
- The code changes made this wave (`platform-runtime-bridge.mjs`, `server.js`,
  `platform/control_plane/index.mjs`, `modules/fpc-release-health.js`) are
  application-code changes in this worktree only; none of them were executed
  against a live/operational database this wave.

**Result: operational data untouched — not applicable to touch, since this
worktree has no operational data path, and none was created.**
