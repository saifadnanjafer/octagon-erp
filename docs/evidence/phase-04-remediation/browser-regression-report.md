# Browser Regression Report

## Phase 04 gate

Command: `node tests/phase04/browser_phase04_remediation.mjs`

- Exit code: `2`
- Status: `BLOCKED`
- Executed scenarios: `0`
- Pass/fail/skip: `0 / 0 / 0`
- Artifact: `docs/evidence/phase-04-remediation/browser-scenario-results.json`

This is intentional. The inherited file did not launch a browser; it queried an in-memory database and searched source text, swallowed migration errors, and printed `100%` even with a failed Work Item scenario. That proof is invalid and has been replaced.

Real Phase 04 UI scenarios were not executed because the source-data migration hit the quantity/reservation/valuation/stock-to-GL hard stop before UI cutover. The shell feature flag remains disabled.

## Prior-phase real-browser regression

- Phase 02 Puppeteer full run: exit `1`, 8/12 in the full run. Isolated retries passed RTL, role navigation, and direct API checks, but login/logout and session-revocation transitions remained reproducibly failing. The suite is not reported as passed.
- Phase 03 Puppeteer run: exit `1`, 5/9. Failures were finance navigation/render and login-overlay transitions.
- Current Phase 03 artifact: `docs/evidence/phase-03/browser-results/finance-browser-evidence_2026-07-24T00-11-15-761Z.json`
- Current Phase 03 screenshots: `docs/evidence/phase-03/browser-screenshots/P03-BR-*_2026-07-24*.png`

Because prior-phase browser regressions also failed, the prompt's independent closure gate is not satisfied even apart from the Phase 04 migration hard stop.
