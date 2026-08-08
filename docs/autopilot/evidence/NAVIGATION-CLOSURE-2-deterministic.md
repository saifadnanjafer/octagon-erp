# Navigation closure — deterministic 231/231

**Date:** 2026-08-08
**Branch:** `codex/octagon-feature-page-expansion-marathon`
**Commits:** `a8e5e65` (page-deactivation contract), `e28dcc2` (deterministic gate)

## Result

```
npm run test:navigation
Navigation click audit: 231/231 passed; 0 failed.
```

| Metric | Saturated run (pre-fix gate) | Deterministic run |
|---|---|---|
| Result | 172/231 (59 failed) | **231/231 (0 failed)** |
| Wall clock | 51.4 min | 18.9 min |
| Median per page | — | 4,045 ms |
| Slowest page | 36,791 ms | 19,691 ms |
| Console errors | 171 | 184 |
| 404 responses | 11 | 11 |

Method: authenticated Chromium, **visible navigation clicks only, no direct
`switchPage()` calls**, against the disposable review fixture at
`127.0.0.1:8091`. Evidence:
`docs/autopilot/evidence/NAVIGATION-RECOVERY-1-click-audit-all.json`.

## What changed

Two defects, each fixed and separately verified.

### 1. Stale workspace left painted on navigation (`a8e5e65`)

Navigating from a Build10/11/12 self-rendered workspace to any other
destination left the previous workspace visibly on screen. Core `switchPage`
removed only the `.page-active` class, but those hosts additionally toggle
visibility with an inline `style.display`, and an inline style always beats the
`.page{display:none}` CSS rule regardless of class state.

Core `switchPage` now clears both the class and any inline display on **every**
`.page` element, so a foreign destination can correctly hide a Build10/11/12
workspace. Each module wrapper additionally captures its own sequence number
synchronously before any `await` and refuses to mutate the DOM if a newer
navigation started meanwhile, so a deferred activation cannot re-surface a page
the user already left.

Verified by `tests/navigation/workshop-pack-setup-to-readiness.test.mjs`:
real clicks, both directions, including a delayed re-check that no deferred
callback reactivates the previous page. **2/2 pass.**

### 2. The gate itself was non-deterministic (`e28dcc2`)

The audit slept a fixed 220 ms per click before judging. Pages hydrate by
fetching `views/<id>.html`, so activation legitimately lands between ~100 ms and
~1200 ms depending on load — the same code therefore scored 230/231 and 172/231
hours apart. The gate now polls for the condition it asserts on a bounded
6000 ms deadline. Pass criteria unchanged; a page that never activates still
fails. Full root-cause analysis, including a confounded single-shot A/B that
wrongly implicated fix #1 and the alternating A/B that cleared it, is in
`docs/navigation/NAVIGATION-GATE-DETERMINISM.md`.

## Canonical page count

**231** primary workspaces, derived from `NAVIGATION_FORENSIC_REPORT.json`
rather than hard-coded. `tests/page-consolidation/consolidation-contract.test.mjs`
asserts the ledger reconciles against this registry and fails if a literal count
is reintroduced into the generator.

The five owner-approved reclassifications (`calculator`, `kanban`, `locations`,
`workshop_tv` as TAB; `pos_deepening` as ALIAS) are already excluded from the
231 and are covered by that contract, which enforces zero capability loss: each
must stay registered, its canonical parent must stay a live primary
destination, and preserved orphan views must not be deleted.

## Not changed

No payroll, attendance, or timesheet path. No operational or production
database — all runs target the disposable `.review-data` fixture. No Finance,
Inventory, Manufacturing, or Quality authority.
