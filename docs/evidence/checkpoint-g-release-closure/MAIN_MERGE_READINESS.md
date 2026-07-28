# Checkpoint G — main merge readiness

## Status: NOT READY as a release candidate. Merge preparation only.

`main` was **not** merged, and no merge was attempted.

## What is on the branch

`review/octagon-unified-release-candidate`, starting from
`81801c4ef7fc3e75ce952abe7dae4ec3b621d6cc`.

| Commit | Content |
|---|---|
| `0962518` | Canonical cutover controller + migration 061 + 17 tests |
| `a87f79d` | Multi-process concurrency + migration 062 (warehouse uniqueness) |
| `b70e143` | Disposable backup/restore + OS port allocation across 37 call sites |
| `3fc2290` | PostgreSQL adapter + portability layer + 22 tests |
| `10aac25` | Complete failure injection, 22 named workflows |
| *(this)* | Evidence pack, package.json serial gates, ledger |

Every commit pushed; local/remote SHA verified equal after each push. No force
push, no history rewrite, no destructive checkout.

## Risk profile of merging as-is

**Source changes are additive and low-risk:**

- Two new platform modules (cutover controller, SQL portability) — no existing
  caller changed.
- `postgres-dialect.mjs` rewritten — it previously threw on every method, so
  nothing could have depended on its behaviour.
- Two forward migrations, 001–060 untouched.
- Test-only changes: port allocation, new suites.
- `package.json` gains scripts; dependencies unchanged.

**Runtime behaviour on the operational database is unchanged.** The cutover
controller cannot activate there (three guards, no bypass), `phase04.canonical_cutover`
stays 0, and `authority_retirement_locks` stays empty. No write that succeeded
before now fails.

**One change carries real operational weight:** migration 062 will **refuse to
apply** if the operational database already contains duplicate warehouse codes.
That is deliberate fail-closed behaviour, but it means the owner should check for
duplicates *before* upgrading. This is the single item to verify before merge.

Rollback is reverting the new files plus a `down()` on 061/062.

## Pre-merge checklist

- [x] Branch continued from the exact expected SHA
- [x] Local and remote SHA equal after every push
- [x] No force push, history rewrite, or destructive checkout
- [x] `main` not merged
- [x] Operational data unchanged (4 SHA-256 identical entry→exit)
- [x] VNext frozen and unchanged (HEAD + dirty fingerprint identical)
- [x] Stash inspected, not applied, not deleted
- [x] Frozen zone untouched and asserted
- [x] Migrations 001–060 not edited
- [x] Every repository suite green (448/448)
- [x] No test weakened; one test updated because the implementation improved, disclosed
- [x] No secrets, databases, WAL/SHM, credentials or logs staged
- [x] Evidence records failures, wrong diagnoses and gaps, not only successes
- [ ] **Check the operational database for duplicate warehouse codes** (migration 062 gate)
- [ ] H1 lifecycle browser proof
- [ ] H2 HTTP-level legacy writer refusal
- [ ] H3 cutover rehearsal against production-shaped data
- [ ] H4 PostgreSQL runtime
- [ ] Owner-approved authorisation to merge

## Recommendation

**Merge the branch as a verification-and-hardening landing — after checking item
one on the unchecked list.**

The reasoning: the code is inert on the operational database, two real defects
are fixed, the test suite is green for the first time in this arc, and the
cutover machinery this branch adds is a *precondition* for closing the remaining
blockers — H1 through H4 cannot be worked on productively while it sits outside
`main`. Holding the branch keeps the fix that unblocks the work out of the trunk.

What must **not** happen is treating this merge as a release. It is not one. The
release candidate remains unverified until H1–H4 are closed.

**Merge requires explicit owner authorisation, which has not been given and was
not assumed.**
