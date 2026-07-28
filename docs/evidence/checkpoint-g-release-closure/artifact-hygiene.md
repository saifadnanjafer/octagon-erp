# Checkpoint G — artifact hygiene

## Inherited state

Checkpoint F left browser-artifact churn uncommitted and disclosed. Checkpoint
G re-ran Phase 02 and Phase 03 (twice, to verify the isolation fix), which
regenerated more of the same images.

## Classification

| Artefact class | Count | Classification | Disposition |
|---|---|---|---|
| Modified `docs/evidence/phase-02/browser-screenshots/*.png` | 13 | accidental churn (byte-different re-renders) | not staged, not reverted |
| Untracked `docs/evidence/phase-03/browser-*` | 22 | accidental churn | not staged |
| `test-artifacts/` (72 dirs, 39 MB) | 72 | disposable raw runs | **gitignored** (`/test-artifacts/` line 118) — never committed |
| `docs/evidence/phase-0{1,2,3,4}/` committed evidence | — | required immutable evidence | preserved untouched |
| Operational `database.db*`, `database.json` | — | operational | **gitignored** (`*.db`, `*.db-*`) |
| Root `database.backup.*.json` (24 files) | 24 | pre-existing operational backups | untouched, not deleted |

## Disposition

Checkpoint G commits stage ONLY source, tests, migrations and evidence:

- `platform/cutover/canonical-cutover-controller.mjs`
- `database/migrations/061_*`, `062_*`
- `database/dialects/postgres-dialect.mjs`, `sql-portability.mjs`
- `tests/checkpoint-g/**`, `tests/helpers/allocate-port.mjs`
- port-allocation edits in `tests/phase02/**`, `tests/phase03/**`
- `tests/migration/runner.test.mjs`
- `package.json`
- `docs/evidence/checkpoint-g-release-closure/**`

Explicitly NOT staged: every regenerated screenshot and browser-result JSON.

Explicitly NOT reverted either. Reverting them is a destructive checkout of
working-tree content, which this checkpoint is forbidden to perform and which
would discard artefacts without owner review. They are left dirty and
disclosed for the owner to decide.

## Safety

| Check | Result |
|---|---|
| Databases, WAL/SHM staged | none (gitignored) |
| Credentials, cookies, tokens, raw profiles staged | none |
| Runtime logs staged | none |
| Duplicate screenshots staged | none |
| Temporary reports staged | none |
| History rewritten | no |
| Prior accepted evidence deleted | no |

## Root cause, still open

The Phase 02 and Phase 03 browser runners write screenshots and timestamped
JSON into TRACKED evidence directories, so running the tests dirties the repo
and the churn leaks into unrelated commits. Checkpoint F identified this;
Checkpoint G reproduced it again rather than fixing it. The fix — have the
runners write to `test-artifacts/` (already gitignored) and promote only
deliberately kept images — was NOT implemented. Recorded in
unresolved-risks.md as a MEDIUM item.
