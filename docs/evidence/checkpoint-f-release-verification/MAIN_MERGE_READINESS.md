# Checkpoint F — main merge readiness

## Status: NOT READY for main merge. Merge preparation only.

`main` was **not** merged, and no merge was attempted. This document assesses
readiness; it does not authorise anything.

## What is on the review branch

`review/octagon-unified-release-candidate`, branched from
`487409a3dfa4fc99acb14da45809f9168a55a588`.

| Commit | Content |
|---|---|
| `4f7e646` | Authority-map extraction, seven D/E domains registered, retirement locks declared, authority-coverage suite, baseline evidence |
| `5c2f6d3` | Atomicity, idempotency and cross-domain integrity suites |
| (this) | Full Checkpoint F evidence pack and decision |

Every commit was pushed and local/remote SHA equality verified immediately
after each push. No force push. No history rewrite. No destructive checkout.

## Risk profile of merging this branch as-is

The **code** change is small and low-risk:

- `platform/cutover/canonical-authority-map.js` — new, extracted verbatim from
  `server.js` plus seven added domain entries
- `platform/cutover/legacy-writer-retirement.mjs` — added lock definitions, guard
  reads a merged map
- `server.js` — 90 lines removed, 8 added; pure extraction, verified by diff
- `tests/checkpoint-f/**` — new tests only
- `docs/evidence/**` — documentation only

It is **inert at runtime**: `enforced()` still requires the cutover flag and a
RETIRED lock, neither of which exists, so no write that succeeded before now
fails. Confirmed by re-running Checkpoint C (100/100), Phase 04 (47/47),
Phase 04 finalization (100/100) and Checkpoint D/E (56/56) after the change.

Rollback is reverting two source files.

## Why merge is still withheld

Merge readiness is not the same as change safety. The branch's *purpose* was to
establish that the completed modules form a unified release candidate, and it
established the opposite for 12 of 13 domains.

Blocking items, from [unresolved-risks.md](unresolved-risks.md):

| Id | Blocker |
|---|---|
| **C1** | Legacy writers live for 12 of 13 domains; only FINANCE enforced |
| **H1** | No end-to-end lifecycle browser proof for any of the 13 domains |
| **H2** | Backup/restore never exercised |
| **H3** | Multi-process concurrency unproven |
| **H4** | PostgreSQL adapter unimplemented |
| **H5** | Failure injection covers 3 of 20 named points |

## Pre-merge checklist

- [x] Branch created from the exact verified source SHA
- [x] Pushed; local and remote SHA equal after every push
- [x] No force push, history rewrite, or destructive checkout
- [x] `main` not merged
- [x] Operational data unchanged (4 hashes identical entry→exit)
- [x] VNext frozen and unchanged (HEAD + dirty fingerprint identical)
- [x] Frozen zone untouched and now protected by assertion
- [x] Full repository regression run, per suite, no aggregation
- [x] No test weakened or removed to preserve an implementation
- [x] No secrets, databases, WAL/SHM, credentials or logs staged
- [x] Evidence records failures and gaps, not only successes
- [ ] Owner-approved authorisation to merge
- [ ] C1 resolved (cutover run per domain)
- [ ] H1 lifecycle browser proof
- [ ] H2 backup/restore proof
- [ ] H3 multi-process concurrency proof

## Recommendation

Two defensible options, for the owner to choose:

**A — Merge the branch now as a verification and hardening landing.** The code
change is inert, reversible and strictly improves the cutover machinery (the
seven D/E domains become retirable for the first time), and the test suites are
pure additions. This banks the remediation and the regression guard without
claiming release readiness.

**B — Hold the branch until C1, H1 and H2 are closed,** then merge once as a
genuine release candidate.

I recommend **A**, because C1 cannot be closed without the cutover, and the
cutover cannot be run safely without the lock definitions this branch adds. B
leaves the fix that unblocks the work sitting outside `main`.

Either way, **merge requires explicit owner authorisation**, which has not been
given and was not assumed.
