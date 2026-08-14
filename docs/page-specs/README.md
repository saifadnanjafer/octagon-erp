# Octagon ERP Page Specification Catalog

This is a documentation-only catalog of the **231 primary workspaces** registered at baseline `25c24df753962bbf3c13301eed71624bc0ee39b6`. It was built in the isolated worktree/branch `codex/octagon-page-spec-catalog` while the engineering worktree was concurrently changing.

## Scope

- One canonical Markdown specification per current primary navigation workspace.
- Four embedded tabs and one POS compatibility alias are recorded in MANIFEST.json but do not receive primary workspace specs.
- AS-IS implementation, TARGET BUSINESS CONTRACT, and GAP are kept separate in every file.
- Visible Chromium navigation evidence proves route activation only; it is not presented as workflow or persistence proof.
- Unknowns are explicitly marked NOT VERIFIED.

## Files

- [INDEX.md](./INDEX.md) — domain index and reconciled counts.
- [MANIFEST.json](./MANIFEST.json) — machine-readable page graph and source evidence.
- [STALE_SPEC_RECONCILIATION.md](./STALE_SPEC_RECONCILIATION.md) — post-Product-Recovery refresh procedure.
- [tools/generate-catalog.mjs](./tools/generate-catalog.mjs) — reproducible baseline generator.

## Important baseline contradiction

The navigation forensic report records 24 BUILD-12 destinations as `app.js switchPage`, while the baseline also contains their page registry and renderers in `modules/build12-workspaces.js`. The affected specs preserve both facts and flag reconciliation rather than collapsing the evidence.
