# Unified Expansion Architecture Decisions

## UE-ADR-001 — One original Octagon product

Original `octagon-erp` remains the only product shell, server, repository, and
runtime. VNext is read-only project-owned salvage material.

## UE-ADR-002 — Modular monolith and strangler

Canonical domains live under `platform/**` and are exposed through registries,
commands/actions, and queries. Original pages are adapted progressively. A
domain cutover requires data reconciliation, client/runtime parity, and active
legacy-writer denial.

## UE-ADR-003 — Relational governed facts

Finance, stock, reservations, valuation, payments, commercial documents, tasks,
audit, and licensing use explicit relational facts and commands. JSON remains
for metadata, preferences, safe configuration, and compatibility projections.

## UE-ADR-004 — Source-safe SQLite acceptance

When the live SQLite database has WAL state, copying only `database.db` is not a
logical snapshot. Disposable acceptance must first stage byte copies of
`database.db` and its WAL without opening the operational path, then consolidate
that staged pair with `VACUUM INTO`. DB, WAL, SHM, and JSON fingerprints are
recorded before and after, and only the consolidated disposable copy is writable.

## UE-ADR-005 — Canonical finance posting

Opening inventory and every other accounting event must use the Phase 03 finance
authority. Direct insertion of `posted` documents, journal entries, or journal
lines is prohibited. The accepted lifecycle is create → submit → approve → post,
inside the migration's disposable transaction boundary.

## UE-ADR-006 — Fail-closed source policy

Account, company, currency, date, dimension, quantity, reservation, valuation,
and lineage ambiguity is quarantined or blocks the migration. Fallback IDs that
do not resolve to real valid rows are prohibited.

## UE-ADR-007 — Browser evidence

Generated JSON or source inspection is not browser evidence. A browser result
must drive the real original Octagon UI against an isolated runtime and
disposable accepted database.

## UE-ADR-008 — Frozen workforce facts

Payroll, attendance, and timesheet collections and behavior remain read-only.
No later wave may migrate, replace, or write them.

## UE-ADR-009 â€” Two-key legacy-writer retirement

Phase 04 legacy mutation denial is active per domain only when both
`phase04.canonical_cutover` is enabled and the exact domain row in
`authority_retirement_locks` is `RETIRED` with the expected canonical target.
The flag alone, a row alone, a wrong target, or a missing table cannot be
represented as completed retirement.
