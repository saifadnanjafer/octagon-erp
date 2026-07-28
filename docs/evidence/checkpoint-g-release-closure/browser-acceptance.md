# Checkpoint G — browser acceptance

## Result: NOT PERFORMED. No lifecycle browser proof is claimed.

`scripts/release-candidate-browser-acceptance.mjs` was **not built**. None of
the 13 domain lifecycles specified in mission sections 10–22 were executed in an
authenticated Chromium session. No screenshots, traces, correlation IDs or
command IDs were captured for them.

`docs/evidence/checkpoint-g-release-closure/screenshots/` exists and is
**empty**. It is not padded with unrelated images to look complete.

## Why

Checkpoint G closed six of the seven Checkpoint F blockers with executable
proof: the cutover controller and disposable rehearsal, complete failure
injection, real multi-process concurrency, disposable backup/restore, the
PostgreSQL adapter, and the Phase 02 aggregate isolation defect. That work
consumed the checkpoint.

The lifecycle runner is a substantial build — thirteen full business lifecycles
driven through the real UI with authoritative server-side assertions. Starting
it without finishing it would have produced a half-runner and no proof, and
reporting partial screenshots as "lifecycle proof" is exactly the inherited
claim Checkpoint F rejected.

## What browser evidence does exist

| Suite | Result | What it actually proves |
|---|---|---|
| `tests/phase02` (serial) | **11/11, exit 0** | Real Puppeteer/Chromium: starts `server.js` on a disposable port and database, performs the real login through the DOM, then verifies Arabic `lang="ar"`/`dir="rtl"`, platform-controlled page and action visibility, owner-vs-clerk differences, logout returning to the login overlay, **direct API calls to hidden actions denied**, server-side session revocation, tenant/company isolation, field-masking metadata, workflow approval through the UI, permission-gated inbox/chatter/uploads, English/LTR switching, desktop and mobile viewports, and unrelated pages still rendering |
| `tests/phase03` | 12/12 | Finance canonical cutover including browser evidence |

This is genuine authenticated browser evidence for the **shell, identity,
permissions, RTL/LTR and responsive** requirements. It is not lifecycle evidence
for the thirteen business domains, and is not presented as such.

## Consequence

This is the largest remaining gap and the primary reason Checkpoint G does not
classify as RELEASE CANDIDATE VERIFIED. Recorded in
[unresolved-risks.md](unresolved-risks.md) as blocker **H1**.
