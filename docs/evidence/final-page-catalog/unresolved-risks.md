# Octagon ERP — Final Page Catalog · Unresolved Risks

**Branch:** `build/octagon-final-page-catalog`

| # | Risk | Severity | Status |
|---|---|---|---|
| R1 | `platform/domains/*/index.mjs` (16 files) still contain the two non-functional registration dialects. They are dead code now, but a future contributor could copy the pattern. | Medium | Open. Delete once nothing imports them; `wave2-actions.mjs` is the live path. |
| R2 | 62 of the 65 target page families are unbuilt. Wave 2's 16 domains are connected but only reachable through the API, not through a page. | High (scope) | Open — this is the continuation work. |
| R3 | `rebuildSidebarNavigation()` sweeps any unregistered `data-page` button into `admin_org` at runtime. That hides missing navigation registration instead of surfacing it. | Medium | Open. 14 pages currently rely on it; enumerated in `page-regression.test.mjs`. |
| R4 | The `home_work` nav group is new. Users with a persisted collapsed-group state will see it in its default (open) state. | Low | Accepted — cosmetic, self-correcting. |
| R5 | Populated-state and mutation round-trips are unproven in a browser because the administrator credential was deliberately not used. | Medium | Open — deferred, listed in `DEFERRED_INTEGRATION_AND_HARDENING.md`. |
| R6 | Migration 083 is dialect-neutral but only exercised on SQLite. | Medium | Open. |
| R7 | Two CRM tests and two Wave 2 tests carried stale assertions that would have failed for anyone running the suite after Wave 2 landed. Similar time-bombs may exist in suites not run in this wave (phase02/03/04, checkpoint-*). | Medium | Partially resolved — 4 fixed; the older phase suites were not run (they start servers and Chromium, and are slow). |
| R8 | `platform_pages` is created but not yet populated. The regression scan currently checks the client against itself, not against the server registry. | Medium | Open — populate in the page-registry step of FP-10. |
| R9 | Customization Studio has no governed mutation path: `defineCustomField` / `defineViewSchema` / `saveView` exist in the canonical ConfigurationAuthority but are not registered as ActionExecutor actions, so the page is read-only by design. | Medium | Open — wire real actions in the configuration_center slice (FP-2F). |
| R10 | Commercial Control Center renders storage limits, AI allowances, API limits, and grace/trials as `not_supported` — no canonical backend meters exist for them. | Medium | Open — requires a real metering backend before any number may be displayed. |
| R11 | The migration-manifest gap (067–083 on disk with manifests only to 066) was a pre-existing red gate at `82082bd`; the "128/128" checkpoint claim did not include the migration suite. Repaired via `accepted-067-083-wave2.json`. | Medium | Resolved 2026-07-31. |
| R12 | Browser-level smoke for the 15 FP-2 pages is unproven in this session: the administrator credential was not used (owner constraint) and no synthetic-auth disposable launcher was validated for page screenshots. Behaviour is locked by 95 catalog tests instead; the prior wave's Chromium evidence for the shell/kit/RTL/mobile stands. | Medium | Open — needs a synthetic-auth disposable browser run. |
