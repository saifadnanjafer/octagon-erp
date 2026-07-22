# Wave A — Sequence and Hash Report

**Scope:** `FN-006` Gapless/tamper-evident journal numbering.
**Evidence date:** 2026-07-22

## What was implemented

- Document number allocation uses the Phase 01 `platform/records/sequences` authority (`nextSeq`).
- Scope per `(move_type, company_id)`.
- Templates per document type: `JV-{YYYY}-{#####}`, `INV-{YYYY}-{#####}`, `BILL-{YYYY}-{#####}`, etc.
- Numbers are allocated inside the posting transaction, so a rollback does not consume them permanently.
- Hash chain links each posted journal entry to the previous posted entry for the same company.
- `verifyHashChain()` recomputes every hash from stored inputs and validates chain continuity.
- Stored hash inputs in `finance_integrity_hashes` allow independent reconstruction and forensic verification.

## Files changed

- `platform/finance/engine.mjs` — `sequenceTemplate`, `lastJournalEntryHash`, `buildHashInput`, `verifyHashChain`.
- `platform/records/sequences/index.mjs` — reused unchanged.
- `database/migrations/014_finance_canonical_schema_and_coa.mjs`.

## Tests and results

| Test | Result |
|------|--------|
| Post document assigns sequence number | PASS |
| Hash chain verifies after multiple postings | PASS |
| Append-only GL trigger protects posted data | PASS |

Command:

```bash
node tests/phase03/finance-wave-a.test.mjs
```

## Sample output

After posting three manual entries:

```text
entry_number: JV-2026-00001, hash: ..., prev_hash: 0000...0000
entry_number: JV-2026-00002, hash: ..., prev_hash: <hash of 00001>
entry_number: JV-2026-00003, hash: ..., prev_hash: <hash of 00002>
```

`verifyHashChain()` returns `{ ok: true, count: 3 }`.
