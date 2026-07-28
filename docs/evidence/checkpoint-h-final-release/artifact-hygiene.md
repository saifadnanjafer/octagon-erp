# Checkpoint H — artifact hygiene

## Classification

| Artefact class | Count | Classification | Disposition |
|---|---|---|---|
| Modified `docs/evidence/phase-02/browser-screenshots/*.png` | ~13 | accidental churn (byte-different re-renders of accepted evidence) | not staged, not reverted |
| Untracked `docs/evidence/phase-03/browser-*` | ~22 | accidental churn | not staged |
| `test-artifacts/` raw runs | 72+ dirs | disposable | **gitignored** (`/test-artifacts/`) — left ignored |
| `docs/evidence/phase-0{1,2,3,4}` committed evidence | — | accepted immutable evidence | preserved untouched |
| `docs/evidence/checkpoint-{f,g}-*` | — | accepted immutable evidence | preserved untouched |
| Operational `database.db*`, `database.json` | — | operational | **gitignored** |
| Root `database.backup.*.json` (24 files) | 24 | pre-existing operational backups | untouched, not deleted |
| Scratchpad `opgate/op.db*` (read-only copy of operational DB) | 3 | temporary, **contains operational data** | written **outside the repository**, under the OS temp scratchpad — never in the worktree, never staged |

## Disposition

Checkpoint H commits stage ONLY source, tests and evidence:

- `platform/operations/release-health.mjs`
- `server.js` (the `/api/release/health` route)
- `tests/checkpoint-h/**`
- `docs/evidence/checkpoint-h-final-release/**`

Explicitly NOT staged: every regenerated screenshot and browser-result JSON,
and every copy of operational data.

## Nothing was removed

The mission permits removing accidental tracked churn through a forward commit
"when safe". It was **not** done, for a specific reason: the churn is modified
copies of **accepted Phase 02 evidence**. Committing the re-renders would
overwrite accepted evidence with images no reviewer has looked at; deleting
them from the index would remove accepted evidence entirely. Reverting the
working tree is a destructive checkout this checkpoint is forbidden to perform.

Leaving them dirty and disclosed is the only option that preserves accepted
evidence and takes no unreviewed action. Three checkpoints have now reached the
same conclusion.

## Safety scan

| Check | Result |
|---|---|
| Databases, WAL/SHM staged | none (gitignored; the operational copy lived outside the repo) |
| Cookies, credentials, profiles staged | none |
| Logs or temporary reports staged | none |
| Duplicate screenshots staged | none |
| History rewritten | no |
| Prior accepted evidence deleted | no |

## Root cause, still open

The Phase 02/03 browser runners write into **tracked** evidence directories, so
running the tests dirties the repository. Identified in Checkpoint F,
reproduced in G and H. The fix — write to `test-artifacts/` (already ignored)
and promote only deliberately kept images — remains unimplemented and is a
MEDIUM risk.
