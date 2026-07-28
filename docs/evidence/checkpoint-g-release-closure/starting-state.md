# Checkpoint G — starting state

| | |
|---|---|
| Repository | `saifadnanjafer/octagon-erp` |
| Working copy | `C:\Users\Zahraa dlbooz\Downloads\odoo-19.0\octagon-erp` |
| Origin | `https://github.com/saifadnanjafer/octagon-erp.git` |
| Branch | `review/octagon-unified-release-candidate` |
| Expected starting SHA | `81801c4ef7fc3e75ce952abe7dae4ec3b621d6cc` |
| Verified local HEAD | `81801c4ef7fc3e75ce952abe7dae4ec3b621d6cc` — **match** |
| Verified upstream HEAD | `81801c4ef7fc3e75ce952abe7dae4ec3b621d6cc` — **match** |

No newer local work existed beyond the expected SHA, so nothing had to be
preserved or reconciled.

## Worktree at entry

33 dirty paths: 12 modified Phase 02 screenshots, 21 untracked Phase 03
artefacts. All inherited browser churn — see artifact-hygiene.md.

## Stash — inspected, not applied, not deleted

```
stash@{0}: WIP on checkpoint/phase-01-02-closed: b952c72 docs: record Phase 02 validation fix
  database.json | 1745 +++++++++++++++++-  (1725 insertions, 20 deletions)
```

It touches operational `database.json` only. Left exactly as found.

## Operational databases confirmed ignored

```
.gitignore:23:*.db      -> database.db
.gitignore:24:*.db-*    -> database.db-wal, database.db-shm
.gitignore:118:/test-artifacts/
```

## Operational entry hashes

| File | SHA-256 |
|---|---|
| `database.db` | `1437550f7a5b84b9191bfde80b210fe73a29999470e216bed609cb7f16efd1f2` |
| `database.db-wal` | `4f7a1f51b2cb1bd97fe2df37c2533eb013afb31a0b476a990fc21b50a380c5ec` |
| `database.db-shm` | `62dac42ec52f227a29c70481cdfa121f45f17c639e6f6ac743d51dc983fa8a18` |
| `database.json` | `2e4d7d91b15b053d276cf1b5ac2b73524be3bd73da096e5ba925724b61c700a1` |

Exit hashes in operational-data-integrity.md — all identical.

## VNext at entry

HEAD `cf7ae4ed73eac91a325c964178036290bc0736c1`, 17 dirty paths, fingerprint
`bf69e28926ceee96c7b568e1748626dab2afb30ffa42fd7970e2ac1e6779eec6`.
See vnext-fingerprint.md.
