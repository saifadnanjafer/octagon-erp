# Checkpoint I — Governed Legacy-to-Canonical Cutover Engine: Canonical Finance Migration

**Repository:** `C:\Users\Zahraa dlbooz\Downloads\odoo-19.0\octagon-erp`  
**Branch:** `cutover/octagon-operational-canonical-migration`  

---

## 1. Canonical Finance Migration Summary

Following successful equivalence validation, `finance-migrator.mjs` performed the governed merge of Chart of Accounts and Journals, followed by header-and-line insertion of all 568 authoritative `account_moves` into canonical Finance tables on staged disposable clones:

| Entity / Target Table | Pre-Migration Count | Migrated / Merged | Post-Migration Count | Status |
| :--- | :---: | :---: | :---: | :---: |
| **Chart of Accounts** (`finance_accounts`) | 16 canonical | 34 legacy merged | 39 unique accounts | `reconciled` |
| **Journals** (`finance_journals`) | 6 canonical | 5 legacy merged | 6 unique journals | `reconciled` |
| **Document Headers** (`finance_documents`) | 0 | 568 headers created | 568 documents | `reconciled` |
| **Journal Entries** (`finance_journal_entries`) | 0 | 568 entries created | 568 entries | `reconciled` |
| **Document Lines** (`finance_document_lines`) | 0 | 1,482 lines created | 1,482 document lines | `reconciled` |
| **Journal Lines** (`finance_journal_lines`) | 0 | 1,482 lines created | 1,482 journal lines | `reconciled` |
| **Validation Entries** (`journal_entries`) | 568 | 568 verified/skipped | 568 validation evidence | `skipped` |

---

## 2. Balance & Financial Integrity Assurance

- **Debit = Credit Equilibrium:**
  - Total Debits Migrated: **IQD 102,339,538**
  - Total Credits Migrated: **IQD 102,339,538**
  - Balance Variance: **IQD 0.00**
- **Immutability & Idempotency:**
  - Standard conflict handling uses `ON CONFLICT DO NOTHING` on posted journal entries and documents. Re-running the migration pass produces zero constraint violations or duplicate key errors.
- **Lineage:**
  - 568 lineage records recorded in `cutover_lineage` referencing `account_moves -> finance_journal_entries`.
