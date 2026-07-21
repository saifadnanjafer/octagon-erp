# Browser and Shell Regression Report

## Evidence available

`platform/client/` contains the Octagon-native CRUD, chatter, inbox, print,
export, workflow-builder, ACL admin, and governance bootstrap assets. `index.html`
preserves the existing grouped sidebar and loads the existing platform client
assets; `app.js`, operational pages, payroll, attendance, and timesheet behavior
were not modified by Phase 02.

The runtime cutover is now live in `server.js` and `app.js`:

- `server.js` initializes the Phase 02 platform authority after migrations and
  exposes `GET /api/auth/bootstrap` with the canonical navigation and action
  payload derived from the evaluator.
- `app.js` calls `/api/auth/bootstrap` after a successful server login, stores the
  payload in `window.__octagonBootstrap`, and applies platform-controlled page
  visibility through `isPlatformPageVisible()` / `applyPlatformBootstrapVisibility()`
  while preserving the Arabic RTL layout.

`tests/phase02/security-suite.test.mjs` passed the role-specific RTL bootstrap,
deep-link denial, impersonation banner/field metadata, and unrelated/frozen-zone
regression assertions as part of **24/24**.

`tests/phase02/browser-evidence.test.mjs` (contract-level) passes:

- bootstrap payload shape and Arabic/RTL identity,
- bootstrap page catalogue matches the server contract for an owner,
- `app.js` is wired to the bootstrap endpoint and visibility helpers.

`tests/phase02/runtime-integration.test.mjs` passes:

- server starts, owner login, session info, and bootstrap work end-to-end,
- unauthenticated privileged routes are blocked,
- a clerk without `platform:db:write` / `platform:backup:*` is denied.

## Limitation

No headless browser/Chromium is installed in this environment. Browser evidence is
contract-level DOM/payload and live HTTP evidence, not a real pixel or real-login
browser run. The bootstrap payload, `app.js` wiring, and server route guards are
proven; a full Puppeteer/Playwright regression run remains a recommended follow-up
when the dependency is available. Gate H is **PASS** for the contract-level proof
with this noted limitation.