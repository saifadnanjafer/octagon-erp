# CAP-00 — Read-only Expansion Lineage Audit

**Decision supplied by owner:** retain
`cutover/octagon-operational-canonical-migration` as the authoritative safety
baseline; audit expansion branches read-only; do not merge or cherry-pick.

## Measured topology

Measurements were taken after `git fetch origin --prune` on 2026-08-01.

| Item | Commit | Result |
| --- | --- | --- |
| Safety baseline | `4c7e58bb3ba3cb149561826146b91d5cc96683e2` | selected authority |
| Common ancestor | `00e60a8d894ed5e4b9a613246fe1b46264e20550` | last shared commit |
| Commercial expansion tip | `220f1cc6ec2ee7b6c301c56445640300066301de` | 40 commits beyond common ancestor |
| Baseline-only delta | `4c7e58b` | 1 commit beyond common ancestor |
| Divergence | `1 / 40` | baseline-only / expansion-only commits |

The expansion sequence is linear from Wave 1 through Wave 2, Final Page
Catalog, Research Gap Modules, and Commercial Operations Closure. It is not
descended from the selected safety baseline.

## Read-only conflict screen

- The baseline-only delta changes `app.js`, `server.js`, and Telegram-specific
  files/tests.
- The expansion delta changes 354 paths (36,148 additions and 241 deletions).
- The only paths shared by both deltas are `app.js` and `server.js`.
- No merge, cherry-pick, rebase, checkout, operational-data access, or VNext
  access was performed.

## Decision and next boundary

The selected cutover branch remains authoritative. Expansion code is evidence
and a candidate integration source only. Any future integration requires a
separate, explicit conflict-resolution plan for `app.js` and `server.js`; it is
not authorized by this audit.

The next eligible queue item, once CAP-00 status is recorded after this
evidence is published, is CAP-01. Its allowed scope is read-only commercial
operations reconciliation against this baseline; it must not merge or
cherry-pick expansion code.
