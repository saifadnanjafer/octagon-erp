# RELEASE_FINANCE_PAYROLL_PILOT_2026_07_04

## 1. Release Snapshot

- **Release name:** Finance & Payroll — Internal Workshop Pilot (2026-07-04)
- **Timestamp:** 2026-07-04T00:06:00+03:00 (release freeze point)
- **Scope:** Cashbox reconciliation, payroll accrual/payment posting, account_moves as sole source of truth, server-backed operation locking.

### Modified/added files (this release)
| File | Status |
|---|---|
| `app.js` | modified |
| `server.js` | modified |
| `services/financeService.js` | modified |
| `services/permissionService.js` | modified |
| `database.json` | modified (data — auto-mirrored from `database.db`) |
| `scripts/fix_opening_balance_ledger_integrity.mjs` | new |
| `scripts/normalize_opening_balance_metadata.mjs` | new |
| `scripts/create_stabilization_checkpoint.mjs` | new |
| `scripts/cleanup_lock_sprint_test_data.mjs` | new |

(`database.db` is gitignored — not tracked by git; verified against `*.db` in `.gitignore`.)

### Checksums (SHA-256)
| File | SHA-256 |
|---|---|
| `database.db` | `917b5c2fcd8e58e2d5128820ce1e1c7822399e26ee1060572f5d174528d1bc52` |
| `database.json` | `444e4d8ebe83817a30199b0943853e7c7506114bea03a418cf15fff4866db711` |

### GL / Ledger counters at freeze
| Metric | Value |
|---|---|
| account_moves count | 534 |
| journal_entries count | 534 (1:1 mirror, matches account_moves) |
| payroll_periods count | 2 |
| employee_payroll_closings count | 14 |
| payroll_payments count | 3 |
| operation_locks count (active/stale) | 0 |
| cash_workshop (1001) balance | **-458,420** |
| total debit | 69,770,816 |
| total credit | 69,770,816 |
| difference | **0** |
| draft moves count | **0** |
| cancelled moves count | 0 |
| invalid accounts used | **0** |
| hash chain status | **intact — 0 broken links across all 534 posted moves** |
| suspense (9999) moves | 17 (documented, unresolved by design — see §7) |
| employees count | 26 |

## 2. Production Decision

- **UAT Ready:** Yes
- **Production Candidate:** Yes
- **Production Ready for Internal Workshop Pilot:** **Yes**
- **Production Ready for multi-branch/external deployment:** **No** — until stronger deployment controls, role testing, and backup automation are added.

## 3. Final Backup

| Item | Path |
|---|---|
| `database.db` backup | `release-backups/20260704_release_pilot/database.db` |
| `database.json` backup | `release-backups/20260704_release_pilot/database.json` |
| Modified code files (archive) | `release-backups/20260704_release_pilot/code-files.tar.gz` |
| Modified code files (checksum manifest) | `release-backups/20260704_release_pilot/code-files-checksums.txt` |

All backup checksums verified byte-identical to the live files at freeze time (see §1 checksums — they match exactly).

### Restore instructions (short)
1. Stop the server (`Ctrl+C` on the running `node server.js` process, or stop the preview session).
2. Copy `release-backups/20260704_release_pilot/database.db` over the live `database.db` (and likewise `database.json` if needed).
3. Restart the server: `node server.js` (confirm the console prints `Database Engine: SQLite Active`).
4. Re-run the GL validation counters in §1 and confirm they match this document exactly before letting anyone back into the app.

**No database changes are permitted after this backup unless the reason is logged** (in `audit_log` via the app, and as a dated note appended to this file).

## 4. Pilot Rules (first week)

1. Every salary payment MUST go through the new payroll screen (`closePayrollPeriod` → `postPayrollAccrual` → `settlePayrollPayment`) or through `markAsPaid()` — both are ledger-backed now; no other path is permitted.
2. **Never** edit `database.json` by hand.
3. **Never** delete any `account_move`, posted or not.
4. Any financial correction goes through an adjustment (`payroll_adjustments` / `createPayrollAdjustment`) or a reversal (`FinanceService.cancelMove` / `reopenPayrollPeriod`) — never a direct edit.
5. Any `suspense` (9999) movement stays pending for human review — do not force-classify it.
6. Run a database backup every day before the shift ends.
7. No new features on finance/payroll during the first week.

## 5. Monitoring Checklist (daily, 7 days)

Check and record each of the following once per day:

- [ ] `cash_workshop` balance
- [ ] `account_moves` count
- [ ] `journal_entries` count
- [ ] total debit = total credit (difference = 0)
- [ ] draft moves = 0
- [ ] `operation_locks` active/stale count = 0
- [ ] payroll payments made today (count + total amount)
- [ ] suspense (9999) count (should stay 17 unless a human reviewer resolves one)
- [ ] backup created (file exists, non-zero size, checksum recorded)
- [ ] any console errors observed
- [ ] any failed API requests (check server logs / network tab)

## 6. Rollback Plan

If something goes wrong:

1. Stop the server.
2. Copy the current (possibly broken) `database.db` and `database.json` to an **incident backup** (e.g. `database.db.incident-<timestamp>`) — never overwrite it, this is evidence for root-causing later.
3. Restore the last known-good backup (§3) over the live files.
4. Run GL validation (account_moves count, journal_entries count, total debit = total credit, draft moves = 0, hash chain intact).
5. Verify `cash_workshop` balance matches the last confirmed-correct figure.
6. Do not let employees back into the system until a written note explains what caused the incident.

## 7. Known Limitations

- SQLite is adequate for this internal single-workshop pilot; it is **not** necessarily suitable for a wider multi-branch deployment (single-writer characteristics, no built-in replication).
- The 17 `suspense` (9999) movements are historical cash-count differences from the original Excel migration; they require a human (bookkeeper/owner) decision and are deliberately left unresolved.
- The system currently relies on **operational discipline** — no one manually edits `database.json` or `database.db` outside of the documented scripts in `scripts/`.
- This release is scoped for internal workshop use; it is **not** ready for external/customer-facing sale in its current form.
- Any external/multi-branch expansion will need deeper security/roles/permissions testing and load testing beyond what this pilot covers.

---
*No new database changes were made after the backups in §3 were taken, other than writing this report file.*
