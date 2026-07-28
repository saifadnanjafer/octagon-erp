# Checkpoint F — navigation and module mounting

Verified structurally by `tests/checkpoint-d-e/shell_dispatcher.test.mjs`
(8 tests, all passing), re-run under Checkpoint F as part of the 56/56 D/E
result.

## Single dispatch authority

| Property | Result |
|---|---|
| `app.js` declares exactly one `switchPage` (at `app.js:4134`) | **PASS** |
| No navigation-related function defined twice at top level — the only duplicate top-level function is the unrelated `renderAttendanceCalendar` | **PASS** |
| `index.html` installs a single idempotent template guard | **PASS** |
| Canonical modules wrap rather than replace the dispatcher | **PASS** |
| Modules delegate to the original dispatcher | **PASS** |
| Activation gated on `ensurePageTemplateLoaded` | **PASS** |
| Modules are re-entry guarded (initialise exactly once) | **PASS** |
| Modules mount on a real page host | **PASS** |
| `window.switchPage` is not replaced outright | **PASS** |
| Canonical modules loaded by the original shell (`canonical-projects.js`, `canonical-engineering.js`) | **PASS** |

There is one dispatch authority and no shadowed dispatcher. The historical
failure mode in this codebase — a module replacing `switchPage`, plus a race
that swaps mounted content after activation — is guarded by test.

## Shell-level browser evidence

From `tests/phase02/browser-live-evidence.test.mjs` (real Chromium, real login
through the DOM):

- Arabic `lang="ar"` / `dir="rtl"` preserved
- English / LTR switching works
- desktop and mobile viewports remain usable
- owner sees privileged pages a clerk does not — license/permission-controlled
  visibility
- logout returns to the login overlay
- unrelated operational pages still render (strangler regression guard)

## Limits — what was NOT verified

The mission asks for a per-module audit across all 19 visible modules covering
permission-denied, server-error, empty, loading and post-command-refresh
states, in Arabic RTL and English LTR, at desktop/tablet/mobile.

**That per-module state matrix was not executed.** What is proved is that the
dispatcher is single and correctly wrapped, and that the shell as a whole
handles RTL/LTR, responsive layout and permission-gated visibility. Per-module
empty / loading / error / post-refresh states are **unverified**, as is the
tablet breakpoint specifically.

No dead or duplicate navigation code was found requiring removal, so no
navigation repair commit was needed. The shell was not redesigned.
