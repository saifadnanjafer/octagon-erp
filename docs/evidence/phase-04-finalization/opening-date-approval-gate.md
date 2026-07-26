# Opening Date Approval Gate — Wave 6

## Finding

**No owner- or source-approved opening-inventory accounting date exists in this
repository.** The gate remains closed.

This session searched the full tree (excluding `node_modules`) for any
declaration of an approved opening date — `openingCutoverDate`,
`opening_cutover_date`, and free-text variants of "approved opening date". Every
hit is either the fail-closed guard itself, a test asserting the guard fires, or
prior evidence recording the same blocker. None is an approval.

## The date was not invented

Per the assignment, no date was derived from file timestamps, migration
execution times, test times, commit dates, or the current system clock. Doing so
would fabricate a material accounting fact — the exact failure mode the guard
exists to prevent.

## Guard is implemented and proven

The approval mechanism already exists and fails closed:

| Location | Behavior |
|---|---|
| `scripts/migrate_legacy_data.mjs:64` | `throw new Error('OPENING_CUTOVER_DATE_REQUIRED: provide --cutover-date as YYYY-MM-DD')` |
| `scripts/migrate_legacy_data.mjs:68` | `OPENING_CUTOVER_DATE_INVALID` on a malformed date |
| `tests/phase04/opening_cutover_phase04.test.mjs:201` | asserts the migration refuses to run without the date |

The code is machine-readable and fail-closed: an operational migration cannot
proceed by omission, only by explicit supply of a valid `YYYY-MM-DD`.

The new client layer maps this correctly too — `OPENING_CUTOVER_DATE_REQUIRED`
surfaces as a typed `CanonicalError` with `code` intact and
`isBusinessRule === true`, distinguishable from an authorization denial
(`tests/phase04-finalization/canonical_client.test.mjs:197-206`).

## Consequence

While the gate is closed:

- Real operational-source migration stays blocked. **Not attempted.**
- No operational cutover may be claimed.
- No production readiness may be claimed.
- Fixture/disposable acceptance may proceed, and did — the Phase 04 aggregate
  suite runs entirely on fresh disposable databases in the OS temp directory.
- A clearly-marked disposable acceptance date may be used for test environments
  only. It must never be applied to operational data.

Implementation readiness and owner approval are separate. This session advanced
implementation readiness; it did not and cannot advance the approval.

## The single owner decision required

Everything else in this wave is complete. One fact is missing, and only the
owner can supply it:

> **Approved opening inventory accounting date: `YYYY-MM-DD`**

Once supplied, it must be validated against the fiscal period and period locks,
then used as the single timestamp for opening stock, opening reservation,
opening valuation, opening GL, audit, and the migration batch — one timestamp
across all six, not six independently chosen ones.
