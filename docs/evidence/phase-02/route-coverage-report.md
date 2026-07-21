# Route Coverage Report

`platform/authorization/route-coverage/index.mjs` records route, page, menu,
action, and public-route rationale metadata. Unknown routes and unmapped public
routes fail closed. `platform/client/governance-bootstrap.mjs` filters visible
navigation from the same server evaluator while deep-link checks still call the
server decision path.

Evidence: `tests/phase02/authorization.test.mjs` **32/32 passed**, including
unmapped route denial, public-route rationale, hidden-button direct-call denial,
coverage reporting, and Arabic role navigation. `tests/phase02/security-suite.test.mjs`
also passed the hidden-action and loopback adversarial cases.

Live legacy route cutover is tracked in `legacy-authority-cutover.md`.
