# Octagon ERP — Final Page Catalog · Operational Data Integrity

**Branch:** `build/octagon-final-page-catalog`

## 1. The operational database was never opened

The live operational database is `octagon-erp/database.db`, inside the
Telegram-bot worktree. It is `.gitignore`d (`*.db`, `*.db-*`) and is **not**
present in this worktree.

Fingerprint taken at FP-0 entry by `ls` + `sha256sum` only — the file was never
opened by a SQLite driver, never migrated, never checkpointed:

| File | Size | Modified | SHA-256 |
|---|---:|---|---|
| `octagon-erp/database.db` | 17,084,416 | 2026-07-30 16:33 | `acfd3ab89e805abd49a724e2e177f75f14594b80861e3260639b387bca3a4683` |
| `octagon-erp/database.db-wal` | 0 | 2026-07-30 16:36 | — |
| `octagon-erp/database.db-shm` | 32,768 | 2026-07-30 16:37 | — |

The WAL is 0 bytes, i.e. the last operational writer closed cleanly. This wave
must leave it that way.

## 2. Rules enforced in this wave

- No server in this worktree is started against `octagon-erp/database.db`.
- No migration is applied operationally.
- No operational JSON (`database.json`, `octagon_payroll` exports) is written.
- No WAL checkpoint is executed against the operational file.
- No credential, session, or canonical lock is modified.
- No production backup, restore, or cutover is executed.
- **Never** issue a partial `POST /api/db` — a partial body replaces
  collections server-side and wipes `omni`/`employees`/`finance`.

## 3. Disposable environment contract

Any runtime verification in this wave uses:

- a disposable database file created under the session scratch directory,
  never `database.db`;
- an isolated port (not the operational port);
- an isolated browser profile;
- synthetic records only.

`this worktree contains no *.db file` is verified by:

```bash
find . -maxdepth 2 -name '*.db' -o -maxdepth 2 -name '*.sqlite'   # -> empty
```

## 4. Frozen zone — payroll, attendance, timesheet

Per `CLAUDE.md`, these remain **read-only in every edit of this wave**:

```
employees                      employee_advances
employee_payroll_closings      payroll_payments
payroll_periods                omni.employeeAttendance
omni.workshopAdvances          omni.workshopTimesheetCases
```

No new payroll engine, no second attendance calculator, no "improved" import.
Pages in this wave that display payroll or attendance facts (`employee_services`,
`expenses_cash_travel`, `talent_*`) read them and never write them.
