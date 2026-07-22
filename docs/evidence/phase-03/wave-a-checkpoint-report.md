# Wave A Checkpoint Report

**Phase 03 — Finance, Tax, Payments, and Financial Reporting**
**Date:** 2026-07-22
**Branch:** `phase-03/finance-tax-payments-reporting`
**Base commit:** `da0a1a2` (`docs: reconcile phase 02 closure evidence for final status`)

## Scope closed in Wave A

- Evidence and authority map for Phase 03 finance.
- Canonical `finance_canonical` module registration.
- Relational chart of accounts (`finance_accounts`).
- Fiscal-document header/line schema (`finance_documents`, `finance_document_lines`).
- Immutable double-entry GL schema (`finance_journal_entries`, `finance_journal_lines`).
- Reversal links and integrity hashes (`finance_reversal_links`, `finance_integrity_hashes`).
- Fiscal years, periods, and locks (`finance_fiscal_years`, `finance_periods`, `finance_locks`).
- Journals (`finance_journals`).
- First registered finance actions in `platform_actions`.
- Default Iraq-style CoA seed for the default company.
- Wave A test suite.

## Files added/modified

| File | Purpose |
|------|---------|
| `database/migrations/014_finance_canonical_schema_and_coa.mjs` | Wave A migration: schema, module, entities, actions, CoA, periods |
| `platform/finance/engine.mjs` | Core finance engine (accounts, journals, documents, posting, reversal, periods, hash chain, queries) |
| `platform/finance/index.mjs` | Action handler registration and public exports |
| `tests/phase03/finance-wave-a.test.mjs` | Wave A tests |
| `docs/evidence/phase-03/phase-01-02-prerequisite-verification.md` | Phase 01/02 readiness verification |
| `docs/evidence/phase-03/source-lock.md` | Source roots, versions, fixtures, authority inventory |
| `docs/evidence/phase-03/current-finance-authority-map.md` | Current Octagon finance authority map |
| `docs/evidence/phase-03/source-composition-ledger.md` | Source-directed composition decisions |
| `docs/evidence/phase-03/vnext-finance-salvage-ledger.md` | VNext finance salvage plan |
| `docs/evidence/phase-03/donor-license-ledger.md` | Donor license and reuse mode |
| `docs/evidence/phase-03/chart-of-accounts-report.md` | CoA evidence |
| `docs/evidence/phase-03/fiscal-document-report.md` | Document family evidence |
| `docs/evidence/phase-03/gl-integrity-report.md` | GL immutability and hash-chain evidence |
| `docs/evidence/phase-03/posting-atomicity-report.md` | Posting atomicity evidence |
| `docs/evidence/phase-03/reversal-report.md` | Reversal evidence |
| `docs/evidence/phase-03/sequence-and-hash-report.md` | Sequence and hash evidence |
| `docs/evidence/phase-03/period-lock-close-report.md` | Period and lock evidence |

## Migrations

- `014_finance_canonical_schema_and_coa`
  - `dependsOn: ['013_governance_collection_cutover']`
  - `rollbackPolicy: 'reversible'`
  - `down()` drops all `finance_*` tables and deletes `finance_canonical` module/entity/action rows.

## Commands and pass counts

```bash
node scripts/precommit.js
# PASS

node tests/migration/runner.test.mjs
# PASS: 8/8

for f in tests/unit/*.test.mjs; do node "$f"; done
# PASS: all suites

node tests/phase02/identity.test.mjs
# PASS: 32/32

node tests/phase02/runtime-strangler.test.mjs
# PASS: 6/6

node tests/phase02/runtime-adversarial.test.mjs
# PASS: 11/11

node tests/phase03/finance-wave-a.test.mjs
# PASS: 14/14
```

## Legacy authorities retired

None in Wave A. Legacy `services/financeService.js` remains the operational writer; it will be retired through the controlled cutover in later waves.

## Adapters remaining

None in Wave A.

## Unresolved risks

- Failure-injection suite not yet implemented (Wave F).
- Browser evidence not yet produced (Wave F).
- Legacy finance bridge not yet implemented (Wave F).
- Localization pack is a foundation; legal/tax values require accountant/legal validation before release.
- No cross-tenant/cross-company adversarial finance tests yet (Wave F).
- No multi-currency or tax tests yet (Wave C).
- No AR/AP, payment, bank, or budget tests yet (Waves D–E).

## Next wave

Wave B: Fiscal documents, immutable GL, posting, reversal, sequence, and periods — deepen the document lifecycle, add concurrency tests, and strengthen period/close semantics.
