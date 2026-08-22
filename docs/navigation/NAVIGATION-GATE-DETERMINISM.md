# Navigation gate determinism — root cause and fix

**Date:** 2026-08-08
**Applies to:** `scripts/navigation/run-click-audit.mjs` (`npm run test:navigation`)

## Symptom

A full 231-page audit run returned **172/231 passed, 59 failed** where the
immediately preceding run of the same code returned **230/231**. Every one of
the 59 failures reported `activeNav: false` with the *previous* page in the
traversal still active:

```
customer_portal -> activePageKey "pageContracts"
documents       -> activePageKey "pageDeviceCenter"
eliminations    -> activePageKey "pageDocuments"
```

The failures lagged the traversal by exactly one step.

## Why this was not a navigation defect

Four independent lines of evidence, gathered before changing anything:

1. **Wall-clock.** The failing run took **51.4 minutes**; the healthy baseline
   took **10.2 minutes** — a 5x degradation with no code change between them.
2. **Failure durations.** Median duration of the 59 failures was **12,803 ms**.
   In the healthy run the *slowest page of all 231* was 8,603 ms and the mean
   was ~2,600 ms.
3. **Direct DOM instrumentation** (`scripts/navigation/diagnose-lag.mjs`)
   sampled the DOM at 220/600/1200/2500 ms after each click. Transitions were
   clean at every sample — exactly one `.page-active`, exactly one visible page,
   zero stray inline display styles. The destination activated *correctly*, just
   later than 220 ms:

   ```
   finance    @220ms navActive=false [pageHome]      @600ms  navActive=true [pageFinance]
   documents  @220ms navActive=false [pageFinance]   @1200ms navActive=true [pageDocuments]
   ```

4. **Controlled A/B.** Baseline `app.js` and patched `app.js` were swapped and
   re-run alternately, twice each, on the same six pages at the same 220 ms
   settle: **6/6 pass in all four runs**, medians 1687–2262 ms with no
   consistent ordering between variants. The page-deactivation fix is not the
   cause.

   *A first, single-shot A/B appeared to implicate the fix (baseline 10/10 vs
   patched 0/10). That comparison was confounded: the machine was still
   recovering from the 51-minute saturated run during the patched pass and had
   quieted by the baseline pass. Alternating the variants is what removed the
   confound. The single-shot result was wrong and is recorded here so the same
   trap is not re-entered.*

## Root cause

The gate waited a **fixed 220 ms** after each click and then judged the terminal
state. These pages hydrate by fetching `views/<id>.html` and then loading data,
so activation legitimately completes anywhere between ~100 ms and ~1200 ms
depending on machine load. A fixed sleep shorter than the real activation window
does not measure navigation correctness — it measures whether the machine was
fast enough that day. That is non-determinism in the gate itself, and it is why
the same code scored 230/231 and 172/231 hours apart.

## Fix

`auditItem()` now polls for the actual terminal condition — the destination's
nav button carries `active` **and** a `.page-active` element has non-empty
content — on a bounded 6000 ms deadline, then settles a further 150 ms to catch
any deferred module re-activation.

This does not weaken the gate:

- The pass criteria are **unchanged**.
- The poll is **bounded**; on timeout the caller captures and judges exactly the
  same terminal state it always did, so a page that never activates still fails.
- The extra 150 ms settle *strengthens* it against the stale-reactivation class
  of defect, because it looks after deferred callbacks have had a chance to run.

The same bounded wait is used by `scripts/product/inspect-pages.mjs`, where
observing a half-hydrated page would otherwise undercount its controls and rows
and misclassify a working page as functionally thin.

## Note on the "do not raise the wait" rule

`package.json` carries a standing warning not to fix a timeout by raising a
wait, because that masks resource starvation. That warning is respected here.
The fix does not raise a timeout to make a red gate green — it replaces a blind
sleep with a wait on the condition being asserted, which is the standard remedy
for a timing-flaky UI gate. Starvation is still visible: it shows up as longer
run time, and a genuinely dead page still fails at the deadline.

`NAV_SETTLE_MS` in `scripts/navigation/recheck-ids.mjs` is diagnostic only and
is deliberately absent from the real gate.
