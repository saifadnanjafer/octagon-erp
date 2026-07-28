# Checkpoint F — starting state

## Repository

| | |
|---|---|
| Repository | `saifadnanjafer/octagon-erp` |
| Writable working copy | `C:\Users\Zahraa dlbooz\Downloads\odoo-19.0\octagon-erp` |
| Source branch | `build/octagon-projects-manufacturing-assets-maintenance-fleet` |
| Source commit | `487409a3dfa4fc99acb14da45809f9168a55a588` |
| Review branch | `review/octagon-unified-release-candidate` |
| Branch created from | `487409a3dfa4fc99acb14da45809f9168a55a588` (verified by `git rev-parse` after checkout) |

The review branch was created with `git checkout -b`. No `reset --hard`, no
`clean`, no force push, no history rewrite, no merge into `main`.

First push:

```
git push --set-upstream origin review/octagon-unified-release-candidate
```

Verified immediately after creation:

```
git rev-parse HEAD                                       -> 487409a3dfa4fc99acb14da45809f9168a55a588
git rev-parse origin/review/octagon-unified-release-candidate -> 487409a3dfa4fc99acb14da45809f9168a55a588
```

Local and remote SHAs equal.

## Working tree at entry

13 paths were already dirty at the source commit — they were **not** created by
Checkpoint F:

- 4 modified: `docs/evidence/phase-02/browser-screenshots/*.png`
- 9 untracked: `docs/evidence/phase-03/browser-results/` and
  `docs/evidence/phase-03/browser-screenshots/*.png`

These are regression-run artefacts. They are assessed in
[artifact-hygiene.md](artifact-hygiene.md).

## Operational data — entry hashes

Recorded before any Checkpoint F work. All verification used **disposable**
databases created under the OS temp directory via `freshInstall()`; the
operational store was never opened for write.

| File | Bytes | SHA-256 |
|---|---|---|
| `database.db` | 17,084,416 | `1437550f7a5b84b9191bfde80b210fe73a29999470e216bed609cb7f16efd1f2` |
| `database.db-wal` | 4,783,352 | `4f7a1f51b2cb1bd97fe2df37c2533eb013afb31a0b476a990fc21b50a380c5ec` |
| `database.db-shm` | 32,768 | `62dac42ec52f227a29c70481cdfa121f45f17c639e6f6ac743d51dc983fa8a18` |
| `database.json` | 6,309,472 | `2e4d7d91b15b053d276cf1b5ac2b73524be3bd73da096e5ba925724b61c700a1` |

Exit hashes are recorded in
[operational-data-integrity.md](operational-data-integrity.md).

## VNext freeze fingerprint

`C:\Users\Zahraa dlbooz\Downloads\odoo-19.0\octagon-erp-commercial-vnext`

| | Entry |
|---|---|
| HEAD | `cf7ae4ed73eac91a325c964178036290bc0736c1` |
| Dirty paths | 17 |
| `git status --porcelain` SHA-256 | `bf69e28926ceee96c7b568e1748626dab2afb30ffa42fd7970e2ac1e6779eec6` |

VNext was read for provenance only. No modification, commit, branch, migration,
cleanup, or execution. Exit fingerprint is recorded in
[operational-data-integrity.md](operational-data-integrity.md).

## Environment

| | |
|---|---|
| Node | v24.18.0 |
| Platform | Windows 11 Pro 10.0.26200 |
| SQLite driver | `node:sqlite` `DatabaseSync` |
| Migrations present | 001–060 (60 files, no duplicate numeric prefix) |
