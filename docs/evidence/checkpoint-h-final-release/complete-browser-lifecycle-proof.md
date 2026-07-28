# Checkpoint H — complete browser lifecycle proof

# RESULT: NOT PERFORMED. No lifecycle browser proof is claimed.

`scripts/release-candidate-browser-acceptance.mjs` was **not built**. None of
the thirteen domain lifecycles specified in mission sections 6-18 were executed
in an authenticated Chromium session. No screenshots, traces, correlation IDs
or command IDs were captured for them.

`docs/evidence/checkpoint-h-final-release/screenshots/` exists and is **empty**.
It is not padded with unrelated images to look complete.

## Why

Checkpoint H closed three of Checkpoint G's eight blockers completely — the
real-HTTP writer refusal, the server-derived Release Health diagnostics, and
the read-only operational warehouse gate (which uncovered the seventeen-migration
deployment gap). The lifecycle runner is a build on the scale of all three
combined: thirteen full business lifecycles driven through the real UI with
authoritative server-side assertions at every step.

Starting it and not finishing would have produced a half-runner and no proof,
while leaving the three closable blockers open. Reporting partial screenshots as
"lifecycle proof" is precisely the inherited claim Checkpoint F rejected, and
the mission forbids converting a failing lifecycle into a page-open test.

## What browser evidence does exist

| Suite | Result | What it actually proves |
|---|---|---|
| `npm run test:phase02` (serial) | 11/11, exit 0 | Real Puppeteer/Chromium against the real server: DOM login, Arabic `lang="ar"`/`dir="rtl"`, platform-controlled page and action visibility, owner-vs-clerk differences, logout to the login overlay, **direct API calls to hidden actions denied**, server-side session revocation, tenant/company isolation, field masking, workflow approval through the UI, permission-gated inbox/chatter/uploads, English/LTR switching, desktop and mobile viewports |
| `tests/phase03` | 12/12 | Finance canonical cutover including browser evidence |
| `tests/checkpoint-h/http_legacy_writer_refusal.test.mjs` | 62/62 | **Real HTTP against the real server** — 40 observed refusals, frozen-zone negative control, Release Health endpoint |

The last of these is new in Checkpoint H and is genuine end-to-end HTTP proof
through `server.js` — it is simply not *browser* proof, and not lifecycle proof
for the thirteen domains.

## Consequence

This remains the largest gap in the release and is the primary reason the
classification is not RELEASE CANDIDATE VERIFIED.
