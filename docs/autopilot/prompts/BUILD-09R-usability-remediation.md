# BUILD-09R — BUILD-09 usability remediation

BUILD-09 shipped 32 governed WMS and operations pages whose domain layer, actions, permissions
and audit trail were correct, but whose front end was a single generic shell: one table, one
filter box, and one JSON-ish action dialog per page. Every page was reachable and every action
was callable, yet almost none of them matched how the work is actually done. BUILD-09R is the
chapter that closes that gap.

This prompt exists so the chapter has a stable definition of done rather than being redefined by
whichever session picks it up.

## Scope

**R-1 — runtime and form foundations (COMPLETE).** One canonical runtime context, a real API
client with abort and duplicate-submission handling, governed lookups instead of raw id text
boxes, action-specific forms instead of a JSON console, and a scope selector. This is the layer
every purpose-built workspace is built on.

**R-2 — purpose-built workspaces (IN PROGRESS).** Replace the generic shell on each page with a
workspace shaped like the task. A page is done when it is registered through
`OctagonBuild09.registerPageOverride()`, renders the domain's real read model, drives the real
governed actions from visible controls, and is proven by a real Chromium flow.

## Rules for any session continuing this chapter

1. **Do not rewrite finished workspaces.** Modify an existing purpose-built page only for a real
   defect or for shared-component compatibility.
2. **Build on the shared kernel** (`modules/build09r-shared.js`). It owns bilingual/RTL
   rendering, the guarded single-flight action caller, denied/error classification, governed
   lookup wiring, and the shared KPI/progress/stepper/field primitives. Six groups already use
   it; a seventh that hand-rolls its own is a regression in consistency, not an improvement.
3. **Honour the canonical boundaries.** These pages propose; canonical Inventory, Manufacturing
   and Quality dispose. Where the domain returns `executionBoundary: 'REQUEST_ONLY'`,
   `inventoryWritten: false`, `createAuthorized: false` or a null metric, the UI must render that
   state honestly rather than implying the effect already happened.
4. **Prove it with real clicks.** A `page.evaluate(fetch(...))` does not count as UI proof when a
   visible control exists. Assert against the rendered DOM, and remember the harness renders
   `lang="ar"` — fold Arabic-Indic digits with `latinDigits()` before any numeric assertion, or
   the assertion may pass for the wrong reason.
5. **Keep the BUILD-09 baseline green** and update the page lists in
   `tests/build-09/build09r2-bespoke-contract.test.mjs` as pages move from generic to bespoke.
   That test fails if the lists drift from what the modules actually register.

## Definition of done

BUILD-09R is COMPLETE when every one of the 32 BUILD-09 pages is either purpose-built or has a
recorded, owner-visible decision that the generic shell is genuinely the right shape for it —
not when a session's numeric target happens to be met.

## Progress

- **R-1:** complete.
- **R-2:** 16 of 32 pages purpose-built. Shipped groups and the exact remaining backlog are
  recorded in `docs/autopilot/evidence/BUILD-09R-2-mobile-workspaces.md` and
  `docs/autopilot/evidence/BUILD-09R-2-high-value-page-pack.md`, and pinned in
  `tests/build-09/build09r2-bespoke-contract.test.mjs`.
