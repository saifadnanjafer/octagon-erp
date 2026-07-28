# Checkpoint F — browser acceptance

## Result: NOT PERFORMED for the 13 lifecycle domains

The complete authenticated Chromium lifecycle acceptance required by the mission
(sections 7A–7M: Products/Parties, Inventory, Sales, Procurement, POS, Work
Management, Projects, Engineering/MRP, Manufacturing, Quality, Assets,
Maintenance, Fleet) was **not executed** in this checkpoint.

No screenshots, traces, correlation ids, or command ids were captured for those
lifecycles. **No browser lifecycle proof is claimed.**

## The inherited claim is rejected

The "8/8 Chromium checks" carried into Checkpoint F is **NOT PROVEN**:

- `scripts/checkpoint-d-e-browser-acceptance.mjs` exists, but the branch's own
  `docs/evidence/checkpoint-d-e/test-suite-register.md` states the authenticated
  Chromium acceptance runner for Checkpoint D/E is "**not written**" and that
  "no screenshot artefacts were captured for this checkpoint";
- no Checkpoint D/E screenshot directory exists on disk.

Even had it run, opening a page is not a lifecycle. The mission is explicit that
page-open is not proof, and the inherited claim describes page-level checks, not
posted business lifecycles.

## What browser evidence does exist

| Suite | Result | What it actually proves |
|---|---|---|
| `tests/phase02/browser-live-evidence.test.mjs` | passes in isolation (1/1, exit 0); fails under the phase02 glob | Real Puppeteer/Chromium run: starts `server.js` on a disposable port and SQLite database, performs the real login flow through the DOM, then verifies Arabic `lang="ar"`/`dir="rtl"`, platform-controlled page/action visibility, owner-vs-clerk page differences, logout returning to the login overlay, **direct API calls to hidden actions denied**, server-side session revocation on logout, tenant/company isolation, field-masking metadata, workflow/approval creation and decision through the UI, permission-gated inbox/chatter/uploads, English/LTR switching, desktop and mobile viewports, and unrelated pages still rendering |
| `tests/phase03` | 12/12 pass | Finance canonical cutover, including browser evidence |

This is genuine authenticated browser evidence for the **shell, identity,
permissions, RTL/LTR and responsive** requirements — it is simply not lifecycle
evidence for the thirteen business domains.

## Dispatcher and mounting

Covered structurally rather than visually by
`tests/checkpoint-d-e/shell_dispatcher.test.mjs` (8 tests, all passing) — see
[navigation-and-module-mounting.md](navigation-and-module-mounting.md).

## Why it was not done

Checkpoint F prioritised the audit that decides the release classification: the
canonical authority coverage gap, the legacy-writer state, atomicity,
idempotency and cross-domain integrity. Those findings are sufficient on their
own to prevent a release-candidate verification, so a multi-hour lifecycle
browser run would not have changed the outcome — while the authority gap it
uncovered had to be found and remediated first.

This is a **required** gate and remains outstanding. Recorded in
[unresolved-risks.md](unresolved-risks.md) and
[MAIN_MERGE_READINESS.md](MAIN_MERGE_READINESS.md).
