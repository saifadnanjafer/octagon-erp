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
