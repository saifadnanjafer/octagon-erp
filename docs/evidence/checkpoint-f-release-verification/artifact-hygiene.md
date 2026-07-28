# Checkpoint F — artifact hygiene

## Inherited state

At the source commit `487409a3`, 13 paths were already dirty:

- 4 modified `docs/evidence/phase-02/browser-screenshots/*.png`
- 9 untracked `docs/evidence/phase-03/browser-results/*.json` and
  `docs/evidence/phase-03/browser-screenshots/*.png`

The observation that the Checkpoint D/E commit carried Phase 03 browser
artefacts generated during regression runs is **confirmed**: Phase 03 artefacts
are timestamped and regenerate on every run, so any commit made after a Phase 03
run sweeps them in unless they are excluded.

## Churn caused by Checkpoint F itself — disclosed

Re-running the suites to verify the inherited test claims **regenerated more of
these artefacts**. Current state:

| | At entry | Now | Cause |
|---|---|---|---|
| Modified phase-02 screenshots | 4 | **12** | my `tests/phase02` runs (glob run + isolated re-run) |
| Untracked phase-03 artefacts | 9 | **29** | my `tests/phase03` run |

These are byte-different re-renders of the same evidence, not new information.
They carry no finding that the committed versions do not already carry.

## Disposition

**None of this churn was committed.** The Checkpoint F commits stage only:

- `platform/cutover/canonical-authority-map.js`
- `platform/cutover/legacy-writer-retirement.mjs`
- `server.js`
- `tests/checkpoint-f/**`
- `docs/evidence/checkpoint-f-release-verification/**`

Explicitly **not** staged: every regenerated screenshot and browser-result JSON.

The modified files were also **not reverted**. Reverting them would be a
destructive checkout of working-tree content, which this checkpoint is forbidden
to perform and which would discard artefacts without owner review. They are left
in place, dirty and disclosed, for the owner to decide.

## Safety scan

| Check | Result |
|---|---|
| Secrets in new phase-03 browser-result JSON (`api_key`, `secret`, `password`, `token`, `bearer`) | **none found** |
| Databases, WAL/SHM staged | none |
| Credentials, cookies, tokens, raw profiles staged | none |
| Runtime logs staged | none |
| Operational exports or generated backups staged | none |

The repository root does contain 24 `database.backup.*.json` files (~6.5 MB
each, ≈150 MB) and several `browser-*.log` / `workflow*.log` files that predate
this checkpoint. They were **not** created, modified, or staged here.

## Recommendations (not performed — they need owner review)

1. Add `docs/evidence/phase-02/browser-screenshots/` and
   `docs/evidence/phase-03/browser-*/` regeneration output to `.gitignore`, or
   have the runners write to a timestamped scratch directory and promote only
   deliberately-kept artefacts. Today, *running the tests dirties the repo*,
   which is why regression artefacts keep leaking into unrelated commits.
2. Assess the 24 root-level `database.backup.*.json` files for relocation out of
   the repository. They were not deleted: nothing here is deleted merely for
   being old, and backups are exactly the wrong thing to remove without the
   owner.

No history was rewritten. No evidence required by a previously accepted
checkpoint was deleted.
