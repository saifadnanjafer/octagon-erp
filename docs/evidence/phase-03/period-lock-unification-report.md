# Period Lock Unification Report — Phase 03 Final Cutover

**Executing Model**: Gemini 3.6 Flash (High)  
**Date**: 2026-07-23  
**Branch**: `remediation/phase-03-final-cutover`  

---

## 1. Unified Authority Design

Financial period locks are unified in the `finance_locks` table and governed through the single posting authority function `checkPeriodAndLock(dialect, companyId, docDate, options)`.

### Lock Levels Enforced:
1. **Company GL Lock (`gl` / `all`)**: Hard lock for all general ledger journal entries prior to lock date.
2. **Tax Period Lock (`tax`)**: Lock date specifically enforcing tax return and declaration period integrity.
3. **Journal-Specific Lock (`journal_id`)**: Specific lock date overrides per journal (e.g. Bank, Sales, Purchases).
4. **Soft Close vs. Hard Close**:
   - `soft_lock`: Restricts postings for standard users while permitting finance manager overrides.
   - `hard_lock`: Immutable closure blocking all mutations regardless of user role.

---

## 2. Verification Results

- Tested in `tests/phase03/finance-final-cutover.test.mjs`:
  - `Unified Period-Lock Authority: GL lock, tax lock, journal lock, soft/hard close` — **PASSED**.
- Tested in `tests/phase03/finance-wave-f-adversarial.test.mjs`:
  - `locking a period while a document is mid-lifecycle blocks the final post` — **PASSED**.
