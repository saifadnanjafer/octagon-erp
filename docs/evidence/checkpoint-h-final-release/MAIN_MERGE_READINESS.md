# Checkpoint H — main merge readiness

## Status: NOT READY as a release candidate. Merge preparation only.

`main` was **not** merged, and no merge was attempted.

## What is on the branch

`review/octagon-unified-release-candidate`, continued from
`7bcf7960aa9bf892ff06eab91fff83f14a54f23a`.

| Commit | Content |
|---|---|
| `f6daba8` | Operational duplicate gate (read-only) + HTTP legacy-writer refusal, 48 tests |
| `9a57dc2` | Server-derived Release Health, 27 signals + endpoint, 14 tests |
| *(this)* | Evidence pack and ledger |

Every commit pushed; local/remote SHA verified equal after each. No force push,
no history rewrite, no destructive checkout.

## Risk profile of merging as-is

**Source changes are additive and low-risk:**

- `platform/operations/release-health.mjs` — new, read-only, no writes.
- `server.js` — one new `GET /api/release/health` route, permission-gated on
  `platform:db:read`. No existing route touched.
- `tests/checkpoint-h/**` — new tests only.
- **No migrations.** `git diff 7bcf796..HEAD -- database/migrations/` is empty.

**Runtime behaviour on the operational database is unchanged.** The new endpoint
only reads. The cutover controller still cannot activate there. Nothing that
worked before now fails.

Rollback is reverting three files.

## The reason merge readiness is not the real question

Checkpoint H found that the operational database is at migration **045** while
the repository is at **062**, with every canonical business table empty. The
live workshop runs on the legacy JSON layer.

So merging this branch is safe and changes nothing operationally — and that is
precisely the point. **The gap between this verified branch and the running
business is not a merge; it is an unexecuted seventeen-migration upgrade plus a
data migration into the canonical schema.** Treating a merge as progress toward
deployment would misread the situation.

## Pre-merge checklist

- [x] Continued from the exact expected SHA
- [x] Local and remote SHA equal after every push
- [x] No force push, history rewrite, or destructive checkout
- [x] `main` not merged
- [x] Operational data unchanged (4 SHA-256 identical across F, G, H)
- [x] Operational database read **read-only**, enforcement proved
- [x] VNext frozen and unchanged (identical fingerprint across F, G, H)
- [x] Stash inspected, not applied, not deleted
- [x] Frozen zone proven unaffected over real HTTP
- [x] Migrations 001–062 not edited; no new migrations
- [x] Every repository suite green
- [x] No test weakened
- [x] No secrets, databases, credentials or logs staged
- [x] Evidence records wrong diagnoses and gaps, not only successes
- [ ] **C1: decide on applying migrations 046–062 to the operational database**
- [ ] **Re-run the warehouse duplicate gate after that upgrade**
- [ ] **Enumerate legacy UI call sites that write governed collections** (they break at cutover)
- [ ] H1 lifecycle browser proof
- [ ] H2 mid-lifecycle injection beyond stock
- [ ] H3 remaining 14 concurrency scenarios
- [ ] H4 PostgreSQL runtime
- [ ] Owner-approved authorisation to merge

## Recommendation

**Merge the branch as a verification-and-hardening landing.** It is inert
operationally, adds no migrations, and gives you a live Release Health endpoint
that will report the truth about the production database the moment you point it
at one — including the seventeen-migration gap.

**Do not treat the merge as a release, and do not activate canonical cutover on
the operational database.** The next decision is not about this branch; it is
C1: whether and when to bring the live database up to migration 062 and migrate
legacy data into the canonical schema. Everything else waits behind that.

**Merge requires explicit owner authorisation, which has not been given and was
not assumed.**
