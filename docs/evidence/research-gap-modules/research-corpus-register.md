# Research Corpus Register

## Located and inspected

| File | Location | Lines | Role |
|---|---|---|---|
| `MASTER_CAPABILITY_INTEGRATION_MATRIX.md` | `..\21-7 MD\` (sibling to `octagon-erp`, **not** inside the git repo) | 571 | Primary capability matrix — ~223 rows across PK/GV/FN/SC/OP/HR/UX/AI/CM/TR |
| `OCTAGON_TARGET_ARCHITECTURE.md` | `..\21-7 MD\` | 1993 | Companion doc #4 — target architecture |
| `OCTAGON_TRANSFORMATION_AND_INTEGRATION_MASTER_PLAN.md` | `..\21-7 MD\` | 864 | Companion doc #1 |
| `OCTAGON_MASTER_ROADMAP_PHASES.md` | `..\21-7 MD\` | 641 | Phase roadmap |
| `SOURCE_TO_TARGET_EXTRACTION_MAP.md` | `..\21-7 MD\` | 1663 | Companion doc #2 |
| `HERE.md`, `STRUCTURE.md` | tracked inside `octagon-erp` (every worktree has its own checked-out copy) | — | Per-worktree orientation docs |
| `docs/evidence/final-page-catalog/*` | inside repo, `build/octagon-final-page-catalog` branch | — | Source-of-truth for the FP-2 completion claim (verified in `starting-state.md`) |
| `docs/evidence/checkpoint-j-staged-cutover-closure/*` | inside repo, `cutover/octagon-operational-canonical-migration` branch | — | Confirms the unrelated cutover effort's real status (PARTIAL, not this wave's concern) |
| `docs/evidence/model-execution-ledger.md` | inside repo | — | Prior-run ledger; this wave appends to it, does not edit it |

## Referenced but not located (recorded as unavailable, not invented)

- `VNEXT_SALVAGE_AND_MERGE_BLUEPRINT.md` — listed as companion doc #3 by
  `MASTER_CAPABILITY_INTEGRATION_MATRIX.md` §"Companion documents". Not found
  under `21-7 MD/`, `erp-research/`, or inside the `octagon-erp` repository
  tree (`git ls-tree` across `build/octagon-final-page-catalog`,
  `build/octagon-module-expansion-wave-1`, `build/octagon-module-expansion-wave-2`,
  `main`, `cutover/octagon-operational-canonical-migration` — no match). Content
  not invented; row-level VNext-asset claims in the matrix were cross-checked
  against actual repository files instead (see gap matrix).

## Secondary corpus (present, lower precedence per §3)

- `erp-research/` (sibling folder): `00-octagon-baseline.md` through
  `11-nocobase-deep-source.md`, `MASTER_PLAN.md`, `BUILD_PACKETS.md`,
  `PROGRESS.md` — donor-system research notes. Not re-read in depth this wave;
  the capability matrix already digests their conclusions into disposition
  decisions (§4 source aliases), and source precedence rule 2 (executable
  current repository behavior) outranks this material regardless.
- `octagon-analysis/` — frozen per project `CLAUDE.md`; read-only reference,
  not touched.

## Duplicate-copy handling

No duplicate copies of the same named research file were found across
locations — each of the five primary `21-7 MD` files exists exactly once.
No content-hash deduplication was needed.
