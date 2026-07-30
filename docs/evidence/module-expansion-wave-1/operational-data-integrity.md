# Operational-data integrity

- This worktree contains no `database.db`, SQLite WAL/SHM, or `database.json`.
- Automated migration, domain, API, runtime, and browser tests used temporary
  disposable databases only.
- The preview launcher staged zero operational files and created a fresh
  temporary database under the Windows temp directory.
- Operational data was not opened or mutated.
- Administrator credentials were unchanged.
