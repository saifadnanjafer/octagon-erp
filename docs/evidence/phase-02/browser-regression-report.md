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

`tests/phase02/browser-live-evidence.test.mjs` (Puppeteer) passes and produces
screenshots in `docs/evidence/phase-02/browser-screenshots/`:

- Arabic `lang="ar"` and `dir="rtl"` are preserved on the root element,
- the owner login flow through the existing Octagon shell works and applies the
  platform bootstrap,
- role-specific navigation hides `security_center` from a clerk with a limited role,
- direct API calls and request-body identity/company/role overrides are denied.

## Limitation

The live evidence is bounded to three scenarios: Arabic/RTL owner login and
bootstrap, limited-role navigation, and direct API/identity-override denial.
Responsive viewport behavior, English/LTR, session revocation, tenant/company
isolation in the UI, field masking, workflow/approval actions, inbox/chatter,
file flows, and unrelated operational deep links do not yet have live browser
evidence. Gate H is therefore **PARTIAL**, not a closure pass.
