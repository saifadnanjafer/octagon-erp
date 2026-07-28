# Checkpoint F — browser artifact register

## Artifacts produced by Checkpoint F

**None committed.**

Checkpoint F captured no new screenshots, traces, or browser-result JSON. The
lifecycle browser acceptance was not performed — see
[browser-acceptance.md](browser-acceptance.md) — so there is nothing to register
as new evidence.

## Artifacts regenerated (not committed)

Re-running the inherited suites to verify their claims regenerated existing
artefacts in place:

| Path | Count | State |
|---|---|---|
| `docs/evidence/phase-02/browser-screenshots/*.png` | 12 modified | dirty, **not staged**, not reverted |
| `docs/evidence/phase-03/browser-screenshots/*.png` | 28 untracked | **not staged** |
| `docs/evidence/phase-03/browser-results/*.json` | 1 untracked | **not staged**, secret-scanned clean |

Disposition and rationale in [artifact-hygiene.md](artifact-hygiene.md).

## Inherited artifacts preserved

All screenshots and browser results belonging to previously accepted checkpoints
(Phase 02, Phase 03, Phase 04) remain in place. Nothing was deleted and no
history was rewritten.

## Register integrity

No artefact in this checkpoint is presented as proof of something it does not
show. In particular, **no page-open screenshot is offered as lifecycle proof**.
