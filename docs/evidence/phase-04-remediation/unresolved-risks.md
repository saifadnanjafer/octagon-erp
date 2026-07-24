# Unresolved Risks

## Critical hard-stop risks

1. Opening stock: 401 source units have no source-backed executed movement lineage.
2. Reservations: 86 reserved units have aggregate fields but no owner/source-line reservation records.
3. Valuation: IQD 1,963,000 cannot be posted without an approved opening-stock date, accounts, dimensions, and policy.
4. Stock-to-GL: canonical journal debit is 0 because the migrator correctly refuses to invent a journal.
5. UI/writer cutover: legacy Phase 04 writers remain authoritative while `phase04.canonical_cutover` is disabled.
6. Browser gate: Phase 04 scenarios cannot truthfully run against a cut-over shell; Phase 02 and 03 live-browser regressions also have failures.

## High residual risks

- `app.js`, `services/stockService.js`, generic collection writers, and legacy customer/supplier/material/task arrays are not retired.
- The server-side strangler paths are present but intentionally dormant for Phase 04 domains.
- Mandatory boundary-by-boundary failure-injection and concurrency lists are only partially covered; atomic finance-port/outbox, reservation serialization, migration failure/parallelism, and POS rollback have proof, but the full matrix does not.
- Full UI/API parity, finance-view conversion, responsive Phase 04 coverage, and unrelated-page browser proof remain incomplete.
- Inherited evidence contains historical false closure claims; this directory and `PHASE_04_REMEDIATION_CLOSURE.md` are the correction.

## Safest next action

Do not activate cutover. Obtain approved opening-stock and reservation-lineage decisions, rerun the disposable migration, then execute writer-denial, UI parity, and real browser suites. Re-run Phase 01-03 browser gates before closure.
