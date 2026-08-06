# Navigation Visual Recovery 2 — Root Cause and Proof

Generated from the dedicated codex/octagon-feature-page-expansion-marathon
worktree on 2026-08-07. BUILD-13 and BUILD-14 were not started or modified.

## Served-build identity

The owner’s browser was previously viewing http://127.0.0.1:8090. The
listener was PID 2392, launched as node scripts/review/start.mjs. Its served
app.js SHA-256 was
57ea0119e2172098d43d33c3b23f61a6b22f38152db9d1f20084ba50c09c8c08, matching
the frozen octagon-review-build12-freeze-v1 and v2 bundles, not the
development worktree. It did not contain navLabelOverrides.

Only that stale Octagon node process was stopped. The current branch was then
started on the unambiguous loopback URL http://127.0.0.1:8091. After Recovery
2 changes, the served bundle SHA-256 is
10f7854d8c36bc0d12f6ad7b57a6757afa72217cdbe5e97ba6352197ce498cbe,
identical to the current worktree app.js derived from commit
31f85623f32755b8a51ce00cbdf820cf6280e209.

## Root causes

1. The inline shell-recovery CSS in index.html loaded after the mobile drawer
   stylesheet and reintroduced position: sticky plus
   max-width: calc(100vw - 260px). At 339px this left an approximately 79px
   content lane beside the drawer. The drawer was visually present, but the
   page remained permanently compressed.
2. The fixed #pilotReviewLauncher used right: 22px. In RTL the sidebar is the
   right-hand flex item, so the launcher was painted over the lower
   navigation/footer even though it was outside .sidebar-nav.
3. Generated navigation groups were rendered after the initial language-layer
   pass. Their group/domain labels were therefore Arabic while the document
   direction had switched to English.
4. Collapse/domain state was previously represented primarily by CSS classes
   and hidden domain wrappers were not guarded by an explicit canonical
   geometry contract. Recovery 2 now sets hidden, aria-hidden, inert,
   zero-height collapse geometry, aria-expanded, and descendant tab order from
   the one registry-owned tree.

The earlier frozen-build mismatch explains why the owner could still see the
old static-group appearance. It is not being treated as a cache-only issue:
the current served build was measured, its mobile source-order defect was
reproduced, and the layout source was corrected.

## Geometry before and after

Before evidence is preserved under
review-artifacts/navigation-visual-recovery-2/before/. The 339x950 Arabic
capture shows the Review launcher over the lower RTL drawer and the compressed
content lane. The before report intentionally records 0/35 accepted cases
because it reproduces the known broken state.

After evidence is preserved under
review-artifacts/navigation-visual-recovery-2/after/. The real Chromium
acceptance reports 35/35 geometry cases passed:

- 339x950 Arabic RTL: sidebar 277.97px overlay; main content 339px; maximum
  adjacent-group gap 18px.
- 390x844 Arabic RTL: sidebar 300px overlay; main content 390px; maximum gap
  18px.
- 390x844 English LTR: sidebar 300px overlay; main content 390px; maximum gap
  18px.
- 1366x768 Arabic RTL: sidebar 260px fixed lane; main content 1106px;
  maximum gap 18px.
- 1440x900 English LTR: sidebar 260px fixed lane; main content 1180px;
  maximum gap 18px.

In the corrected build, hidden inactive domains and collapsed bodies have
offsetHeight === 0; empty expanded groups, duplicate visible page IDs,
duplicate navigation roots, viewport-height group minima, unintended sidebar
flex growth, sidebar horizontal overflow, Review/nav overlap, and bilingual
label failures are all zero in the visual report.

## Browser noise retained for follow-up

The visual report records pageErrors=0, but it does not hide console/network
noise: the final after run saw 206 console errors across its 35 browser cases,
dominated by existing HTTP 400 (89), 401 (69), 404 (20), one explicit server
401, and the guarded saveData empty-employees warning (27). These are preserved in
review-artifacts/navigation-visual-recovery-2/after-report.json; they are not
claimed as navigation-visual passes or silently classified away.

## Files changed for Recovery 2

- app.js: registry-owned bilingual labels, explicit domain/collapse state,
  inert hidden domains, and language refresh.
- index.html: source-order-safe mobile overlay/full-width content rules.
- style.css: zero-space hidden/collapsed navigation geometry.
- modules/pilot-review-session.css: direction-aware Review placement and
  mobile drawer overlap prevention.
- scripts/navigation/run-visual-acceptance.mjs: real Chromium geometry,
  responsive, bilingual, drawer, and screenshot acceptance.
- package.json: test:navigation and test:navigation-visual commands.
