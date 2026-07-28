# Checkpoint D/E — verified starting state

Recorded before any file was written.

## Repository

| Item | Value |
|---|---|
| Repository root | `C:\Users\Zahraa dlbooz\Downloads\odoo-19.0\octagon-erp` |
| Origin (fetch/push) | `https://github.com/saifadnanjafer/octagon-erp.git` |
| Source branch | `build/octagon-original-shell-visible-expansion` |
| Source commit (local) | `6adcd0df19788867c336d5020fe0d15cb7a123bb` |
| Source commit (remote) | `6adcd0df19788867c336d5020fe0d15cb7a123bb` |
| Commits newer than source | **none** (`git log 6adcd0d..origin/build/...` empty) |
| Target branch created | `build/octagon-projects-manufacturing-assets-maintenance-fleet` |
| Branch base | `6adcd0df19788867c336d5020fe0d15cb7a123bb` (the highest valid source commit — nothing descends from it) |

`git fetch origin` completed normally. Local and remote source SHAs were
identical, so the new branch was created directly at the source commit.

## Worktree and stash

- Worktree at start: **clean** (`git status --porcelain` produced no output).
- Stash: **1 pre-existing entry, left untouched** —
  `stash@{0}: WIP on checkpoint/phase-01-02-closed: b952c72 docs: record Phase 02 validation fix`

No stash was created, applied, dropped, or reordered.

## Operational database files

Confirmed ignored and untracked:

```
.gitignore:23:*.db        -> database.db
.gitignore:31:/data/      -> data/database.db
```

`git ls-files` returned **no** matches for `database.db`, `database.json`,
`*.wal`, or `*.shm`. The operational stores are not tracked.

### Hashes (MD5)

| File | Before work | After Checkpoint D1 |
|---|---|---|
| `database.db` | `ab024b2cbf46837d966cdf2966fc7441` | `ab024b2cbf46837d966cdf2966fc7441` |
| `database.json` | `644bc345d38d9dc1a826018ed5d4aecf` | `644bc345d38d9dc1a826018ed5d4aecf` |

**Unchanged.** All development and verification ran against disposable
copies staged under `os.tmpdir()` by
`scripts/preview-disposable-server.mjs`, which reports:

```
[preview]   operational database.db is NOT open and cannot be written by this process
```

## VNext freeze baseline

| Item | Value |
|---|---|
| Path | `C:\Users\Zahraa dlbooz\Downloads\odoo-19.0\octagon-erp-commercial-vnext` |
| HEAD at inspection | `cf7ae4ed73eac91a325c964178036290bc0736c1` |
| Worktree state when found | **already dirty** — pre-existing uncommitted modifications to `.ai-team/AUTONOMOUS_RUN_STATE.md`, `.ai-team/CURRENT_HANDOFF.md`, `AGENTS.md`, `ANTIGRAVITY_HANDOFF.md`, `CONTRIBUTING.md` and others |

This dirty state was **found, not created**. VNext was opened read-only. No
file in VNext was written, cleaned, reset, branched, or migrated. See
`frozen-zone-attestation.md`.

## Migration registry resolved

Latest migration present at start: **`051_checkpoint_c_control_entity_policy`**
(51 files in `database/migrations/`, discovered by directory scan — there is no
central registry file to edit). New work therefore begins at **052**.

## Pre-existing test failures (baseline, not caused by this work)

Verified by checking out `6adcd0df` into a temporary worktree and running the
suite there:

| Suite | Baseline result | This branch |
|---|---|---|
| `tests/phase02/browser-live-evidence.test.mjs` | **10/12 passed → FAILS** | 11/12 passed → still fails |

The failure predates this checkpoint. It is recorded, not inherited silently
and not masked.

Additionally, these test directories exist but are **empty** at the source
commit and contain no test files: `tests/rollback`, `tests/concurrency`,
`tests/security`, `tests/contract`, `tests/integration`, `tests/provenance`.
